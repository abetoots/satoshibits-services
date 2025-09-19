import { describe, expect, it } from "vitest";

import { IO } from "./io.mjs";
import { none, Option, some } from "./option.mjs";
import { Reader } from "./reader.mjs";
import { Result } from "./result.mjs";
import { Task } from "./task.mjs";

/**
 * Algebraic law tests for functional types.
 * These tests verify that our implementations satisfy the mathematical laws
 * required for functors, monads, and applicatives.
 */

describe("Algebraic Laws", () => {
  // generic identity function
  const id = <T,>(x: T): T => x;

  describe("Task Laws", () => {
    describe("Functor Laws", () => {
      it("identity: map(id) ≅ id", async () => {
        const task = Task.of(42);
        const mapped = Task.map(id)(task);

        const r1 = await Task.run(task);
        const r2 = await Task.run(mapped);
        expect(r1).toEqual(r2);
      });

      it("composition: map(g∘f) ≅ map(g)∘map(f)", async () => {
        const task = Task.of(10);
        const f = (n: number) => n * 2;
        const g = (n: number) => n + 1;

        const r1 = await Task.run(Task.map((x: number) => g(f(x)))(task));
        const r2 = await Task.run(Task.map(g)(Task.map(f)(task)));
        expect(r1).toEqual(r2);
      });
    });

    describe("Monad Laws", () => {
      it("left identity: chain(f)(of(x)) ≅ f(x)", async () => {
        const x = 42;
        const f = (n: number) => Task.of(n * 2);

        const r1 = await Task.run(Task.chain(f)(Task.of(x)));
        const r2 = await Task.run(f(x));
        expect(r1).toEqual(r2);
      });

      it("right identity: chain(of)(m) ≅ m", async () => {
        const task = Task.of(42);
        const chained = Task.chain(Task.of)(task);

        const r1 = await Task.run(task);
        const r2 = await Task.run(chained);
        expect(r1).toEqual(r2);
      });

      it("associativity: chain(g)(chain(f)(m)) ≅ chain(x => chain(g)(f(x)))(m)", async () => {
        const task = Task.of(10);
        const f = (n: number) => Task.of(n * 2);
        const g = (n: number) => Task.of(n + 1);

        const r1 = await Task.run(Task.chain(g)(Task.chain(f)(task)));
        const r2 = await Task.run(
          Task.chain((x: number) => Task.chain(g)(f(x)))(task),
        );
        expect(r1).toEqual(r2);
      });
    });

    describe("Applicative Laws", () => {
      it("identity: ap(of(id))(v) ≅ v", async () => {
        const value = Task.of(42);
        const identity = Task.of(id);

        const r1 = await Task.run(Task.ap(value)(identity));
        const r2 = await Task.run(value);
        expect(r1).toEqual(r2);
      });

      it("composition: ap(ap(ap(of(compose))(u))(v))(w) ≅ ap(u)(ap(v)(w))", async () => {
        // Properly typed curried compose for applicative composition
        type ComposeType = (g: (n: number) => number) => (f: (n: number) => number) => (x: number) => number;
        const compose: ComposeType = (g) => (f) => (x) => g(f(x));

        const u = Task.of((n: number) => n * 2);
        const v = Task.of((n: number) => n + 10);
        const w = Task.of(5);

        // Left side: compose via lifted compose function
        const step1 = Task.ap(u)(Task.of(compose));
        const step2 = Task.ap(v)(step1 as Task<(f: (n: number) => number) => (x: number) => number>);
        const r1 = await Task.run(Task.ap(w)(step2 as Task<(x: number) => number>));

        // Right side: direct composition
        const innerAp = Task.ap<number, number>(w)(v);
        const outerAp = Task.ap<number, number>(innerAp)(u);
        const r2 = await Task.run(outerAp);
        expect(r1).toEqual(r2);
      });

      it("homomorphism: ap(of(x))(of(f)) ≅ of(f(x))", async () => {
        const f = (n: number) => n * 2;
        const x = 42;

        const r1 = await Task.run(Task.ap(Task.of(x))(Task.of(f)));
        const r2 = await Task.run(Task.of(f(x)));
        expect(r1).toEqual(r2);
      });

      it("interchange: ap(of(y))(u) ≅ ap(u)(of(f => f(y)))", async () => {
        const y = 42;
        const u = Task.of((n: number) => n * 2);

        const r1 = await Task.run(Task.ap(Task.of(y))(u));
        const r2 = await Task.run(
          Task.ap(u)(Task.of((f: (n: number) => number) => f(y))),
        );
        expect(r1).toEqual(r2);
      });
    });
  });

  describe("IO Laws", () => {
    describe("Functor Laws", () => {
      it("identity: map(id) ≅ id", () => {
        const io = IO.of(42);
        const mapped = IO.map(id)(io);

        expect(IO.run(io)).toEqual(IO.run(mapped));
      });

      it("composition: map(g∘f) ≅ map(g)∘map(f)", () => {
        const io = IO.of(10);
        const f = (n: number) => n * 2;
        const g = (n: number) => n + 1;

        const r1 = IO.run(IO.map((x: number) => g(f(x)))(io));
        const r2 = IO.run(IO.map(g)(IO.map(f)(io)));
        expect(r1).toEqual(r2);
      });
    });

    describe("Applicative Laws", () => {
      it("identity: ap(of(id))(v) ≅ v", () => {
        const value = IO.of(42);
        const identity = IO.of(id);

        const r1 = IO.run(IO.ap(value)(identity));
        const r2 = IO.run(value);
        expect(r1).toEqual(r2);
      });

      it("composition: ap(ap(ap(of(compose))(u))(v))(w) ≅ ap(u)(ap(v)(w))", () => {
        // Properly typed curried compose for applicative composition
        type ComposeType = (g: (n: number) => number) => (f: (n: number) => number) => (x: number) => number;
        const compose: ComposeType = (g) => (f) => (x) => g(f(x));

        const u = IO.of((n: number) => n * 2);
        const v = IO.of((n: number) => n + 10);
        const w = IO.of(5);

        // Left side: compose via lifted compose function
        const step1 = IO.ap(u)(IO.of(compose));
        const step2 = IO.ap(v)(step1 as IO<(f: (n: number) => number) => (x: number) => number>);
        const r1 = IO.run(IO.ap(w)(step2 as IO<(x: number) => number>));

        // Right side: direct composition
        const innerAp = IO.ap<number, number>(w)(v);
        const outerAp = IO.ap<number, number>(innerAp)(u);
        const r2 = IO.run(outerAp);
        expect(r1).toEqual(r2);
      });

      it("homomorphism: ap(of(x))(of(f)) ≅ of(f(x))", () => {
        const f = (n: number) => n * 2;
        const x = 42;

        const r1 = IO.run(IO.ap(IO.of(x))(IO.of(f)));
        const r2 = IO.run(IO.of(f(x)));
        expect(r1).toEqual(r2);
      });

      it("interchange: ap(of(y))(u) ≅ ap(u)(of(f => f(y)))", () => {
        const y = 42;
        const u = IO.of((n: number) => n * 2);

        const r1 = IO.run(IO.ap(IO.of(y))(u));
        const r2 = IO.run(
          IO.ap(u)(IO.of((f: (n: number) => number) => f(y))),
        );
        expect(r1).toEqual(r2);
      });
    });

    describe("Monad Laws", () => {
      it("left identity: chain(f)(of(x)) ≅ f(x)", () => {
        const x = 42;
        const f = (n: number) => IO.of(n * 2);

        const r1 = IO.run(IO.chain(f)(IO.of(x)));
        const r2 = IO.run(f(x));
        expect(r1).toEqual(r2);
      });

      it("right identity: chain(of)(m) ≅ m", () => {
        const io = IO.of(42);
        const chained = IO.chain(IO.of)(io);

        expect(IO.run(io)).toEqual(IO.run(chained));
      });

      it("associativity: chain(g)(chain(f)(m)) ≅ chain(x => chain(g)(f(x)))(m)", () => {
        const io = IO.of(10);
        const f = (n: number) => IO.of(n * 2);
        const g = (n: number) => IO.of(n + 1);

        const r1 = IO.run(IO.chain(g)(IO.chain(f)(io)));
        const r2 = IO.run(IO.chain((x: number) => IO.chain(g)(f(x)))(io));
        expect(r1).toEqual(r2);
      });
    });
  });

  describe("Reader Laws", () => {
    interface TestEnv {
      multiplier: number;
      offset: number;
    }

    const testEnv: TestEnv = { multiplier: 2, offset: 10 };

    describe("Functor Laws", () => {
      it("identity: map(id) ≅ id", () => {
        const reader = Reader.of<TestEnv, number>(42);
        const mapped = Reader.map<TestEnv, number, number>(id)(reader);

        expect(Reader.run(testEnv)(reader)).toEqual(
          Reader.run(testEnv)(mapped),
        );
      });

      it("composition: map(g∘f) ≅ map(g)∘map(f)", () => {
        const reader = Reader.asks<TestEnv, number>((env) => env.multiplier);
        const f = (n: number) => n * 2;
        const g = (n: number) => n + 1;

        const r1 = Reader.run(testEnv)(
          Reader.map<TestEnv, number, number>((x: number) => g(f(x)))(reader),
        );
        const r2 = Reader.run(testEnv)(
          Reader.map<TestEnv, number, number>(g)(
            Reader.map<TestEnv, number, number>(f)(reader)
          )
        );
        expect(r1).toEqual(r2);
      });
    });

    describe("Applicative Laws", () => {
      it("identity: ap(of(id))(v) ≅ v", () => {
        const value = Reader.of<TestEnv, number>(42);
        const identity = Reader.of<TestEnv, typeof id>(id);

        const r1 = Reader.run(testEnv)(Reader.ap(value)(identity));
        const r2 = Reader.run(testEnv)(value);
        expect(r1).toEqual(r2);
      });

      it("composition: ap(ap(ap(of(compose))(u))(v))(w) ≅ ap(u)(ap(v)(w))", () => {
        // Properly typed curried compose for applicative composition
        type ComposeType = (g: (n: number) => number) => (f: (n: number) => number) => (x: number) => number;
        const compose: ComposeType = (g) => (f) => (x) => g(f(x));

        const u = Reader.of<TestEnv, (n: number) => number>((n: number) => n * 2);
        const v = Reader.of<TestEnv, (n: number) => number>((n: number) => n + 10);
        const w = Reader.of<TestEnv, number>(5);

        // Left side: compose via lifted compose function
        const composeReader = Reader.of<TestEnv, ComposeType>(compose);
        const applyU = Reader.ap<TestEnv, (n: number) => number, (f: (n: number) => number) => (x: number) => number>(
          u
        )(composeReader as Reader<TestEnv, (g: (n: number) => number) => (f: (n: number) => number) => (x: number) => number>);
        const applyV = Reader.ap<TestEnv, (n: number) => number, (x: number) => number>(
          v
        )(applyU);
        const r1 = Reader.run(testEnv)(
          Reader.ap<TestEnv, number, number>(w)(applyV)
        );

        // Right side: direct composition
        const r2 = Reader.run(testEnv)(Reader.ap<TestEnv, number, number>(Reader.ap<TestEnv, number, number>(w)(v))(u));
        expect(r1).toEqual(r2);
      });

      it("homomorphism: ap(of(x))(of(f)) ≅ of(f(x))", () => {
        const f = (n: number) => n * 2;
        const x = 42;

        const r1 = Reader.run(testEnv)(Reader.ap(Reader.of<TestEnv, number>(x))(Reader.of<TestEnv, typeof f>(f)));
        const r2 = Reader.run(testEnv)(Reader.of<TestEnv, number>(f(x)));
        expect(r1).toEqual(r2);
      });

      it("interchange: ap(of(y))(u) ≅ ap(u)(of(f => f(y)))", () => {
        const y = 42;
        const u = Reader.of<TestEnv, (n: number) => number>((n: number) => n * 2);

        const r1 = Reader.run(testEnv)(Reader.ap(Reader.of<TestEnv, number>(y))(u));
        const r2 = Reader.run(testEnv)(
          Reader.ap(u)(Reader.of<TestEnv, (f: (n: number) => number) => number>((f: (n: number) => number) => f(y))),
        );
        expect(r1).toEqual(r2);
      });
    });

    describe("Monad Laws", () => {
      it("left identity: chain(f)(of(x)) ≅ f(x)", () => {
        const x = 42;
        const f = (n: number) =>
          Reader.asks<TestEnv, number>((env) => n * env.multiplier);

        const r1 = Reader.run(testEnv)(
          Reader.chain(f)(Reader.of<TestEnv, number>(x)),
        );
        const r2 = Reader.run(testEnv)(f(x));
        expect(r1).toEqual(r2);
      });

      it("right identity: chain(of)(m) ≅ m", () => {
        const reader = Reader.asks<TestEnv, number>((env) => env.offset);
        const chained = Reader.chain<TestEnv, number, number>(Reader.of)(
          reader,
        );

        expect(Reader.run(testEnv)(reader)).toEqual(
          Reader.run(testEnv)(chained),
        );
      });

      it("associativity: chain(g)(chain(f)(m)) ≅ chain(x => chain(g)(f(x)))(m)", () => {
        const reader = Reader.of<TestEnv, number>(10);
        const f = (n: number) =>
          Reader.asks<TestEnv, number>((env) => n * env.multiplier);
        const g = (n: number) =>
          Reader.asks<TestEnv, number>((env) => n + env.offset);

        const r1 = Reader.run(testEnv)(
          Reader.chain(g)(Reader.chain(f)(reader)),
        );
        const r2 = Reader.run(testEnv)(
          Reader.chain((x: number) => Reader.chain(g)(f(x)))(reader),
        );
        expect(r1).toEqual(r2);
      });
    });

    describe("Reader-specific Laws", () => {
      it("ask law: run(env)(ask) ≅ env", () => {
        const reader = Reader.ask<TestEnv>();
        expect(Reader.run(testEnv)(reader)).toEqual(testEnv);
      });

      it("asks law: run(env)(asks(f)) ≅ f(env)", () => {
        const f = (env: TestEnv) => env.multiplier * env.offset;
        const reader = Reader.asks(f);
        expect(Reader.run(testEnv)(reader)).toEqual(f(testEnv));
      });

      it("local law: run(env)(local(f)(r)) ≅ run(f(env))(r)", () => {
        interface OuterEnv {
          inner: TestEnv;
        }
        const outerEnv: OuterEnv = { inner: testEnv };

        const reader = Reader.asks<TestEnv, number>((env) => env.multiplier);
        const f = (outer: OuterEnv) => outer.inner;

        const r1 = Reader.run(outerEnv)(Reader.local(f)(reader));
        const r2 = Reader.run(f(outerEnv))(reader);
        expect(r1).toEqual(r2);
      });
    });
  });

  describe("Result Laws", () => {
    describe("Functor Laws", () => {
      it("identity: map(id) ≅ id", () => {
        const ok = Result.ok(42);
        const err = Result.err("error");

        expect(Result.map(id)(ok)).toEqual(ok);
        expect(Result.map(id)(err)).toEqual(err);
      });

      it("composition: map(g∘f) ≅ map(g)∘map(f)", () => {
        const result = Result.ok(10);
        const f = (n: number) => n * 2;
        const g = (n: number) => n + 1;

        const r1 = Result.map((x: number) => g(f(x)))(result);
        const r2 = Result.map(g)(Result.map(f)(result));
        expect(r1).toEqual(r2);
      });
    });

    describe("Applicative Laws", () => {
      it("identity: ap(of(id))(v) ≅ v", () => {
        const value = Result.ok<number, string>(42);
        const identity = Result.ok<typeof id, string>(id);

        const r1 = Result.ap(value)(identity);
        const r2 = value;
        expect(r1).toEqual(r2);
      });

      it("composition: ap(ap(ap(of(compose))(u))(v))(w) ≅ ap(u)(ap(v)(w))", () => {
        // Properly typed curried compose for applicative composition
        type ComposeType = (g: (n: number) => number) => (f: (n: number) => number) => (x: number) => number;
        const compose: ComposeType = (g) => (f) => (x) => g(f(x));

        const u = Result.ok<(n: number) => number, string>((n: number) => n * 2);
        const v = Result.ok<(n: number) => number, string>((n: number) => n + 10);
        const w = Result.ok<number, string>(5);

        // Left side: compose via lifted compose function
        const step1 = Result.ap(u)(Result.ok<ComposeType, string>(compose));
        const step2 = Result.ap(v)(step1 as Result<(f: (n: number) => number) => (x: number) => number, string>);
        const r1 = Result.ap(w)(step2 as Result<(x: number) => number, string>);

        // Right side: direct composition
        const innerAp = Result.ap(w)(v) as Result<number, string>;
        const outerAp = Result.ap(innerAp)(u) as Result<number, string>;
        const r2 = outerAp;
        expect(r1).toEqual(r2);
      });

      it("homomorphism: ap(of(x))(of(f)) ≅ of(f(x))", () => {
        const f = (n: number) => n * 2;
        const x = 42;

        const r1 = Result.ap(Result.ok<number, string>(x))(Result.ok<typeof f, string>(f));
        const r2 = Result.ok<number, string>(f(x));
        expect(r1).toEqual(r2);
      });

      it("interchange: ap(of(y))(u) ≅ ap(u)(of(f => f(y)))", () => {
        const y = 42;
        const u = Result.ok<(n: number) => number, string>((n: number) => n * 2);

        const r1 = Result.ap(Result.ok<number, string>(y))(u);
        const r2 = Result.ap(u)(Result.ok<(f: (n: number) => number) => number, string>((f: (n: number) => number) => f(y)));
        expect(r1).toEqual(r2);
      });
    });

    describe("Monad Laws", () => {
      it("left identity: chain(f)(of(x)) ≅ f(x)", () => {
        const x = 42;
        const f = (n: number) =>
          n > 0 ? Result.ok(n * 2) : Result.err("negative");

        const r1 = Result.flatMap(f)(Result.ok(x));
        const r2 = f(x);
        expect(r1).toEqual(r2);
      });

      it("right identity: chain(of)(m) ≅ m", () => {
        const result = Result.ok(42);
        const chained = Result.flatMap(Result.ok)(result);

        expect(result).toEqual(chained);
      });

      it("associativity: chain(g)(chain(f)(m)) ≅ chain(x => chain(g)(f(x)))(m)", () => {
        const result = Result.ok(10);
        const f = (n: number) => Result.ok(n * 2);
        const g = (n: number) => Result.ok(n + 1);

        const r1 = Result.flatMap(g)(Result.flatMap(f)(result));
        const r2 = Result.flatMap((x: number) => Result.flatMap(g)(f(x)))(
          result,
        );
        expect(r1).toEqual(r2);
      });
    });
  });

  describe("Option Laws", () => {
    describe("Functor Laws", () => {
      it("identity: map(id) ≅ id", () => {
        const someVal = some(42);
        const noneVal = none();

        expect(Option.map(id)(someVal)).toEqual(someVal);
        expect(Option.map(id)(noneVal)).toEqual(noneVal);
      });

      it("composition: map(g∘f) ≅ map(g)∘map(f)", () => {
        const option = some(10);
        const f = (n: number) => n * 2;
        const g = (n: number) => n + 1;

        const r1 = Option.map((x: number) => g(f(x)))(option);
        const r2 = Option.map(g)(Option.map(f)(option));
        expect(r1).toEqual(r2);
      });
    });

    describe("Applicative Laws", () => {
      it("identity: ap(of(id))(v) ≅ v", () => {
        const value = some(42);
        const identity = some(id);

        const r1 = Option.ap(value)(identity);
        const r2 = value;
        expect(r1).toEqual(r2);
      });

      it("composition: ap(ap(ap(of(compose))(u))(v))(w) ≅ ap(u)(ap(v)(w))", () => {
        // Properly typed curried compose for applicative composition
        type ComposeType = (g: (n: number) => number) => (f: (n: number) => number) => (x: number) => number;
        const compose: ComposeType = (g) => (f) => (x) => g(f(x));

        const u = some((n: number) => n * 2);
        const v = some((n: number) => n + 10);
        const w = some(5);

        // Left side: compose via lifted compose function
        const step1 = Option.ap(u)(some(compose));
        const step2 = Option.ap(v)(step1 as Option<(f: (n: number) => number) => (x: number) => number>);
        const r1 = Option.ap(w)(step2 as Option<(x: number) => number>);

        // Right side: direct composition
        const innerAp = Option.ap<number, number>(w)(v);
        const outerAp = Option.ap<number, number>(innerAp)(u);
        const r2 = outerAp;
        expect(r1).toEqual(r2);
      });

      it("homomorphism: ap(of(x))(of(f)) ≅ of(f(x))", () => {
        const f = (n: number) => n * 2;
        const x = 42;

        const r1 = Option.ap(some(x))(some(f));
        const r2 = some(f(x));
        expect(r1).toEqual(r2);
      });

      it("interchange: ap(of(y))(u) ≅ ap(u)(of(f => f(y)))", () => {
        const y = 42;
        const u = some((n: number) => n * 2);

        const r1 = Option.ap(some(y))(u);
        const r2 = Option.ap(u)(some((f: (n: number) => number) => f(y)));
        expect(r1).toEqual(r2);
      });
    });

    describe("Monad Laws", () => {
      it("left identity: chain(f)(of(x)) ≅ f(x)", () => {
        const x = 42;
        const f = (n: number) => (n > 0 ? some(n * 2) : none());

        const r1 = Option.flatMap(f)(some(x));
        const r2 = f(x);
        expect(r1).toEqual(r2);
      });

      it("right identity: chain(of)(m) ≅ m", () => {
        const option = some(42);
        const chained = Option.flatMap(some)(option);

        expect(option).toEqual(chained);
      });

      it("associativity: chain(g)(chain(f)(m)) ≅ chain(x => chain(g)(f(x)))(m)", () => {
        const option = some(10);
        const f = (n: number) => some(n * 2);
        const g = (n: number) => some(n + 1);

        const r1 = Option.flatMap(g)(Option.flatMap(f)(option));
        const r2 = Option.flatMap((x: number) => Option.flatMap(g)(f(x)))(
          option,
        );
        expect(r1).toEqual(r2);
      });
    });
  });

  describe("Cross-type Law Consistency", () => {
    it("all types should handle identity consistently", async () => {
      const value = 42;

      // all should preserve the value through identity
      expect(await Task.run(Task.map(id)(Task.of(value)))).toBe(value);
      expect(IO.run(IO.map(id)(IO.of(value)))).toBe(value);
      expect(Reader.run({})(Reader.map(id)(Reader.of(value)))).toBe(value);
      expect(Result.map(id)(Result.ok(value))).toEqual(Result.ok(value));
      expect(Option.map(id)(some(value))).toEqual(some(value));
    });

    it("all types should handle composition consistently", async () => {
      const f = (n: number) => n * 2;
      const g = (n: number) => n + 1;
      const compose = (x: number) => g(f(x));
      const value = 10;
      const expected = 21; // (10 * 2) + 1

      // all should produce the same result
      expect(await Task.run(Task.map(compose)(Task.of(value)))).toBe(expected);
      expect(IO.run(IO.map(compose)(IO.of(value)))).toBe(expected);
      expect(Reader.run({})(Reader.map(compose)(Reader.of(value)))).toBe(
        expected,
      );
      expect(Result.map(compose)(Result.ok(value))).toEqual(
        Result.ok(expected),
      );
      expect(Option.map(compose)(some(value))).toEqual(some(expected));
    });
  });
});
