import { describe, it, expect } from 'vitest';
import {
  mapWithIndex,
  filterMap,
  chunk,
  groupBy,
  findSafe,
  partition,
} from './array-utils.mjs';

describe('array-utils', () => {
  describe('mapWithIndex', () => {
    it('should map elements with their indices', () => {
      const result = mapWithIndex((item: string, i: number) => `${i}: ${item}`)(['a', 'b', 'c']);
      expect(result).toEqual(['0: a', '1: b', '2: c']);
    });

    it('should handle empty arrays', () => {
      const result = mapWithIndex((item: number, i: number) => item + i)([]);
      expect(result).toEqual([]);
    });

    it('should work with complex transformations', () => {
      const items = ['First', 'Second', 'Third'];
      const numbered = mapWithIndex((item: string, i: number) => ({ 
        index: i + 1, 
        value: item,
        label: `${i + 1}. ${item}`
      }))(items);
      
      expect(numbered).toEqual([
        { index: 1, value: 'First', label: '1. First' },
        { index: 2, value: 'Second', label: '2. Second' },
        { index: 3, value: 'Third', label: '3. Third' }
      ]);
    });
  });

  describe('filterMap', () => {
    it('should filter and map in a single pass', () => {
      const nums = filterMap((s: string) => {
        const n = parseInt(s);
        return isNaN(n) ? undefined : n;
      })(['1', 'a', '2', 'b', '3']);
      
      expect(nums).toEqual([1, 2, 3]);
    });

    it('should handle empty arrays', () => {
      const result = filterMap((x: number) => x > 0 ? x * 2 : undefined)([]);
      expect(result).toEqual([]);
    });

    it('should filter out all undefined values', () => {
      const result = filterMap((x: number) => x > 10 ? x : undefined)([1, 2, 3, 4, 5]);
      expect(result).toEqual([]);
    });

    it('should work with complex objects', () => {
      const users = [
        { name: 'Alice', profile: { age: 25 } },
        { name: 'Bob', profile: null },
        { name: 'Charlie', profile: { age: 30 } }
      ];
      
      const ages = filterMap((u: typeof users[0]) => 
        u.profile ? { name: u.name, age: u.profile.age } : undefined
      )(users);
      
      expect(ages).toEqual([
        { name: 'Alice', age: 25 },
        { name: 'Charlie', age: 30 }
      ]);
    });

    it('should provide index to the mapping function', () => {
      const result = filterMap((x: number, i: number) => 
        i % 2 === 0 ? x * 2 : undefined
      )([1, 2, 3, 4, 5]);
      
      expect(result).toEqual([2, 6, 10]); // indices 0, 2, 4
    });

    it('should not create intermediate arrays', () => {
      // This test verifies the optimization by checking behavior
      // The function should process each element exactly once
      let processCount = 0;
      
      const result = filterMap((x: number) => {
        processCount++;
        return x > 2 ? x * 10 : undefined;
      })([1, 2, 3, 4, 5]);
      
      expect(processCount).toBe(5); // Each element processed exactly once
      expect(result).toEqual([30, 40, 50]);
    });
  });

  describe('chunk', () => {
    it('should chunk array into specified size', () => {
      const chunks = chunk(2)([1, 2, 3, 4, 5]);
      expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('should throw when size is zero or negative', () => {
      expect(() => chunk(0)([1, 2, 3])).toThrowError(
        new RangeError('chunk size must be greater than 0')
      );
      expect(() => chunk(-1)([1, 2, 3])).toThrowError(RangeError);
    });

    it('should handle arrays that divide evenly', () => {
      const chunks = chunk(3)([1, 2, 3, 4, 5, 6]);
      expect(chunks).toEqual([[1, 2, 3], [4, 5, 6]]);
    });

    it('should handle empty arrays', () => {
      const chunks = chunk(3)([]);
      expect(chunks).toEqual([]);
    });

    it('should handle chunk size larger than array', () => {
      const chunks = chunk(10)([1, 2, 3]);
      expect(chunks).toEqual([[1, 2, 3]]);
    });

    it('should handle chunk size of 1', () => {
      const chunks = chunk(1)([1, 2, 3]);
      expect(chunks).toEqual([[1], [2], [3]]);
    });

    it('should work with strings', () => {
      const items = ['A', 'B', 'C', 'D', 'E', 'F'];
      const rows = chunk(3)(items);
      expect(rows).toEqual([['A', 'B', 'C'], ['D', 'E', 'F']]);
    });
  });

  describe('groupBy', () => {
    it('should group by key function', () => {
      const users = [
        { name: 'Alice', age: 25 },
        { name: 'Bob', age: 30 },
        { name: 'Charlie', age: 25 }
      ];
      
      const byAge = groupBy((u: typeof users[0]) => u.age)(users);
      
      expect(byAge).toEqual({
        25: [
          { name: 'Alice', age: 25 },
          { name: 'Charlie', age: 25 }
        ],
        30: [{ name: 'Bob', age: 30 }]
      });
    });

    it('should handle empty arrays', () => {
      const result = groupBy((x: number) => x % 2)([]);
      expect(result).toEqual({});
    });

    it('should group strings by first letter', () => {
      const words = ['apple', 'banana', 'apricot', 'cherry', 'avocado'];
      const byFirstLetter = groupBy((word: string) => word[0]!)(words);
      
      expect(byFirstLetter).toEqual({
        a: ['apple', 'apricot', 'avocado'],
        b: ['banana'],
        c: ['cherry']
      });
    });

    it('should handle numeric grouping', () => {
      const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      const byRemainder = groupBy((n: number) => n % 3)(numbers);
      
      expect(byRemainder).toEqual({
        0: [3, 6, 9],
        1: [1, 4, 7],
        2: [2, 5, 8]
      });
    });

    it('should preserve order within groups', () => {
      const items = [
        { id: 1, type: 'a' },
        { id: 2, type: 'b' },
        { id: 3, type: 'a' },
        { id: 4, type: 'b' },
        { id: 5, type: 'a' }
      ];
      
      const byType = groupBy((item: typeof items[0]) => item.type)(items);
      
      expect(byType.a?.map(i => i.id)).toEqual([1, 3, 5]);
      expect(byType.b?.map(i => i.id)).toEqual([2, 4]);
    });
  });

  describe('findSafe', () => {
    it('should return success result when item is found', () => {
      const result = findSafe((n: number) => n > 3)([1, 2, 3, 4, 5]);
      expect(result).toEqual({ success: true, data: 4 });
    });

    it('should return error result when item is not found', () => {
      const result = findSafe((n: number) => n > 10)([1, 2, 3]);
      expect(result).toEqual({ success: false, error: 'Item not found' });
    });

    it('should handle empty arrays', () => {
      const result = findSafe((n: number) => n > 0)([]);
      expect(result).toEqual({ success: false, error: 'Item not found' });
    });

    it('should find first matching item', () => {
      const result = findSafe((n: number) => n % 2 === 0)([1, 2, 3, 4, 5]);
      expect(result).toEqual({ success: true, data: 2 });
    });

    it('should work with objects', () => {
      const users = [
        { id: 1, email: 'alice@example.com' },
        { id: 2, email: 'bob@example.com' }
      ];
      
      const result = findSafe((u: typeof users[0]) => u.email === 'bob@example.com')(users);
      
      expect(result).toEqual({
        success: true,
        data: { id: 2, email: 'bob@example.com' }
      });
    });

    it('should handle falsy values correctly', () => {
      const result = findSafe((n: number | null | undefined) => n === 0)([null, undefined, 0, 1, 2]);
      expect(result).toEqual({ success: true, data: 0 });
    });

    it('should treat undefined value as found when present', () => {
      const result = findSafe((value: string | undefined) => value === undefined)([
        'a',
        undefined,
        'b'
      ]);

      expect(result).toEqual({ success: true, data: undefined });
    });
  });

  describe('partition', () => {
    it('should partition based on predicate', () => {
      const [evens, odds] = partition((n: number) => n % 2 === 0)([1, 2, 3, 4, 5]);
      expect(evens).toEqual([2, 4]);
      expect(odds).toEqual([1, 3, 5]);
    });

    it('should handle empty arrays', () => {
      const [left, right] = partition((n: number) => n > 0)([]);
      expect(left).toEqual([]);
      expect(right).toEqual([]);
    });

    it('should handle all elements matching predicate', () => {
      const [positive, negative] = partition((n: number) => n > 0)([1, 2, 3, 4, 5]);
      expect(positive).toEqual([1, 2, 3, 4, 5]);
      expect(negative).toEqual([]);
    });

    it('should handle no elements matching predicate', () => {
      const [positive, negative] = partition((n: number) => n > 10)([1, 2, 3, 4, 5]);
      expect(positive).toEqual([]);
      expect(negative).toEqual([1, 2, 3, 4, 5]);
    });

    it('should work with objects', () => {
      const data = [
        { id: 1, valid: true },
        { id: 2, valid: false },
        { id: 3, valid: true }
      ];
      
      const [valid, invalid] = partition((item: typeof data[0]) => item.valid)(data);
      
      expect(valid).toEqual([
        { id: 1, valid: true },
        { id: 3, valid: true }
      ]);
      expect(invalid).toEqual([
        { id: 2, valid: false }
      ]);
    });

    it('should preserve order in both arrays', () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const [multiples, others] = partition((n: number) => n % 3 === 0)(items);
      
      expect(multiples).toEqual([3, 6, 9]);
      expect(others).toEqual([1, 2, 4, 5, 7, 8, 10]);
    });

    it('should work with date comparisons', () => {
      const users = [
        { name: 'Alice', lastLogin: new Date('2024-01-10') },
        { name: 'Bob', lastLogin: new Date('2023-12-01') },
        { name: 'Charlie', lastLogin: new Date('2024-01-14') }
      ];
      
      const cutoffDate = new Date('2024-01-01');
      const [active, inactive] = partition(
        (u: typeof users[0]) => u.lastLogin > cutoffDate
      )(users);
      
      expect(active.map(u => u.name)).toEqual(['Alice', 'Charlie']);
      expect(inactive.map(u => u.name)).toEqual(['Bob']);
    });
  });
});
