/**
 * Location primitives (§29).
 *
 * Pure data and maths: distance, the bundled Canadian centroid tables, and
 * the coarsening rule that keeps a stored coordinate approximate. Resolving
 * free text to a coordinate is a provider concern and lives in
 * `services/external/geocoding-provider.js`; this module has no I/O, so
 * anything that only needs a distance can import it without pulling a
 * server-only dependency along.
 */

import { escapeRegex } from "@/lib/security/sanitize";

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two [lng, lat] pairs. */
export function distanceKm([lng1, lat1], [lng2, lat2]) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(a)) * 10) / 10;
}

/**
 * Canadian cities and forward sortation areas (postal-code prefixes) the MVP
 * serves. Coordinates are municipal centroids — deliberately coarse, since we
 * never place a tutor at an exact address (§15, §42).
 */
export const CITY_CENTROIDS = {
  toronto: { city: "Toronto", province: "ON", coordinates: [-79.3832, 43.6532] },
  scarborough: { city: "Scarborough", province: "ON", coordinates: [-79.2318, 43.7764] },
  "north york": { city: "North York", province: "ON", coordinates: [-79.4163, 43.7615] },
  etobicoke: { city: "Etobicoke", province: "ON", coordinates: [-79.5655, 43.6205] },
  mississauga: { city: "Mississauga", province: "ON", coordinates: [-79.6441, 43.589] },
  brampton: { city: "Brampton", province: "ON", coordinates: [-79.7624, 43.7315] },
  markham: { city: "Markham", province: "ON", coordinates: [-79.3370, 43.8561] },
  vaughan: { city: "Vaughan", province: "ON", coordinates: [-79.5083, 43.8361] },
  richmondhill: { city: "Richmond Hill", province: "ON", coordinates: [-79.4391, 43.8828] },
  oakville: { city: "Oakville", province: "ON", coordinates: [-79.6876, 43.4675] },
  burlington: { city: "Burlington", province: "ON", coordinates: [-79.7990, 43.3255] },
  hamilton: { city: "Hamilton", province: "ON", coordinates: [-79.8711, 43.2557] },
  ottawa: { city: "Ottawa", province: "ON", coordinates: [-75.6972, 45.4215] },
  london: { city: "London", province: "ON", coordinates: [-81.2497, 42.9849] },
  kitchener: { city: "Kitchener", province: "ON", coordinates: [-80.4925, 43.4516] },
  waterloo: { city: "Waterloo", province: "ON", coordinates: [-80.5204, 43.4643] },
  windsor: { city: "Windsor", province: "ON", coordinates: [-83.0364, 42.3149] },
  kingston: { city: "Kingston", province: "ON", coordinates: [-76.4860, 44.2312] },
  barrie: { city: "Barrie", province: "ON", coordinates: [-79.6903, 44.3894] },
  oshawa: { city: "Oshawa", province: "ON", coordinates: [-78.8658, 43.8971] },
};

/** First three characters of a postal code -> approximate centroid. */
export const FSA_CENTROIDS = {
  M1B: { city: "Scarborough", province: "ON", coordinates: [-79.1943, 43.8067] },
  M1C: { city: "Scarborough", province: "ON", coordinates: [-79.1596, 43.7845] },
  M1E: { city: "Scarborough", province: "ON", coordinates: [-79.1895, 43.7635] },
  M1K: { city: "Scarborough", province: "ON", coordinates: [-79.2646, 43.7279] },
  M1L: { city: "Scarborough", province: "ON", coordinates: [-79.2870, 43.7111] },
  M1P: { city: "Scarborough", province: "ON", coordinates: [-79.2846, 43.7574] },
  M1S: { city: "Scarborough", province: "ON", coordinates: [-79.2620, 43.7942] },
  M2N: { city: "North York", province: "ON", coordinates: [-79.4084, 43.7701] },
  M3C: { city: "North York", province: "ON", coordinates: [-79.3406, 43.7258] },
  M4C: { city: "East York", province: "ON", coordinates: [-79.3129, 43.6953] },
  M4W: { city: "Toronto", province: "ON", coordinates: [-79.3776, 43.6795] },
  M5A: { city: "Toronto", province: "ON", coordinates: [-79.3606, 43.6543] },
  M5B: { city: "Toronto", province: "ON", coordinates: [-79.3789, 43.6572] },
  M5G: { city: "Toronto", province: "ON", coordinates: [-79.3873, 43.6579] },
  M5H: { city: "Toronto", province: "ON", coordinates: [-79.3844, 43.6505] },
  M5V: { city: "Toronto", province: "ON", coordinates: [-79.3960, 43.6289] },
  M6H: { city: "Toronto", province: "ON", coordinates: [-79.4423, 43.6690] },
  M8V: { city: "Etobicoke", province: "ON", coordinates: [-79.4980, 43.6056] },
  M9V: { city: "Etobicoke", province: "ON", coordinates: [-79.5876, 43.7394] },
  L4W: { city: "Mississauga", province: "ON", coordinates: [-79.6157, 43.6355] },
  L5B: { city: "Mississauga", province: "ON", coordinates: [-79.6441, 43.5890] },
  L5M: { city: "Mississauga", province: "ON", coordinates: [-79.7346, 43.5559] },
  L6T: { city: "Brampton", province: "ON", coordinates: [-79.7203, 43.7064] },
  L6Y: { city: "Brampton", province: "ON", coordinates: [-79.7624, 43.6598] },
  L3R: { city: "Markham", province: "ON", coordinates: [-79.3370, 43.8561] },
  L4L: { city: "Vaughan", province: "ON", coordinates: [-79.5920, 43.7942] },
  L6H: { city: "Oakville", province: "ON", coordinates: [-79.7070, 43.4675] },
  L8P: { city: "Hamilton", province: "ON", coordinates: [-79.8875, 43.2557] },
  K1P: { city: "Ottawa", province: "ON", coordinates: [-75.6972, 45.4215] },
  K2P: { city: "Ottawa", province: "ON", coordinates: [-75.6960, 45.4141] },
  N2L: { city: "Waterloo", province: "ON", coordinates: [-80.5204, 43.4643] },
  N6A: { city: "London", province: "ON", coordinates: [-81.2497, 42.9849] },
};

/** First letter of a Canadian FSA maps to a region. */
export function provinceFromFsa(fsa) {
  const map = {
    A: "NL", B: "NS", C: "PE", E: "NB", G: "QC", H: "QC", J: "QC",
    K: "ON", L: "ON", M: "ON", N: "ON", P: "ON", R: "MB", S: "SK",
    T: "AB", V: "BC", X: "NT", Y: "YT",
  };
  return map[fsa?.charAt(0)] ?? null;
}

/**
 * Round a coordinate pair down to roughly a kilometre.
 *
 * A production geocoder will happily return a rooftop for a full address. A
 * tutor's home is never stored or published at that resolution, so every
 * coordinate that enters the system passes through here first (§15, §42).
 */
export function coarsenCoordinates([lng, lat]) {
  return [Math.round(lng * 100) / 100, Math.round(lat * 100) / 100];
}

/** City suggestions for the location input. */
export function suggestCities(query, limit = 6) {
  const q = String(query ?? "").toLowerCase().trim();
  if (!q) return [];
  const pattern = new RegExp(`^${escapeRegex(q)}`, "i");
  return Object.values(CITY_CENTROIDS)
    .filter((c) => pattern.test(c.city))
    .slice(0, limit);
}

export const SERVICE_CITIES = Object.values(CITY_CENTROIDS);
