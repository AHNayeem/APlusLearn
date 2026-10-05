import { serializeJsonLd } from "@/lib/security/json-ld";

/**
 * Structured data for search engines (§32).
 *
 * The only way this application writes a JSON-LD block. The payload is
 * escaped by `serializeJsonLd`, so stored, user-supplied text in it (a tutor's
 * headline, a course description) can never terminate the script element.
 */
export function JsonLd({ data }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
