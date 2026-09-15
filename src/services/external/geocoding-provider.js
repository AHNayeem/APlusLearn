import "server-only";
import {
  CITY_CENTROIDS,
  FSA_CENTROIDS,
  provinceFromFsa,
  coarsenCoordinates,
} from "@/lib/geo";
import { requireIntegration } from "@/lib/config/env";

/**
 * Geocoding (§29, §38).
 *
 *   LocalTableGeocodingProvider — development. A bundled table of Ontario
 *                                 municipal and FSA centroids.
 *   GoogleGeocodingProvider     — production. Country-restricted lookups
 *                                 against the Google Geocoding API.
 *
 * Three rules hold whichever provider is running:
 *
 * 1. **Coordinates are always approximate.** A production geocoder returns
 *    rooftop precision for a full address; every result is passed through
 *    `coarsenCoordinates` before it leaves this module, so nothing finer than
 *    about a kilometre is ever stored or compared (§15, §42).
 * 2. **Failure is never fatal.** A geocoder that is down, rate-limited or
 *    simply has no answer returns `null` and search falls back to
 *    non-geographic matching. It must not break booking or search.
 * 3. **Diagnostics never contain the input.** A failed lookup logs the reason
 *    and the provider's status, never the postal code or address that
 *    produced it.
 */

export class GeocodingProvider {
  get name() {
    throw new Error("not implemented");
  }

  /**
   * @returns {Promise<null | {
   *   city: string, province: string, coordinates: [number, number],
   *   precision: "POSTAL_CODE"|"CITY"|"PROVINCE", postalCodePrefix?: string
   * }>}
   */
  async lookup() {
    throw new Error("not implemented");
  }
}

/**
 * Development provider. Covers the Ontario cities and forward sortation areas
 * the seed data uses, and falls back to the province's largest city so a
 * distance search still returns something sensible rather than nothing.
 */
export class LocalTableGeocodingProvider extends GeocodingProvider {
  get name() {
    return "LOCAL_TABLE";
  }

  async lookup({ postalCode, city, province } = {}) {
    if (postalCode) {
      const fsa = String(postalCode).toUpperCase().replace(/\s/g, "").slice(0, 3);
      const hit = FSA_CENTROIDS[fsa];
      if (hit) return { ...hit, precision: "POSTAL_CODE", postalCodePrefix: fsa };

      const provinceGuess = provinceFromFsa(fsa);
      if (provinceGuess) {
        const fallback = Object.values(CITY_CENTROIDS).find((c) => c.province === provinceGuess);
        if (fallback) return { ...fallback, precision: "PROVINCE", postalCodePrefix: fsa };
      }
    }

    if (city) {
      const key = String(city).toLowerCase().trim();
      const hit = CITY_CENTROIDS[key] ?? CITY_CENTROIDS[key.replace(/\s+/g, "")];
      if (hit) return { ...hit, precision: "CITY" };

      // Loose prefix match, e.g. "Toronto, ON".
      const loose = Object.entries(CITY_CENTROIDS).find(([name]) => key.startsWith(name));
      if (loose) return { ...loose[1], precision: "CITY" };
    }

    if (province) {
      const fallback = Object.values(CITY_CENTROIDS).find((c) => c.province === province);
      if (fallback) return { ...fallback, precision: "PROVINCE" };
    }

    return null;
  }
}

const GOOGLE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";

/**
 * Production provider.
 *
 * Lookups are component-filtered rather than free-text, which keeps them
 * inside Canada and stops an arbitrary string being resolved to somewhere
 * unrelated. The API key is read here and nowhere else — it is a server
 * secret and never reaches a client component (§36).
 */
export class GoogleGeocodingProvider extends GeocodingProvider {
  constructor({ apiKey, fetchImpl, timeoutMs = 4000 } = {}) {
    super();
    this.apiKey = apiKey;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.timeoutMs = timeoutMs;
  }

  get name() {
    return "GOOGLE";
  }

  async lookup({ postalCode, city, province, country = "CA" } = {}) {
    const components = [`country:${country}`];
    if (postalCode) components.push(`postal_code:${normalisePostalCode(postalCode)}`);
    if (city) components.push(`locality:${city}`);
    if (province) components.push(`administrative_area:${province}`);
    if (components.length === 1) return null;

    const url = new URL(GOOGLE_ENDPOINT);
    url.searchParams.set("components", components.join("|"));
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("language", "en-CA");

    const payload = await this.request(url);
    if (!payload) return null;

    if (payload.status !== "OK" || !payload.results?.length) {
      // ZERO_RESULTS is an answer, not a fault; the rest are worth seeing.
      if (payload.status !== "ZERO_RESULTS") {
        console.warn(`[geocode] Google returned ${payload.status}${payload.error_message ? `: ${payload.error_message}` : ""}`);
      }
      return null;
    }

    return describe(payload.results[0], postalCode);
  }

  async request(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(url, { signal: controller.signal });
      if (!response.ok) {
        console.warn(`[geocode] Google responded HTTP ${response.status}`);
        return null;
      }
      return await response.json();
    } catch (error) {
      // Never include the query: it is somebody's postal code.
      console.warn(`[geocode] lookup failed: ${error.name === "AbortError" ? "timed out" : error.message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Google result -> the shape the rest of the application already speaks. */
function describe(result, postalCode) {
  const component = (type) =>
    result.address_components?.find((c) => c.types?.includes(type));

  const city =
    component("locality")?.long_name ??
    component("sublocality")?.long_name ??
    component("postal_town")?.long_name ??
    component("administrative_area_level_2")?.long_name ??
    null;

  const province = component("administrative_area_level_1")?.short_name ?? null;
  const postalPrefix = (component("postal_code")?.long_name ?? postalCode ?? "")
    .toUpperCase()
    .replace(/\s/g, "")
    .slice(0, 3);

  const location = result.geometry?.location;
  if (!location || !city) return null;

  return {
    city,
    province,
    // Coarsened on the way out: nothing downstream ever sees a rooftop.
    coordinates: coarsenCoordinates([location.lng, location.lat]),
    precision: postalPrefix ? "POSTAL_CODE" : "CITY",
    ...(postalPrefix ? { postalCodePrefix: postalPrefix } : {}),
  };
}

function normalisePostalCode(value) {
  const clean = String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length > 3 ? `${clean.slice(0, 3)} ${clean.slice(3, 6)}` : clean;
}

let cached = null;

export function getGeocodingProvider() {
  const { name } = requireIntegration("geocoding");
  if (cached?.key === name) return cached.provider;

  const provider =
    name === "google"
      ? new GoogleGeocodingProvider({ apiKey: process.env.GOOGLE_MAPS_API_KEY })
      : new LocalTableGeocodingProvider();

  cached = { key: name, provider };
  return provider;
}

/** Only ever used when the production provider has nothing to say. */
const fallbackProvider = new LocalTableGeocodingProvider();

/**
 * Resolve a location to an approximate coordinate.
 *
 * Returns `null` when nothing matches — callers fall back to non-geographic
 * search rather than failing. This is the only geocoding entry point the
 * services use; no service or component talks to a provider directly.
 */
export async function geocode({ postalCode, city, province } = {}) {
  if (!postalCode && !city && !province) return null;

  const provider = getGeocodingProvider();

  let result = null;
  try {
    result = await provider.lookup({ postalCode, city, province });
  } catch (error) {
    // A provider that throws is a bug in the adapter; it must not take a
    // search or a profile save down with it.
    console.error(`[geocode] ${provider.name} adapter threw: ${error.message}`);
  }

  // The bundled table is a genuine answer for the cities we serve, so a
  // production miss degrades to it rather than to nothing.
  if (!result && provider.name !== fallbackProvider.name) {
    result = await fallbackProvider.lookup({ postalCode, city, province });
  }

  if (!result) return null;

  return { ...result, coordinates: coarsenCoordinates(result.coordinates) };
}
