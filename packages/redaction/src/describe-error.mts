/**
 * The default safe shape of an error in a log line.
 *
 * Not the error itself, and not a copy of all its properties: a database
 * error can carry the document it failed on, an HTTP client's error the
 * request it sent. What is kept is what identifies the failure: its name,
 * message, code and stack, and the name and code of its cause.
 */

// an error's class name or code: a short identifier, never prose or an object
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,64}$/;

/** an error as a log line may carry it */
export interface ErrorDescription {
  /** the error's name, or its class's; "Error" when neither is a usable identifier */
  name: string;
  /** the message; "" when it is not a text */
  message: string;
  code?: string | number;
  stack?: string;
  /** the name of the error's cause, when the cause is an error */
  causeName?: string;
  /** the code of the error's cause, when it has a usable one */
  causeCode?: string | number;
}

/** what was thrown, when it was not an error: its type and nothing of its content */
export interface ThrownDescription {
  thrown: string;
}

/**
 * Whether a value can be logged or put on a span as an error's code: a
 * finite number, or a string of 1 to 64 characters from letters, digits and
 * `_ . : -`. Anything else (prose, an object, an empty string) is not a code.
 */
export const isUsableErrorCode = (value: unknown): value is string | number =>
  typeof value === "number"
    ? Number.isFinite(value)
    : typeof value === "string" && IDENTIFIER.test(value);

/** a property of something that may refuse to be read; `undefined` when it does */
const read = (from: object, property: string): unknown => {
  try {
    return (from as Record<string, unknown>)[property];
  } catch {
    return undefined;
  }
};

const isIdentifier = (value: unknown): value is string =>
  typeof value === "string" && IDENTIFIER.test(value);

/** whether a property is the object's own; false when it refuses to say */
const hasOwn = (object: object, property: string): boolean => {
  try {
    return Object.prototype.hasOwnProperty.call(object, property);
  } catch {
    return false;
  }
};

/** a structure that can have a code: an object that is not an array; false when it refuses to say */
const isStructure = (value: unknown): value is object => {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
};

/**
 * An error's name: the one it gives itself, or its class's name when it only
 * inherits "Error" (a class that extends `Error` and sets no name). An error
 * that names itself "Error" keeps that name.
 */
const nameOf = (error: object): string => {
  const name = read(error, "name");
  if (name !== "Error" || hasOwn(error, "name")) {
    return isIdentifier(name) ? name : "Error";
  }
  const constructor = read(error, "constructor");
  const className =
    typeof constructor === "function" ? read(constructor, "name") : undefined;
  return isIdentifier(className) ? className : "Error";
};

const isError = (value: unknown): value is Error => {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
};

/**
 * An error as name, message, code and stack, with one level of cause as
 * `causeName` and `causeCode`, and nothing else it carries.
 *
 * Each field is kept only as what it claims to be: the name and a string
 * code as short identifiers, the message and the stack as text. A name that
 * is not usable is "Error", a message that is not a text is "", so every
 * description has both; a code or a stack that is not usable is left out. A
 * cause contributes identifiers only: its message is not read, and of a
 * cause that is a structure and not an error only the code is kept.
 *
 * A value that is not an `Error` of this realm is described by its type
 * alone. Nothing here throws, whatever the error does when it is read.
 *
 * What this does not do: a message or a stack can quote a value. Pass the
 * description through a policy (`redactFields`) before it is written, and do
 * not log a third party's free text where you have handed that party a secret.
 */
export function describeError(error: unknown): ErrorDescription | ThrownDescription {
  if (!isError(error)) return { thrown: typeof error };

  const message = read(error, "message");
  const code = read(error, "code");
  const stack = read(error, "stack");
  const cause = read(error, "cause");
  const causeIsError = isError(cause);
  const causeCode = isStructure(cause) ? read(cause, "code") : undefined;

  return {
    name: nameOf(error),
    message: typeof message === "string" ? message : "",
    ...(isUsableErrorCode(code) && { code }),
    ...(typeof stack === "string" && { stack }),
    ...(causeIsError && { causeName: nameOf(cause) }),
    ...(isUsableErrorCode(causeCode) && { causeCode }),
  };
}
