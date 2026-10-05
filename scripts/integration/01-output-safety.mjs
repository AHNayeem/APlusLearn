/**
 * Output safety and PATCH semantics (audit S1, and the `.partial()` defect).
 *
 * S1: a tutor headline is stored, user-supplied text that ends up inside an
 * inline `<script type="application/ld+json">`. `JSON.stringify` alone lets
 * `</script>` through, so these assert the serialiser that every JSON-LD
 * block now goes through can never be closed early — while still producing
 * JSON that parses back to the original value.
 *
 * PATCH: Zod's `.partial()` keeps `.default()` values, so a one-field PATCH
 * came back from validation with every defaulted field reset. `patchSchema`
 * is the one helper every PATCH route uses instead.
 */
export default async function outputSafety({ section, check }) {
  section("Output safety — JSON-LD cannot be closed by stored text (S1)");

  const { serializeJsonLd } = await import("@/lib/security/json-ld");

  const headline = '</script><script>window.__pwned=1</script>';
  const out = serializeJsonLd({ "@type": "Person", description: headline });

  check("a closing script tag in a value is not emitted verbatim", !out.includes("</script"));
  check("no raw < survives anywhere in the payload", !out.includes("<"));
  check("no raw > survives anywhere in the payload", !out.includes(">"));
  check("ampersands are escaped so no entity can be formed", !serializeJsonLd({ a: "&amp;" }).includes("&"));
  check("an HTML comment opener cannot be formed", !serializeJsonLd({ a: "<!--" }).includes("<!--"));
  check("the result is still valid JSON", (() => {
    try {
      return JSON.parse(out).description === headline;
    } catch {
      return false;
    }
  })());
  const separators = String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
  const sepOut = serializeJsonLd({ a: separators });
  check("U+2028 / U+2029 are escaped for legacy parsers",
    !sepOut.includes(String.fromCharCode(0x2028)) && !sepOut.includes(String.fromCharCode(0x2029)));
  check("and still round-trip", JSON.parse(sepOut).a === separators);
  check("nullish input serialises to an empty object", serializeJsonLd(undefined) === "{}");

  section("PATCH validation — omitted fields are left alone");

  const { patchSchema } = await import("@/lib/validation/common");
  const { provinceSchema, subjectSchema, gradeSchema, courseSchema } = await import("@/lib/validation/admin");

  const provincePatch = patchSchema(provinceSchema).parse({ isActive: true });
  check("a province PATCH naming isActive does not reset usesCourseCodes",
    !("usesCourseCodes" in provincePatch), JSON.stringify(provincePatch));
  check("nor displayOrder", !("displayOrder" in provincePatch));
  check("and keeps what was sent", provincePatch.isActive === true);

  const subjectPatch = patchSchema(subjectSchema).parse({ name: "Mathematics" });
  check("a subject rename does not un-flag it as popular", !("isPopular" in subjectPatch));
  check("nor reactivate or deactivate it", !("isActive" in subjectPatch));

  const gradePatch = patchSchema(gradeSchema).parse({ name: "Grade 12" });
  check("a grade rename does not touch isActive", !("isActive" in gradePatch));

  const coursePatch = patchSchema(courseSchema).parse({ description: "Updated" });
  check("a course edit does not reset isPopular / isActive",
    !("isPopular" in coursePatch) && !("isActive" in coursePatch));

  check("a PATCH still validates the fields it does send",
    patchSchema(provinceSchema).safeParse({ code: "ZZ" }).success === false);
  check("and an empty PATCH is a valid no-op", Object.keys(patchSchema(subjectSchema).parse({})).length === 0);
}
