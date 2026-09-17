import "server-only";
import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4, for the object-storage provider (§16, §35, §38).
 *
 * Written against `fetch` and `node:crypto` rather than pulling in an SDK.
 * The S3 operations this application performs are three — PUT, GET, DELETE of
 * a single object — and SigV4 over them is the small, fixed amount of code
 * below. An SDK would add tens of megabytes to the server bundle to save it,
 * which is the same trade `lib/images/inspect.js` already declines.
 *
 * Because it speaks the protocol rather than a vendor's client, the same
 * provider works against Amazon S3, Cloudflare R2, Backblaze B2, DigitalOcean
 * Spaces, MinIO and anything else S3-compatible: only the endpoint changes.
 */

const ALGORITHM = "AWS4-HMAC-SHA256";
const UNSIGNED_HEADERS = new Set(["authorization", "content-length", "user-agent"]);

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
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

/**
 * Sign one request.
 *
 * @returns {{ url: string, headers: Record<string,string> }}
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
    "", // no query string on any request this provider makes
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
 * A minimal S3 client: put, get, delete.
 *
 * Path-style addressing (`https://endpoint/bucket/key`) is the default
 * because it is what every S3-compatible service accepts; virtual-hosted
 * style is available for buckets that require it.
 */
export class S3Client {
  constructor({
    bucket,
    region = "us-east-1",
    accessKeyId,
    secretAccessKey,
    sessionToken,
    endpoint,
    forcePathStyle = true,
    fetchImpl,
  } = {}) {
    if (!bucket) throw new Error("S3Client needs a bucket.");
    if (!accessKeyId || !secretAccessKey) throw new Error("S3Client needs credentials.");

    this.bucket = bucket;
    this.region = region;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    this.base = new URL(endpoint || `https://s3.${region}.amazonaws.com`);
    this.forcePathStyle = forcePathStyle;
    this.fetch = fetchImpl ?? globalThis.fetch;
  }

  /** Host and canonical path for one object key. */
  address(key) {
    const encoded = encodeKeyPath(key);
    if (this.forcePathStyle) {
      const prefix = this.base.pathname.replace(/\/$/, "");
      return {
        host: this.base.host,
        path: `${prefix}/${this.bucket}/${encoded}`,
      };
    }
    return { host: `${this.bucket}.${this.base.host}`, path: `/${encoded}` };
  }

  url(key) {
    const { host, path } = this.address(key);
    return `${this.base.protocol}//${host}${path}`;
  }

  async send(method, key, { body, headers = {} } = {}) {
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

    const response = await this.fetch(`${this.base.protocol}//${host}${path}`, {
      method,
      headers: signed.headers,
      body: method === "GET" || method === "DELETE" ? undefined : payload,
    });

    if (!response.ok) {
      const detail = await response.text?.().catch(() => "");
      throw storageError(
        `Object storage responded HTTP ${response.status} to ${method} ${key}.`,
        response.status,
        detail,
      );
    }
    return response;
  }

  async putObject(key, buffer, { contentType } = {}) {
    await this.send("PUT", key, {
      body: buffer,
      headers: {
        ...(contentType ? { "content-type": contentType } : {}),
        // At-rest encryption is requested rather than assumed. Services that
        // encrypt unconditionally ignore it; S3 honours it.
        "x-amz-server-side-encryption": "AES256",
      },
    });
    return { key };
  }

  async getObject(key) {
    const response = await this.send("GET", key);
    return Buffer.from(await response.arrayBuffer());
  }

  async deleteObject(key) {
    await this.send("DELETE", key);
    return { key };
  }
}

export function storageError(message, status, detail) {
  const error = new Error(message);
  error.code = "STORAGE_PROVIDER_ERROR";
  error.status = status ?? 502;
  if (detail) error.detail = String(detail).slice(0, 500);
  return error;
}
