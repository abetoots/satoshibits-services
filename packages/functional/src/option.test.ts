/**
 * @module option.test
 * Tests for Option/Maybe type implementation
 */

import { describe, it, expect, vi } from 'vitest';
import {
  Option,
  some,
  none,
  fromNullable,
  fromPredicate,
  tryCatch,
  isSome,
  isNone,
  map,
  flatMap,
  chain,
  filter,
  tap,
  getOrElse,
  orElse,
  match,
  toNullable,
  toUndefined,
  lift2,
  sequence,
  ap,
  sequenceS,
} from './option.mjs';

describe('Option Type', () => {
  describe('Constructors', () => {
    describe('some', () => {
      it('should create a Some variant with the provided value', () => {
        const result = some(42);
        expect(result._tag).toBe('Some');
        if (isSome(result)) {
          expect(result.value).toBe(42);
        }
      });

      it('should work with any type of value', () => {
        const obj = { name: 'Alice' };
        const result = some(obj);
        expect(result._tag).toBe('Some');
        if (isSome(result)) {
          expect(result.value).toBe(obj);
        }
      });

      it('should work with null or undefined as explicit values', () => {
        const nullResult = some(null);
        expect(nullResult._tag).toBe('Some');
        if (isSome(nullResult)) {
          expect(nullResult.value).toBe(null);
        }

        const undefinedResult = some(undefined);
        expect(undefinedResult._tag).toBe('Some');
        if (isSome(undefinedResult)) {
          expect(undefinedResult.value).toBe(undefined);
        }
      });
    });

    describe('none', () => {
      it('should create a None variant', () => {
        const result = none();
        expect(result._tag).toBe('None');
        expect('value' in result).toBe(false);
      });

      it('should always return the same structure', () => {
        const result1 = none();
        const result2 = none();
        expect(result1).toEqual(result2);
      });
    });

    describe('fromNullable', () => {
      it('should return Some for non-null/undefined values', () => {
        expect(fromNullable(42)).toEqual(some(42));
        expect(fromNullable('hello')).toEqual(some('hello'));
        expect(fromNullable(0)).toEqual(some(0));
        expect(fromNullable('')).toEqual(some(''));
        expect(fromNullable(false)).toEqual(some(false));
      });

      it('should return None for null or undefined', () => {
        expect(fromNullable(null)).toEqual(none());
        expect(fromNullable(undefined)).toEqual(none());
      });

      it('should work with optional chaining', () => {
        const user: { contact?: { email?: string } } = {};
        const email = fromNullable(user?.contact?.email);
        expect(isNone(email)).toBe(true);
      });
    });

    describe('fromPredicate', () => {
      const isPositive = (n: number) => n > 0;
      const positive = fromPredicate(isPositive);

      it('should return Some when predicate is true', () => {
        expect(positive(5)).toEqual(some(5));
        expect(positive(0.1)).toEqual(some(0.1));
      });

      it('should return None when predicate is false', () => {
        expect(positive(-1)).toEqual(none());
        expect(positive(0)).toEqual(none());
      });

      it('should work with complex predicates', () => {
        const validEmail = fromPredicate((s: string) => 
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
        );
        
        expect(validEmail('user@example.com')).toEqual(some('user@example.com'));
        expect(validEmail('invalid')).toEqual(none());
      });
    });

    describe('tryCatch', () => {
      it('should return Some when function succeeds', () => {
        const result = tryCatch(() => JSON.parse('{"a": 1}') as { a: number });
        expect(isSome(result)).toBe(true);
        if (isSome(result)) {
          expect(result.value).toEqual({ a: 1 });
        }
      });

      it('should return None when function throws', () => {
        const result = tryCatch(() => JSON.parse('invalid json') as unknown);
        expect(isNone(result)).toBe(true);
      });

      it('should work with any thrown value', () => {
        const result = tryCatch(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'string error';
        });
        expect(isNone(result)).toBe(true);
      });

      it('should execute function immediately', () => {
        const fn = vi.fn(() => 42);
        const result = tryCatch(fn);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(result).toEqual(some(42));
      });
    });
  });

  describe('Type Guards', () => {
    describe('isSome', () => {
      it('should return true for Some variants', () => {
        expect(isSome(some(42))).toBe(true);
        expect(isSome(some(null))).toBe(true);
        expect(isSome(some(undefined))).toBe(true);
      });

      it('should return false for None variants', () => {
        expect(isSome(none())).toBe(false);
      });

      it('should narrow types correctly', () => {
        const opt: Option<number> = some(42);
        if (isSome(opt)) {
          // TypeScript should know opt.value exists
          expect(opt.value).toBe(42);
        }
      });
    });

    describe('isNone', () => {
      it('should return true for None variants', () => {
        expect(isNone(none())).toBe(true);
      });

      it('should return false for Some variants', () => {
        expect(isNone(some(42))).toBe(false);
        expect(isNone(some(null))).toBe(false);
      });

      it('should work in filter operations', () => {
        const options = [some(1), none(), some(2), none()];
        const nones = options.filter(isNone);
        expect(nones).toHaveLength(2);
      });
    });
  });

  describe('Transformations', () => {
    describe('map', () => {
      it('should transform value in Some', () => {
        const double = map((n: number) => n * 2);
        expect(double(some(5))).toEqual(some(10));
      });

      it('should return None for None', () => {
        const double = map((n: number) => n * 2);
        expect(double(none())).toEqual(none());
      });

      it('should work with type transformations', () => {
        const toString = map((n: number) => n.toString());
        const result = toString(some(42));
        expect(result).toEqual(some('42'));
      });

      it('should be chainable', () => {
        const result = some(5);
        const transformed = map((n: number) => n * 2)(
          map((n: number) => n + 1)(result)
        );
        expect(transformed).toEqual(some(12));
      });
    });

    describe('flatMap/chain', () => {
      const safeDivide = (divisor: number) => (dividend: number): Option<number> =>
        divisor === 0 ? none() : some(dividend / divisor);

      it('should chain operations on Some', () => {
        const result = flatMap(safeDivide(2))(some(10));
        expect(result).toEqual(some(5));
      });

      it('should return None when function returns None', () => {
        const result = flatMap(safeDivide(0))(some(10));
        expect(result).toEqual(none());
      });

      it('should return None when input is None', () => {
        const result = flatMap(safeDivide(2))(none());
        expect(result).toEqual(none());
      });

      it('should work with multiple chained operations', () => {
        const result = chain(safeDivide(2))(
          chain(safeDivide(5))(some(100))
        );
        expect(result).toEqual(some(10));
      });

      it('chain should be an alias for flatMap', () => {
        expect(chain).toBe(flatMap);
      });
    });

    describe('filter', () => {
      const isEven = (n: number) => n % 2 === 0;

      it('should keep Some when predicate is true', () => {
        expect(filter(isEven)(some(4))).toEqual(some(4));
      });

      it('should return None when predicate is false', () => {
        expect(filter(isEven)(some(3))).toEqual(none());
      });

      it('should return None when input is None', () => {
        expect(filter(isEven)(none())).toEqual(none());
      });

      it('should work with type guard predicates', () => {
        const isString = (v: unknown): v is string => typeof v === 'string';
        const mixed: Option<string | number> = some(42);
        const filtered: Option<string> = filter(isString)(mixed);
        expect(filtered).toEqual(none());

        const stringOpt: Option<string | number> = some('hello');
        const stringFiltered: Option<string> = filter(isString)(stringOpt);
        expect(stringFiltered).toEqual(some('hello'));
      });

      it('should be chainable with other operations', () => {
        const result = filter(isEven)(
          map((n: number) => n * 2)(some(3))
        );
        expect(result).toEqual(some(6));
      });
    });

    describe('tap', () => {
      it('should execute side effect on Some', () => {
        const sideEffect = vi.fn();
        const result = tap(sideEffect)(some(42));
        
        expect(sideEffect).toHaveBeenCalledWith(42);
        expect(result).toEqual(some(42));
      });

      it('should not execute side effect on None', () => {
        const sideEffect = vi.fn();
        const result = tap(sideEffect)(none());
        
        expect(sideEffect).not.toHaveBeenCalled();
        expect(result).toEqual(none());
      });

      it('should return original Option unchanged', () => {
        const original = some({ id: 1 });
        const sideEffect = (obj: { id: number }) => {
          obj.id = 2; // Try to mutate
        };
        
        const result = tap(sideEffect)(original);
        expect(result).toBe(original);
        expect(result).toEqual(some({ id: 2 })); // Mutation happened but same reference
      });

      it('should work in a pipeline', () => {
        const log = vi.fn();
        const result = tap(log)(
          map((n: number) => n * 2)(
            some(5)
          )
        );
        
        expect(log).toHaveBeenCalledWith(10);
        expect(result).toEqual(some(10));
      });
    });
  });

  describe('Extractors', () => {
    describe('getOrElse', () => {
      it('should return value for Some', () => {
        const result = getOrElse(() => 0)(some(42));
        expect(result).toBe(42);
      });

      it('should return default for None', () => {
        const result = getOrElse(() => 0)(none());
        expect(result).toBe(0);
      });

      it('should lazily evaluate default', () => {
        const defaultFn = vi.fn(() => 'default');
        
        getOrElse(defaultFn)(some('value'));
        expect(defaultFn).not.toHaveBeenCalled();
        
        getOrElse(defaultFn)(none());
        expect(defaultFn).toHaveBeenCalledTimes(1);
      });
    });

    describe('orElse', () => {
      it('should return original Some', () => {
        const result = orElse(() => some(0))(some(42));
        expect(result).toEqual(some(42));
      });

      it('should return alternative for None', () => {
        const result = orElse(() => some(0))(none());
        expect(result).toEqual(some(0));
      });

      it('should lazily evaluate alternative', () => {
        const alternativeFn = vi.fn(() => some('alternative'));
        
        orElse(alternativeFn)(some('value'));
        expect(alternativeFn).not.toHaveBeenCalled();
        
        orElse(alternativeFn)(none());
        expect(alternativeFn).toHaveBeenCalledTimes(1);
      });

      it('should chain multiple fallbacks', () => {
        const result = orElse(() => some('third'))(
          orElse(() => none())(
            none()
          )
        );
        expect(result).toEqual(some('third'));
      });
    });
  });

  describe('Pattern Matching', () => {
    describe('match', () => {
      it('should call some branch for Some', () => {
        const result = match({
          some: (n: number) => `Value is ${n}`,
          none: () => 'No value',
        })(some(42));
        
        expect(result).toBe('Value is 42');
      });

      it('should call none branch for None', () => {
        const result = match({
          some: (n: number) => `Value is ${n}`,
          none: () => 'No value',
        })(none());
        
        expect(result).toBe('No value');
      });

      it('should work with different return types', () => {
        const renderOption = match({
          some: (user: { name: string }) => ({ type: 'user', name: user.name }),
          none: () => ({ type: 'guest' }),
        });
        
        expect(renderOption(some({ name: 'Alice' }))).toEqual({ type: 'user', name: 'Alice' });
        expect(renderOption(none())).toEqual({ type: 'guest' });
      });

      it('should handle async branches', async () => {
        const fetchData = match({
          some: async (id: number) => Promise.resolve(`Fetched data for ${id}`),
          none: async () => Promise.resolve('No ID provided'),
        });
        
        const result = await fetchData(some(123));
        expect(result).toBe('Fetched data for 123');
      });
    });
  });

  describe('Conversions', () => {
    describe('toNullable', () => {
      it('should convert Some to value', () => {
        expect(toNullable(some(42))).toBe(42);
        expect(toNullable(some('hello'))).toBe('hello');
      });

      it('should convert None to null', () => {
        expect(toNullable(none())).toBe(null);
      });

      it('should preserve null in Some', () => {
        expect(toNullable(some(null))).toBe(null);
      });
    });

    describe('toUndefined', () => {
      it('should convert Some to value', () => {
        expect(toUndefined(some(42))).toBe(42);
        expect(toUndefined(some('hello'))).toBe('hello');
      });

      it('should convert None to undefined', () => {
        expect(toUndefined(none())).toBe(undefined);
      });

      it('should preserve undefined in Some', () => {
        expect(toUndefined(some(undefined))).toBe(undefined);
      });
    });
  });

  describe('Combinations', () => {
    describe('lift2', () => {
      const add = (a: number, b: number) => a + b;
      const liftedAdd = lift2(add);

      it('should combine two Some values', () => {
        expect(liftedAdd(some(5), some(3))).toEqual(some(8));
      });

      it('should return None if first is None', () => {
        expect(liftedAdd(none(), some(3))).toEqual(none());
      });

      it('should return None if second is None', () => {
        expect(liftedAdd(some(5), none())).toEqual(none());
      });

      it('should return None if both are None', () => {
        expect(liftedAdd(none(), none())).toEqual(none());
      });

      it('should work with different types', () => {
        const concat = (s: string, n: number) => `${s}${n}`;
        const liftedConcat = lift2(concat);
        expect(liftedConcat(some('value'), some(42))).toEqual(some('value42'));
      });
    });

    describe('sequence', () => {
      it('should convert array of Somes to Some of array', () => {
        const options = [some(1), some(2), some(3)];
        expect(sequence(options)).toEqual(some([1, 2, 3]));
      });

      it('should return None if any element is None', () => {
        const options = [some(1), none(), some(3)];
        expect(sequence(options)).toEqual(none());
      });

      it('should return Some of empty array for empty input', () => {
        expect(sequence([])).toEqual(some([]));
      });

      it('should short-circuit on first None', () => {
        const fn = vi.fn(() => some(42));
        const options = [some(1), none(), fn()];
        
        const result = sequence(options);
        expect(result).toEqual(none());
        // fn was called because array is evaluated before sequence
        expect(fn).toHaveBeenCalled();
      });
    });

    describe('ap', () => {
      it('should apply Some function to Some value', () => {
        const addOne = (n: number) => n + 1;
        expect(ap(some(addOne))(some(5))).toEqual(some(6));
      });

      it('should return None if function is None', () => {
        expect(ap(none())(some(5))).toEqual(none());
      });

      it('should return None if value is None', () => {
        const addOne = (n: number) => n + 1;
        expect(ap(some(addOne))(none())).toEqual(none());
      });

      it('should work with curried functions', () => {
        const add = (a: number) => (b: number) => a + b;
        const maybeAdd5 = map(add)(some(5));
        expect(ap(maybeAdd5)(some(3))).toEqual(some(8));
      });
    });

    describe('sequenceS', () => {
      it('should convert struct of Somes to Some of struct', () => {
        const result = sequenceS({
          a: some(1),
          b: some('hello'),
          c: some(true),
        });
        
        expect(result).toEqual(some({
          a: 1,
          b: 'hello',
          c: true,
        }));
      });

      it('should return None if any value is None', () => {
        const result = sequenceS({
          a: some(1),
          b: none(),
          c: some(true),
        });
        
        expect(result).toEqual(none());
      });

      it('should work with empty struct', () => {
        expect(sequenceS({})).toEqual(some({}));
      });

      it('should preserve type information', () => {
        const result = sequenceS({
          num: some(42),
          str: some('test'),
        });
        
        if (isSome(result)) {
          expect(result.value.num).toBe(42);
          expect(result.value.str).toBe('test');
        }
      });

      it('should work with nested options', () => {
        const result = sequenceS({
          user: some({ id: 1, name: 'Alice' }),
          config: some({ theme: 'dark' }),
        });
        
        expect(result).toEqual(some({
          user: { id: 1, name: 'Alice' },
          config: { theme: 'dark' },
        }));
      });
    });
  });

  describe('Namespace', () => {
    it('should export all functions through Option namespace', () => {
      expect(Option.some).toBe(some);
      expect(Option.none).toBe(none);
      expect(Option.fromNullable).toBe(fromNullable);
      expect(Option.fromPredicate).toBe(fromPredicate);
      expect(Option.tryCatch).toBe(tryCatch);
      expect(Option.isSome).toBe(isSome);
      expect(Option.isNone).toBe(isNone);
      expect(Option.map).toBe(map);
      expect(Option.flatMap).toBe(flatMap);
      expect(Option.chain).toBe(chain);
      expect(Option.filter).toBe(filter);
      expect(Option.tap).toBe(tap);
      expect(Option.getOrElse).toBe(getOrElse);
      expect(Option.orElse).toBe(orElse);
      expect(Option.match).toBe(match);
      expect(Option.toNullable).toBe(toNullable);
      expect(Option.toUndefined).toBe(toUndefined);
    });

    it('should work with pipe-style composition', () => {
      const pipeline = (value: number) =>
        Option.fromPredicate((n: number) => n > 0)(value);
      
      const transform = (opt: Option<number>) =>
        Option.getOrElse(() => 0)(
          Option.filter((n: number) => n < 100)(
            Option.map((n: number) => n * 2)(opt)
          )
        );
      
      expect(transform(pipeline(5))).toBe(10);
      expect(transform(pipeline(60))).toBe(0); // Filtered out
      expect(transform(pipeline(-5))).toBe(0); // None from predicate
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle user authentication flow', () => {
      interface User {
        id: string;
        name: string;
        role: 'admin' | 'user';
      }
      
      const findUser = (id: string): Option<User> =>
        id === '123' ? some({ id, name: 'Alice', role: 'admin' }) : none();
      
      const isAdmin = (user: User): boolean => user.role === 'admin';
      
      const result = match({
        some: (user: User) => isAdmin(user) ? 'Admin access granted' : 'User access granted',
        none: () => 'Access denied: User not found',
      })(findUser('123'));
      
      expect(result).toBe('Admin access granted');
    });

    it('should handle configuration with fallbacks', () => {
      const getEnvVar = (key: string): Option<string> =>
        fromNullable(process.env[key]);
      
      const getConfig = (key: string): Option<string> =>
        orElse(() => getEnvVar(`FALLBACK_${key}`))(
          orElse(() => none() as Option<string>)(
            getEnvVar(key)
          )
        );
      
      process.env.FALLBACK_API_KEY = 'fallback-key';
      const apiKey = getOrElse(() => 'default-key')(getConfig('API_KEY'));
      expect(apiKey).toBe('fallback-key');
      delete process.env.FALLBACK_API_KEY;
    });

    it('should handle form validation', () => {
      interface FormData {
        name: string;
        email: string;
        age: string;
      }
      
      const validateName = (name: string): Option<string> =>
        name.length >= 2 ? some(name) : none();
      
      const validateEmail = (email: string): Option<string> =>
        fromPredicate((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))(email);
      
      const validateAge = (age: string): Option<number> =>
        flatMap((n: number) => n >= 18 && n <= 100 ? some(n) : none())(
          tryCatch(() => parseInt(age, 10))
        );
      
      const validateForm = (data: FormData) =>
        sequenceS({
          name: validateName(data.name),
          email: validateEmail(data.email),
          age: validateAge(data.age),
        });
      
      const validForm = validateForm({
        name: 'Alice',
        email: 'alice@example.com',
        age: '25',
      });
      
      expect(isSome(validForm)).toBe(true);
      if (isSome(validForm)) {
        expect(validForm.value).toEqual({
          name: 'Alice',
          email: 'alice@example.com',
          age: 25,
        });
      }
      
      const invalidForm = validateForm({
        name: 'A',
        email: 'invalid',
        age: '200',
      });
      
      expect(isNone(invalidForm)).toBe(true);
    });
  });
});