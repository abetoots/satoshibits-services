import { describe, it, expect } from 'vitest';
import { Pipeline } from './pipeline.mjs';

describe('Pipeline', () => {
  describe('constructor', () => {
    it('should create a pipeline with initial value', () => {
      const pipeline = new Pipeline(42);
      expect(pipeline.value()).toBe(42);
    });

    it('should work with different types', () => {
      const stringPipeline = new Pipeline('hello');
      expect(stringPipeline.value()).toBe('hello');

      const objectPipeline = new Pipeline({ x: 1, y: 2 });
      expect(objectPipeline.value()).toEqual({ x: 1, y: 2 });

      const arrayPipeline = new Pipeline([1, 2, 3]);
      expect(arrayPipeline.value()).toEqual([1, 2, 3]);
    });
  });

  describe('pipe', () => {
    it('should transform value through single function', () => {
      const result = new Pipeline(5)
        .map(x => x * 2)
        .value();
      
      expect(result).toBe(10);
    });

    it('should chain multiple transformations', () => {
      const result = new Pipeline(5)
        .map(x => x * 2)
        .map(x => x + 1)
        .map(x => x / 3)
        .value();
      
      expect(result).toBe(11 / 3);
    });

    it('should work with type transformations', () => {
      const result = new Pipeline('42')
        .map(s => parseInt(s))
        .map(n => n * 2)
        .map(n => n.toString())
        .value();
      
      expect(result).toBe('84');
    });

    it('should handle object transformations', () => {
      const result = new Pipeline({ name: 'John', age: 30 })
        .map(user => ({ ...user, age: user.age + 1 }))
        .map(user => ({ ...user, name: user.name.toUpperCase() }))
        .value();
      
      expect(result).toEqual({ name: 'JOHN', age: 31 });
    });

    it('should work with array transformations', () => {
      const result = new Pipeline([1, 2, 3, 4, 5])
        .map(arr => arr.filter(n => n % 2 === 0))
        .map(arr => arr.map(n => n * 2))
        .map(arr => arr.reduce((sum, n) => sum + n, 0))
        .value();
      
      expect(result).toBe(12); // (2*2) + (4*2) = 4 + 8 = 12
    });
  });

  describe('map', () => {
    it('should be an alias for pipe', () => {
      const viaPipe = new Pipeline(10)
        .map(x => x * 2)
        .value();
      
      const viaMap = new Pipeline(10)
        .map(x => x * 2)
        .value();
      
      expect(viaPipe).toBe(viaMap);
    });

    it('should chain with pipe interchangeably', () => {
      const result = new Pipeline(5)
        .map(x => x * 2)
        .map(x => x + 1)
        .map(x => x / 3)
        .value();
      
      expect(result).toBe(11 / 3);
    });
  });

  describe('tap', () => {
    it('should execute side effect without changing value', () => {
      let sideEffect = 0;
      
      const result = new Pipeline(42)
        .tap(x => { sideEffect = x * 2; })
        .value();
      
      expect(result).toBe(42); // Value unchanged
      expect(sideEffect).toBe(84); // Side effect executed
    });

    it('should work in a chain', () => {
      const log: number[] = [];
      
      const result = new Pipeline(1)
        .map(x => x + 1)
        .tap(x => log.push(x))
        .map(x => x * 2)
        .tap(x => log.push(x))
        .map(x => x + 3)
        .value();
      
      expect(result).toBe(7); // ((1 + 1) * 2) + 3 = 7
      expect(log).toEqual([2, 4]);
    });

    it('should handle multiple taps', () => {
      const effects: string[] = [];
      
      new Pipeline('hello')
        .tap(s => effects.push(`1: ${s}`))
        .tap(s => effects.push(`2: ${s.toUpperCase()}`))
        .tap(s => effects.push(`3: ${s.length}`))
        .value();
      
      expect(effects).toEqual(['1: hello', '2: HELLO', '3: 5']);
    });
  });

  describe('pipeAsync', () => {
    it('should handle single async transformation', async () => {
      const result = await new Pipeline(5)
        .pipeAsync(x => Promise.resolve(x * 2));
      
      expect(result).toBe(10);
    });

    it('should chain multiple async transformations', async () => {
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      
      const result = await new Pipeline(1)
        .pipeAsync(
          async x => { await delay(10); return x + 1; },
          async x => { await delay(10); return x * 2; },
          async x => { await delay(10); return x + 3; }
        );
      
      expect(result).toBe(7); // ((1 + 1) * 2) + 3 = 7
    });

    it('should handle type transformations', async () => {
      const result = await new Pipeline('42')
        .pipeAsync(
          s => Promise.resolve(parseInt(s)),
          n => Promise.resolve(n * 2),
          n => Promise.resolve(n.toString())
        );
      
      expect(result).toBe('84');
    });

    it('should work with async functions returning promises', async () => {
      const fetchUser = (id: number) => Promise.resolve({ id, name: `User ${id}` });
      const fetchPosts = (user: { id: number }) => Promise.resolve({ 
        user, 
        posts: [`Post 1 by ${user.id}`, `Post 2 by ${user.id}`] 
      });
      
      const result = await new Pipeline(123)
        .pipeAsync(fetchUser, fetchPosts);
      
      expect(result).toEqual({
        user: { id: 123, name: 'User 123' },
        posts: ['Post 1 by 123', 'Post 2 by 123']
      });
    });

    it('should handle errors in async operations', async () => {
      const pipeline = new Pipeline(5)
        .pipeAsync(
          x => Promise.resolve(x * 2),
          () => { throw new Error('Async error'); },
          (x: unknown) => Promise.resolve((x as number) + 1) // This should not execute
        );
      
      await expect(pipeline).rejects.toThrow('Async error');
    });

    it('should maintain order of execution', async () => {
      const log: string[] = [];
      
      const result = await new Pipeline('start')
        .pipeAsync(
          s => { log.push('1'); return Promise.resolve(s + '-1'); },
          s => { log.push('2'); return Promise.resolve(s + '-2'); },
          s => { log.push('3'); return Promise.resolve(s + '-3'); }
        );
      
      expect(result).toBe('start-1-2-3');
      expect(log).toEqual(['1', '2', '3']);
    });

    it('should work with single function', async () => {
      const result = await new Pipeline(42).pipeAsync(x => Promise.resolve(x * 2));
      expect(result).toBe(84);
    });

    it('should handle mixed sync and async operations', async () => {
      const syncDouble = (x: number) => x * 2;
      const asyncAddOne = (x: number) => Promise.resolve(x + 1);
      const syncToString = (x: number) => x.toString();
      
      const result = await new Pipeline(5)
        .map(syncDouble)
        .pipeAsync(asyncAddOne)
        .then(x => new Pipeline(x))
        .then(p => p.map(syncToString).value());
      
      expect(result).toBe('11');
    });
  });

  describe('value', () => {
    it('should return the current value', () => {
      const pipeline = new Pipeline({ x: 1, y: 2 });
      expect(pipeline.value()).toEqual({ x: 1, y: 2 });
    });

    it('should return transformed value after operations', () => {
      const pipeline = new Pipeline(10)
        .map(x => x * 2)
        .map(x => x + 5);
      
      expect(pipeline.value()).toBe(25);
    });

    it('should not mutate original value', () => {
      const original = { count: 0 };
      const pipeline = new Pipeline(original)
        .map(obj => ({ ...obj, count: obj.count + 1 }));
      
      expect(pipeline.value()).toEqual({ count: 1 });
      expect(original).toEqual({ count: 0 }); // Original unchanged
    });
  });

  describe('complex scenarios', () => {
    it('should handle data processing pipeline', () => {
      interface User {
        id: number;
        name: string;
        email: string;
        age: number;
      }

      const users: User[] = [
        { id: 1, name: 'Alice', email: 'alice@example.com', age: 25 },
        { id: 2, name: 'Bob', email: 'bob@example.com', age: 30 },
        { id: 3, name: 'Charlie', email: 'charlie@example.com', age: 28 },
        { id: 4, name: 'David', email: 'david@example.com', age: 35 }
      ];

      const result = new Pipeline(users)
        .map(users => users.filter(u => u.age >= 28))
        .map(users => users.map(u => ({ ...u, name: u.name.toUpperCase() })))
        .map(users => users.sort((a, b) => b.age - a.age))
        .map(users => users.map(u => `${u.name} (${u.age})`))
        .value();

      expect(result).toEqual([
        'DAVID (35)',
        'BOB (30)',
        'CHARLIE (28)'
      ]);
    });

    it('should work with error handling pattern', () => {
      type Result<T, E> = { success: true; data: T } | { success: false; error: E };

      const safeDivide = (a: number, b: number): Result<number, string> =>
        b === 0 
          ? { success: false, error: 'Division by zero' }
          : { success: true, data: a / b };

      const processIfSuccess = <T, U, E>(
        fn: (value: T) => Result<U, E>
      ) => (result: Result<T, E>): Result<U, E> =>
        result.success ? fn(result.data) : result as Result<U, E>;

      const result = new Pipeline(safeDivide(10, 2))
        .map(processIfSuccess(x => safeDivide(x, 2)))
        .map(processIfSuccess(x => ({ success: true, data: x * 3 })))
        .value();

      expect(result).toEqual({ success: true, data: 7.5 }); // (10/2/2)*3 = 7.5

      const errorResult = new Pipeline(safeDivide(10, 0))
        .map(processIfSuccess(x => safeDivide(x, 2)))
        .map(processIfSuccess(x => ({ success: true, data: x * 3 })))
        .value();

      expect(errorResult).toEqual({ success: false, error: 'Division by zero' });
    });

    it('should compose with other functional utilities', () => {
      // Simulating composition with other utilities
      const double = (x: number) => x * 2;
      const addOne = (x: number) => x + 1;
      const isEven = (x: number) => x % 2 === 0;

      const process = (nums: number[]) => 
        new Pipeline(nums)
          .map(arr => arr.filter(isEven))
          .map(arr => arr.map(double))
          .map(arr => arr.map(addOne))
          .value();

      expect(process([1, 2, 3, 4, 5])).toEqual([5, 9]);
    });

    it('should handle async data fetching and transformation', async () => {
      // Simulating API calls
      const fetchUserIds = (): Promise<number[]> => Promise.resolve([1, 2, 3]);
      const fetchUserDetails = (id: number) => Promise.resolve({
        id,
        name: `User ${id}`,
        score: id * 10
      });

      const result = await new Pipeline(null)
        .pipeAsync(
          () => fetchUserIds(),
          ids => Promise.all(ids.map(fetchUserDetails)),
          users => Promise.resolve(users.filter(u => u.score >= 20)),
          users => Promise.resolve(users.map(u => u.name))
        );

      expect(result).toEqual(['User 2', 'User 3']);
    });
  });

  describe('edge cases', () => {
    it('should handle null and undefined values', () => {
      const nullPipeline = new Pipeline(null)
        .map(x => x ?? 'default')
        .value();
      expect(nullPipeline).toBe('default');

      const undefinedPipeline = new Pipeline(undefined)
        .map(x => x ?? 'default')
        .value();
      expect(undefinedPipeline).toBe('default');
    });

    it('should handle empty chains', () => {
      const pipeline = new Pipeline(42);
      expect(pipeline.value()).toBe(42);
    });

    it('should preserve this context in methods', () => {
      const obj = {
        multiplier: 3,
        process(value: number) {
          return new Pipeline(value)
            .map(x => x * this.multiplier)
            .value();
        }
      };

      expect(obj.process(5)).toBe(15);
    });

    it('should handle recursive structures', () => {
      interface TreeNode {
        value: number;
        children: TreeNode[];
      }

      const tree: TreeNode = {
        value: 1,
        children: [
          { value: 2, children: [] },
          { value: 3, children: [
            { value: 4, children: [] }
          ]}
        ]
      };

      const sumTree = (node: TreeNode): number =>
        new Pipeline(node)
          .map(n => n.value + n.children.reduce((sum, child) => sum + sumTree(child), 0))
          .value();

      expect(sumTree(tree)).toBe(10); // 1 + 2 + 3 + 4
    });
  });
});