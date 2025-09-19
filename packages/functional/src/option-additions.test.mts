import { describe, expect, it, vi } from "vitest";

import {
  ap,
  chainFirst,
  Do,
  isNone,
  isSome,
  none,
  Option,
  sequenceT,
  some,
  traverse,
} from "./option.mjs";

describe("Option additions", () => {
  describe("Type Guards", () => {
    it("isSome should return true for Some values", () => {
      expect(isSome(some(42))).toBe(true);
      expect(isSome(some("hello"))).toBe(true);
      expect(isSome(some(null))).toBe(true);
      expect(isSome(some(undefined))).toBe(true);
    });

    it("isSome should return false for None", () => {
      expect(isSome(none())).toBe(false);
    });

    it("isNone should return true for None", () => {
      expect(isNone(none())).toBe(true);
    });

    it("isNone should return false for Some values", () => {
      expect(isNone(some(42))).toBe(false);
      expect(isNone(some("hello"))).toBe(false);
      expect(isNone(some(null))).toBe(false);
      expect(isNone(some(undefined))).toBe(false);
    });

    it("type guards should be exhaustive", () => {
      const opt = some(42);
      expect(isSome(opt) || isNone(opt)).toBe(true);
      expect(isSome(opt) && isNone(opt)).toBe(false);
    });
  });

  describe("chainFirst", () => {
    it("should execute side effect and return original value on Some", () => {
      const sideEffect = vi.fn((n: number) => some(`logged: ${n}`));
      const result = chainFirst(sideEffect)(some(42));

      expect(result).toEqual(some(42));
      expect(sideEffect).toHaveBeenCalledWith(42);
    });

    it("should not execute side effect on None", () => {
      const sideEffect = vi.fn((n: number) => some(`logged: ${n}`));
      const result = chainFirst(sideEffect)(none());

      expect(result).toEqual(none());
      expect(sideEffect).not.toHaveBeenCalled();
    });

    it("should return None if side effect returns None", () => {
      const sideEffect = (_n: number) => none();
      const result = chainFirst(sideEffect)(some(42));

      expect(result).toEqual(none());
    });
  });

  describe("sequenceT", () => {
    it("should combine tuple of Some values", () => {
      const o1 = some(1);
      const o2 = some("hello");
      const o3 = some(true);

      const combined = sequenceT(o1, o2, o3);
      expect(combined).toEqual(some([1, "hello", true]));
    });

    it("should return None if any value is None", () => {
      const o1 = some(1);
      const o2 = none();
      const o3 = some(true);

      const combined = sequenceT(o1, o2, o3);
      expect(combined).toEqual(none());
    });

    it("should handle empty tuple", () => {
      const combined = sequenceT();
      expect(combined).toEqual(some([]));
    });

    it("should short-circuit evaluation", () => {
      const o1 = some(1);
      const o2 = none();
      const o3 = some(3);

      const combined = sequenceT(o1, o2, o3);
      expect(combined).toEqual(none());
    });
  });

  describe("traverse", () => {
    it("should map and sequence, returning Some with all values", () => {
      const fn = (s: string): Option<number> =>
        s.length > 0 ? some(s.length) : none();
      const traverseFn = traverse(fn);

      expect(traverseFn(["a", "bb", "ccc"])).toEqual(some([1, 2, 3]));
    });

    it("should return None if any mapping returns None", () => {
      const fn = (s: string): Option<number> =>
        s.length > 0 ? some(s.length) : none();
      const traverseFn = traverse(fn);

      expect(traverseFn(["a", "", "ccc"])).toEqual(none());
    });

    it("should handle empty array", () => {
      const fn = (s: string): Option<number> => some(s.length);
      const traverseFn = traverse(fn);

      expect(traverseFn([])).toEqual(some([]));
    });

    it("should short-circuit on first None", () => {
      const calls: string[] = [];
      const fn = (s: string): Option<number> => {
        calls.push(s);
        return s === "b" ? none() : some(s.length);
      };

      const traverseFn = traverse(fn);
      const result = traverseFn(["a", "b", "c", "d"]);

      expect(result).toEqual(none());
      expect(calls).toEqual(["a", "b"]); // should not call fn for "c" and "d"
    });
  });

  describe("ap", () => {
    it("should apply Some function to Some value", () => {
      const add = (a: number) => (b: number) => a + b;
      const optionFn = some(add(5));
      const optionValue = some(3);
      const result = ap(optionValue)(optionFn);
      expect(result).toEqual(some(8));
    });

    it("should return None if function is None", () => {
      const optionFn = none() as Option<(n: number) => number>;
      const optionValue = some(3);
      const result = ap(optionValue)(optionFn);
      expect(result).toEqual(none());
    });

    it("should return None if value is None", () => {
      const optionFn = some((n: number) => n * 2);
      const optionValue = none() as Option<number>;
      const result = ap(optionValue)(optionFn);
      expect(result).toEqual(none());
    });

    it("should return None if both are None", () => {
      const optionFn = none() as Option<(n: number) => number>;
      const optionValue = none() as Option<number>;
      const result = ap(optionValue)(optionFn);
      expect(result).toEqual(none());
    });

    it("should work with curried functions", () => {
      const add = (a: number) => (b: number) => (c: number) => a + b + c;
      const option10 = some(10);
      const option5 = some(5);

      // Start with the curried function wrapped in Some
      const addInOption = some(add);
      // Apply first argument
      const add3 = ap(some(3))(
        addInOption as Option<
          (a: number) => (b: number) => (c: number) => number
        >,
      );
      // Apply second argument
      const add3and10 = ap(option10)(
        add3 as Option<(b: number) => (c: number) => number>,
      );
      // Apply third argument
      const result = ap(option5)(add3and10 as Option<(c: number) => number>);

      expect(result).toEqual(some(18)); // 3 + 10 + 5
    });
  });

  describe("Do notation", () => {
    it("should chain successful computations with Some", () => {
      const result = Do()
        .bind("x", some(5))
        .bind("y", some(3))
        .map(({ x, y }) => (x as number) + (y as number));

      expect(result).toEqual(some(8));
    });

    it("should handle dependent bindings", () => {
      const result = Do()
        .bind("a", some(10))
        .bind("b", ({ a }) => ((a as number) > 5 ? some((a as number) * 2) : none()))
        .bind("c", ({ b }) => some((b as number) + 1))
        .map(({ a, b, c }) => ({ original: a, doubled: b, final: c }));

      expect(result).toEqual(some({ original: 10, doubled: 20, final: 21 }));
    });

    it("should short-circuit on first None", () => {
      const fn1 = vi.fn(() => some(5));
      const fn2 = vi.fn(() => none());
      const fn3 = vi.fn(() => some(100));

      const result = Do()
        .bind("x", fn1())
        .bind("y", fn2())
        .bind("z", fn3()) // This binding happens but is ignored
        .map(({ x, y, z }) => (x as number) + (y as number) + (z as number));

      expect(result).toEqual(none());
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
      expect(fn3).toHaveBeenCalledTimes(1); // Created but not used in chain
    });

    it("should work with flatMap for Option-returning operations", () => {
      const safeDivide = (a: number, b: number): Option<number> =>
        b === 0 ? none() : some(a / b);

      const result = Do()
        .bind("x", some(10))
        .bind("y", some(2))
        .flatMap(({ x, y }) => safeDivide(x as number, y as number));

      expect(result).toEqual(some(5));

      const errorResult = Do()
        .bind("x", some(10))
        .bind("y", some(0))
        .flatMap(({ x, y }) => safeDivide(x as number, y as number));

      expect(errorResult).toEqual(none());
    });

    it("should provide value() to get the current context", () => {
      const builder = Do().bind("x", some(5)).bind("y", some(3));

      const contextOption = builder.value();
      expect(contextOption).toEqual(some({ x: 5, y: 3 }));
    });

    it("should handle conditional bindings", () => {
      const result = Do()
        .bind("x", some(5))
        .bind("y", ({ x }) =>
          (x as number) > 10 ? some((x as number) * 2) : none(),
        )
        .map(({ x, y }) => (x as number) + (y as number));

      expect(result).toEqual(none());

      const successResult = Do()
        .bind("x", some(15))
        .bind("y", ({ x }) =>
          (x as number) > 10 ? some((x as number) * 2) : none(),
        )
        .map(({ x, y }) => (x as number) + (y as number));

      expect(successResult).toEqual(some(45)); // 15 + 30
    });

    it("should compose with other Option utilities", () => {
      const parseNumber = (s: string): Option<number> => {
        const n = Number(s);
        return isNaN(n) ? none() : some(n);
      };

      const result = Do()
        .bind("a", parseNumber("10"))
        .bind("b", parseNumber("20"))
        .bind("sum", ({ a, b }) => some((a as number) + (b as number)))
        .bind("doubled", ({ sum }) =>
          (sum as number) > 0 ? some((sum as number) * 2) : none(),
        )
        .map(({ doubled }) => doubled);

      expect(result).toEqual(some(60));
    });
  });

  describe("edge cases", () => {
    it("should handle undefined and null correctly", () => {
      const fn = (val: unknown): Option<string> => {
        if (val == null) return none();
        // Handle objects explicitly with JSON.stringify
        if (typeof val === 'object' && val !== null) {
          return some(JSON.stringify(val));
        }
        // At this point val is a primitive (string, number, boolean, symbol, bigint)
        if (typeof val === 'symbol') return some(val.toString());
        if (typeof val === 'bigint') return some(val.toString());
        if (typeof val === 'boolean') return some(val.toString());
        if (typeof val === 'number') return some(val.toString());
        // Now val must be a string
        return some(val as string);
      };

      const traverseFn = traverse(fn);
      expect(traverseFn([1, null, 3])).toEqual(none());
      expect(traverseFn([1, 2, 3])).toEqual(some(["1", "2", "3"]));
    });

    it("should handle nested Options", () => {
      const nestedSome = some(some(42));
      const flattened = Option.flatMap((o: Option<number>) => o)(nestedSome);
      expect(flattened).toEqual(some(42));

      const nestedNone = some(none());
      const flattenedNone = Option.flatMap((o: Option<number>) => o)(
        nestedNone,
      );
      expect(flattenedNone).toEqual(none());
    });

    it("should handle empty Do notation", () => {
      const result = Do().map(() => 42);
      expect(result).toEqual(some(42));
    });
  });

  describe("integration with sequenceOption", () => {
    it("should work with existing sequenceOption", () => {
      const options = [some(1), some(2), some(3)];
      const sequenced = Option.sequenceOption(options);
      expect(sequenced).toEqual(some([1, 2, 3]));
    });

    it("sequenceT should have consistent behavior with sequenceOption", () => {
      const o1 = some(1);
      const o2 = some(2);
      const o3 = some(3);

      const tupleResult = sequenceT(o1, o2, o3);
      const arrayResult = Option.sequenceOption([o1, o2, o3]);

      expect(isSome(tupleResult)).toBe(isSome(arrayResult));
      if (isSome(tupleResult) && isSome(arrayResult)) {
        expect(tupleResult.value).toEqual([1, 2, 3]);
        expect(arrayResult.value).toEqual([1, 2, 3]);
      }
    });
  });
});
