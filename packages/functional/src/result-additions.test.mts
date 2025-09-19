import { describe, expect, it, vi } from "vitest";

import { Result } from "./result.mjs";

describe("Result additions", () => {
  describe("traverse", () => {
    it("should map and sequence, returning all values on success", () => {
      const fn = (n: number): Result<number, string> =>
        n > 0 ? Result.ok(n * 2) : Result.err("negative");
      const traverseFn = Result.traverse(fn);

      expect(traverseFn([1, 2, 3])).toEqual(Result.ok([2, 4, 6]));
    });

    it("should return first error on failure", () => {
      const fn = (n: number): Result<number, string> =>
        n > 0 ? Result.ok(n * 2) : Result.err(`negative: ${n}`);
      const traverseFn = Result.traverse(fn);

      expect(traverseFn([1, -2, 3, -4])).toEqual(Result.err("negative: -2"));
    });

    it("should handle empty array", () => {
      const fn = (n: number): Result<number, string> => Result.ok(n * 2);
      const traverseFn = Result.traverse(fn);

      expect(traverseFn([])).toEqual(Result.ok([]));
    });

    it("should short-circuit on first error", () => {
      const calls: number[] = [];
      const fn = (n: number): Result<number, string> => {
        calls.push(n);
        return n === 2 ? Result.err("stop") : Result.ok(n);
      };

      const traverseFn = Result.traverse(fn);
      const result = traverseFn([1, 2, 3, 4]);

      expect(result).toEqual(Result.err("stop"));
      expect(calls).toEqual([1, 2]); // should not call fn for 3 and 4
    });
  });

  describe("ap", () => {
    it("should apply ok function to ok value", () => {
      const add = (a: number) => (b: number) => a + b;
      const resultFn = Result.ok<(b: number) => number, string>(add(5));
      const resultValue = Result.ok<number, string>(3);
      const result = Result.ap(resultValue)(resultFn);
      expect(result).toEqual(Result.ok(8));
    });

    it("should propagate error from function", () => {
      const resultFn = Result.err<(n: number) => number, string>("fn error");
      const resultValue = Result.ok<number, string>(3);
      const result = Result.ap(resultValue)(resultFn);
      expect(result).toEqual(Result.err("fn error"));
    });

    it("should propagate error from value", () => {
      const resultFn = Result.ok<(n: number) => number, string>((n) => n * 2);
      const resultValue = Result.err<number, string>("value error");
      const result = Result.ap(resultValue)(resultFn);
      expect(result).toEqual(Result.err("value error"));
    });

    it("should return first error when both are errors", () => {
      const resultFn = Result.err<(n: number) => number, string>("fn error");
      const resultValue = Result.err<number, string>("value error");
      const result = Result.ap(resultValue)(resultFn);
      expect(result).toEqual(Result.err("fn error"));
    });
  });

  describe("bimap", () => {
    it("should transform success value", () => {
      const transform = Result.bimap(
        (n: number) => `ok: ${n}`,
        (s: string) => `err: ${s}`,
      );
      expect(transform(Result.ok(10))).toEqual(Result.ok("ok: 10"));
    });

    it("should transform error value", () => {
      const transform = Result.bimap(
        (n: number) => `ok: ${n}`,
        (s: string) => `err: ${s}`,
      );
      expect(transform(Result.err("bad"))).toEqual(Result.err("err: bad"));
    });

    it("should work with different types", () => {
      const transform = Result.bimap(
        (n: number) => n > 0,
        (e: Error) => e.message,
      );
      expect(transform(Result.ok(10))).toEqual(Result.ok(true));
      expect(transform(Result.err(new Error("fail")))).toEqual(
        Result.err("fail"),
      );
    });
  });

  describe("chainFirst", () => {
    it("should execute side effect and return original value on success", () => {
      const sideEffect = vi.fn((n: number) => Result.ok(`logged: ${n}`));
      const result = Result.chainFirst(sideEffect)(Result.ok(42));

      expect(result).toEqual(Result.ok(42));
      expect(sideEffect).toHaveBeenCalledWith(42);
    });

    it("should not execute side effect on error", () => {
      const sideEffect = vi.fn((n: number) => Result.ok(`logged: ${n}`));
      const result = Result.chainFirst<number, string>(sideEffect)(
        Result.err<number, string>("initial error"),
      );

      expect(result).toEqual(Result.err("initial error"));
      expect(sideEffect).not.toHaveBeenCalled();
    });

    it("should propagate error from side effect", () => {
      const sideEffect = (_n: number) =>
        Result.err<void, string>("side effect error");
      const result = Result.chainFirst(sideEffect)(Result.ok(42));

      expect(result).toEqual(Result.err("side effect error"));
    });
  });

  describe("sequenceT", () => {
    it("should combine tuple of successful Results", () => {
      const r1 = Result.ok<number, string>(1);
      const r2 = Result.ok<string, string>("hello");
      const r3 = Result.ok<boolean, string>(true);

      const combined = Result.sequenceT(r1, r2, r3);
      expect(combined).toEqual(Result.ok([1, "hello", true]));
    });

    it("should return first error", () => {
      const r1 = Result.ok<number, string>(1);
      const r2 = Result.err<string, string>("error2");
      const r3 = Result.err<boolean, string>("error3");

      const combined = Result.sequenceT(r1, r2, r3);
      expect(combined).toEqual(Result.err("error2"));
    });

    it("should handle empty tuple", () => {
      const combined = Result.sequenceT();
      expect(combined).toEqual(Result.ok([]));
    });

    it("should short-circuit on error", () => {
      const createResult = vi.fn((val: unknown, isOk: boolean) =>
        isOk ? Result.ok(val) : Result.err("error"),
      );

      const r1 = createResult(1, true);
      const r2 = createResult(2, false);
      const r3 = createResult(3, true); // This shouldn't be evaluated in sequenceT

      const combined = Result.sequenceT(r1, r2, r3);
      expect(combined).toEqual(Result.err("error"));
      expect(createResult).toHaveBeenCalledTimes(3); // All created upfront
    });
  });

  describe("sequenceS", () => {
    it("should combine record of successful Results", () => {
      const results = {
        user: Result.ok<{ name: string }, string>({ name: "Alice" }),
        count: Result.ok<number, string>(42),
        enabled: Result.ok<boolean, string>(true),
      };

      const combined = Result.sequenceS(results);
      expect(combined).toEqual(
        Result.ok({
          user: { name: "Alice" },
          count: 42,
          enabled: true,
        }),
      );
    });

    it("should return first error", () => {
      const results = {
        a: Result.ok<number, string>(1),
        b: Result.err<string, string>("error b"),
        c: Result.err<boolean, string>("error c"),
      };

      const combined = Result.sequenceS(results);
      expect(combined).toEqual(Result.err("error b"));
    });

    it("should handle empty record", () => {
      const combined = Result.sequenceS({});
      expect(combined).toEqual(Result.ok({}));
    });

    it("should preserve key order", () => {
      const results = {
        z: Result.ok<number, string>(1),
        a: Result.ok<number, string>(2),
        m: Result.ok<number, string>(3),
      };

      const combined = Result.sequenceS(results);
      expect(combined).toEqual(Result.ok({ z: 1, a: 2, m: 3 }));
      if (combined.success) {
        expect(Object.keys(combined.data)).toEqual(["z", "a", "m"]);
      }
    });
  });

  describe("Do notation", () => {
    it("should chain successful computations", () => {
      const result = Result.Do<string>()
        .bind("x", Result.ok(5))
        .bind("y", Result.ok(3))
        .map(({ x, y }) => (x as number) + (y as number));

      expect(result).toEqual(Result.ok(8));
    });

    it("should handle dependent bindings", () => {
      const result = Result.Do<string>()
        .bind("x", Result.ok(10))
        .bind("y", ({ x }) => Result.ok((x as number) * 2))
        .bind("z", ({ y }) => Result.ok((y as number) + 1))
        .map(({ x, y, z }) => ({ original: x, doubled: y, final: z }));

      expect(result).toEqual(
        Result.ok({ original: 10, doubled: 20, final: 21 }),
      );
    });

    it("should short-circuit on first error", () => {
      const fn1 = vi.fn(() => Result.ok(5));
      const fn2 = vi.fn(() => Result.err<number, string>("error at y"));
      const fn3 = vi.fn(() => Result.ok(100));

      const result = Result.Do<string>()
        .bind("x", fn1())
        .bind("y", fn2())
        .bind("z", fn3()) // This binding happens but the function result is ignored
        .map(({ x, y, z }) => (x as number) + (y as number) + (z as number));

      expect(result).toEqual(Result.err("error at y"));
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
      expect(fn3).toHaveBeenCalledTimes(1); // Created but not used in chain
    });

    it("should short-circuit on error at 2nd step with dependent bindings", () => {
      const fn1 = vi.fn(() => Result.ok(10));
      const fn2 = vi.fn(({ x }: { x: number }) =>
        x < 20
          ? Result.err<number, string>("value too small")
          : Result.ok(x * 2),
      );
      const fn3 = vi.fn(({ y }: { y: number }) => Result.ok(y + 5));

      const result = Result.Do<string>()
        .bind("x", fn1())
        .bind("y", fn2 as unknown as (ctx: Record<string, unknown>) => Result<number, string>)
        .bind("z", fn3 as unknown as (ctx: Record<string, unknown>) => Result<number, string>)
        .map(({ x, y, z }) => ({ first: x, second: y, third: z }));

      expect(result).toEqual(Result.err("value too small"));
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
      expect(fn3).toHaveBeenCalledTimes(0); // should not be called due to short-circuit
    });

    it("should short-circuit on error at 3rd step with dependent bindings", () => {
      const fn1 = vi.fn(() => Result.ok(60));
      const fn2 = vi.fn(({ x }: { x: number }) => Result.ok(x * 2));
      const fn3 = vi.fn(({ x, y }: { x: number; y: number }) =>
        y > 100
          ? Result.err<number, string>("result too large")
          : Result.ok(x + y),
      );

      const result = Result.Do<string>()
        .bind("x", fn1())
        .bind("y", fn2 as unknown as (ctx: Record<string, unknown>) => Result<number, string>)
        .bind("z", fn3 as unknown as (ctx: Record<string, unknown>) => Result<number, string>)
        .map(({ x, y, z }) => ({ first: x, second: y, third: z }));

      expect(result).toEqual(Result.err("result too large"));
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
      expect(fn3).toHaveBeenCalledTimes(1);
    });

    it("should work with flatMap for Result-returning operations", () => {
      const safeDivide = (a: number, b: number): Result<number, string> =>
        b === 0 ? Result.err("division by zero") : Result.ok(a / b);

      const result = Result.Do<string>()
        .bind("x", Result.ok(10))
        .bind("y", Result.ok(2))
        .flatMap(({ x, y }) => safeDivide(x as number, y as number));

      expect(result).toEqual(Result.ok(5));

      const errorResult = Result.Do<string>()
        .bind("x", Result.ok(10))
        .bind("y", Result.ok(0))
        .flatMap(({ x, y }) => safeDivide(x as number, y as number));

      expect(errorResult).toEqual(Result.err("division by zero"));
    });

    it("should provide value() to get the current context", () => {
      const builder = Result.Do<string>()
        .bind("x", Result.ok(5))
        .bind("y", Result.ok(3));

      const contextResult = builder.value();
      expect(contextResult).toEqual(Result.ok({ x: 5, y: 3 }));
    });

    it("should handle errors in dependent bindings", () => {
      const result = Result.Do<string>()
        .bind("x", Result.ok(5))
        .bind("y", ({ x }) =>
          (x as number) > 10 ? Result.ok((x as number) * 2) : Result.err<number, string>("x too small"),
        )
        .map(({ x, y }) => (x as number) + (y as number));

      expect(result).toEqual(Result.err("x too small"));
    });
  });

  describe("edge cases", () => {
    it("should handle complex error types", () => {
      interface ApiError {
        code: number;
        message: string;
      }

      const error: ApiError = { code: 404, message: "Not Found" };
      const result = Result.err<number, ApiError>(error);

      const transformed = Result.bimap(
        (n: number) => n.toString(),
        (e: ApiError) => `${e.code}: ${e.message}`,
      )(result);

      expect(transformed).toEqual(Result.err("404: Not Found"));
    });

    it("should handle nested Results", () => {
      const nestedOk = Result.ok(Result.ok(42));
      const flattened = Result.flatMap((r: Result<number, string>) => r)(
        nestedOk,
      );
      expect(flattened).toEqual(Result.ok(42));

      const nestedErr = Result.ok(Result.err<number, string>("inner error"));
      const flattenedErr = Result.flatMap((r: Result<number, string>) => r)(
        nestedErr,
      );
      expect(flattenedErr).toEqual(Result.err("inner error"));
    });
  });
});
