/** URL-safe slug used for SEO routes (§29). */
export function slugify(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** "grade-12" -> "Grade 12"; used to read slugs back into labels. */
export function deslugify(slug = "") {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
