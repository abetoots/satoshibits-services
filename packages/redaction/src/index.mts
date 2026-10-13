/**
 * `@satoshibits/redaction`
 *
 * Redaction for what a process writes or sends: text masks, key rules, a
 * standard policy made of them, the same policy for a logger's fields, and a
 * safe description of an error. No dependencies and no global state; nothing
 * is redacted unless a caller applies a mask or names a policy.
 */

export type { Mask, EmailReplacement } from "./masks.mjs";
export {
  REDACTED,
  composeMasks,
  maskApiKeys,
  maskBearerTokens,
  maskCardNumbers,
  maskEmails,
  maskGroupedDigits,
  maskIpv4Addresses,
  maskJwts,
  maskLongDigits,
  maskPasswordPairs,
  maskPhoneNumbers,
  maskProviderKeys,
  maskSsns,
  maskUuids,
} from "./masks.mjs";

export { cutUrl, cutUrls } from "./urls.mjs";

export type { KeyRule } from "./keys.mjs";
export { anyKey, exactKeys, keyEndsWith, keyWords, wordsOfKey } from "./keys.mjs";

export type {
  FieldsRedactor,
  PolicyAttributes,
  PolicyLogRecord,
  PolicyParts,
  PolicySpanEvent,
  RedactionPolicy,
} from "./policy.mjs";
export { createFieldsRedactor, createPolicy } from "./policy.mjs";

export {
  redactFields,
  standardMasks,
  standardParts,
  standardPolicy,
  standardRules,
} from "./standard.mjs";

export type { ErrorDescription, ThrownDescription } from "./describe-error.mjs";
export { describeError, isUsableErrorCode } from "./describe-error.mjs";
