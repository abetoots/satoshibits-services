import { describe, it, expect } from 'vitest';
import { Result, isResult, unwrap, safe } from './result.mjs';

describe('Result', () => {
  describe('ok', () => {
    it('creates a successful Result', () => {
      const result = Result.ok(42);
      expect(result).toEqual({ success: true, data: 42 });
    });

    it('works with complex data types', () => {
      const data = { name: 'test', items: [1, 2, 3] };
      const result = Result.ok(data);
      expect(result).toEqual({ success: true, data });
    });
  });

  describe('err', () => {
    it('creates a failed Result', () => {
      const result = Result.err('error message');
      expect(result).toEqual({ success: false, error: 'error message' });
    });

    it('works with Error objects', () => {
      const error = new Error('test error');
      const result = Result.err<number, Error>(error);
      expect(result).toEqual({ success: false, error });
    });
  });

  describe('map', () => {
    it('transforms successful Result data', () => {
      const result = Result.ok(5);
      const mapped = Result.map((x: number) => x * 2)(result);
      expect(mapped).toEqual({ success: true, data: 10 });
    });

    it('passes through failed Results unchanged', () => {
      const result = Result.err<number>('error');
      const mapped = Result.map((x: number) => x * 2)(result);
      expect(mapped).toEqual({ success: false, error: 'error' });
    });

    it('works with type transformations', () => {
      const result = Result.ok('42');
      const mapped = Result.map((s: string) => parseInt(s))(result);
      expect(mapped).toEqual({ success: true, data: 42 });
    });
  });

  describe('flatMap', () => {
    it('chains successful Result operations', () => {
      const result = Result.ok(10);
      const chained = Result.flatMap((x: number) =>
        x > 0 ? Result.ok(x / 2) : Result.err('negative')
      )(result);
      expect(chained).toEqual({ success: true, data: 5 });
    });

    it('short-circuits on first error', () => {
      const result = Result.err<number>('first error');
      const chained = Result.flatMap((x: number) => Result.ok(x * 2))(result as Result<number, never>);
      expect(chained).toEqual({ success: false, error: 'first error' });
    });

    it('propagates errors from the chained function', () => {
      const result = Result.ok(-5);
      const chained = Result.flatMap((x: number) =>
        x > 0 ? Result.ok(x / 2) : Result.err('negative value')
      )(result);
      expect(chained).toEqual({ success: false, error: 'negative value' });
    });
  });

  describe('mapError', () => {
    it('transforms error values', () => {
      const result = Result.err<number>('error');
      const mapped = Result.mapError((e: string) => e.toUpperCase())(result);
      expect(mapped).toEqual({ success: false, error: 'ERROR' });
    });

    it('passes through successful Results unchanged', () => {
      const result = Result.ok(42);
      const mapped = Result.mapError((e: string) => e.toUpperCase())(result);
      expect(mapped).toEqual({ success: true, data: 42 });
    });

    it('works with error type transformations', () => {
      const result = Result.err<number>('404');
      const mapped = Result.mapError((e: string) => new Error(e))(result);
      expect(mapped.success).toBe(false);
      if (!mapped.success) {
        expect(mapped.error).toBeInstanceOf(Error);
        expect(mapped.error.message).toBe('404');
      }
    });
  });

  describe('getOrElse', () => {
    it('returns data from successful Result', () => {
      const result = Result.ok(42);
      const value = Result.getOrElse(0)(result);
      expect(value).toBe(42);
    });

    it('returns default value for failed Result', () => {
      const result = Result.err<number>('error');
      const value = Result.getOrElse(0)(result);
      expect(value).toBe(0);
    });
  });

  describe('fold', () => {
    it('applies success function for successful Result', () => {
      const result = Result.ok(42);
      const folded = Result.fold(
        (data: number) => `Success: ${data}`,
        (error: string) => `Error: ${error}`
      )(result);
      expect(folded).toBe('Success: 42');
    });

    it('applies failure function for failed Result', () => {
      const result = Result.err<number>('not found');
      const folded = Result.fold(
        (data: number) => `Success: ${data}`,
        (error: string) => `Error: ${error}`
      )(result);
      expect(folded).toBe('Error: not found');
    });
  });

  describe('combine', () => {
    it('combines two successful Results', () => {
      const result1 = Result.ok(5);
      const result2 = Result.ok(3);
      const combined = Result.combine((a: number, b: number) => a + b)(result1, result2);
      expect(combined).toEqual({ success: true, data: 8 });
    });

    it('returns first error when first Result fails', () => {
      const result1 = Result.err<number>('first error');
      const result2 = Result.ok(3);
      const combined = Result.combine((a: number, b: number) => a + b)(result1, result2);
      expect(combined).toEqual({ success: false, error: 'first error' });
    });

    it('returns second error when second Result fails', () => {
      const result1 = Result.ok(5);
      const result2 = Result.err<number>('second error');
      const combined = Result.combine((a: number, b: number) => a + b)(result1, result2);
      expect(combined).toEqual({ success: false, error: 'second error' });
    });

    it('returns first error when both Results fail', () => {
      const result1 = Result.err<number>('first error');
      const result2 = Result.err<number>('second error');
      const combined = Result.combine((a: number, b: number) => a + b)(result1, result2);
      expect(combined).toEqual({ success: false, error: 'first error' });
    });
  });

  describe('sequence', () => {
    it('sequences all successful Results', () => {
      const results = [Result.ok(1), Result.ok(2), Result.ok(3)];
      const sequenced = Result.sequence(results);
      expect(sequenced).toEqual({ success: true, data: [1, 2, 3] });
    });

    it('returns first error on failure', () => {
      const results = [
        Result.ok(1),
        Result.err<number>('error 1'),
        Result.err<number>('error 2'),
      ];
      const sequenced = Result.sequence(results);
      expect(sequenced).toEqual({ success: false, error: 'error 1' });
    });

    it('works with empty array', () => {
      const results: Result<number>[] = [];
      const sequenced = Result.sequence(results);
      expect(sequenced).toEqual({ success: true, data: [] });
    });
  });

  describe('filter', () => {
    it('passes through Results that match predicate', () => {
      const result = Result.ok(10);
      const filtered = Result.filter((x: number) => x > 5, 'too small')(result);
      expect(filtered).toEqual({ success: true, data: 10 });
    });

    it('converts to error when predicate fails', () => {
      const result = Result.ok(3);
      const filtered = Result.filter((x: number) => x > 5, 'too small')(result);
      expect(filtered).toEqual({ success: false, error: 'too small' });
    });

    it('passes through failed Results unchanged', () => {
      const result = Result.err<number>('original error');
      const filtered = Result.filter((x: number) => x > 5, 'too small')(result);
      expect(filtered).toEqual({ success: false, error: 'original error' });
    });
  });

  describe('orElse', () => {
    it('returns original Result when successful', () => {
      const result = Result.ok(42);
      const fallback = Result.orElse(() => Result.ok(0))(result);
      expect(fallback).toEqual({ success: true, data: 42 });
    });

    it('calls fallback function when Result fails', () => {
      const result = Result.err<number>('error');
      const fallback = Result.orElse((error: string) => 
        Result.ok(error === 'error' ? 99 : 0)
      )(result);
      expect(fallback).toEqual({ success: true, data: 99 });
    });

    it('can return another error from fallback', () => {
      const result = Result.err<number>('first error');
      const fallback = Result.orElse(() => 
        Result.err<number, string>('fallback error')
      )(result);
      expect(fallback).toEqual({ success: false, error: 'fallback error' });
    });

    it('allows error type transformation', () => {
      const result = Result.err<number, string>('string error');
      const fallback = Result.orElse((error: string) => 
        Result.err<number, Error>(new Error(error))
      )(result);
      expect(fallback.success).toBe(false);
      if (!fallback.success) {
        expect(fallback.error).toBeInstanceOf(Error);
        expect(fallback.error.message).toBe('string error');
      }
    });
  });

  describe('combineWithAllErrors', () => {
    it('combines all successful Results', () => {
      const results = [Result.ok(1), Result.ok(2), Result.ok(3)];
      const combined = Result.combineWithAllErrors(results);
      expect(combined).toEqual({ success: true, data: [1, 2, 3] });
    });

    it('collects all errors instead of short-circuiting', () => {
      const results = [
        Result.ok(1),
        Result.err<number>('error 1'),
        Result.ok(2),
        Result.err<number>('error 2'),
      ];
      const combined = Result.combineWithAllErrors(results);
      expect(combined).toEqual({ success: false, error: ['error 1', 'error 2'] });
    });

    it('returns all errors when all Results fail', () => {
      const results = [
        Result.err<number>('error 1'),
        Result.err<number>('error 2'),
        Result.err<number>('error 3'),
      ];
      const combined = Result.combineWithAllErrors(results);
      expect(combined).toEqual({ success: false, error: ['error 1', 'error 2', 'error 3'] });
    });

    it('works with empty array', () => {
      const results: Result<number>[] = [];
      const combined = Result.combineWithAllErrors(results);
      expect(combined).toEqual({ success: true, data: [] });
    });
  });

  describe('isOk', () => {
    it('returns true for successful Results', () => {
      const result = Result.ok(42);
      expect(Result.isOk(result)).toBe(true);
    });

    it('returns false for failed Results', () => {
      const result = Result.err('error');
      expect(Result.isOk(result)).toBe(false);
    });

    it('provides type narrowing', () => {
      const result: Result<number> = Result.ok(42);
      if (Result.isOk(result)) {
        // TypeScript should know result.data is available
        expect(result.data).toBe(42);
      }
    });
  });

  describe('isErr', () => {
    it('returns false for successful Results', () => {
      const result = Result.ok(42);
      expect(Result.isErr(result)).toBe(false);
    });

    it('returns true for failed Results', () => {
      const result = Result.err('error');
      expect(Result.isErr(result)).toBe(true);
    });

    it('provides type narrowing', () => {
      const result: Result<number> = Result.err('error');
      if (Result.isErr(result)) {
        // TypeScript should know result.error is available
        expect(result.error).toBe('error');
      }
    });
  });

  describe('fromPromise', () => {
    it('converts resolved promises to successful Results', async () => {
      const promise = Promise.resolve(42);
      const result = await Result.fromPromise(promise);
      expect(result).toEqual({ success: true, data: 42 });
    });

    it('converts rejected promises to failed Results with Error', async () => {
      const error = new Error('promise error');
      const promise = Promise.reject(error);
      const result = await Result.fromPromise(promise);
      expect(result).toEqual({ success: false, error });
    });

    it('wraps non-Error rejections in Error', async () => {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      const promise = Promise.reject('string rejection');
      const result = await Result.fromPromise(promise);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('string rejection');
      }
    });
  });

  describe('fromThrowable', () => {
    it('wraps successful function calls in Result', () => {
      const fn = (a: number, b: number) => a + b;
      const wrapped = Result.fromThrowable(fn);
      const result = wrapped(5, 3);
      expect(result).toEqual({ success: true, data: 8 });
    });

    it('catches thrown errors and wraps in Result', () => {
      const fn = () => {
        throw new Error('function error');
      };
      const wrapped = Result.fromThrowable(fn);
      const result = wrapped();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('function error');
      }
    });

    it('wraps non-Error throws in Error', () => {
      const fn = () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'string error';
      };
      const wrapped = Result.fromThrowable(fn);
      const result = wrapped();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('string error');
      }
    });
  });
});

describe('isResult', () => {
  it('returns true for valid Result objects', () => {
    expect(isResult(Result.ok(42))).toBe(true);
    expect(isResult(Result.err('error'))).toBe(true);
  });

  it('returns false for non-Result objects', () => {
    expect(isResult(null)).toBe(false);
    expect(isResult(undefined)).toBe(false);
    expect(isResult(42)).toBe(false);
    expect(isResult('string')).toBe(false);
    expect(isResult({})).toBe(false);
    expect(isResult({ success: 'true' })).toBe(false);
    expect(isResult({ success: true })).toBe(false); // Missing data property
    expect(isResult({ success: false })).toBe(false); // Missing error property
  });
});

describe('unwrap', () => {
  it('returns data from successful Result', () => {
    const result = Result.ok(42);
    expect(unwrap(result)).toBe(42);
  });

  it('throws error for failed Result', () => {
    const result = Result.err('error message');
    expect(() => unwrap(result)).toThrow('Attempted to unwrap failed Result: error message');
  });
});

describe('safe', () => {
  it('returns successful Result for valid property access', () => {
    const obj = { name: 'test', value: 42 };
    const getter = safe((o: typeof obj) => o.value);
    const result = getter(obj);
    expect(result).toEqual({ success: true, data: 42 });
  });

  it('returns error Result for undefined property', () => {
    const obj = { name: 'test' };
    const getter = safe((o: typeof obj & { value?: unknown }) => o.value);
    const result = getter(obj);
    expect(result).toEqual({ success: false, error: 'Property access failed' });
  });

  it('returns error Result for null property', () => {
    const obj = { name: 'test', value: null };
    const getter = safe((o: typeof obj) => (o.value as unknown) as number);
    const result = getter(obj);
    expect(result).toEqual({ success: false, error: 'Property access failed' });
  });

  it('catches thrown errors during property access', () => {
    const obj = {
      get value(): number {
        throw new Error('getter error');
      }
    };
    const getter = safe((o: typeof obj) => o.value);
    const result = getter(obj);
    expect(result).toEqual({ success: false, error: 'Property access failed' });
  });

  it('uses custom error message', () => {
    const obj = {};
    const getter = safe((o: typeof obj & { value?: unknown }) => o.value, 'Value not found');
    const result = getter(obj);
    expect(result).toEqual({ success: false, error: 'Value not found' });
  });
});