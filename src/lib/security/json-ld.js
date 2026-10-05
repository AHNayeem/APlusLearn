/**
 * Serialise structured data for an inline `<script type="application/ld+json">`.
 *
 * `JSON.stringify` is not an output encoder. It leaves `<`, `>` and `&` as
 * they are, so a stored string such as a tutor headline of
 * `</script><script>…</script>` closes the JSON-LD block and opens a script
 * the browser runs — and the CSP allows inline script, because Next's
 * streamed payload needs it. Escaping those characters as JSON unicode
 * escapes keeps the document byte-for-byte equivalent JSON (a parser reads
 * the escaped form as `<`) while making it impossible for any value to end the
 * script element or start an HTML comment inside it.
 *
 * U+2028 and U+2029 are escaped too: they are legal in JSON strings but are
 * line terminators to older JavaScript parsers.
 *
 * Every JSON-LD block goes through here — see `components/seo/JsonLd.jsx`.
 */
const UNSAFE = /[<>&\u2028\u2029]/g;

const ESCAPES = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

export function serializeJsonLd(data) {
  return JSON.stringify(data ?? {}).replace(UNSAFE, (char) => ESCAPES[char]);
}
