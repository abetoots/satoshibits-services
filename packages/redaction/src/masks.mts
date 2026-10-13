/**
 * Masks: each takes a text and returns it with one kind of value replaced.
 *
 * A mask runs on text other people wrote (a URL, a user agent, an error
 * message from a third party), so each one takes time that grows with the
 * length of the text and not with its square. The two shapes with no bound on
 * their length, an email address and a JWT, are found by a scan written for
 * the purpose; the rest are patterns whose every repetition is bounded.
 *
 * A mask recognises a shape, not a meaning: a card number is sixteen digits
 * in groups, whatever they number. What a mask leaves is not thereby safe.
 */

/** a text in, the text with something replaced out */
export type Mask = (text: string) => string;

/** what a masked value is replaced with unless a mask is told otherwise */
export const REDACTED = "[REDACTED]";

/** the masks in the order given, as one */
export const composeMasks =
  (...masks: readonly Mask[]): Mask =>
  (text) =>
    masks.reduce((masked, mask) => mask(masked), text);

const isBetween = (code: number, low: string, high: string): boolean =>
  code >= low.charCodeAt(0) && code <= high.charCodeAt(0);

const isLetter = (code: number): boolean =>
  isBetween(code, "a", "z") || isBetween(code, "A", "Z");

const isDigit = (code: number): boolean => isBetween(code, "0", "9");

/** a letter, a digit or an underscore: what a pattern's `\w` is */
const isWordCharacter = (code: number): boolean =>
  isLetter(code) || isDigit(code) || code === 95;

/** the part of an address before the sign: letters, digits and `. _ % + -` */
const isLocalCharacter = (code: number): boolean =>
  isWordCharacter(code) ||
  code === 46 ||
  code === 37 ||
  code === 43 ||
  code === 45;

/** the part after it: letters, digits, dots and hyphens */
const isDomainCharacter = (code: number): boolean =>
  isLetter(code) || isDigit(code) || code === 46 || code === 45;

/** what an address is replaced with: a text, or a function of its two sides */
export type EmailReplacement =
  | string
  | ((local: string, domain: string) => string);

/**
 * Email addresses: `local@domain`, the domain ending in a dot and a label of
 * two letters or more.
 *
 * Each `@` is looked at once: the scan walks back over the local part and
 * forward over the domain, and no character is walked over more than twice.
 * The address ends at the end of the last label of two letters or more, so in
 * `a@b.com.123` it is `a@b.com`.
 */
export const maskEmails =
  (replacement: EmailReplacement = "[EMAIL]"): Mask =>
  (text) => {
    let masked = "";
    // everything before this index has been copied to the result
    let copied = 0;
    let at = text.indexOf("@");
    while (at !== -1) {
      let start = at;
      while (start > copied && isLocalCharacter(text.charCodeAt(start - 1))) {
        start--;
      }
      let domainEnd = at + 1;
      while (
        domainEnd < text.length &&
        isDomainCharacter(text.charCodeAt(domainEnd))
      ) {
        domainEnd++;
      }
      let end = -1;
      if (start < at) {
        // the last dot that has something before it and two letters or more after it
        for (let dot = domainEnd - 1; dot > at + 1; dot--) {
          if (text.charCodeAt(dot) !== 46) continue;
          let labelEnd = dot + 1;
          while (labelEnd < domainEnd && isLetter(text.charCodeAt(labelEnd))) {
            labelEnd++;
          }
          if (labelEnd - dot > 2) {
            end = labelEnd;
            break;
          }
        }
      }
      if (end !== -1) {
        masked +=
          text.slice(copied, start) +
          (typeof replacement === "string"
            ? replacement
            : replacement(text.slice(start, at), text.slice(at + 1, end)));
        copied = end;
      }
      at = text.indexOf("@", Math.max(at + 1, copied));
    }
    return copied === 0 ? text : masked + text.slice(copied);
  };

/** a JWT segment's characters: base64url */
const isSegmentCharacter = (code: number): boolean =>
  isWordCharacter(code) || code === 45;

/**
 * JWTs: three base64url segments joined by dots, the first starting `eyJ`
 * (a JSON object's opening brace and quote, encoded) at the start of a word.
 * A hyphen that ends the third segment is not taken as part of it.
 *
 * A prefix that does not start a token costs one walk over its first
 * segment, and the scan resumes after that segment: a prefix inside it would
 * end at the same place and fail the same way.
 */
export const maskJwts =
  (replacement: string = REDACTED): Mask =>
  (text) => {
    const segmentEnd = (from: number): number => {
      let end = from;
      while (end < text.length && isSegmentCharacter(text.charCodeAt(end))) {
        end++;
      }
      return end;
    };
    let masked = "";
    let copied = 0;
    let start = text.indexOf("eyJ");
    while (start !== -1) {
      let next = start + 3;
      if (start === 0 || !isWordCharacter(text.charCodeAt(start - 1))) {
        const first = segmentEnd(start + 3);
        next = first;
        if (first > start + 3 && text.charCodeAt(first) === 46) {
          const second = segmentEnd(first + 1);
          if (second > first + 1 && text.charCodeAt(second) === 46) {
            // the token does not end in a hyphen: the third segment is cut back to its last other character
            let end = segmentEnd(second + 1);
            while (end > second + 1 && text.charCodeAt(end - 1) === 45) end--;
            if (end > second + 1) {
              masked += text.slice(copied, start) + replacement;
              copied = end;
              next = end;
            }
          }
        }
      }
      start = text.indexOf("eyJ", next);
    }
    return copied === 0 ? text : masked + text.slice(copied);
  };

/** a mask that replaces every match of a pattern whose repetitions are all bounded */
const patternMask =
  (pattern: RegExp, fallback: string = REDACTED) =>
  (replacement: string = fallback): Mask =>
  (text) =>
    text.replace(pattern, () => replacement);

/** sixteen digits in four groups, with or without a space or hyphen between */
export const maskCardNumbers = patternMask(/\b(?:\d{4}[\s-]?){3}\d{4}\b/g);

/** a US social security number as it is written: 123-45-6789 */
export const maskSsns = patternMask(/\b\d{3}-\d{2}-\d{4}\b/g);

/** thirteen digits or more in a row: a card, an account, a long id */
export const maskLongDigits = patternMask(/\b\d{13,}\b/g);

/** thirteen to nineteen digits written in groups, which the rule for a run of digits misses */
export const maskGroupedDigits = patternMask(/\b\d(?:[ -]?\d){12,18}\b/g);

/** the key shapes of named vendors, as alternatives of one pattern */
const VENDOR_KEYS = [
  // Stripe
  "(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{24,}",
  // AWS access key ids, long-term and temporary
  "A[KS]IA[A-Z0-9]{16}",
  // Google
  "AIza[0-9A-Za-z_-]{35}",
  // GitHub
  "(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}",
  "github_pat_[A-Za-z0-9_]{22,}",
  // Slack
  "xox[bpas]-[A-Za-z0-9-]{10,}",
  // SendGrid; a segment longer than any real key's is not looked for: the bound keeps the pattern linear
  "SG\\.[A-Za-z0-9_-]{1,128}\\.[A-Za-z0-9_-]{1,128}",
  // OpenAI project keys, Anthropic
  "sk-(?:proj|ant)[A-Za-z0-9_-]{20,}",
];
/** a word that suggests a key, an underscore, and sixteen letters or digits or more */
const GENERIC_KEY = "(?:api|key|token|secret|auth|bearer)_[A-Za-z0-9]{16,}";

const keyPattern = (alternatives: readonly string[]): RegExp =>
  new RegExp(`\\b(?:${alternatives.join("|")})\\b`, "gi");

/**
 * Keys with a vendor's prefix: Stripe, AWS access key ids, Google, GitHub,
 * Slack, SendGrid, OpenAI project keys, Anthropic. Not a matcher for
 * anything long and random: a hash or an id passes.
 */
export const maskVendorKeys = patternMask(keyPattern(VENDOR_KEYS));

/**
 * `maskVendorKeys`, and anything that starts `api_`, `key_`, `token_`,
 * `secret_`, `auth_` or `bearer_` and goes on for sixteen letters or digits.
 * That second shape is also the shape of an ordinary name
 * (`api_getUserProfileSettings`): use this where names are not expected.
 */
export const maskApiKeys = patternMask(
  keyPattern([...VENDOR_KEYS, GENERIC_KEY]),
);

/**
 * The key shapes an AI provider quotes back in an error: `sk-…` (OpenAI,
 * Anthropic) and `AIza…` (Google), at shorter lengths than `maskApiKeys`
 * asks for. A model id such as `gpt-4o-mini` passes.
 */
export const maskProviderKeys = patternMask(
  /\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{10,})/g,
);

/** `Bearer <token>`, the scheme included: an Authorization header quoted in a text */
export const maskBearerTokens = patternMask(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi);

/** `password: value` (also `passwd`, `pwd`): the value goes, the word stays */
export const maskPasswordPairs =
  (replacement: string = REDACTED): Mask =>
  (text) =>
    text.replace(
      /\b(password|passwd|pwd):\s*\S+/gi,
      (_match, word: string) => `${word}: ${replacement}`,
    );

/** North American phone numbers; each run of digits becomes `***` */
export const maskPhoneNumbers =
  (): Mask =>
  (text) =>
    text.replace(
      /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
      (match) => match.replace(/\d/g, "*").replace(/\*{3,}/g, "***"),
    );

/** IPv4 addresses */
export const maskIpv4Addresses = patternMask(
  /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
  "***.***.***",
);

/** UUIDs */
export const maskUuids = patternMask(
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  "********-****-****-****-************",
);
