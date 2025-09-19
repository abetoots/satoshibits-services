import { describe, expect, it, vi } from "vitest";

import { IO } from "./io.mjs";

describe("IO", () => {
  describe("laziness", () => {
    it("should not execute until run", () => {
      const effect = vi.fn(() => 42);
      const io = effect as IO<number>;

      expect(effect).not.toHaveBeenCalled();

      const result = IO.run(io);
      expect(effect).toHaveBeenCalledTimes(1);
      expect(result).toBe(42);
    });

    it("should execute each time run is called", () => {
      const effect = vi.fn(() => "test");
      const io = effect as IO<string>;

      IO.run(io);
      IO.run(io);

      expect(effect).toHaveBeenCalledTimes(2);
    });
  });

  describe("run", () => {
    it("should execute an IO and return its value", () => {
      const io = IO.of(42);
      const result = IO.run(io);
      expect(result).toBe(42);
    });

    it("should handle IO side effects", () => {
      let sideEffectValue = 0;
      const io: IO<number> = () => {
        sideEffectValue = 100;
        return sideEffectValue;
      };

      expect(sideEffectValue).toBe(0);
      const result = IO.run(io);
      expect(sideEffectValue).toBe(100);
      expect(result).toBe(100);
    });

    it("should handle IO that throws errors", () => {
      const io: IO<never> = () => {
        throw new Error("IO error");
      };

      expect(() => IO.run(io)).toThrow("IO error");
    });

    it("should work with complex IO chains", () => {
      const io = IO.chain((n: number) =>
        IO.chain((doubled: number) =>
          IO.of(doubled + 1)
        )(IO.of(n * 2))
      )(IO.of(5));

      expect(IO.run(io)).toBe(11);
    });
  });

  describe("of", () => {
    it("should create an IO that returns the value", () => {
      const io = IO.of(42);
      expect(IO.run(io)).toBe(42);
    });

    it("should work with complex values", () => {
      const value = { a: 1, b: "test" };
      const io = IO.of(value);
      expect(IO.run(io)).toEqual(value);
    });

    it("should always return the same value", () => {
      const io = IO.of(42);
      expect(IO.run(io)).toBe(42);
      expect(IO.run(io)).toBe(42);
      expect(IO.run(io)).toBe(42);
    });
  });

  describe("map", () => {
    it("should transform the value", () => {
      const io = IO.of(5);
      const mapped = IO.map((n: number) => n * 2)(io);
      expect(IO.run(mapped)).toBe(10);
    });

    it("should not execute the original IO until run", () => {
      const effect = vi.fn(() => 5);
      const io = effect as IO<number>;
      const mapped = IO.map((n: number) => n + 1)(io);

      expect(effect).not.toHaveBeenCalled();
      IO.run(mapped);
      expect(effect).toHaveBeenCalledTimes(1);
    });

    it("should chain transformations", () => {
      const io = IO.of(5);
      const mapped = IO.map((n: number) => n * 2)(
        IO.map((n: number) => n + 1)(io),
      );
      expect(IO.run(mapped)).toBe(12); // (5 + 1) * 2
    });
  });

  describe("chain / flatMap", () => {
    it("should sequence computations", () => {
      let state = 0;
      const io1 = () => {
        state = 10;
        return state;
      };
      const io2 = (n: number) => () => {
        state = n * 2;
        return state;
      };

      const chained = IO.chain(io2)(io1);
      const result = IO.run(chained);

      expect(result).toBe(20);
      expect(state).toBe(20);
    });

    it("flatMap should be an alias for chain", () => {
      const io1 = IO.of(5);
      const io2 = (n: number) => IO.of(n * 2);

      const chained = IO.chain(io2)(io1);
      const flatMapped = IO.flatMap(io2)(io1);

      expect(IO.run(chained)).toBe(10);
      expect(IO.run(flatMapped)).toBe(10);
    });

    it("should maintain laziness through the chain", () => {
      const effect1 = vi.fn(() => 1);
      const effect2 = vi.fn((n: number) => n + 1);

      const io1 = effect1 as IO<number>;
      const chained = IO.chain((n: number) => () => effect2(n))(io1);

      expect(effect1).not.toHaveBeenCalled();
      expect(effect2).not.toHaveBeenCalled();

      IO.run(chained);

      expect(effect1).toHaveBeenCalledTimes(1);
      expect(effect2).toHaveBeenCalledTimes(1);
    });
  });

  describe("side effect ordering", () => {
    it("should preserve side effect ordering in chain", () => {
      const log: string[] = [];
      const io1: IO<number> = () => {
        log.push("io1");
        return 1;
      };
      const io2 =
        (n: number): IO<number> =>
        () => {
          log.push(`io2:${n}`);
          return n * 2;
        };
      const io3 =
        (n: number): IO<number> =>
        () => {
          log.push(`io3:${n}`);
          return n + 1;
        };

      const program = IO.chain(io3)(IO.chain(io2)(io1));

      expect(log).toEqual([]);
      const result = IO.run(program);
      expect(log).toEqual(["io1", "io2:1", "io3:2"]);
      expect(result).toBe(3);
    });
  });

  describe("ap", () => {
    it("should apply an IO of a function to an IO of a value", () => {
      const add = (a: number) => (b: number) => a + b;
      const ioFn = IO.of(add(5));
      const ioValue = IO.of(3);
      const result = IO.ap(ioValue)(ioFn);
      expect(IO.run(result)).toBe(8);
    });

    it("should maintain laziness", () => {
      const fnEffect = vi.fn(() => (n: number) => n * 2);
      const valueEffect = vi.fn(() => 5);

      const ioFn = fnEffect as IO<(n: number) => number>;
      const ioValue = valueEffect as IO<number>;
      const applied = IO.ap(ioValue)(ioFn);

      expect(fnEffect).not.toHaveBeenCalled();
      expect(valueEffect).not.toHaveBeenCalled();

      const result = IO.run(applied);

      expect(fnEffect).toHaveBeenCalledTimes(1);
      expect(valueEffect).toHaveBeenCalledTimes(1);
      expect(result).toBe(10);
    });
  });

  describe("sequence", () => {
    it("should convert array of IOs to IO of array", () => {
      const ios = [IO.of(1), IO.of(2), IO.of(3)];
      const sequenced = IO.sequence(ios);
      expect(IO.run(sequenced)).toEqual([1, 2, 3]);
    });

    it("should execute IOs in order", () => {
      const log: number[] = [];
      const ios = [1, 2, 3].map((n) => () => {
        log.push(n);
        return n;
      });

      const sequenced = IO.sequence(ios);
      expect(log).toEqual([]);

      IO.run(sequenced);
      expect(log).toEqual([1, 2, 3]);
    });

    it("should handle empty array", () => {
      const sequenced = IO.sequence([]);
      expect(IO.run(sequenced)).toEqual([]);
    });
  });

  describe("traverse", () => {
    it("should map and sequence", () => {
      const fn = (n: number): IO<number> => IO.of(n * 2);
      const traverse = IO.traverse(fn);
      const result = IO.run(traverse([1, 2, 3]));
      expect(result).toEqual([2, 4, 6]);
    });

    it("should handle empty array", () => {
      const fn = (n: number): IO<number> => IO.of(n * 2);
      const traverse = IO.traverse(fn);
      const result = IO.run(traverse([]));
      expect(result).toEqual([]);
    });

    it("should execute in order", () => {
      const log: string[] = [];
      const fn =
        (n: number): IO<number> =>
        () => {
          log.push(`process:${n}`);
          return n * 2;
        };

      const traverse = IO.traverse(fn);
      const io = traverse([1, 2, 3]);

      expect(log).toEqual([]);
      const result = IO.run(io);
      expect(log).toEqual(["process:1", "process:2", "process:3"]);
      expect(result).toEqual([2, 4, 6]);
    });
  });

  describe("sequenceT", () => {
    it("should combine tuple of IOs", () => {
      const io1 = IO.of(1);
      const io2 = IO.of("hello");
      const io3 = IO.of(true);
      const result = IO.run(IO.sequenceT(io1, io2, io3));
      expect(result).toEqual([1, "hello", true]);
    });

    it("should handle empty tuple", () => {
      const result = IO.run(IO.sequenceT());
      expect(result).toEqual([]);
    });

    it("should maintain laziness", () => {
      const effect1 = vi.fn(() => 1);
      const effect2 = vi.fn(() => "test");

      const combined = IO.sequenceT(
        effect1 as IO<number>,
        effect2 as IO<string>,
      );

      expect(effect1).not.toHaveBeenCalled();
      expect(effect2).not.toHaveBeenCalled();

      const result = IO.run(combined);

      expect(effect1).toHaveBeenCalledTimes(1);
      expect(effect2).toHaveBeenCalledTimes(1);
      expect(result).toEqual([1, "test"]);
    });
  });

  describe("sequenceS", () => {
    it("should combine record of IOs", () => {
      const ios = {
        a: IO.of(1),
        b: IO.of("hello"),
        c: IO.of(true),
      };
      const result = IO.run(IO.sequenceS(ios));
      expect(result).toEqual({ a: 1, b: "hello", c: true });
    });

    it("should handle empty record", () => {
      const result = IO.run(IO.sequenceS({}));
      expect(result).toEqual({});
    });

    it("should maintain laziness", () => {
      const effects = {
        a: vi.fn(() => 1),
        b: vi.fn(() => "hello"),
      };
      const ioStruct = {
        a: effects.a as IO<number>,
        b: effects.b as IO<string>,
      };

      const sequenced = IO.sequenceS(ioStruct);
      expect(effects.a).not.toHaveBeenCalled();
      expect(effects.b).not.toHaveBeenCalled();

      const result = IO.run(sequenced);

      expect(effects.a).toHaveBeenCalledTimes(1);
      expect(effects.b).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ a: 1, b: "hello" });
    });
  });

  describe("chainFirst", () => {
    it("should execute side effect but return original value", () => {
      const log: string[] = [];
      const logIO =
        (msg: string): IO<void> =>
        () => {
          log.push(msg);
        };

      const io = IO.of(42);
      const withLogging = IO.chainFirst((n: number) => logIO(`Got: ${n}`))(io);

      expect(log).toEqual([]);
      const result = IO.run(withLogging);
      expect(log).toEqual(["Got: 42"]);
      expect(result).toBe(42);
    });

    it("should maintain laziness", () => {
      const mainEffect = vi.fn(() => 10);
      const sideEffect = vi.fn((n: number) => `side: ${n}`);

      const io = mainEffect as IO<number>;
      const chained = IO.chainFirst((n: number) => () => sideEffect(n))(io);

      expect(mainEffect).not.toHaveBeenCalled();
      expect(sideEffect).not.toHaveBeenCalled();

      IO.run(chained);

      expect(mainEffect).toHaveBeenCalledTimes(1);
      expect(sideEffect).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    it("should propagate thrown exceptions", () => {
      const throwingIO: IO<number> = () => {
        throw new Error("Sync Error");
      };
      expect(() => IO.run(throwingIO)).toThrow("Sync Error");
    });

    it("should propagate exceptions through map", () => {
      const io: IO<number> = () => {
        throw new Error("Original");
      };
      const mapped = IO.map((n: number) => n * 2)(io);
      expect(() => IO.run(mapped)).toThrow("Original");
    });

    it("should propagate exceptions through chain", () => {
      const io1: IO<number> = () => 5;
      const io2 =
        (_n: number): IO<number> =>
        () => {
          throw new Error("Chain error");
        };
      const chained = IO.chain(io2)(io1);
      expect(() => IO.run(chained)).toThrow("Chain error");
    });
  });

  describe("Functor laws", () => {
    it("should satisfy identity law: map(id) ≅ id", () => {
      const io = IO.of(42);
      const id = <T,>(x: T) => x;
      const mapped = IO.map(id)(io);

      expect(IO.run(io)).toEqual(IO.run(mapped));
    });

    it("should satisfy composition law: map(g∘f) ≅ map(g)∘map(f)", () => {
      const io = IO.of(10);
      const f = (n: number) => n * 2;
      const g = (n: number) => n + 1;

      const composed1 = IO.map((x: number) => g(f(x)))(io);
      const composed2 = IO.map(g)(IO.map(f)(io));

      expect(IO.run(composed1)).toEqual(IO.run(composed2));
    });
  });

  describe("Monad laws", () => {
    it("should satisfy left identity: chain(f)(of(x)) ≅ f(x)", () => {
      const x = 42;
      const f = (n: number) => IO.of(n * 2);

      const result1 = IO.run(IO.chain(f)(IO.of(x)));
      const result2 = IO.run(f(x));
      expect(result1).toEqual(result2);
    });

    it("should satisfy right identity: chain(of)(m) ≅ m", () => {
      const io = IO.of(42);
      const chained = IO.chain(IO.of)(io);

      expect(IO.run(io)).toEqual(IO.run(chained));
    });

    it("should satisfy associativity: chain(g)(chain(f)(m)) ≅ chain(x => chain(g)(f(x)))(m)", () => {
      const io = IO.of(10);
      const f = (n: number) => IO.of(n * 2);
      const g = (n: number) => IO.of(n + 1);

      const left = IO.chain(g)(IO.chain(f)(io));
      const right = IO.chain((x: number) => IO.chain(g)(f(x)))(io);

      expect(IO.run(left)).toEqual(IO.run(right));
    });
  });
});
