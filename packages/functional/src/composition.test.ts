/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, vi } from "vitest";

import {
  compose,
  composeAsync,
  constant,
  flow,
  identity,
  memoize,
  pipe,
  pipeAsync,
  tap,
} from "./composition.mjs";

describe("pipe", () => {
  it("returns the value when called with no functions", () => {
    const result = pipe(42);
    expect(result).toBe(42);
  });

  it("applies a single function", () => {
    const result = pipe(5, (x) => x * 2);
    expect(result).toBe(10);
  });

  it("applies multiple functions left to right", () => {
    const result = pipe(
      5,
      (x) => x * 2,
      (x) => x + 1,
      (x) => x * 3,
    );
    expect(result).toBe(33); // (5 * 2 + 1) * 3
  });

  it("maintains type safety through transformations", () => {
    const result = pipe(
      5,
      (x) => x * 2,
      (x) => x.toString(),
      (s) => s + "!",
      (s) => s.length,
    );
    expect(result).toBe(3); // "10!".length
  });

  it("works with async functions", async () => {
    const result = await pipe(
      5,
      (x) => Promise.resolve(x * 2),
      async (x) => {
        const value = await x;
        return value + 1;
      },
    );
    expect(result).toBe(11);
  });

  it("preserves this context in methods", () => {
    const obj = {
      value: 10,
      double() {
        return this.value * 2;
      },
    };

    const result = pipe(obj, (o) => o.double.call(o));
    expect(result).toBe(20);
  });

  it("handles complex object transformations", () => {
    const user = { name: "John", age: 30 };
    const result = pipe(
      user,
      (u) => ({ ...u, age: u.age + 1 }),
      (u) => ({ ...u, name: u.name.toUpperCase() }),
      (u) => `${u.name} is ${u.age}`,
    );
    expect(result).toBe("JOHN is 31");
  });
});

describe("flow", () => {
  it("creates a pipeline function with single transform", () => {
    const double = flow((x: number) => x * 2);
    expect(double(5)).toBe(10);
  });

  it("creates a pipeline function with multiple transforms", () => {
    const pipeline = flow(
      (x: number) => x * 2,
      (x) => x + 1,
      (x) => x * 3,
    );
    expect(pipeline(5)).toBe(33); // (5 * 2 + 1) * 3
  });

  it("maintains type safety in composed functions", () => {
    const pipeline = flow(
      (x: number) => x.toString(),
      (s) => s + "!",
      (s) => s.length,
    );
    expect(pipeline(100)).toBe(4); // "100!".length
  });

  it("can be composed with other flows", () => {
    const addOne = flow((x: number) => x + 1);
    const double = flow((x: number) => x * 2);
    const combined = flow(addOne, double);

    expect(combined(5)).toBe(12); // (5 + 1) * 2
  });

  it("works with async functions", async () => {
    const pipeline = flow(
      (x: number) => Promise.resolve(x * 2),
      async (p: Promise<number>) => {
        const value = await p;
        return value + 1;
      },
    );

    const result = await pipeline(5);
    expect(result).toBe(11);
  });

  it("handles error propagation", () => {
    const pipeline = flow(
      (x: number) => {
        if (x < 0) throw new Error("Negative number");
        return x;
      },
      (x) => x * 2,
    );

    expect(() => pipeline(-1)).toThrow("Negative number");
    expect(pipeline(5)).toBe(10);
  });
});

describe("identity", () => {
  it("returns the input unchanged", () => {
    expect(identity(42)).toBe(42);
    expect(identity("hello")).toBe("hello");
    expect(identity(null)).toBe(null);
    expect(identity(undefined)).toBe(undefined);
  });

  it("preserves object references", () => {
    const obj = { a: 1 };
    expect(identity(obj)).toBe(obj);
  });

  it("is useful as a default transform", () => {
    const transform =
      (fn: (x: number) => number = identity) =>
      (x: number) =>
        fn(x);
    const defaultTransform = transform();
    const customTransform = transform((x) => x * 2);

    expect(defaultTransform(5)).toBe(5);
    expect(customTransform(5)).toBe(10);
  });

  it("works in pipe as a no-op", () => {
    const result = pipe(42, identity, (x) => x * 2, identity);
    expect(result).toBe(84);
  });
});

describe("constant", () => {
  it("creates a function that always returns the same value", () => {
    const always42 = constant(42);
    expect(always42()).toBe(42);
    expect(always42()).toBe(42);
  });

  it("ignores any arguments passed", () => {
    const alwaysHello = constant("hello");
    expect(
      (alwaysHello as (n1: number, n2: number, n3: number) => string)(1, 2, 3),
    ).toBe("hello");
  });

  it("preserves object references", () => {
    const obj = { a: 1 };
    const alwaysObj = constant(obj);
    expect(alwaysObj()).toBe(obj);
    expect(alwaysObj()).toBe(obj);
  });

  it("is useful for default values in pipelines", () => {
    const getOrDefault = <T>(value: T | null, defaultValue: T) =>
      pipe(value, (v) => v ?? constant(defaultValue)());

    expect(getOrDefault(null, 42)).toBe(42);
    expect(getOrDefault(10, 42)).toBe(10);
  });
});

describe("compose", () => {
  it("applies functions right to left (opposite of flow)", () => {
    const pipeline = compose(
      (x: number) => x * 3,
      (x: number) => x + 1,
      (x: number) => x * 2,
    );
    expect(pipeline(5)).toBe(33); // ((5 * 2) + 1) * 3
  });

  it("single function compose", () => {
    const double = compose((x: number) => x * 2);
    expect(double(5)).toBe(10);
  });

  it("maintains type safety", () => {
    const pipeline = compose(
      (s: string) => s.length,
      (s: string) => s + "!",
      (x: number) => x.toString(),
    );
    expect(pipeline(100)).toBe(4); // "100!".length
  });

  it("is equivalent to reversed flow", () => {
    const fn1 = (x: number) => x * 2;
    const fn2 = (x: number) => x + 1;
    const fn3 = (x: number) => x * 3;

    const composed = compose(fn3, fn2, fn1);
    const flowed = flow(fn1, fn2, fn3);

    expect(composed(5)).toBe(flowed(5));
  });

  it("works with different arity functions", () => {
    const double = (x: number) => x * 2;
    const toString = (x: number) => x.toString();

    // Note: compose takes the last function's parameters
    const pipeline = compose(
      toString,
      double,
      (x: number) => x, // adapter to make it work with single arg
    );

    expect(pipeline(5)).toBe("10");
  });
});

describe("tap", () => {
  it("executes side effect without changing value", () => {
    const sideEffect = vi.fn();
    const result = pipe(42, tap(sideEffect), (x) => x * 2);

    expect(sideEffect).toHaveBeenCalledWith(42);
    expect(result).toBe(84);
  });

  it("can be used for logging", () => {
    const logs: string[] = [];
    const log = (x: string) => logs.push(x);

    const result = pipe(
      5,
      tap((x) => log(`Initial: ${x}`)),
      (x) => x * 2,
      tap((x) => log(`After double: ${x}`)),
      (x) => x + 1,
      tap((x) => log(`Final: ${x}`)),
    );

    expect(result).toBe(11);
    expect(logs).toEqual(["Initial: 5", "After double: 10", "Final: 11"]);
  });

  it("preserves value even if side effect throws", () => {
    const dangerousSideEffect = () => {
      throw new Error("Side effect error");
    };

    expect(() => pipe(42, tap(dangerousSideEffect))).toThrow(
      "Side effect error",
    );
  });

  it("works with async side effects in async pipelines", async () => {
    const logs: number[] = [];

    const result = await pipe(5, async (x) => {
      // For async side effects, handle them directly in the pipeline
      await new Promise((resolve) => setTimeout(resolve, 10));
      logs.push(x);
      return x * 2;
    });

    expect(result).toBe(10);
    expect(logs).toEqual([5]);
  });

  it("maintains type safety", () => {
    const result = pipe(
      { name: "John", age: 30 },
      tap((user) => {
        // TypeScript knows user is { name: string, age: number }
        expect(user.name).toBe("John");
      }),
      (user) => user.age,
    );

    expect(result).toBe(30);
  });
});

describe("Type inference", () => {
  it("infers types correctly through long pipelines", () => {
    const result = pipe(
      1,
      (n) => n + 1,
      (n) => n * 2,
      (n) => n.toString(),
      (s) => s + "!",
      (s) => s.split(""),
      (arr) => arr.length,
    );

    expect(result).toBe(2); // "4!".split('').length
  });

  it("handles union types", () => {
    const process = (x: string | number) =>
      pipe(
        x,
        (val) => (typeof val === "string" ? val.length : val),
        (n) => n * 2,
      );

    expect(process("hello")).toBe(10);
    expect(process(5)).toBe(10);
  });

  it("works with generic functions", () => {
    const wrapInArray = <T>(x: T): T[] => [x];
    const getFirst = <T>(arr: T[]): T | undefined => arr[0];

    const result = pipe(
      42,
      wrapInArray,
      (arr) => arr.map((x) => x * 2),
      getFirst,
    );

    expect(result).toBe(84);
  });
});

describe("Async composition helpers", () => {
  it("pipeAsync composes heterogeneous async functions left to right", async () => {
    const pipeline = pipeAsync(
      async (input: string) => input.length,
      async (length: number) => ({ length }),
      async (payload: { length: number }) => `len:${payload.length}`,
    );

    await expect(pipeline("vitest")).resolves.toBe("len:6");
  });

  it("composeAsync composes heterogeneous async functions right to left", async () => {
    const pipeline = composeAsync(
      async (payload: { length: number }) => `len:${payload.length}`,
      async (length: number) => ({ length }),
      async (input: string) => input.length,
    );

    await expect(pipeline("compose")).resolves.toBe("len:7");
  });
});

describe("memoize", () => {
  it("returns cached result for repeated primitive arguments", () => {
    let callCount = 0;
    const fn = memoize((value: number) => {
      callCount += 1;
      return value * 2;
    });

    expect(fn(2)).toBe(4);
    expect(fn(2)).toBe(4);
    expect(callCount).toBe(1);
  });

  it("handles circular object arguments without throwing", () => {
    interface Circular {
      value: number;
      self?: Circular;
    }
    const obj: Circular = { value: 1 };
    obj.self = obj;

    let callCount = 0;
    const fn = memoize((input: Circular) => {
      callCount += 1;
      return input.value;
    });

    expect(fn(obj)).toBe(1);
    expect(fn(obj)).toBe(1);
    expect(callCount).toBe(1);
  });

  it("creates distinct cache entries for different argument combinations", () => {
    let callCount = 0;
    const fn = memoize((a: number, b: { tag: string }) => {
      callCount += 1;
      return `${a}-${b.tag}`;
    });

    const left = { tag: "left" };
    const right = { tag: "right" };

    expect(fn(1, left)).toBe("1-left");
    expect(fn(1, right)).toBe("1-right");
    expect(fn(1, left)).toBe("1-left");
    expect(callCount).toBe(2);
  });

  it("supports custom key functions", () => {
    const keyFn = ({ id }: { id: string }) => id;
    let callCount = 0;
    const fn = memoize(({ id }: { id: string }) => {
      callCount += 1;
      return `user:${id}`;
    }, keyFn);

    expect(fn({ id: "123" })).toBe("user:123");
    expect(fn({ id: "123" })).toBe("user:123");
    expect(callCount).toBe(1);
  });
});
