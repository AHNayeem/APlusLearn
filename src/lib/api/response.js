import { NextResponse } from "next/server";
import { AppError } from "./errors";

/**
 * One response envelope for the entire API (§6):
 *   success -> { ok: true, data, meta? }
 *   failure -> { ok: false, error: { code, message, details? } }
 */

export function ok(data, { status = 200, meta, headers } = {}) {
  return NextResponse.json({ ok: true, data, ...(meta ? { meta } : {}) }, { status, headers });
}

export function created(data, meta) {
  return ok(data, { status: 201, meta });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function fail(message, { status = 400, code = "BAD_REQUEST", details } = {}) {
  return NextResponse.json(
    { ok: false, error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

/**
 * Turn any thrown value into a safe response. Known AppErrors pass their
 * message through; anything else becomes a generic 500 and is logged.
 */
export function failFromError(error) {
  if (error instanceof AppError) {
    return fail(error.message, {
      status: error.status,
      code: error.code,
      details: error.details,
    });
  }

  // Mongo duplicate key — surface as a conflict rather than a 500.
  if (error?.code === 11000) {
    return fail("That already exists.", { status: 409, code: "CONFLICT" });
  }

  // Mongoose schema validation that slipped past zod.
  if (error?.name === "ValidationError" && error?.errors) {
    const fieldErrors = {};
    for (const [key, value] of Object.entries(error.errors)) {
      fieldErrors[key] = [value.message];
    }
    return fail("Some details need your attention.", {
      status: 422,
      code: "VALIDATION_ERROR",
      details: { fieldErrors },
    });
  }

  if (error?.name === "CastError") {
    return fail("We couldn't find what you were looking for.", {
      status: 404,
      code: "NOT_FOUND",
    });
  }

  // The object store refused or could not be reached. Its own message names
  // the bucket, the credentials or the endpoint — operator-actionable, and
  // exactly what a browser must never be told — so it is logged and a plain
  // one goes back. The upstream status travels with the error but is not
  // reused: a 403 from the bucket is not the caller's 403, and returning it
  // would tell somebody uploading a photo that *they* lack permission.
  if (error?.code === "STORAGE_PROVIDER_ERROR") {
    console.error("[api] file storage unavailable:", error.message, error.detail ?? "");
    return fail("File storage is unavailable right now. Please try again in a moment.", {
      status: 502,
      code: "STORAGE_UNAVAILABLE",
    });
  }

  console.error("[api] unhandled error:", error);
  return fail("Something went wrong on our end. Please try again.", {
    status: 500,
    code: "INTERNAL_ERROR",
  });
}

/** Pagination metadata used by every list endpoint. */
export function paginationMeta({ page, pageSize, total }) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    hasMore: page * pageSize < total,
  };
}
