/**
 * Browser-side API client.
 *
 * Every response follows the envelope from `lib/api/response`, so this is the
 * one place that unwraps it and turns a failure into a thrown ApiError
 * carrying the per-field details the forms render.
 */

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Per-field messages, ready to merge into form state. */
  get fieldErrors() {
    const raw = this.details?.fieldErrors ?? {};
    return Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
    );
  }
}

async function request(path, { method = "GET", body, signal, headers } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal,
    credentials: "same-origin",
  });

  if (response.status === 204) return null;

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError("We couldn't read the server's response. Please try again.", {
      status: response.status,
      code: "BAD_RESPONSE",
    });
  }

  if (!response.ok || payload?.ok === false) {
    const error = payload?.error ?? {};
    throw new ApiError(error.message ?? "Something went wrong. Please try again.", {
      status: response.status,
      code: error.code,
      details: error.details,
    });
  }

  return payload.meta ? { ...payload.data, meta: payload.meta } : payload.data;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: "GET" }),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
  put: (path, body, options) => request(path, { ...options, method: "PUT", body }),
  delete: (path, options) => request(path, { ...options, method: "DELETE" }),
};

/** Build a query string, dropping empty values. */
export function qs(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length) search.set(key, value.join(","));
    } else {
      search.set(key, String(value));
    }
  }
  const str = search.toString();
  return str ? `?${str}` : "";
}
