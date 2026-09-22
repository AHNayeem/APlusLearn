import { REMOTE_IMAGE_HOSTS } from "@/constants/config";

/**
 * The `src` to hand `next/image`, or `null` if there isn't a usable one.
 *
 * A missing photo is the easy case — every caller already draws a fallback
 * for it. The case that breaks a page is a photo that *is* there and that the
 * optimizer will not accept: `next/image` treats an unconfigured hostname or
 * an unparseable path as a programming error and throws `Invalid src prop`,
 * so instead of one missing face the whole surrounding render fails.
 *
 * That is reachable from stored data. `User.avatarUrl` carried arbitrary text
 * before uploads existed (Google sign-in still writes a `lh3` URL), and a
 * tutor's `gallery` is still a free-text array. Treating anything we cannot
 * render as "no photo" turns every one of those into the fallback the caller
 * already has, which is the outcome the design is built for.
 *
 * Deliberately not a sanitiser: it decides renderability, not trust. The
 * host list is the optimizer's own allow-list, so a `javascript:` or `data:`
 * URL fails it as a side effect rather than as the point.
 */
export function renderableImageSrc(src) {
  if (typeof src !== "string") return null;

  const value = src.trim();
  if (!value) return null;

  // Served by this application — an uploaded photo, or a bundled asset.
  // `//host/path` is protocol-relative, not a local path, so it is excluded
  // here and judged as a remote URL below (where it fails to parse).
  if (value.startsWith("/") && !value.startsWith("//")) return value;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  return REMOTE_IMAGE_HOSTS.includes(url.hostname) ? value : null;
}
