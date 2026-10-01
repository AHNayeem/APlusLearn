import { PWA_INSTALL_PROMPT } from "@/constants/config";

/**
 * Whether, and how, to offer "install this app" (docs/PWA.md).
 *
 * Everything here is pure — it takes the browser facts as arguments rather
 * than reading `window` — so the decision can be tested without a browser and
 * the component is left with nothing to decide, only to render.
 *
 * There are exactly two ways to offer an install, and they are not the same
 * offer:
 *
 * - `NATIVE` — the browser handed us a `beforeinstallprompt` event, so a real
 *   "Install App" button can open the browser's own dialog. Chromium only
 *   (Chrome, Edge, Samsung Internet, Opera), desktop and Android.
 * - `IOS` — Safari on iPhone or iPad, which has no such event and never will
 *   expose one. Nothing on the page can open Apple's sheet, so the offer is
 *   the three steps of Safari's own Share → Add to Home Screen, and there is
 *   no install button at all.
 *
 * Every other browser gets nothing. Firefox, macOS Safari and the in-app
 * browsers inside Instagram or Gmail either cannot install a web app or can
 * only from a menu whose shape we cannot know, and a button that does nothing
 * is worse than no button.
 */

export const INSTALL_OFFER = {
  NATIVE: "native",
  IOS: "ios",
};

/** Why nothing is offered — named so tests and docs can point at a state. */
export const INSTALL_SILENCE = {
  INSTALLED: "installed",
  ACCEPTED: "accepted",
  COOLING_DOWN: "cooling-down",
  UNSUPPORTED: "unsupported",
  ROUTE: "route",
};

/** `localStorage`: when the visitor last said no, in epoch milliseconds. */
export const DISMISSED_KEY = "aplus:install-prompt-dismissed";
/** `sessionStorage`: set once an install was accepted in this session. */
export const ACCEPTED_KEY = "aplus:install-prompt-accepted";

/** Where the inline capture script parks the event until React is ready. */
export const DEFERRED_PROMPT_GLOBAL = "__aplusInstallPrompt";
/** Fired on `window` when the capture script parks a new event. */
export const DEFERRED_PROMPT_EVENT = "aplus:installprompt";

/**
 * Captures `beforeinstallprompt` from the first moment the document parses.
 *
 * Chromium can fire the event before the application's chunks have loaded and
 * well before React hydrates, and it fires it once per page load — a listener
 * attached in an effect can simply miss it, and then nothing can be installed
 * from this page until the next navigation. So the root layout inlines this
 * before anything else in <body>.
 *
 * `preventDefault()` suppresses Chrome's own mini-infobar on Android, because
 * our prompt replaces it on a schedule we control. It does not touch the
 * install icon in the desktop address bar or the "Install app" menu item, so
 * a visitor in a cooldown can still install whenever they like.
 */
export const CAPTURE_SCRIPT = `(function(){
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    window.${DEFERRED_PROMPT_GLOBAL} = event;
    window.dispatchEvent(new Event("${DEFERRED_PROMPT_EVENT}"));
  });
  window.addEventListener("appinstalled", function () {
    window.${DEFERRED_PROMPT_GLOBAL} = null;
  });
})();`;

/**
 * Display modes that only exist for an installed web app. `browser` is the
 * one that means "a tab". `window-controls-overlay` is a desktop installed
 * window with its title bar hidden; `minimal-ui` and `fullscreen` are what
 * Chromium falls back through when the manifest's `standalone` is not offered.
 */
const INSTALLED_DISPLAY_MODES = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"];

/**
 * True when this page is running *as* the installed application.
 *
 * `matchMedia` covers every Chromium and modern Safari. `navigator.standalone`
 * is the older iOS spelling and the only one iOS 15 and earlier answer. A
 * Trusted Web Activity wrapper announces itself through the referrer.
 *
 * It answers "is *this* window the app", not "is the app installed somewhere"
 * — a browser tab on a device that has the app installed returns false here.
 * Chromium covers that case on its own by not firing `beforeinstallprompt` for
 * an installed app; Safari offers no way to ask (see docs/PWA.md).
 */
export function isRunningInstalled({ matchMedia, navigator: nav, referrer = "" } = {}) {
  if (nav?.standalone === true) return true;
  if (referrer.startsWith("android-app://")) return true;
  if (typeof matchMedia !== "function") return false;
  return INSTALLED_DISPLAY_MODES.some((mode) => {
    try {
      return matchMedia(`(display-mode: ${mode})`).matches;
    } catch {
      return false;
    }
  });
}

/**
 * Browsers that run on iOS and carry Safari's `Safari/` token, but whose own
 * share menu is not Safari's — or which are an app's embedded web view and
 * cannot add to the home screen at all. Telling a Chrome-on-iOS user to "tap
 * the Share button in Safari" would be an instruction for a different app.
 */
const IOS_NOT_SAFARI =
  /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo|Brave|FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Line\/|Snapchat|Pinterest|Twitter|MicroMessenger|WhatsApp/i;

/**
 * True for Safari itself on iPhone, iPod or iPad.
 *
 * iPadOS 13+ presents a *desktop* Mac user agent by default, so an iPad is
 * recognised by a Mac platform that reports touch points — no Mac does.
 * An embedded web view usually drops the `Safari/` token entirely, which is
 * what excludes most in-app browsers before the list above is consulted.
 */
export function isIosSafari({ userAgent = "", platform = "", maxTouchPoints = 0 } = {}) {
  const iPhoneOrIPad = /iPhone|iPad|iPod/i.test(userAgent);
  const desktopModeIPad = /Macintosh/i.test(userAgent) && platform === "MacIntel" && maxTouchPoints > 1;
  if (!iPhoneOrIPad && !desktopModeIPad) return false;
  if (!/Safari\//.test(userAgent) || !/Version\//.test(userAgent)) return false;
  return !IOS_NOT_SAFARI.test(userAgent);
}

/** Whether a "Not now" stamped at `dismissedAt` still silences the prompt. */
export function isCoolingDown(dismissedAt, now, cooldownDays = PWA_INSTALL_PROMPT.cooldownDays) {
  const at = Number(dismissedAt);
  if (!Number.isFinite(at) || at <= 0) return false;
  // A timestamp from the future is a clock that moved back, not a dismissal
  // that lasts forever — treat it as having just happened.
  const since = Math.max(0, now - at);
  return since < cooldownDays * 24 * 60 * 60 * 1000;
}

/**
 * Routes where an unsolicited card would be in the way of the one thing the
 * person came to do: signing in or up, entering a code, paying, or typing in
 * a conversation whose composer is pinned to the bottom of a phone screen.
 * The offer waits and appears on the next ordinary page instead.
 */
const QUIET_ROUTE_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/bookings/checkout",
  "/offline",
  "/dev",
];
const QUIET_ROUTE_PATTERNS = [/^\/messages\/[^/]+/, /^\/tutor\/messages\/[^/]+/];

export function isQuietRoute(pathname) {
  if (!pathname) return true;
  if (QUIET_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }
  return QUIET_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

/**
 * The whole decision, in order of precedence:
 *
 *   C. already running as the installed app            → nothing
 *   F. an install was accepted earlier this session    → nothing
 *   E. "Not now" (or the native dialog declined) recently → nothing
 *   A. the browser gave us an install event            → NATIVE
 *   B. Safari on iOS                                   → IOS
 *   D. anything else                                   → nothing
 *
 * The route is checked last because it decides *when* rather than *whether*:
 * on a quiet route the offer is kept (`offer` set, `visible` false) through a
 * sign-in page and shown on the page after it.
 */
export function resolveInstallPrompt({
  installed = false,
  accepted = false,
  dismissedAt = null,
  now = Date.now(),
  nativeAvailable = false,
  iosSafari = false,
  pathname = "/",
}) {
  const silent = (reason) => ({ offer: null, visible: false, reason });
  if (installed) return silent(INSTALL_SILENCE.INSTALLED);
  if (accepted) return silent(INSTALL_SILENCE.ACCEPTED);
  if (isCoolingDown(dismissedAt, now)) return silent(INSTALL_SILENCE.COOLING_DOWN);

  // A Chromium browser on iPadOS does not exist (every iOS browser is WebKit),
  // so the two offers cannot both apply; the native one is checked first
  // only because it is the one that can actually install.
  const offer = nativeAvailable ? INSTALL_OFFER.NATIVE : iosSafari ? INSTALL_OFFER.IOS : null;
  if (!offer) return silent(INSTALL_SILENCE.UNSUPPORTED);
  if (isQuietRoute(pathname)) return { offer, visible: false, reason: INSTALL_SILENCE.ROUTE };
  return { offer, visible: true, reason: null };
}
