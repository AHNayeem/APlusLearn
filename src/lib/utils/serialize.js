/**
 * Mongoose documents contain ObjectIds, Dates and Buffers that cannot cross
 * the server/client boundary. Every service returns plain objects through
 * this helper so Server Components can pass results straight to Client
 * Components.
 */
export function toPlain(value) {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) return value.map(toPlain);

  if (value instanceof Date) return value.toISOString();

  // Mongoose documents and ObjectIds
  if (typeof value === "object") {
    if (typeof value.toHexString === "function") return value.toHexString();
    if (typeof value.toJSON === "function" && value.constructor?.name === "Decimal128") {
      return Number(value.toString());
    }
    if (typeof value.toObject === "function") {
      return toPlain(value.toObject({ virtuals: true, depopulate: false }));
    }

    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (key === "__v") continue;
      out[key] = toPlain(val);
    }
    if (out._id !== undefined && out.id === undefined) out.id = String(out._id);
    return out;
  }

  return value;
}

/** Drop keys whose value is `undefined` (so `$set` never wipes a field). */
export function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));
}

/** Keep only the listed keys — used to shape public API payloads. */
export function pick(object, keys) {
  const out = {};
  for (const key of keys) {
    if (object?.[key] !== undefined) out[key] = object[key];
  }
  return out;
}

/** Remove the listed keys — used to strip secrets before serialising. */
export function omit(object, keys) {
  const out = { ...object };
  for (const key of keys) delete out[key];
  return out;
}
