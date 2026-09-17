import "server-only";
import { createHash, createHmac } from "node:crypto";

/**
 * The S3 wire protocol, spoken directly (§16, §35, §38).
 *
 * MinIO — the object store this platform deploys against — exposes the S3
 * API, so the client below talks to it over `fetch` and `node:crypto` rather
 * than through an SDK. The operations this application performs are four:
 * PUT, GET, HEAD and DELETE of a single object, plus a HEAD of the bucket for
 * the health check. AWS Signature V4 over those is the small, fixed amount of
 * code here; an SDK would add tens of megabytes to the server bundle to save
 * it, which is the same trade `lib/images/inspect.js` already declines.
 *
 * Because it speaks the protocol rather than a vendor's client, the same
 * module also works against Amazon S3, Cloudflare R2, Backblaze B2 and
 * DigitalOcean Spaces: only the endpoint and credentials change.
 */

const ALGORITHM = "AWS4-HMAC-SHA256";
const UNSIGNED_HEADERS = new Set(["authorization", "content-length", "user-agent"]);

/** A hung object store must not hold a request handler open forever. */
const DEFAULT_TIMEOUT_MS = 20_000;

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

/** `20240117T101530Z` and `20240117`, the two forms SigV4 wants. */
function timestamps(now = new Date()) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * Each path segment is encoded, but the separators are not — S3 canonicalises
 * the URI path, so `a/b.pdf` must stay `a/b.pdf` while a space inside a
 * segment becomes `%20`.
 */
function encodeKeyPath(key) {
  return key
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

/**
 * Sign one request.
 *
 * @returns {{ headers: Record<string,string> }}
 */
export function signRequest({
  method,
  host,
  path,
  region,
  service = "s3",
  accessKeyId,
  secretAccessKey,
  sessionToken,
  payload = "",
  headers = {},
  now = new Date(),
}) {
  const { amzDate, dateStamp } = timestamps(now);
  // S3 requires the payload hash in a header, and it is also what binds the
  // body to the signature — an altered body no longer verifies.
  const payloadHash = sha256Hex(payload);

  const allHeaders = {
    ...headers,
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(sessionToken ? { "x-amz-security-token": sessionToken } : {}),
  };

  const signable = Object.entries(allHeaders)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, " ")])
    .filter(([name]) => !UNSIGNED_HEADERS.has(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const canonicalHeaders = signable.map(([n, v]) => `${n}:${v}\n`).join("");
  const signedHeaders = signable.map(([n]) => n).join(";");

  const canonicalRequest = [
    method,
    path,
    "", // no query string on any request this client makes
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = ["aws4_request"].reduce(
    (key, part) => hmac(key, part),
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    headers: {
      ...allHeaders,
      Authorization: `${ALGORITHM} Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/**
 * A minimal object-store client: put, get, head, delete, and a bucket probe.
 *
 * Path-style addressing (`https://endpoint/bucket/key`) is the default,
 * because it is what MinIO serves and what every S3-compatible service
 * accepts; virtual-hosted style is available for buckets that require it.
 */
export class ObjectStoreClient {
  constructor({
    bucket,
    region = "us-east-1",
    accessKeyId,
    secretAccessKey,
    sessionToken,
    endpoint,
    forcePathStyle = true,
    /**
     * At-rest encryption, requested per object. Left off by default: MinIO
     * answers `NotImplemented` to `x-amz-server-side-encryption` unless a KMS
     * is wired up, which would fail every upload. Amazon S3 deployments set
     * `STORAGE_SSE=AES256`; MinIO installations encrypt at the volume or
     * bucket level instead.
     */
    serverSideEncryption = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl,
  } = {}) {
    if (!bucket) throw new Error("Object storage needs a bucket.");
    if (!accessKeyId || !secretAccessKey) throw new Error("Object storage needs credentials.");

    this.bucket = bucket;
    this.region = region;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    this.base = new URL(endpoint || `https://s3.${region}.amazonaws.com`);
    this.forcePathStyle = forcePathStyle;
    this.serverSideEncryption = serverSideEncryption || null;
    this.timeoutMs = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;
    this.fetch = fetchImpl ?? globalThis.fetch;
  }

  /** Host and canonical path for one object key, or for the bucket itself. */
  address(key = "") {
    const encoded = key ? encodeKeyPath(key) : "";
    if (this.forcePathStyle) {
      const prefix = this.base.pathname.replace(/\/$/, "");
      return {
        host: this.base.host,
        path: `${prefix}/${this.bucket}${encoded ? `/${encoded}` : "/"}`,
      };
    }
    return { host: `${this.bucket}.${this.base.host}`, path: `/${encoded}` };
  }

  async send(method, key, { body, headers = {}, allow404 = false } = {}) {
    const { host, path } = this.address(key);
    const payload = body ?? "";

    const signed = signRequest({
      method,
      host,
      path,
      region: this.region,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken,
      payload,
      headers,
    });

    let response;
    try {
      response = await this.fetch(`${this.base.protocol}//${host}${path}`, {
        method,
        headers: signed.headers,
        body: method === "PUT" || method === "POST" ? payload : undefined,
        // A store that has stopped answering must fail the request rather
        // than hold a route handler open.
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // DNS failure, refused connection, TLS problem or the timeout above.
      // The endpoint host is the useful part for an operator and is not a
      // secret; nothing else from the exception is repeated.
      throw storageError(
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? `Object storage did not answer ${method} within ${this.timeoutMs}ms.`
          : `Object storage at ${this.base.host} could not be reached.`,
        error?.name === "TimeoutError" || error?.name === "AbortError" ? 504 : 502,
        error?.code ?? error?.name,
      );
    }

    if (response.status === 404 && allow404) return null;

    if (!response.ok) {
      const detail = await response.text?.().catch(() => "");
      throw storageError(describeStatus(response.status, method), response.status, this.redact(detail));
    }
    return response;
  }

  /**
   * A provider error is shown to operators through logs and the admin health
   * panel, so the credential is stripped from anything the store echoes back.
   */
  redact(detail) {
    if (!detail) return detail;
    return String(detail)
      .split(this.accessKeyId)
      .join("***")
      .split(this.secretAccessKey)
      .join("***");
  }

  async putObject(key, buffer, { contentType } = {}) {
    await this.send("PUT", key, {
      body: buffer,
      headers: {
        ...(contentType ? { "content-type": contentType } : {}),
        ...(this.serverSideEncryption
          ? { "x-amz-server-side-encryption": this.serverSideEncryption }
          : {}),
      },
    });
    return { key };
  }

  async getObject(key) {
    const response = await this.send("GET", key);
    return Buffer.from(await response.arrayBuffer());
  }

  /** Size, type and etag without transferring the bytes. */
  async headObject(key) {
    const response = await this.send("HEAD", key, { allow404: true });
    if (!response) return null;
    const length = response.headers?.get?.("content-length");
    return {
      key,
      contentType: response.headers?.get?.("content-type") ?? null,
      sizeBytes: length == null ? null : Number(length),
      etag: response.headers?.get?.("etag")?.replace(/"/g, "") ?? null,
      lastModified: response.headers?.get?.("last-modified") ?? null,
    };
  }

  async deleteObject(key) {
    await this.send("DELETE", key);
    return { key };
  }

  /**
   * Prove the credentials open the bucket, without reading or writing an
   * object. Used by the admin integrations panel and `bun run storage check`.
   */
  async headBucket() {
    await this.send("HEAD", "");
    return { bucket: this.bucket };
  }
}

/**
 * What an HTTP status from the store means, in words an operator can act on.
 * Deliberately says nothing about keys, credentials or infrastructure.
 */
function describeStatus(status, method) {
  if (status === 403)
    return "Object storage refused the request: the credentials are wrong or lack permission on this bucket.";
  if (status === 404)
    return method === "HEAD" || method === "GET"
      ? "That object is not in the bucket."
      : "The bucket does not exist.";
  if (status === 400) return "Object storage rejected the request as malformed.";
  if (status === 413) return "Object storage refused the upload: the file is too large.";
  if (status === 501)
    return "Object storage does not support that request. Check STORAGE_SSE — MinIO needs a KMS before it will encrypt per object.";
  if (status >= 500) return "Object storage is unavailable.";
  return `Object storage responded HTTP ${status} to ${method}.`;
}

export function storageError(message, status, detail) {
  const error = new Error(message);
  error.code = "STORAGE_PROVIDER_ERROR";
  error.status = status ?? 502;
  if (detail) error.detail = String(detail).slice(0, 500);
  return error;
}
