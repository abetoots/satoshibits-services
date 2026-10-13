import { describe, expect, it } from "vitest";

import type { ErrorDescription, ThrownDescription } from "./describe-error.mjs";

import { describeError as describeErrorAsExported, isUsableErrorCode } from "./describe-error.mjs";

// the tests read fields of either description without narrowing first
const describeError = describeErrorAsExported as (
  error: unknown,
) => Partial<ErrorDescription> & Partial<ThrownDescription>;

const PAYLOAD = { secret: "payload-must-not-be-logged" };

describe("describeError", () => {
  it("keeps an error's name, message, code and stack", () => {
    const error = Object.assign(new TypeError("fetch failed"), { code: "ECONNREFUSED" });

    expect(describeError(error)).toEqual({
      name: "TypeError",
      message: "fetch failed",
      code: "ECONNREFUSED",
      stack: expect.stringContaining("fetch failed") as unknown,
    });
  });

  it("returns a plain object, not the error", () => {
    expect(describeError(new Error("x"))).not.toBeInstanceOf(Error);
  });

  it("drops everything else an error carries", () => {
    // a database error can carry the document it failed on
    const error = Object.assign(new Error("write failed"), {
      name: "MongoServerError",
      code: 11000,
      op: PAYLOAD,
      keyValue: PAYLOAD,
      writeErrors: [{ err: { op: PAYLOAD } }],
      response: { body: PAYLOAD },
      cause: PAYLOAD,
    });

    const described = describeError(error);

    expect(Object.keys(described).sort()).toEqual(["code", "message", "name", "stack"]);
    expect(JSON.stringify(described)).not.toContain("payload-must-not-be-logged");
  });

  it("takes each of the four only as what it claims to be", () => {
    // an object, or prose, put in one of them is not an error's name or code
    const error = new Error("x");
    Object.defineProperties(error, {
      name: { value: PAYLOAD },
      message: { value: PAYLOAD },
      stack: { value: PAYLOAD },
    });
    Object.assign(error, { code: "payload-must-not-be-logged as a code with spaces" });

    // strict: no key is left behind with an undefined value
    expect(describeError(error)).toStrictEqual({ name: "Error", message: "" });
  });

  it("does not keep a name that is prose", () => {
    const error = new Error("x");
    Object.defineProperty(error, "name", { value: "payload-must-not-be-logged with spaces" });

    expect(describeError(error).name).toBe("Error");
  });

  it("keeps an identifier of 64 characters and drops one of 65", () => {
    const fits = "A".repeat(64);
    const tooLong = "A".repeat(65);
    const named = (name: string): Error => Object.defineProperty(new Error("x"), "name", { value: name });

    expect(describeError(named(fits)).name).toBe(fits);
    expect(describeError(named(tooLong)).name).toBe("Error");
    expect(describeError(Object.assign(new Error("x"), { code: fits })).code).toBe(fits);
    expect("code" in describeError(Object.assign(new Error("x"), { code: tooLong }))).toBe(false);
  });

  it.each([11000, "ECONNREFUSED", "ERR_INVALID_ARG_TYPE"])("keeps the code %s", (code) => {
    expect(describeError(Object.assign(new Error("failed"), { code })).code).toBe(code);
  });

  it.each([
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["an object", {}],
    ["an array", ["x"]],
    ["a string with spaces", "has spaces"],
    ["an empty string", ""],
  ])("drops a code that is %s", (_label, code) => {
    expect("code" in describeError(Object.assign(new Error("failed"), { code }))).toBe(false);
  });

  it.each([
    ["a string", "not-an-error", "string"],
    ["an object", PAYLOAD, "object"],
    ["undefined", undefined, "undefined"],
    ["null", null, "object"],
    ["a function", () => PAYLOAD, "function"],
  ])("says only the type of %s that was thrown", (_label, thrown, type) => {
    expect(describeError(thrown)).toEqual({ thrown: type });
  });

  describe("the class name", () => {
    class PaymentDeclined extends Error {}
    class Renamed extends Error {
      override name = "CardError";
    }

    it("is used when the name is the one every error inherits", () => {
      expect(describeError(new PaymentDeclined("declined")).name).toBe("PaymentDeclined");
    });

    it("is not used when the error names itself", () => {
      expect(describeError(new Renamed("declined")).name).toBe("CardError");
      expect(describeError(Object.assign(new PaymentDeclined("x"), { name: "Other" })).name).toBe("Other");
    });

    it("is not used when it is not a usable identifier", () => {
      const Anonymous = class extends Error {};
      Object.defineProperty(Anonymous, "name", { value: "not an identifier" });
      expect(describeError(new Anonymous("x")).name).toBe("Error");
      Object.defineProperty(Anonymous, "name", { value: PAYLOAD });
      expect(describeError(new Anonymous("x")).name).toBe("Error");
    });

    it("is not used for a plain Error", () => {
      expect(describeError(new Error("x")).name).toBe("Error");
    });
  });

  describe("a cause, one level of it", () => {
    it("contributes its name and code and nothing else", () => {
      const cause = Object.assign(new TypeError(`fetch failed for ${PAYLOAD.secret}`), {
        code: "ECONNRESET",
        response: PAYLOAD,
      });
      const described = describeError(new Error("send failed", { cause }));

      expect(described).toEqual({
        name: "Error",
        message: "send failed",
        stack: expect.any(String) as unknown,
        causeName: "TypeError",
        causeCode: "ECONNRESET",
      });
      expect(JSON.stringify({ ...described, stack: "" })).not.toContain(PAYLOAD.secret);
    });

    it("uses the cause's class name as it would the error's", () => {
      class UpstreamTimeout extends Error {}
      expect(describeError(new Error("x", { cause: new UpstreamTimeout("y") })).causeName).toBe("UpstreamTimeout");
    });

    it("keeps the code of a cause that is a structure and not an error, and none of its other fields", () => {
      const described = describeError(
        new Error("refused", { cause: { code: "rate_limited", name: "ShouldNotBeRead", detail: PAYLOAD } }),
      );
      expect(described).toStrictEqual({
        name: "Error",
        message: "refused",
        stack: expect.any(String) as unknown,
        causeCode: "rate_limited",
      });
    });

    it("leaves out a cause's code that is not usable, and a cause that is neither an error nor a structure", () => {
      expect("causeCode" in describeError(new Error("x", { cause: { code: "has spaces" } }))).toBe(false);
      for (const cause of ["a string", 3, null, undefined, ["x"]]) {
        const described = describeError(new Error("x", { cause }));
        expect(Object.keys(described).sort()).toEqual(["message", "name", "stack"]);
      }
    });

    it("does not follow a cause's cause", () => {
      const root = Object.assign(new RangeError("root"), { code: "ROOT" });
      const middle = Object.assign(new TypeError("middle", { cause: root }), { code: "MIDDLE" });
      expect(describeError(new Error("top", { cause: middle }))).toMatchObject({
        causeName: "TypeError",
        causeCode: "MIDDLE",
      });
    });

    it("an error that is its own cause is described once", () => {
      const error = Object.assign(new Error("loop"), { code: "LOOP" });
      (error as { cause?: unknown }).cause = error;
      expect(describeError(error)).toMatchObject({ name: "Error", code: "LOOP", causeName: "Error", causeCode: "LOOP" });
    });
  });

  describe("an error that cannot be read", () => {
    const throwing = (property: string, on: object = new Error("x")): object =>
      Object.defineProperty(on, property, {
        get: () => {
          throw new Error("getter failed");
        },
      });

    it.each(["name", "message", "stack", "code", "cause", "constructor"])(
      "does not throw when reading %s does, and keeps what it could read",
      (property) => {
        const described = describeError(throwing(property, Object.assign(new Error("x"), { code: "E_KEPT" })));
        expect(typeof described.name).toBe("string");
        expect(typeof described.message).toBe("string");
        if (property !== "code") expect(described.code).toBe("E_KEPT");
        if (property !== "message") expect(described.message).toBe("x");
        if (property === "message") expect(described.message).toBe("");
        if (property === "name") expect(described.name).toBe("Error");
      },
    );

    it("does not throw when a cause's fields do", () => {
      for (const property of ["name", "code", "constructor"]) {
        const cause = throwing(property, Object.assign(new TypeError("c"), { code: "E_CAUSE" }));
        expect(() => describeError(new Error("x", { cause }))).not.toThrow();
      }
      expect(describeError(new Error("x", { cause: throwing("code", {}) }))).toStrictEqual({
        name: "Error",
        message: "x",
        stack: expect.any(String) as unknown,
      });
    });

    it("does not throw for a proxy that refuses every question", () => {
      const refuse = (): never => {
        throw new Error("trap");
      };
      const proxy = new Proxy(new Error("x"), { get: refuse, getPrototypeOf: refuse, has: refuse });
      expect(describeError(proxy)).toEqual({ thrown: "object" });
    });
  });
});

describe("isUsableErrorCode", () => {
  it.each([0, 11000, -1, 1.5, "E", "ECONNREFUSED", "ERR_INVALID_ARG_TYPE", "rate_limited", "a.b:c-d_e", "A".repeat(64), "42"])(
    "is true for %j",
    (code) => {
      expect(isUsableErrorCode(code)).toBe(true);
    },
  );

  it.each([
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["an empty string", ""],
    ["a string of 65 characters", "A".repeat(65)],
    ["a string with a space", "has space"],
    ["a string with a slash", "a/b"],
    ["a string with a line break", "a\nb"],
    ["a string with a letter outside ASCII", "é"],
    ["a boolean", true],
    ["null", null],
    ["undefined", undefined],
    ["an object", { code: "E" }],
    ["an array", ["E"]],
    ["a bigint", BigInt(1)],
    ["a symbol", Symbol("E")],
  ])("is false for %s", (_what, code) => {
    expect(isUsableErrorCode(code)).toBe(false);
  });
});
