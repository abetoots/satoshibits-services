/**
 * Permanence rule tests
 *
 * One rule decides whether a failed job is retried: the worker's `failed`
 * event and every provider that applies it read it from here
 */

import { describe, expect, it } from "vitest";

import {
  getErrorMessage,
  isPermanentError,
  PermanentJobError,
  TransientJobError,
} from "./errors.mjs";

describe("isPermanentError", () => {
  it.each([
    {
      label: "a PermanentJobError",
      error: new PermanentJobError("never again"),
    },
    {
      label: "an Error instance carrying retryable: false",
      error: Object.assign(new Error("flagged"), { retryable: false }),
    },
    {
      label: "a plain structured object carrying retryable: false",
      error: {
        type: "DataError",
        code: "VALIDATION",
        message: "bad input",
        retryable: false,
      },
    },
    {
      label: "an object with nothing but retryable: false",
      error: { retryable: false },
    },
  ])("should be permanent for $label", ({ error }) => {
    expect(isPermanentError(error)).toBe(true);
  });

  it.each([
    { label: "a plain Error", error: new Error("try again") },
    { label: "a TransientJobError", error: new TransientJobError("later") },
    {
      label: "an Error instance carrying retryable: true",
      error: Object.assign(new Error("flagged"), { retryable: true }),
    },
    {
      label: "a plain structured object carrying retryable: true",
      error: {
        type: "RuntimeError",
        code: "TIMEOUT",
        message: "slow",
        retryable: true,
      },
    },
    // only the boolean `false` is the signal: a falsy value is not
    { label: "retryable: undefined", error: { retryable: undefined } },
    { label: "retryable: 0", error: { retryable: 0 } },
    { label: "retryable: null", error: { retryable: null } },
    { label: 'retryable: "false"', error: { retryable: "false" } },
    { label: "an object without the flag", error: { message: "no flag" } },
  ])("should not be permanent for $label", ({ error }) => {
    expect(isPermanentError(error)).toBe(false);
  });

  // a handler can throw anything: the rule must answer, not throw (`in` on a
  // primitive is a TypeError)
  it.each([
    { label: "a string", error: "boom" },
    { label: "a number", error: 42 },
    { label: "null", error: null },
    { label: "undefined", error: undefined },
    { label: "the boolean false", error: false },
  ])("should not be permanent, and not throw, for $label", ({ error }) => {
    expect(isPermanentError(error)).toBe(false);
  });
});

describe("getErrorMessage", () => {
  it("should return the message of an Error", () => {
    expect(getErrorMessage(new Error("from an error"))).toBe("from an error");
  });

  it("should return the message of a plain structured object", () => {
    expect(
      getErrorMessage({
        type: "DataError",
        code: "VALIDATION",
        message: "from an object",
        retryable: false,
      }),
    ).toBe("from an object");
  });

  it("should stringify a primitive", () => {
    expect(getErrorMessage("boom")).toBe("boom");
    expect(getErrorMessage(42)).toBe("42");
    expect(getErrorMessage(undefined)).toBe("undefined");
    expect(getErrorMessage(null)).toBe("null");
  });

  it("should stringify an object whose message is not a string", () => {
    expect(getErrorMessage({ retryable: false })).toBe("[object Object]");
    expect(getErrorMessage({ message: 42 })).toBe("[object Object]");
  });
});
