/**
 * Key rules: whether a key names something to act on.
 *
 * A rule looks at the key as it is built, not as a string to search. A dotted
 * key is segments (`http.request.header.authorization`), and a segment is
 * words (`input_tokens`, `x-api-key`, `accessToken`, `password1`). A word matches a word,
 * so a rule for `token` does not fire on `input_tokens`, nor one for
 * `address` on a key that merely contains those letters.
 */

/** whether a key is one the rule is about */
export type KeyRule = (key: string) => boolean;

/** a lower-case letter or a digit followed by an upper-case letter: `accessToken` */
const CAMEL_HUMP = /([a-z0-9])([A-Z])/g;
/** a letter next to a digit, either way round: `password1`, `oauth2token` */
const LETTER_THEN_DIGIT = /([A-Za-z])([0-9])/g;
const DIGIT_THEN_LETTER = /([0-9])([A-Za-z])/g;
/** the end of a run of capitals that is followed by a word: `APIKey` */
const ACRONYM_END = /([A-Z])([A-Z][a-z])/g;
const WORD_SEPARATORS = /[^A-Za-z0-9]+/;

const wordsOfSegment = (segment: string): string[] =>
  segment
    .replace(CAMEL_HUMP, "$1 $2")
    .replace(ACRONYM_END, "$1 $2")
    .replace(LETTER_THEN_DIGIT, "$1 $2")
    .replace(DIGIT_THEN_LETTER, "$1 $2")
    .split(WORD_SEPARATORS)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());

/**
 * A key as its dot-separated segments, each as its words in lower case.
 * Words are separated by anything that is not a letter or a digit, by a
 * change of case (`accessToken`, `APIKey`) and between letters and digits
 * (`password1` is `password` and `1`).
 */
export const wordsOfKey = (key: string): string[][] =>
  key.split(".").map(wordsOfSegment);

/** whether `words` holds `phrase` as a run, starting at `from` */
const holdsAt = (
  words: readonly string[],
  phrase: readonly string[],
  from: number,
): boolean => phrase.every((word, offset) => words[from + offset] === word);

/** a phrase as a rule is given it (`api key`, `api_key`, `apiKey`), as words */
const wordsOfPhrase = (phrase: string): string[] => wordsOfKey(phrase).flat();

/** the keys named, exactly as written */
export const exactKeys = (...keys: readonly string[]): KeyRule => {
  const named = new Set(keys);
  return (key) => named.has(key);
};

/**
 * A word, or several in a row, anywhere in a key: `password` matches
 * `user.password`, `db_password` and `passwordHash`, and not `passwords`.
 * The words of a phrase must stand together in one segment.
 */
export const keyWords = (...phrases: readonly string[]): KeyRule => {
  const wanted = phrases.map(wordsOfPhrase).filter((words) => words.length > 0);
  return (key) =>
    wordsOfKey(key).some((words) =>
      wanted.some((phrase) =>
        words.some((_word, from) => holdsAt(words, phrase, from)),
      ),
    );
};

/**
 * The words a key ends with: `token` matches `access_token` and
 * `http.request.header.x-amz-security-token`, and not `token_count` or
 * `gen_ai.token.type`. For a word that names a secret only when it is the
 * thing the key holds.
 */
export const keyEndsWith = (...phrases: readonly string[]): KeyRule => {
  const wanted = phrases.map(wordsOfPhrase).filter((words) => words.length > 0);
  return (key) => {
    const words = wordsOfKey(key).at(-1) ?? [];
    return wanted.some(
      (phrase) =>
        phrase.length <= words.length &&
        holdsAt(words, phrase, words.length - phrase.length),
    );
  };
};

/** a rule that matches when one of the rules given does */
export const anyKey =
  (...rules: readonly KeyRule[]): KeyRule =>
  (key) =>
    rules.some((rule) => rule(key));
