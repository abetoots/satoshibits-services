import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReaderResult, liftDomain, liftAsync } from './reader-result.mjs';
import { Result } from './result.mjs';

describe('ReaderResult', () => {
  interface TestDeps {
    db: {
      findUser: (id: string) => Promise<{ id: string; name: string } | null>;
      saveUser: (user: { id: string; name: string }) => Promise<void>;
    };
    logger: {
      log: (message: string) => void;
    };
  }

  const mockDeps: TestDeps = {
    db: {
      findUser: vi.fn(),
      saveUser: vi.fn(),
    },
    logger: {
      log: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('of', () => {
    it('creates a successful ReaderResult', async () => {
      const rr = ReaderResult.of<TestDeps, string, number>(42);
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: true, data: 42 });
    });
  });

  describe('fail', () => {
    it('creates a failed ReaderResult', async () => {
      const rr = ReaderResult.fail<TestDeps, string, number>('error');
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: false, error: 'error' });
    });
  });

  describe('chain', () => {
    it('chains successful operations', async () => {
      const rr = ReaderResult.chain((x: number) => 
        ReaderResult.of<TestDeps, string, number>(x * 2)
      )(ReaderResult.of(5));
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: true, data: 10 });
    });

    it('short-circuits on error', async () => {
      const rr = ReaderResult.chain((x: number) => 
        ReaderResult.of<TestDeps, string, number>(x * 2)
      )(ReaderResult.fail('error'));
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: false, error: 'error' });
    });

    it('propagates errors from chained function', async () => {
      const rr = ReaderResult.chain(() => 
        ReaderResult.fail<TestDeps, string, number>('chained error')
      )(ReaderResult.of(5));
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: false, error: 'chained error' });
    });
  });

  describe('map', () => {
    it('transforms successful values', async () => {
      const rr = ReaderResult.map<TestDeps, string, number, number>((x: number) => x * 2)(
        ReaderResult.of<TestDeps, string, number>(5)
      );
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: true, data: 10 });
    });

    it('passes through errors', async () => {
      const rr = ReaderResult.map<TestDeps, string, number, number>((x: number) => x * 2)(
        ReaderResult.fail<TestDeps, string, number>('error')
      );
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: false, error: 'error' });
    });
  });

  describe('mapError', () => {
    it('transforms error values', async () => {
      const rr = ReaderResult.mapError<TestDeps, string, string, number>((e: string) => e.toUpperCase())(
        ReaderResult.fail<TestDeps, string, number>('error')
      );
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: false, error: 'ERROR' });
    });

    it('passes through successful values', async () => {
      const rr = ReaderResult.mapError<TestDeps, string, string, number>((e: string) => e.toUpperCase())(
        ReaderResult.of<TestDeps, string, number>(42)
      );
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: true, data: 42 });
    });
  });

  describe('ask', () => {
    it('returns the dependencies', async () => {
      const rr = ReaderResult.ask<TestDeps, string>();
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: true, data: mockDeps });
    });
  });

  describe('asks', () => {
    it('returns a part of the dependencies', async () => {
      const rr = ReaderResult.asks<TestDeps, string, TestDeps['db']>(
        deps => deps.db
      );
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: true, data: mockDeps.db });
    });
  });

  describe('fromResult', () => {
    it('lifts a successful Result', async () => {
      const rr = ReaderResult.fromResult<TestDeps, string, number>(
        Result.ok(42)
      );
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: true, data: 42 });
    });

    it('lifts a failed Result', async () => {
      const rr = ReaderResult.fromResult<TestDeps, string, number>(
        Result.err('error')
      );
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: false, error: 'error' });
    });
  });

  describe('tryCatch', () => {
    it('wraps successful async operations', async () => {
      const rr = ReaderResult.tryCatch<TestDeps, string, number>(
        () => Promise.resolve(42),
        (error) => String(error)
      );
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: true, data: 42 });
    });

    it('catches exceptions and converts to errors', async () => {
      const rr = ReaderResult.tryCatch<TestDeps, string, number>(
        () => Promise.reject(new Error('async error')),
        (error) => error instanceof Error ? error.message : 'unknown'
      );
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: false, error: 'async error' });
    });

    it('catches non-Error exceptions', async () => {
      const rr = ReaderResult.tryCatch<TestDeps, string, number>(
        () => Promise.reject(new Error('a string error')),
        (error) => error instanceof Error ? error.message : String(error)
      );
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: false, error: 'a string error' });
    });

    it('has access to dependencies', async () => {
      vi.mocked(mockDeps.db.findUser).mockResolvedValue({ id: '1', name: 'John' });
      
      const rr = ReaderResult.tryCatch<TestDeps, string, { id: string; name: string }>(
        async (deps) => {
          const user = await deps.db.findUser('1');
          if (!user) throw new Error('User not found');
          return user;
        },
        (error) => String(error)
      );
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: true, data: { id: '1', name: 'John' } });
      expect(mockDeps.db.findUser).toHaveBeenCalledWith('1');
    });
  });

  describe('zip', () => {
    it('combines two successful ReaderResults', async () => {
      const rr1 = ReaderResult.of<TestDeps, string, number>(5);
      const rr2 = ReaderResult.of<TestDeps, string, string>('hello');
      const zipped = ReaderResult.zip(rr1, rr2);
      
      const result = await ReaderResult.run(mockDeps)(zipped);
      expect(result).toEqual({ success: true, data: [5, 'hello'] });
    });

    it('returns first error when first fails', async () => {
      const rr1 = ReaderResult.fail<TestDeps, string, number>('error1');
      const rr2 = ReaderResult.of<TestDeps, string, string>('hello');
      const zipped = ReaderResult.zip(rr1, rr2);
      
      const result = await ReaderResult.run(mockDeps)(zipped);
      expect(result).toEqual({ success: false, error: 'error1' });
    });

    it('returns second error when second fails', async () => {
      const rr1 = ReaderResult.of<TestDeps, string, number>(5);
      const rr2 = ReaderResult.fail<TestDeps, string, string>('error2');
      const zipped = ReaderResult.zip(rr1, rr2);
      
      const result = await ReaderResult.run(mockDeps)(zipped);
      expect(result).toEqual({ success: false, error: 'error2' });
    });

    it('runs in parallel', async () => {
      const start = Date.now();
      const rr1 = ReaderResult.tryCatch<TestDeps, string, number>(
        async () => { 
          await new Promise(resolve => setTimeout(resolve, 50));
          return 1;
        },
        () => 'error'
      );
      const rr2 = ReaderResult.tryCatch<TestDeps, string, number>(
        async () => { 
          await new Promise(resolve => setTimeout(resolve, 50));
          return 2;
        },
        () => 'error'
      );
      
      const zipped = ReaderResult.zip(rr1, rr2);
      const result = await ReaderResult.run(mockDeps)(zipped);
      const duration = Date.now() - start;
      
      expect(result).toEqual({ success: true, data: [1, 2] });
      expect(duration).toBeLessThan(80); // Should run in parallel, not 100ms+
    });
  });

  describe('sequence', () => {
    it('sequences all successful ReaderResults', async () => {
      const rrs = [
        ReaderResult.of<TestDeps, string, number>(1),
        ReaderResult.of<TestDeps, string, number>(2),
        ReaderResult.of<TestDeps, string, number>(3),
      ];
      const sequenced = ReaderResult.sequence(rrs);
      
      const result = await ReaderResult.run(mockDeps)(sequenced);
      expect(result).toEqual({ success: true, data: [1, 2, 3] });
    });

    it('returns first error on failure', async () => {
      const rrs = [
        ReaderResult.of<TestDeps, string, number>(1),
        ReaderResult.fail<TestDeps, string, number>('error'),
        ReaderResult.of<TestDeps, string, number>(3),
      ];
      const sequenced = ReaderResult.sequence(rrs);
      
      const result = await ReaderResult.run(mockDeps)(sequenced);
      expect(result).toEqual({ success: false, error: 'error' });
    });

    it('works with empty array', async () => {
      const rrs: readonly ReaderResult<TestDeps, string, number>[] = [];
      const sequenced = ReaderResult.sequence(rrs);
      
      const result = await ReaderResult.run(mockDeps)(sequenced);
      expect(result).toEqual({ success: true, data: [] });
    });

    it('runs in sequence, not in parallel', async () => {
      const executionOrder: number[] = [];
      const rrs = [
        ReaderResult.tryCatch<TestDeps, string, number>(async () => {
          await new Promise(res => setTimeout(res, 30));
          executionOrder.push(1);
          return 1;
        }, () => 'error'),
        ReaderResult.tryCatch<TestDeps, string, number>(async () => {
          await new Promise(res => setTimeout(res, 10));
          executionOrder.push(2);
          return 2;
        }, () => 'error'),
      ];
      
      const start = Date.now();
      const sequenced = ReaderResult.sequence(rrs);
      const result = await ReaderResult.run(mockDeps)(sequenced);
      const duration = Date.now() - start;
      
      expect(result.success).toBe(true);
      expect(executionOrder).toEqual([1, 2]); // Confirms order
      expect(duration).toBeGreaterThanOrEqual(40); // Confirms sequential execution (30 + 10)
    });
  });

  describe('Do notation', () => {
    it('builds computations with Do notation', async () => {
      const computation = ReaderResult.map<TestDeps, string, { x: number; y: number; sum: number }, { x: number; y: number; sum: number }>(({ x, y, sum }: { x: number; y: number; sum: number }) => ({ x, y, sum }))(
        ReaderResult.let<TestDeps, string, { x: number; y: number }, 'sum', number>('sum', ({ x, y }: { x: number; y: number }) => x + y)(
          ReaderResult.bind<TestDeps, string, { x: number }, 'y', number>('y', ({ x }: { x: number }) => ReaderResult.of<TestDeps, string, number>(x * 2))(
            ReaderResult.bind<TestDeps, string, {}, 'x', number>('x', () => ReaderResult.of<TestDeps, string, number>(5))(
              ReaderResult.Do<TestDeps, string>()
            )
          )
        )
      );
      
      const result = await ReaderResult.run(mockDeps)(computation);
      expect(result).toEqual({ success: true, data: { x: 5, y: 10, sum: 15 } });
    });

    it('short-circuits on error in Do notation', async () => {
      const computation = ReaderResult.bind<TestDeps, string, { x: number; y: number }, 'z', number>('z', ({ x, y }: { x: number; y: number }) => ReaderResult.of<TestDeps, string, number>(x + y))(
        ReaderResult.bind<TestDeps, string, { x: number }, 'y', number>('y', () => ReaderResult.fail<TestDeps, string, number>('error'))(
          ReaderResult.bind<TestDeps, string, {}, 'x', number>('x', () => ReaderResult.of<TestDeps, string, number>(5))(
            ReaderResult.Do<TestDeps, string>()
          )
        )
      );
      
      const result = await ReaderResult.run(mockDeps)(computation);
      expect(result).toEqual({ success: false, error: 'error' });
    });
  });

  describe('orElse', () => {
    it('returns original value when successful', async () => {
      const rr = ReaderResult.orElse(() => ReaderResult.of<TestDeps, string, number>(0))(
        ReaderResult.of<TestDeps, string, number>(42)
      );
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: true, data: 42 });
    });

    it('uses fallback when original fails', async () => {
      const rr = ReaderResult.orElse(() => ReaderResult.of<TestDeps, string, number>(99))(
        ReaderResult.fail<TestDeps, string, number>('error')
      );
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: true, data: 99 });
    });

    it('can transform error type', async () => {
      const rr = ReaderResult.orElse((error: string) => 
        ReaderResult.fail<TestDeps, Error, number>(new Error(error))
      )(
        ReaderResult.fail<TestDeps, string, number>('string error')
      );
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(Error);
        expect((result.error as Error).message).toBe('string error');
      }
    });

    it('fallback has access to dependencies', async () => {
      const rr = ReaderResult.orElse(() => 
        ReaderResult.asks<TestDeps, string, number>(deps => {
          deps.logger.log('Using fallback');
          return 42;
        })
      )(
        ReaderResult.fail<TestDeps, string, number>('error')
      );
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: true, data: 42 });
      expect(mockDeps.logger.log).toHaveBeenCalledWith('Using fallback');
    });
  });

  describe('timeout', () => {
    it('returns result when computation completes in time', async () => {
      const base = ReaderResult.tryCatch<TestDeps, string, number>(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 42;
        },
        () => 'error'
      );
      const rr = ReaderResult.timeout<TestDeps, string, number>(100, 'timeout')(base);
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: true, data: 42 });
    });

    it('returns timeout error when computation takes too long', async () => {
      const base = ReaderResult.tryCatch<TestDeps, string, number>(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 42;
        },
        () => 'error'
      );
      const rr = ReaderResult.timeout<TestDeps, string, number>(50, 'timeout')(base);
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: false, error: 'timeout' });
    });

    it('propagates immediate errors without timing out', async () => {
      const base = ReaderResult.fail<TestDeps, string, number>('immediate error');
      const rr = ReaderResult.timeout<TestDeps, string, number>(100, 'timeout')(base);
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: false, error: 'immediate error' });
    });
  });

  describe('retry', () => {
    it('returns successful result without retry', async () => {
      let attempts = 0;
      const base = ReaderResult.tryCatch<TestDeps, string, number>(
        () => Promise.resolve().then(() => {
          attempts++;
          return 42;
        }),
        () => 'error'
      );
      const rr = ReaderResult.retry<TestDeps, string, number>(3)(base);
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: true, data: 42 });
      expect(attempts).toBe(1);
    });

    it('retries on failure and eventually succeeds', async () => {
      let attempts = 0;
      const base = ReaderResult.tryCatch<TestDeps, string, number>(
        () => Promise.resolve().then(() => {
          attempts++;
          if (attempts < 3) throw new Error('fail');
          return 42;
        }),
        () => 'error'
      );
      const rr = ReaderResult.retry<TestDeps, string, number>(3, 10)(base);
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: true, data: 42 });
      expect(attempts).toBe(3);
    });

    it('fails after max attempts', async () => {
      let attempts = 0;
      const base = ReaderResult.tryCatch<TestDeps, string, number>(
        () => Promise.resolve().then(() => {
          attempts++;
          throw new Error('fail');
        }),
        () => 'error'
      );
      const rr = ReaderResult.retry<TestDeps, string, number>(3, 10)(base);
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: false, error: 'error' });
      expect(attempts).toBe(3);
    });

    it('uses shouldRetry predicate to allow retries', async () => {
      let attempts = 0;
      const base = ReaderResult.tryCatch<TestDeps, string, number>(
        () => Promise.resolve().then(() => {
          attempts++;
          throw new Error('retry-me');
        }),
        (e) => (e as Error).message
      );
      const rr = ReaderResult.retry<TestDeps, string, number>(3, 10, (error) => error === 'retry-me')(base);
      
      await ReaderResult.run(mockDeps)(rr);
      expect(attempts).toBe(3);
    });

    it('uses shouldRetry predicate to prevent retries', async () => {
      let attempts = 0;
      const base = ReaderResult.tryCatch<TestDeps, string, number>(
        () => Promise.resolve().then(() => {
          attempts++;
          throw new Error('do-not-retry');
        }),
        (e) => (e as Error).message
      );
      const rr = ReaderResult.retry<TestDeps, string, number>(3, 10, (error) => error === 'retry-me')(base);
      
      await ReaderResult.run(mockDeps)(rr);
      expect(attempts).toBe(1);
    });

    it('uses exponential backoff', async () => {
      const delays: number[] = [];
      let lastTime = Date.now();
      
      const base = ReaderResult.tryCatch<TestDeps, string, number>(
        () => Promise.resolve().then(() => {
          const now = Date.now();
          delays.push(now - lastTime);
          lastTime = now;
          throw new Error('fail');
        }),
        () => 'error'
      );
      const rr = ReaderResult.retry<TestDeps, string, number>(3, 10)(base);
      
      await ReaderResult.run(mockDeps)(rr);
      
      // First attempt has no delay, subsequent attempts have exponential delays
      expect(delays.length).toBe(3);
      expect(delays[1]).toBeGreaterThanOrEqual(10);
      expect(delays[1]).toBeLessThan(20);
      expect(delays[2]).toBeGreaterThanOrEqual(20);
      expect(delays[2]).toBeLessThan(40);
    });

    it('fails after a single attempt if maxAttempts is 1', async () => {
      let attempts = 0;
      const base = ReaderResult.tryCatch<TestDeps, string, number>(
        () => Promise.resolve().then(() => {
          attempts++;
          throw new Error('fail');
        }),
        () => 'error'
      );
      const rr = ReaderResult.retry<TestDeps, string, number>(1, 10)(base);
      
      const result = await ReaderResult.run(mockDeps)(rr);
      expect(result).toEqual({ success: false, error: 'error' });
      expect(attempts).toBe(1);
    });
  });

  describe('sequencePar', () => {
    it('sequences all successful ReaderResults in parallel', async () => {
      const start = Date.now();
      const rrs = [
        ReaderResult.tryCatch<TestDeps, string, number>(
          async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
            return 1;
          },
          () => 'error'
        ),
        ReaderResult.tryCatch<TestDeps, string, number>(
          async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
            return 2;
          },
          () => 'error'
        ),
        ReaderResult.tryCatch<TestDeps, string, number>(
          async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
            return 3;
          },
          () => 'error'
        ),
      ];
      
      const sequenced = ReaderResult.sequencePar(rrs);
      const result = await ReaderResult.run(mockDeps)(sequenced);
      const duration = Date.now() - start;
      
      expect(result).toEqual({ success: true, data: [1, 2, 3] });
      expect(duration).toBeLessThan(40); // Should run in parallel
    });

    it('returns first error on failure', async () => {
      const rrs = [
        ReaderResult.of<TestDeps, string, number>(1),
        ReaderResult.fail<TestDeps, string, number>('error'),
        ReaderResult.of<TestDeps, string, number>(3),
      ];
      const sequenced = ReaderResult.sequencePar(rrs);
      
      const result = await ReaderResult.run(mockDeps)(sequenced);
      expect(result).toEqual({ success: false, error: 'error' });
    });

    it('works with an empty array', async () => {
      const rrs: readonly ReaderResult<TestDeps, string, number>[] = [];
      const sequenced = ReaderResult.sequencePar(rrs);
      
      const result = await ReaderResult.run(mockDeps)(sequenced);
      expect(result).toEqual({ success: true, data: [] });
    });
  });

  describe('zipAll', () => {
    it('combines multiple successful ReaderResults', async () => {
      const rr1 = ReaderResult.of<TestDeps, string, number>(1);
      const rr2 = ReaderResult.of<TestDeps, string, string>('hello');
      const rr3 = ReaderResult.of<TestDeps, string, boolean>(true);
      const zipped = (ReaderResult.zipAll as any)(rr1, rr2, rr3);
      
      const result = await ReaderResult.run(mockDeps)(zipped);
      expect(result).toEqual({ success: true, data: [1, 'hello', true] });
    });

    it('returns first error when any fails', async () => {
      const rr1 = ReaderResult.of<TestDeps, string, number>(1);
      const rr2 = ReaderResult.fail<TestDeps, string, string>('error');
      const rr3 = ReaderResult.of<TestDeps, string, boolean>(true);
      const zipped = (ReaderResult.zipAll as any)(rr1, rr2, rr3);
      
      const result = await ReaderResult.run(mockDeps)(zipped);
      expect(result).toEqual({ success: false, error: 'error' });
    });
  });

  describe('parallel', () => {
    it('runs multiple ReaderResults in parallel and collects all results', async () => {
      const rrs = {
        x: ReaderResult.of<TestDeps, string, number>(5),
        y: ReaderResult.of<TestDeps, string, string>('hello'),
        z: ReaderResult.of<TestDeps, string, boolean>(true),
      };
      
      const parallel = (ReaderResult.parallel as any)(rrs);
      const result = await ReaderResult.run(mockDeps)(parallel);
      
      expect(result).toEqual({ 
        success: true, 
        data: { x: 5, y: 'hello', z: true } 
      });
    });

    it('collects all errors instead of short-circuiting', async () => {
      const rrs = {
        x: ReaderResult.of<TestDeps, string, number>(5),
        y: ReaderResult.fail<TestDeps, string, string>('error1'),
        z: ReaderResult.fail<TestDeps, string, boolean>('error2'),
      };
      
      const parallel = (ReaderResult.parallel as any)(rrs);
      const result = await ReaderResult.run(mockDeps)(parallel);
      
      expect(result).toEqual({ 
        success: false, 
        error: [
          { key: 'y', error: 'error1' },
          { key: 'z', error: 'error2' }
        ] 
      });
    });

    it('returns empty object for empty input', async () => {
      const rrs = {};
      
      const parallel = (ReaderResult.parallel as any)(rrs);
      const result = await ReaderResult.run(mockDeps)(parallel);
      
      expect(result).toEqual({ success: true, data: {} });
    });
  });

  describe('liftDomain', () => {
    it('lifts a domain function returning Result', async () => {
      const domainFn = (x: number): Result<number, string> =>
        x > 0 ? Result.ok(x * 2) : Result.err('negative');
      
      const lifted = liftDomain<TestDeps, string, number, [number]>(domainFn);
      
      const rr1 = lifted(5);
      const result1 = await ReaderResult.run(mockDeps)(rr1);
      expect(result1).toEqual({ success: true, data: 10 });
      
      const rr2 = lifted(-5);
      const result2 = await ReaderResult.run(mockDeps)(rr2);
      expect(result2).toEqual({ success: false, error: 'negative' });
    });
  });

  describe('liftAsync', () => {
    it('lifts an async function that uses dependencies', async () => {
      vi.mocked(mockDeps.db.findUser).mockResolvedValue({ id: '1', name: 'John' });
      
      const findUserName = liftAsync<TestDeps, string, string, [string]>(
        async (deps, userId) => {
          const user = await deps.db.findUser(userId);
          if (!user) throw new Error('User not found');
          return user.name;
        },
        (error) => error instanceof Error ? error.message : 'unknown'
      );
      
      const rr = findUserName('1');
      const result = await ReaderResult.run(mockDeps)(rr);
      
      expect(result).toEqual({ success: true, data: 'John' });
      expect(mockDeps.db.findUser).toHaveBeenCalledWith('1');
    });

    it('handles errors from async function', async () => {
      vi.mocked(mockDeps.db.findUser).mockResolvedValue(null);
      
      const findUserName = liftAsync<TestDeps, string, string, [string]>(
        async (deps, userId) => {
          const user = await deps.db.findUser(userId);
          if (!user) throw new Error('User not found');
          return user.name;
        },
        (error) => error instanceof Error ? error.message : 'unknown'
      );
      
      const rr = findUserName('1');
      const result = await ReaderResult.run(mockDeps)(rr);
      
      expect(result).toEqual({ success: false, error: 'User not found' });
    });
  });

  describe('Integration examples', () => {
    it('composes multiple operations with proper error handling', async () => {
      vi.mocked(mockDeps.db.findUser).mockResolvedValue({ id: '1', name: 'John' });
      vi.mocked(mockDeps.db.saveUser).mockResolvedValue(undefined);
      
      const updateUserName = (userId: string, newName: string) => {
        const findUser = ReaderResult.tryCatch<TestDeps, string, { id: string; name: string }>(
          async (deps) => {
            const user = await deps.db.findUser(userId);
            if (!user) throw new Error('User not found');
            return user;
          },
          (error) => error instanceof Error ? error.message : 'unknown'
        );
        
        return ReaderResult.chain((user: { id: string; name: string }) => {
          const saveOp = ReaderResult.tryCatch<TestDeps, string, void>(
            async (deps) => {
              deps.logger.log(`Updating user ${user.id}`);
              await deps.db.saveUser({ ...user, name: newName });
            },
            (error) => error instanceof Error ? error.message : 'unknown'
          );
          return ReaderResult.map<TestDeps, string, void, { id: string; name: string }>(() => ({ ...user, name: newName }))(saveOp);
        })(findUser) as ReaderResult<TestDeps, string, { id: string; name: string }>;
      };
      
      const result = await ReaderResult.run(mockDeps)(updateUserName('1', 'Jane'));
      
      expect(result).toEqual({ success: true, data: { id: '1', name: 'Jane' } });
      expect(mockDeps.logger.log).toHaveBeenCalledWith('Updating user 1');
      expect(mockDeps.db.saveUser).toHaveBeenCalledWith({ id: '1', name: 'Jane' });
    });

    it('handles complex workflows with retry and timeout', async () => {
      let attempts = 0;
      vi.mocked(mockDeps.db.findUser).mockImplementation(() => Promise.resolve().then(() => {
        attempts++;
        if (attempts < 2) throw new Error('Connection error');
        return { id: '1', name: 'John' };
      }));
      
      const findUserWithRetry = (userId: string) => {
        const base = ReaderResult.tryCatch<TestDeps, string, { id: string; name: string }>(
          async (deps) => {
            const user = await deps.db.findUser(userId);
            if (!user) throw new Error('User not found');
            return user;
          },
          (error) => error instanceof Error ? error.message : 'unknown'
        );
        const withRetry = ReaderResult.retry<TestDeps, string, { id: string; name: string }>(3, 10)(base);
        const withTimeout = ReaderResult.timeout<TestDeps, string, { id: string; name: string }>(1000, 'Operation timed out')(withRetry);
        return withTimeout;
      };
      
      const result = await ReaderResult.run(mockDeps)(findUserWithRetry('1'));
      
      expect(result).toEqual({ success: true, data: { id: '1', name: 'John' } });
      expect(attempts).toBe(2);
    });
  });
});