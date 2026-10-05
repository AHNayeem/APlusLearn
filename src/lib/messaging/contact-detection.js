/**
 * Off-platform contact and payment in a message (§17, §21, audit R17.7).
 *
 * §17 asks the platform to stand "against immediately moving payment
 * off-platform", and on a marketplace whose learners are often children the
 * same goes for moving the *conversation* off-platform: once a family and a
 * tutor are talking on a personal number, nothing here can see a report, a
 * cancellation or a refund. So `sendMessage` runs every body through this
 * before it is stored, and:
 *
 *   - contact details — an email address, a phone number, a link or handle on
 *     another messaging app — are replaced in the stored body by
 *     `CONTACT_MASK`. The original text is never stored anywhere;
 *   - payment language ("e-transfer me", "pay me directly") is left exactly as
 *     written, because there is nothing in it to hide and a moderator reading
 *     a reported thread needs the words. It is flagged, not altered.
 *
 * Masking is always on, not a setting. There is no legitimate thing a member
 * needs to send through a message that this removes: lesson times, prices and
 * joining links are all carried by the booking, and an in-person address is
 * released through the confirmed booking (§42), never through a message.
 *
 * Pure, with no imports, so the integration suite can hold the false-positive
 * set to it directly. It is written to be *conservative*: a tutoring thread is
 * full of numbers — times, marks, page numbers, course codes, years, maths —
 * and a detector that mangles "Grade 12, page 245, 4:30 on Tuesday" teaches
 * people to ignore it. Every pattern below asks for real evidence of a
 * contact detail (a provider name, an explicit app, a phone-shaped grouping),
 * not merely for a number or a word.
 */

export const CONTACT_FINDING_KINDS = {
  EMAIL: "EMAIL",
  PHONE: "PHONE",
  /** A link to, or a handle on, another messaging or social app. */
  URL: "URL",
  OFF_PLATFORM_PAYMENT: "OFF_PLATFORM_PAYMENT",
};

/** The kinds that are contact *details* — the ones that get masked. */
export const CONTACT_DETAIL_KINDS = [
  CONTACT_FINDING_KINDS.EMAIL,
  CONTACT_FINDING_KINDS.PHONE,
  CONTACT_FINDING_KINDS.URL,
];

/** What a removed contact detail reads as in the stored message. */
export const CONTACT_MASK = "[contact details removed]";

const { EMAIL, PHONE, URL, OFF_PLATFORM_PAYMENT } = CONTACT_FINDING_KINDS;

// --- Vocabulary ---------------------------------------------------------------

/** TLDs an obfuscated address is allowed to end in. A real `@` accepts any. */
const TLDS = "com|ca|net|org|edu|io|co|me|info|us|uk|biz|app|dev|xyz|live|email|online|ai|mail";

/** Mail providers, so "jane at gmail" is an address even with no TLD. */
const MAIL_PROVIDERS =
  "gmail|googlemail|hotmail|outlook|yahoo|ymail|icloud|live|msn|aol|proton(?:mail)?|gmx|" +
  "zoho|yandex|rogers|sympatico|bell|shaw|telus|videotron|cogeco|sasktel|hushmail";

/** Apps a conversation moves to. Matched as whole words. */
const APPS =
  "whats\\s?app|telegram|insta(?:gram)?|ig|snap(?:chat)?|discord|signal|we\\s?chat|kik|" +
  "tiktok|twitter|facebook|fb|messenger|skype|viber|line\\s+app";

/** Domains whose only use in a tutoring thread is to leave it. */
const CONTACT_DOMAINS =
  "wa\\.me|(?:api|chat|web)\\.whatsapp\\.com|whatsapp\\.com|t\\.me|telegram\\.(?:me|org|dog)|" +
  "instagram\\.com|instagr\\.am|snapchat\\.com|discord\\.gg|discord(?:app)?\\.com|" +
  "facebook\\.com|fb\\.com|fb\\.me|m\\.me|messenger\\.com|signal\\.me|signal\\.group|" +
  "wechat\\.com|weixin\\.qq\\.com|kik\\.me|tiktok\\.com|twitter\\.com|x\\.com|" +
  "linktr\\.ee|calendly\\.com|join\\.skype\\.com|viber\\.com";

/**
 * Words that follow "my insta is …" in ordinary talk about the app, so that
 * "my Instagram is private" is not read as a handle called "private".
 */
const DECLARED_APPS = /^(?:insta(?:gram)?|ig|snap(?:chat)?|discord|telegram|kik|tiktok|twitter|skype|we\s?chat)\b/i;

const NOT_A_HANDLE = new Set(
  (
    "private public down broken blocked banned new old deleted gone off on closed open not " +
    "the a an my your full empty hacked fine ok okay better worse good bad great boring fun " +
    "annoying distracting addictive so very really too also just still always never where " +
    "what how why when there here it this that dead weak strong slow fast lagging glitchy " +
    "suspended was were has had and or but for with"
  ).split(" "),
);

// --- Patterns -----------------------------------------------------------------

const AT_WORD = "(?:\\s*[\\[\\(\\{<]\\s*at\\s*[\\]\\)\\}>]\\s*|\\s*[\\[\\(]@[\\]\\)]\\s*)";
const DOT_WORD = "(?:\\s*[\\[\\(\\{<]\\s*dot\\s*[\\]\\)\\}>]\\s*|\\s+dot\\s+)";
const LOCAL = "[A-Za-z0-9][A-Za-z0-9._%+-]*";
const LABEL = "[A-Za-z0-9-]+";

/**
 * Each entry is one way a detail is written. `mask` says whether the matched
 * span is removed from the stored body; a phrase that *asks* for contact
 * ("what's your number?") is flagged but has nothing in it to remove.
 */
const PATTERNS = [
  // jane.doe@gmail.com, with any TLD, optionally with spaces around the @.
  { kind: EMAIL, mask: true, re: new RegExp(`${LOCAL}\\s?@\\s?${LABEL}(?:\\.${LABEL})*\\.[A-Za-z]{2,}\\b`, "gi") },
  // jane[at]gmail.com, jane (at) gmail (dot) com, jane at gmail dot com.
  {
    kind: EMAIL,
    mask: true,
    re: new RegExp(
      `\\b${LOCAL}(?:${AT_WORD}|\\s+at\\s+)${LABEL}(?:(?:${DOT_WORD}|\\.)${LABEL})*${DOT_WORD}(?:${TLDS})\\b`,
      "gi",
    ),
  },
  { kind: EMAIL, mask: true, re: new RegExp(`\\b${LOCAL}${AT_WORD}${LABEL}(?:\\.${LABEL})*\\.(?:${TLDS})\\b`, "gi") },
  // jane at gmail.com / jane at gmail — a provider name is the evidence.
  {
    kind: EMAIL,
    mask: true,
    re: new RegExp(
      `\\b${LOCAL}(?:${AT_WORD}|\\s+at\\s+|\\s?@\\s?)(?:${MAIL_PROVIDERS})(?:(?:${DOT_WORD}|\\.)(?:${TLDS}))?\\b`,
      "gi",
    ),
    // "look at Gmail" is not an address; "jane.doe at gmail" or an explicit
    // "my email is jane at gmail" is.
    accept: (match, text, index) =>
      /[._\d+-]/.test(match.split(/\s|\[|\(|@/)[0]) ||
      /\b(?:e-?mail|mail|address|contact|reach)\b[^.!?\n]{0,25}$/i.test(text.slice(Math.max(0, index - 40), index)) ||
      /@|\[|\(/.test(match),
  },

  // Links to messaging and social apps. Other links — Desmos, Khan Academy, a
  // school's site — are ordinary teaching and are left alone.
  { kind: URL, mask: true, re: new RegExp(`(?:https?:\\/\\/)?(?:www\\.)?\\b(?:${CONTACT_DOMAINS})(?:\\/[^\\s]*)?`, "gi") },
  // "insta: @jane_doe", "snap - jane.doe22", "discord jane#1234", "my snap is janedoe".
  {
    kind: URL,
    mask: true,
    re: new RegExp(
      `\\b(?:${APPS})\\b(?:\\s+(?:handle|username|user\\s?name|id|name|account|tag|number|#))?` +
        `\\s*(?:is\\b|:|-|=)?\\s*@?([A-Za-z0-9_][A-Za-z0-9_.#]{2,31})`,
      "gi",
    ),
    accept: (match, text, index, groups) => {
      const handle = groups[0] ?? "";
      if (!/[A-Za-z]/.test(handle) || NOT_A_HANDLE.has(handle.toLowerCase())) return false;
      // Evidence in the handle itself: an @, or the digits, underscores and
      // dots usernames have and English words do not.
      const marked = /@/.test(match) || /[\d_#]/.test(handle) || /[a-z]\.[a-z]/i.test(handle);
      // Or a declaration: "my snap is janedoe", "my discord username: jane".
      // Limited to apps that are only ever an account, so "my signal is weak"
      // stays a sentence about reception.
      const declared =
        /(?:\bis\b|:|-|=)\s*@?[A-Za-z0-9_]+$/i.test(match) &&
        /\bmy\s+$/i.test(text.slice(Math.max(0, index - 6), index)) &&
        (DECLARED_APPS.test(match) || /\b(?:handle|username|user\s?name|id|tag)\b/i.test(match));
      return marked || declared;
    },
    // Only the handle is a contact detail; the app's name stays readable.
    span: (match, index, groups) => {
      const handle = groups[0] ?? "";
      const at = match.lastIndexOf(handle);
      const start = match[at - 1] === "@" ? at - 1 : at;
      return [index + start, index + at + handle.length];
    },
  },
  // A bare @handle next to an app or an invitation to follow.
  {
    kind: URL,
    mask: true,
    re: /(?<![\w.@])@([A-Za-z_][A-Za-z0-9_.]{2,29})\b/g,
    accept: (match, text, index) => {
      const around = text.slice(Math.max(0, index - 40), index + match.length + 40);
      return new RegExp(`\\b(?:${APPS})\\b|\\b(?:add|follow|dm|find|message)\\s+me\\b`, "i").test(around);
    },
  },
  // Moving the conversation: "add me on Snapchat", "WhatsApp me", "let's
  // continue on Telegram". Nothing to remove, but it is the attempt itself.
  {
    kind: URL,
    mask: false,
    re: new RegExp(
      `\\b(?:add|message|msg|dm|text|reach|contact|find|follow|hit|call|ping|chat\\s+with|talk\\s+to)\\s+(?:me|us)\\s+(?:up\\s+)?(?:on|at|via|through|over|in)\\s+(?:${APPS})\\b` +
        `|\\b(?:whats\\s?app|telegram|signal|we\\s?chat|viber)\\s+me\\b` +
        `|\\b(?:move|continue|switch|chat|talk|take\\s+this|go)\\b[^.!?\\n]{0,25}\\b(?:on|to|over\\s+to|via)\\s+(?:${APPS})\\b`,
      "gi",
    ),
  },
  // Asking for one: "what's your number?", "send me your email".
  {
    kind: PHONE,
    mask: false,
    re: /\b(?:what'?s|what\s+is|send\s+me|give\s+me|share|text\s+me)\s+your\s+(?:cell(?:\s?phone)?|phone|mobile|personal|whatsapp)?\s*(?:number|#)(?!\s+(?:line|of|sense|system|theory|bonds?|pattern|sentence|talks?|grid|chart|story|lines|sequence|families))\b/gi,
  },
  {
    kind: EMAIL,
    mask: false,
    re: /\b(?:what'?s|what\s+is|send\s+me|give\s+me|share)\s+your\s+(?:personal\s+)?(?:e-?mail|gmail)(?:\s+address)?\b/gi,
  },
  // International numbers written with a leading +.
  { kind: PHONE, mask: true, re: /(?<![\w+])\+(?:\d[\s.\-()]?){9,14}\d(?!\d)/g },
];

/**
 * Payment outside the platform. Never masked — see the header — and written
 * to need a person in the sentence ("pay *me* directly", "*I can* pay cash"),
 * so a word problem in which Sam pays cash for three apples is not a policy
 * matter.
 */
const PAYMENT_PATTERNS = [
  /\be[\s-]?transfer(?:s|red|ring)?\b/gi,
  /\binterac\b/gi,
  /\b(?:venmo|pay\s?pal|cash\s?app|zelle|western\s+union|wise\s+transfer)\b/gi,
  /\bpay(?:ing)?\s+(?:me|you|us|him|her)\s+(?:directly|direct|outside|privately|separately|off|in\s+cash|cash|on\s+the\s+side)\b/gi,
  /\b(?:i|we)\s+(?:can|could|will|would|'ll|’ll)\s+pay\s+(?:you\s+)?(?:in\s+)?cash\b/gi,
  /\bpay\s+(?:you\s+|me\s+)?(?:in\s+)?cash\b/gi,
  /\bcash\s+(?:is\s+fine|works|instead|only|in\s+hand)\b/gi,
  /\boff[\s-](?:the\s+)?platform\b/gi,
  /\boutside\s+(?:of\s+)?(?:the\s+)?platform\b/gi,
  /\b(?:pay|paying|payment|book|booking|lessons?|sessions?|move|moving|take|taking|continue|arrange|deal|meet|talk|chat|contact|switch)\b[^.!?\n]{0,40}\b(?:off|outside(?:\s+of)?)\s+(?:the\s+)?(?:app|site|website|aplus|a\+?\s?plus(?:\s+learn)?)\b/gi,
  /\b(?:avoid|skip|dodge|bypass|save\s+on|get\s+around|cut\s+out)\s+(?:paying\s+)?(?:the\s+|their\s+|any\s+|all\s+the\s+)?(?:(?:platform|site|app|aplus)(?:'s|’s)?\s+)?(?:fees?|commission|cut|middle\s?man)\b/gi,
  /\bwithout\s+(?:the\s+)?(?:platform|site|app|aplus)(?:'s|’s)?\s+(?:fees?|commission|cut)\b/gi,
  /\b(?:skip|bypass|avoid|go\s+around|cut\s+out)\s+(?:the\s+)?(?:platform|site|app|aplus|middle\s?man)\b/gi,
];

// --- Phone numbers ------------------------------------------------------------

const DIGIT_WORDS = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};

/**
 * A digit group, or a digit spelled as a word. Digits must stand alone — a
 * digit inside "MHF4U" or "3x" is part of a word, not of a number.
 */
const NUMBER_TOKEN = new RegExp(
  `(?<![A-Za-z0-9])\\d+(?![A-Za-z0-9])|\\b(?:${Object.keys(DIGIT_WORDS).join("|")})\\b`,
  "gi",
);

/**
 * What may sit between two parts of one phone number. Deliberately not a
 * colon (4:30), a comma (a list of question numbers), a slash (a date or a
 * fraction) or any operator (2^10=1024).
 */
const PHONE_SEPARATOR = /^[\s.\-–—()_]{0,3}$/;

/**
 * Group shapes a North American number is written in, once any run of single
 * digits ("4 1 6", "four one six") has been read as one group.
 */
const PHONE_SHAPES = new Set(["10", "11", "3,3,4", "1,3,3,4", "3,7", "1,3,7"]);

function isNanp(digits) {
  const d = digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
  if (d.length !== 10) return false;
  // Area code and exchange both start 2–9.
  return /[2-9]/.test(d[0]) && /[2-9]/.test(d[3]);
}

/**
 * Phone numbers in `text`, as `[start, end]` spans.
 *
 * Numbers are read as *runs* of digit groups joined by phone-like separators;
 * each run is checked for a phone-shaped grouping inside it. That is what
 * keeps "2 4 6 8 10 12 14" (a sequence, grouped 4,2,2,2) and
 * "4242 4242 4242 4242" (a card-shaped test number) from reading as phones,
 * while "416 555 1234", "(416) 555-1234", "+1 416.555.1234", "4165551234",
 * "4-1-6-5-5-5-1-2-3-4" and "four one six five five five one two three four"
 * all do.
 */
function phoneSpans(text) {
  const tokens = [];
  for (const m of text.matchAll(NUMBER_TOKEN)) {
    const raw = m[0];
    const digits = /^\d+$/.test(raw) ? raw : DIGIT_WORDS[raw.toLowerCase()];
    tokens.push({ start: m.index, end: m.index + raw.length, digits, word: !/^\d+$/.test(raw) });
  }

  const runs = [];
  let run = [];
  for (const token of tokens) {
    const previous = run[run.length - 1];
    if (previous && PHONE_SEPARATOR.test(text.slice(previous.end, token.start))) {
      run.push(token);
    } else {
      if (run.length) runs.push(run);
      run = [token];
    }
  }
  if (run.length) runs.push(run);

  const spans = [];
  for (const tokensInRun of runs) {
    // A run of words alone needs at least ten of them to be a number at all;
    // "one or two" never gets this far, but "one two" might.
    if (tokensInRun.every((t) => t.word) && tokensInRun.length < 10) continue;

    // Collapse consecutive single digits into one group.
    const groups = [];
    for (const token of tokensInRun) {
      const last = groups[groups.length - 1];
      if (token.digits.length === 1 && last?.single) {
        last.digits += token.digits;
        last.end = token.end;
      } else {
        groups.push({ ...token, single: token.digits.length === 1 });
      }
    }

    // Find the first phone-shaped window of consecutive groups.
    let found = null;
    for (let i = 0; i < groups.length && !found; i += 1) {
      let digits = "";
      const shape = [];
      for (let j = i; j < groups.length; j += 1) {
        digits += groups[j].digits;
        shape.push(groups[j].digits.length);
        if (digits.length > 11) break;
        if (PHONE_SHAPES.has(shape.join(",")) && isNanp(digits)) {
          found = { start: groups[i].start, end: groups[j].end };
          break;
        }
      }
    }
    if (!found) continue;

    // Money, percentages and equations are numbers, not phones.
    const before = text.slice(Math.max(0, found.start - 2), found.start);
    const after = text.slice(found.end, found.end + 2);
    if (/[$=^]\s*$/.test(before) || /^\s*[%=^]/.test(after)) continue;

    // Keep a leading "+" or "(" with the number it belongs to, so the mask
    // does not leave "([contact details removed]" behind.
    const lead = /[+(]\s?$/.exec(text.slice(Math.max(0, found.start - 2), found.start));
    spans.push([lead ? found.start - lead[0].length : found.start, found.end]);
  }
  return spans;
}

// --- Detection ----------------------------------------------------------------

/** Zero-width and similar characters used to slip a detail past a pattern. */
const INVISIBLES = /[​-‍⁠﻿­]/g;

/**
 * Look for off-platform contact details and payment language in `text`.
 *
 * @param {string} text
 * @returns {{
 *   findings: Array<{ kind: string, masked: boolean }>,
 *   kinds: string[],
 *   masked: string,
 *   hasContactDetails: boolean,
 *   hasPaymentLanguage: boolean,
 * }}
 *   `findings` never carries the matched text — what was found is a kind, not
 *   a value, so nothing downstream can store it by accident. `masked` is the
 *   text with every contact detail replaced by `CONTACT_MASK`; when nothing
 *   was masked it is `text` exactly as given.
 */
export function detectOffPlatformContact(text) {
  const empty = { findings: [], kinds: [], masked: text ?? "", hasContactDetails: false, hasPaymentLanguage: false };
  if (typeof text !== "string" || !text.trim()) return empty;

  // Read the normalised form, so a full-width "＠" or a zero-width space in
  // the middle of an address is read as what it is.
  const normal = text.normalize("NFKC").replace(INVISIBLES, "");

  const findings = [];
  const spans = [];

  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0;
    for (const m of normal.matchAll(pattern.re)) {
      const groups = m.slice(1);
      if (pattern.accept && !pattern.accept(m[0], normal, m.index, groups)) continue;
      findings.push({ kind: pattern.kind, masked: pattern.mask });
      if (pattern.mask) {
        spans.push(pattern.span ? pattern.span(m[0], m.index, groups) : [m.index, m.index + m[0].length]);
      }
    }
  }

  for (const span of phoneSpans(normal)) {
    findings.push({ kind: PHONE, masked: true });
    spans.push(span);
  }

  for (const re of PAYMENT_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(normal)) findings.push({ kind: OFF_PLATFORM_PAYMENT, masked: false });
    re.lastIndex = 0;
  }

  if (!findings.length) return empty;

  const kinds = [...new Set(findings.map((f) => f.kind))];
  return {
    findings,
    kinds,
    masked: spans.length ? maskSpans(normal, spans) : text,
    hasContactDetails: kinds.some((kind) => CONTACT_DETAIL_KINDS.includes(kind)),
    hasPaymentLanguage: kinds.includes(OFF_PLATFORM_PAYMENT),
  };
}

/**
 * Replace each span with the mask. Overlapping spans, and spans with only
 * spacing or punctuation between them ("416 555 1234 / jane@x.com"), become a
 * single mask rather than a stutter of them.
 */
function maskSpans(text, spans) {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && (start <= last[1] || /^[\s,;/|.:-]*$/.test(text.slice(last[1], start)))) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  let out = "";
  let cursor = 0;
  for (const [start, end] of merged) {
    out += text.slice(cursor, start) + CONTACT_MASK;
    cursor = end;
  }
  return out + text.slice(cursor);
}

/** The words the sender is shown after a flagged send. */
export const OFF_PLATFORM_WARNING = {
  code: "OFF_PLATFORM_CONTACT",
  message:
    "Contact details and off-platform payment aren't allowed — keep bookings and payments on APlus Learn.",
  href: "/legal/community-standards",
};
