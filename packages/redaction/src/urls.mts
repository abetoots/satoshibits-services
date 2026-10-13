/**
 * URLs, cut down to what locates: scheme, host (with its port) and path.
 * The query string, the fragment and the user-info go; they are where a
 * token, a signature, an email address or a password is put.
 *
 * Two limits, both on what is recognised in a running text: only the
 * `scheme://` spelling is a URL, and a URL ends at whitespace. A path is kept
 * as it is, so a secret written into a path is not removed here.
 */

import type { Mask } from "./masks.mjs";

/** the longest scheme looked for; the registered ones are far shorter */
const MAX_SCHEME_LENGTH = 32;

/** what may follow a URL in a sentence without being part of it */
const TRAILING_PUNCTUATION = new Set(".,;:!?)]}>'\"`");

const isLetter = (code: number): boolean =>
  (code >= 97 && code <= 122) || (code >= 65 && code <= 90);

/** a scheme's characters after its first: letters, digits and `+ . -` */
const isSchemeCharacter = (code: number): boolean =>
  isLetter(code) ||
  (code >= 48 && code <= 57) ||
  code === 43 ||
  code === 45 ||
  code === 46;

/** the index of the first `?` or `#` in `value` from `from` and before `end`, or `end` */
const queryOrFragment = (value: string, from: number, end: number): number => {
  for (let index = from; index < end; index++) {
    const code = value.charCodeAt(index);
    if (code === 63 || code === 35) return index;
  }
  return end;
};

/**
 * The URL in `value` whose `://` is at `separator` and which ends before
 * `end`, cut. The scheme is passed as found. Nothing outside the URL is read.
 */
const cutFrom = (
  value: string,
  scheme: string,
  separator: number,
  end: number,
): string => {
  const authorityStart = separator + 3;
  let authorityEnd = authorityStart;
  // the last "@" of the authority ends the user-info
  let hostStart = authorityStart;
  while (authorityEnd < end) {
    const code = value.charCodeAt(authorityEnd);
    if (code === 47 || code === 63 || code === 35) break;
    if (code === 64) hostStart = authorityEnd + 1;
    authorityEnd++;
  }
  return `${scheme}://${value.slice(hostStart, queryOrFragment(value, authorityEnd, end))}`;
};

/**
 * A value that is a URL, or a path with a query (`http.target`), cut. The
 * whole value is taken as one: a space in it does not end it.
 */
export function cutUrl(value: string): string {
  const separator = value.indexOf("://");
  if (separator > 0) {
    let isScheme = isLetter(value.charCodeAt(0));
    for (let index = 1; isScheme && index < separator; index++) {
      isScheme = isSchemeCharacter(value.charCodeAt(index));
    }
    if (isScheme) {
      return cutFrom(value, value.slice(0, separator), separator, value.length);
    }
  }
  return value.slice(0, queryOrFragment(value, 0, value.length));
}

/**
 * A mask that cuts every URL in a text. One pass: each `://` is looked at
 * once, its scheme is read backwards over at most 32 characters, and the URL
 * runs to the next whitespace. Punctuation after it stays where it was.
 */
export const cutUrls = (): Mask => (text) => {
  let cut = "";
  let copied = 0;
  const whitespace = /\s/g;
  let separator = text.indexOf("://");
  while (separator !== -1) {
    let next = separator + 3;
    // the scheme: back over its characters, then forward to its first letter
    let schemeStart = separator;
    const limit = Math.max(copied, separator - MAX_SCHEME_LENGTH);
    while (
      schemeStart > limit &&
      isSchemeCharacter(text.charCodeAt(schemeStart - 1))
    ) {
      schemeStart--;
    }
    while (
      schemeStart < separator &&
      !isLetter(text.charCodeAt(schemeStart))
    ) {
      schemeStart++;
    }
    // only a "://" with a scheme before it is walked forward from
    if (schemeStart < separator) {
      whitespace.lastIndex = separator + 3;
      const tokenEnd = whitespace.exec(text)?.index ?? text.length;
      let urlEnd = tokenEnd;
      while (
        urlEnd > separator + 3 &&
        TRAILING_PUNCTUATION.has(text.charAt(urlEnd - 1))
      ) {
        urlEnd--;
      }
      cut +=
        text.slice(copied, schemeStart) +
        cutFrom(text, text.slice(schemeStart, separator), separator, urlEnd) +
        text.slice(urlEnd, tokenEnd);
      copied = tokenEnd;
      next = tokenEnd;
    }
    separator = text.indexOf("://", next);
  }
  return copied === 0 ? text : cut + text.slice(copied);
};
