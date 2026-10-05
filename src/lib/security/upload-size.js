import "server-only";
import { AppError } from "@/lib/api/errors";

/**
 * Read a multipart body without letting its size be the client's decision
 * (audit S19).
 *
 * `request.formData()` buffers the whole body before a single byte of it can
 * be inspected, so the per-file limits the services enforce (`file.size`)
 * run only *after* a 2 GB upload has already been pulled into memory. That is
 * a way to exhaust a server with one request, signed in or not.
 *
 * Two guards, in order:
 *
 *   1. `Content-Length` — when the client declares a body larger than the
 *      endpoint could ever accept, it is refused before anything is read.
 *   2. A counted read — a body sent without a length (chunked) or with a
 *      length that lies is read through a counter and abandoned the moment it
 *      passes the same cap. Only then is it parsed as a form.
 *
 * `maxBytes` is the whole request, so callers pass the largest legitimate
 * payload (files × per-file limit) and this adds a fixed allowance for the
 * multipart framing and the text fields that ride along with the files.
 * The services still check each file: this caps the request, not the file.
 */
const FORM_OVERHEAD_BYTES = 64 * 1024;

export class PayloadTooLargeError extends AppError {
  constructor(message = "That upload is too large.") {
    super(message, { status: 413, code: "PAYLOAD_TOO_LARGE" });
  }
}

export async function readBoundedFormData(request, maxBytes, message) {
  const cap = maxBytes + FORM_OVERHEAD_BYTES;

  const declared = request.headers.get("content-length");
  if (declared !== null && declared !== "") {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) {
      throw new AppError("The upload's declared length is not valid.", { status: 400, code: "BAD_REQUEST" });
    }
    if (length > cap) throw new PayloadTooLargeError(message);
  }

  if (!request.body) return new FormData();

  const reader = request.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > cap) {
      await reader.cancel().catch(() => {});
      throw new PayloadTooLargeError(message);
    }
    chunks.push(value);
  }

  // Parsed by the platform's own multipart parser, from bytes we have counted.
  const body = new Blob(chunks);
  return new Response(body, {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  }).formData();
}
