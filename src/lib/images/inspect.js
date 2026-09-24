/**
 * Uploaded-image inspection for branding assets (§16 file handling, §26).
 *
 * An administrator's upload is not trusted, and `file.type` is just a string
 * the browser sent — so the format is decided by reading the container's own
 * magic bytes, and the declared type is accepted only if it agrees. The width
 * and height come from the same header walk.
 *
 * Deliberately dependency-free: the four raster formats a logo or favicon can
 * reasonably be are each a fixed-offset read, and adding an image library to
 * the server bundle to learn two integers would be a poor trade.
 *
 * SVG is refused outright. An SVG is a document that can carry script and
 * external references, and these files are served to every visitor.
 */

export const IMAGE_TYPES = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
  GIF: "image/gif",
  ICO: "image/x-icon",
};

const EXTENSIONS = {
  [IMAGE_TYPES.PNG]: ".png",
  [IMAGE_TYPES.JPEG]: ".jpg",
  [IMAGE_TYPES.WEBP]: ".webp",
  [IMAGE_TYPES.GIF]: ".gif",
  [IMAGE_TYPES.ICO]: ".ico",
};

export function extensionFor(contentType) {
  return EXTENSIONS[contentType] ?? "";
}

function isPng(buf) {
  return (
    buf.length > 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  );
}

function isJpeg(buf) {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function isGif(buf) {
  return buf.length > 10 && buf.toString("ascii", 0, 3) === "GIF";
}

function isWebp(buf) {
  return (
    buf.length > 30 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  );
}

function isIco(buf) {
  return buf.length > 6 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00;
}

/** PNG: IHDR is always the first chunk, width and height at a fixed offset. */
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** GIF87a/89a: little-endian logical screen descriptor. */
function gifSize(buf) {
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

/**
 * JPEG: walk the marker chain to the first Start-Of-Frame. Segment lengths are
 * big-endian and include their own two bytes.
 */
function jpegSize(buf) {
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];

    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);

    // SOF0–SOF15, excluding the DHT/JPG/DAC markers interleaved in that range.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/** WebP: three container variants, each with the size in a different place. */
function webpSize(buf) {
  const format = buf.toString("ascii", 12, 16);

  if (format === "VP8 ") {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (format === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (format === "VP8X") {
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height };
  }
  return null;
}

/** ICO: the directory entry stores 0 for 256. */
function icoSize(buf) {
  return { width: buf[6] || 256, height: buf[7] || 256 };
}

/**
 * Identify a buffer.
 *
 * @returns {{ contentType: string, width: number, height: number } | null}
 *   `null` when the bytes are not one of the accepted raster formats.
 */
export function inspectImage(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  if (isPng(buf)) return { contentType: IMAGE_TYPES.PNG, ...pngSize(buf) };
  if (isGif(buf)) return { contentType: IMAGE_TYPES.GIF, ...gifSize(buf) };
  if (isIco(buf)) return { contentType: IMAGE_TYPES.ICO, ...icoSize(buf) };

  if (isWebp(buf)) {
    const size = webpSize(buf);
    return size ? { contentType: IMAGE_TYPES.WEBP, ...size } : null;
  }
  if (isJpeg(buf)) {
    const size = jpegSize(buf);
    return size ? { contentType: IMAGE_TYPES.JPEG, ...size } : null;
  }
  return null;
}

/**
 * Full check against one asset's rules.
 *
 * @returns {{ ok: true, contentType, width, height } | { ok: false, reason: string }}
 */
export function validateImage(buffer, spec) {
  const found = inspectImage(buffer);
  if (!found) {
    return { ok: false, reason: `Upload a ${spec.label} as ${describeTypes(spec.accepts)}.` };
  }
  if (!spec.accepts.includes(found.contentType)) {
    return { ok: false, reason: `${spec.label} must be ${describeTypes(spec.accepts)}.` };
  }
  if (!found.width || !found.height) {
    return { ok: false, reason: "That image file looks damaged — we couldn't read its size." };
  }
  if (found.width < spec.minWidth || found.height < spec.minHeight) {
    return {
      ok: false,
      reason: `${spec.label} must be at least ${spec.minWidth}×${spec.minHeight} pixels.`,
    };
  }
  if (found.width > spec.maxWidth || found.height > spec.maxHeight) {
    return {
      ok: false,
      reason: `${spec.label} must be no larger than ${spec.maxWidth}×${spec.maxHeight} pixels.`,
    };
  }
  if (spec.square && found.width !== found.height) {
    return { ok: false, reason: `${spec.label} must be square.` };
  }
  return { ok: true, ...found };
}

/**
 * Identify an uploaded *document* — the formats verification paperwork comes
 * in (§16).
 *
 * Same reasoning as `inspectImage`: `file.type` is a string the browser sent
 * and an attacker sets it freely, so the format is decided by reading the
 * bytes. A PDF is added to the four raster formats because a certificate or a
 * police check usually arrives as one.
 *
 * @returns {string|null} the content type the bytes really are.
 */
export function inspectDocument(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length > 4 && buf.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return inspectImage(buf)?.contentType ?? null;
}

/**
 * A stored filename, made safe to put in a header and to show to an
 * administrator.
 *
 * The uploader's filename never reaches the filesystem — the storage key is a
 * UUID — but it is kept as a label and later echoed in a `Content-Disposition`
 * header. A CR or LF in it would end that header and start one of the
 * attacker's choosing, so control characters, path separators and quotes all
 * come out here.
 */
export function safeFileName(name, fallback = "document") {
  const cleaned = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .replace(/["']/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

/**
 * Extensions for the formats a *document* may be — the four
 * `UPLOAD.acceptedDocumentTypes`, which is the image set plus PDF.
 *
 * Separate from `EXTENSIONS` because that map answers "what kind of image is
 * this?" and a PDF is not one. Shared rather than kept privately by each
 * upload surface, because the stored key's extension is what a later operator
 * sees in a bucket listing, and three copies of this table is three chances
 * for one of them to start writing extensionless objects.
 */
const DOCUMENT_EXTENSIONS = {
  "application/pdf": ".pdf",
  [IMAGE_TYPES.JPEG]: ".jpg",
  [IMAGE_TYPES.PNG]: ".png",
  [IMAGE_TYPES.WEBP]: ".webp",
};

export function documentExtensionFor(contentType) {
  return DOCUMENT_EXTENSIONS[contentType] ?? "";
}

/**
 * Name a set of accepted formats for a person: "PDF, JPG, PNG or WebP".
 *
 * `describeTypes` reads its names out of the image table, so it cannot name a
 * PDF. This one reads the document table, which can.
 */
export function describeDocumentTypes(types) {
  const names = types.map((t) => documentExtensionFor(t).replace(".", "").toUpperCase());
  if (names.length === 1) return `a ${names[0]}`;
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

export function describeTypes(types) {
  const names = types.map((t) => extensionFor(t).replace(".", "").toUpperCase());
  if (names.length === 1) return `a ${names[0]}`;
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}
