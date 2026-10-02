/**
 * Permanence rule tests
 *
 * One rule decides whether a failed job is retried: the worker's `failed`
 * event and every provider that applies it read it from here
 */

import { describe, expect, it } from "vitest";

import {
  getErrorMessage,
  getErrorName,
  isErrorInstance,
  isPermanentError,
  isReadableError,
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

  it("should keep an empty string message", () => {
    expect(getErrorMessage(new Error(""))).toBe("");
  });

  it("should describe an object with no string message as JSON", () => {
    expect(getErrorMessage({ retryable: false })).toBe('{"retryable":false}');
    expect(getErrorMessage({ message: 42 })).toBe('{"message":42}');
  });

  it("should cap the JSON of a large object", () => {
    const message = getErrorMessage({ blob: "x".repeat(5000) });

    expect(message.length).toBeLessThanOrEqual(501);
    expect(message.startsWith('{"blob":"xxx')).toBe(true);
  });

  it("should stringify a symbol and a bigint", () => {
    expect(getErrorMessage(Symbol("boom"))).toBe("Symbol(boom)");
    expect(getErrorMessage(10n)).toBe("10");
  });
});

// a handler can fail with any value. inspecting it must never throw: a throw
// here would replace the real failure and suppress the `failed` event
describe("hostile values", () => {
  const UNREADABLE = "Unknown error (no readable message)";

  const throwingTraps: ProxyHandler<object> = {
    get: () => {
      throw new Error("get trap");
    },
    has: () => {
      throw new Error("has trap");
    },
    getPrototypeOf: () => {
      throw new Error("getPrototypeOf trap");
    },
    ownKeys: () => {
      throw new Error("ownKeys trap");
    },
    getOwnPropertyDescriptor: () => {
      throw new Error("getOwnPropertyDescriptor trap");
    },
  };

  function revokedProxy(): object {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    return proxy;
  }

  const hostile = [
    {
      label: "a throwing retryable getter",
      make: (): unknown => ({
        get retryable(): boolean {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- the review's counterexample throws a string
          throw "inspection failed";
        },
      }),
      permanent: false,
      message: UNREADABLE,
    },
    {
      label: "retryable: false with a throwing message getter",
      make: (): unknown => ({
        retryable: false,
        get message(): string {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- the review's counterexample throws a string
          throw "inspection failed";
        },
      }),
      permanent: true,
      message: UNREADABLE,
    },
    {
      label: "an object with no prototype",
      make: (): unknown => Object.create(null) as unknown,
      permanent: false,
      message: UNREADABLE,
    },
    {
      label: "an object with no prototype carrying retryable: false",
      make: (): unknown =>
        Object.assign(Object.create(null) as object, { retryable: false }),
      permanent: true,
      message: '{"retryable":false}',
    },
    {
      label: "a proxy whose every trap throws",
      make: (): unknown => new Proxy({}, throwingTraps),
      permanent: false,
      message: UNREADABLE,
    },
    {
      label: "a proxy over an Error whose every trap throws",
      make: (): unknown => new Proxy(new Error("hidden"), throwingTraps),
      permanent: false,
      message: UNREADABLE,
    },
    {
      label: "a revoked proxy",
      make: revokedProxy,
      permanent: false,
      message: UNREADABLE,
    },
    {
      // not an object: converted with String(), which calls its toString
      label: "a function with a throwing toString",
      make: (): unknown =>
        Object.assign((): void => undefined, {
          retryable: false,
          toString: (): never => {
            throw new Error("toString");
          },
        }),
      // a function is wrapped by the worker like a primitive: no flag is read
      permanent: false,
      message: UNREADABLE,
    },
    {
      label: "a circular object",
      make: (): unknown => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        return circular;
      },
      permanent: false,
      message: UNREADABLE,
    },
    {
      label: "an object with a throwing toJSON and toString",
      make: (): unknown => ({
        toJSON: (): never => {
          throw new Error("toJSON");
        },
        toString: (): never => {
          throw new Error("toString");
        },
      }),
      permanent: false,
      message: UNREADABLE,
    },
  ];

  it.each(hostile)(
    "isPermanentError should answer $permanent for $label",
    ({ make, permanent }) => {
      expect(isPermanentError(make())).toBe(permanent);
    },
  );

  it.each(hostile)(
    "getErrorMessage should answer for $label",
    ({ make, message }) => {
      expect(getErrorMessage(make())).toBe(message);
    },
  );

  it.each(hostile)("getErrorName should answer for $label", ({ make }) => {
    expect(getErrorName(make())).toBe("Error");
  });

  it.each(hostile)(
    "isErrorInstance should answer, not throw, for $label",
    ({ make }) => {
      expect(typeof isErrorInstance(make())).toBe("boolean");
    },
  );

  it("getErrorName should fall back for a throwing or non-string name", () => {
    const throwing = new Error("boom");
    Object.defineProperty(throwing, "name", {
      get: () => {
        throw new Error("name getter");
      },
    });
    const numeric = Object.assign(new Error("boom"), { name: 42 });
    const empty = Object.assign(new Error("boom"), { name: "" });

    expect(getErrorName(throwing)).toBe("Error");
    expect(getErrorName(numeric)).toBe("Error");
    expect(getErrorName(empty)).toBe("Error");
    expect(getErrorName(new TypeError("boom"))).toBe("TypeError");
    expect(getErrorName(new PermanentJobError("boom"))).toBe(
      "PermanentJobError",
    );
    // a structured object is not an Error: its `name` is not an error type
    expect(getErrorName({ name: "Custom", message: "boom" })).toBe("Error");
  });

  it("isErrorInstance should recognise Errors only", () => {
    expect(isErrorInstance(new Error("boom"))).toBe(true);
    expect(isErrorInstance(new PermanentJobError("boom"))).toBe(true);
    expect(isErrorInstance({ message: "boom" })).toBe(false);
    expect(isErrorInstance("boom")).toBe(false);
    expect(isErrorInstance(null)).toBe(false);
  });
});

describe("isReadableError - the name BullMQ reads", () => {
  it("should reject an Error whose name cannot be read", () => {
    // bullmq reads err.name before it records the failure: a throwing getter
    // there would stop the job from ever being moved to failed
    const error = new Error("failure");
    // with its own stack value, reading the stack no longer touches the name
    Object.defineProperty(error, "stack", { value: "readable stack" });
    Object.defineProperty(error, "name", {
      get() {
        throw new Error("name inspection failed");
      },
    });

    expect(isReadableError(error)).toBe(false);
  });

  it("should accept an ordinary Error", () => {
    expect(isReadableError(new TypeError("failure"))).toBe(true);
  });
});

