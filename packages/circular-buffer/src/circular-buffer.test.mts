/**
 * Comprehensive unit tests for CircularBuffer utility
 * Tests all methods and edge cases to ensure correctness
 */

import { describe, it, expect } from 'vitest';
import { CircularBuffer } from './circular-buffer.mjs';

describe('CircularBuffer', () => {
  describe('initialization', () => {
    it('should initialize with valid capacity', () => {
      const buffer = new CircularBuffer<number>(5);
      expect(buffer.getCapacity()).toBe(5);
      expect(buffer.length).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
      expect(buffer.isFull()).toBe(false);
    });

    it('should throw error for zero capacity', () => {
      expect(() => new CircularBuffer<number>(0)).toThrow('Capacity must be positive');
    });

    it('should throw error for negative capacity', () => {
      expect(() => new CircularBuffer<number>(-1)).toThrow('Capacity must be positive');
    });
  });

  describe('push operation', () => {
    it('should add elements when not full', () => {
      const buffer = new CircularBuffer<number>(3);
      
      buffer.push(1);
      expect(buffer.length).toBe(1);
      expect(buffer.toArray()).toEqual([1]);
      
      buffer.push(2);
      expect(buffer.length).toBe(2);
      expect(buffer.toArray()).toEqual([1, 2]);
      
      buffer.push(3);
      expect(buffer.length).toBe(3);
      expect(buffer.toArray()).toEqual([1, 2, 3]);
      expect(buffer.isFull()).toBe(true);
    });

    it('should overwrite oldest element when full', () => {
      const buffer = new CircularBuffer<number>(3);
      
      // fill buffer
      buffer.push(1);
      buffer.push(2);
      buffer.push(3);
      
      // overwrite oldest
      buffer.push(4);
      expect(buffer.length).toBe(3);
      expect(buffer.toArray()).toEqual([2, 3, 4]);
      
      buffer.push(5);
      expect(buffer.toArray()).toEqual([3, 4, 5]);
      
      buffer.push(6);
      expect(buffer.toArray()).toEqual([4, 5, 6]);
    });

    it('should handle many overwrites correctly', () => {
      const buffer = new CircularBuffer<number>(2);
      
      for (let i = 1; i <= 10; i++) {
        buffer.push(i);
      }
      
      expect(buffer.length).toBe(2);
      expect(buffer.toArray()).toEqual([9, 10]);
    });
  });

  describe('shift operation', () => {
    it('should return undefined for empty buffer', () => {
      const buffer = new CircularBuffer<number>(3);
      expect(buffer.shift()).toBeUndefined();
      expect(buffer.length).toBe(0);
    });

    it('should remove and return oldest element', () => {
      const buffer = new CircularBuffer<number>(3);
      
      buffer.push(1);
      buffer.push(2);
      buffer.push(3);
      
      expect(buffer.shift()).toBe(1);
      expect(buffer.length).toBe(2);
      expect(buffer.toArray()).toEqual([2, 3]);
      
      expect(buffer.shift()).toBe(2);
      expect(buffer.length).toBe(1);
      expect(buffer.toArray()).toEqual([3]);
      
      expect(buffer.shift()).toBe(3);
      expect(buffer.length).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
    });

    it('should work correctly after wraparound', () => {
      const buffer = new CircularBuffer<number>(3);
      
      // fill and wrap
      buffer.push(1);
      buffer.push(2);
      buffer.push(3);
      buffer.push(4); // overwrites 1
      buffer.push(5); // overwrites 2
      
      expect(buffer.shift()).toBe(3);
      expect(buffer.shift()).toBe(4);
      expect(buffer.shift()).toBe(5);
      expect(buffer.shift()).toBeUndefined();
    });
  });

  describe('peek operations', () => {
    it('should return undefined for empty buffer', () => {
      const buffer = new CircularBuffer<number>(3);
      expect(buffer.peekFirst()).toBeUndefined();
      expect(buffer.peekLast()).toBeUndefined();
    });

    it('should peek first and last without removing', () => {
      const buffer = new CircularBuffer<number>(3);
      
      buffer.push(1);
      expect(buffer.peekFirst()).toBe(1);
      expect(buffer.peekLast()).toBe(1);
      expect(buffer.length).toBe(1);
      
      buffer.push(2);
      expect(buffer.peekFirst()).toBe(1);
      expect(buffer.peekLast()).toBe(2);
      expect(buffer.length).toBe(2);
      
      buffer.push(3);
      expect(buffer.peekFirst()).toBe(1);
      expect(buffer.peekLast()).toBe(3);
      expect(buffer.length).toBe(3);
    });

    it('should peek correctly after wraparound', () => {
      const buffer = new CircularBuffer<number>(3);
      
      buffer.push(1);
      buffer.push(2);
      buffer.push(3);
      buffer.push(4); // overwrites 1
      
      expect(buffer.peekFirst()).toBe(2);
      expect(buffer.peekLast()).toBe(4);
      expect(buffer.toArray()).toEqual([2, 3, 4]);
    });
  });

  describe('toArray operation', () => {
    it('should return empty array for empty buffer', () => {
      const buffer = new CircularBuffer<number>(3);
      expect(buffer.toArray()).toEqual([]);
    });

    it('should return elements in correct order', () => {
      const buffer = new CircularBuffer<number>(3);
      
      buffer.push(1);
      expect(buffer.toArray()).toEqual([1]);
      
      buffer.push(2);
      expect(buffer.toArray()).toEqual([1, 2]);
      
      buffer.push(3);
      expect(buffer.toArray()).toEqual([1, 2, 3]);
    });

    it('should maintain order after wraparound', () => {
      const buffer = new CircularBuffer<number>(3);
      
      buffer.push(1);
      buffer.push(2);
      buffer.push(3);
      buffer.push(4);
      buffer.push(5);
      
      // should have 3, 4, 5 in that order
      const array = buffer.toArray();
      expect(array).toEqual([3, 4, 5]);
      expect(array[0]).toBe(3);
      expect(array[1]).toBe(4);
      expect(array[2]).toBe(5);
    });

    it('should handle complex wraparound scenarios', () => {
      const buffer = new CircularBuffer<number>(4);
      
      // fill buffer
      for (let i = 1; i <= 4; i++) {
        buffer.push(i);
      }
      expect(buffer.toArray()).toEqual([1, 2, 3, 4]);
      
      // wrap once
      buffer.push(5);
      expect(buffer.toArray()).toEqual([2, 3, 4, 5]);
      
      // wrap more
      buffer.push(6);
      buffer.push(7);
      expect(buffer.toArray()).toEqual([4, 5, 6, 7]);
    });
  });

  describe('filter operation', () => {
    it('should filter elements based on predicate', () => {
      const buffer = new CircularBuffer<number>(5);
      
      for (let i = 1; i <= 5; i++) {
        buffer.push(i);
      }
      
      buffer.filter(x => x % 2 === 0);
      expect(buffer.toArray()).toEqual([2, 4]);
      expect(buffer.length).toBe(2);
    });

    it('should handle empty result after filter', () => {
      const buffer = new CircularBuffer<number>(3);
      
      buffer.push(1);
      buffer.push(3);
      buffer.push(5);
      
      buffer.filter(x => x % 2 === 0);
      expect(buffer.toArray()).toEqual([]);
      expect(buffer.isEmpty()).toBe(true);
    });

    it('should maintain capacity after filter', () => {
      const buffer = new CircularBuffer<number>(3);
      
      buffer.push(1);
      buffer.push(2);
      buffer.push(3);
      
      buffer.filter(x => x > 1);
      expect(buffer.getCapacity()).toBe(3);
      expect(buffer.toArray()).toEqual([2, 3]);
      
      // can still push to capacity
      buffer.push(4);
      expect(buffer.toArray()).toEqual([2, 3, 4]);
    });
  });

  describe('clear operation', () => {
    it('should clear all elements', () => {
      const buffer = new CircularBuffer<number>(3);
      
      buffer.push(1);
      buffer.push(2);
      buffer.push(3);
      
      buffer.clear();
      expect(buffer.length).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
      expect(buffer.toArray()).toEqual([]);
    });

    it('should allow reuse after clear', () => {
      const buffer = new CircularBuffer<number>(2);
      
      buffer.push(1);
      buffer.push(2);
      buffer.clear();
      
      buffer.push(3);
      buffer.push(4);
      expect(buffer.toArray()).toEqual([3, 4]);
    });
  });

  describe('state methods', () => {
    it('should correctly report empty state', () => {
      const buffer = new CircularBuffer<number>(3);
      
      expect(buffer.isEmpty()).toBe(true);
      buffer.push(1);
      expect(buffer.isEmpty()).toBe(false);
      buffer.shift();
      expect(buffer.isEmpty()).toBe(true);
    });

    it('should correctly report full state', () => {
      const buffer = new CircularBuffer<number>(2);
      
      expect(buffer.isFull()).toBe(false);
      buffer.push(1);
      expect(buffer.isFull()).toBe(false);
      buffer.push(2);
      expect(buffer.isFull()).toBe(true);
      buffer.push(3); // overwrites
      expect(buffer.isFull()).toBe(true);
      buffer.shift();
      expect(buffer.isFull()).toBe(false);
    });

    it('should maintain correct length', () => {
      const buffer = new CircularBuffer<number>(3);
      
      expect(buffer.length).toBe(0);
      buffer.push(1);
      expect(buffer.length).toBe(1);
      buffer.push(2);
      expect(buffer.length).toBe(2);
      buffer.push(3);
      expect(buffer.length).toBe(3);
      buffer.push(4); // overwrites
      expect(buffer.length).toBe(3);
      buffer.shift();
      expect(buffer.length).toBe(2);
      buffer.clear();
      expect(buffer.length).toBe(0);
    });
  });

  describe('type safety', () => {
    it('should work with different types', () => {
      const stringBuffer = new CircularBuffer<string>(2);
      stringBuffer.push('hello');
      stringBuffer.push('world');
      expect(stringBuffer.toArray()).toEqual(['hello', 'world']);
      
      const objectBuffer = new CircularBuffer<{ id: number }>(2);
      objectBuffer.push({ id: 1 });
      objectBuffer.push({ id: 2 });
      expect(objectBuffer.toArray()).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should handle undefined values correctly', () => {
      const buffer = new CircularBuffer<number | undefined>(3);
      buffer.push(1);
      buffer.push(undefined);
      buffer.push(3);
      // toArray filters out undefined values
      expect(buffer.toArray()).toEqual([1, 3]);
      expect(buffer.length).toBe(3); // but length still counts them
    });
  });

  describe('edge cases', () => {
    it('should handle single capacity buffer', () => {
      const buffer = new CircularBuffer<number>(1);
      
      buffer.push(1);
      expect(buffer.toArray()).toEqual([1]);
      
      buffer.push(2);
      expect(buffer.toArray()).toEqual([2]);
      
      expect(buffer.shift()).toBe(2);
      expect(buffer.isEmpty()).toBe(true);
    });

    it('should handle alternating push and shift', () => {
      const buffer = new CircularBuffer<number>(3);
      
      buffer.push(1);
      buffer.push(2);
      expect(buffer.shift()).toBe(1);
      buffer.push(3);
      buffer.push(4);
      expect(buffer.shift()).toBe(2);
      expect(buffer.shift()).toBe(3);
      buffer.push(5);
      expect(buffer.toArray()).toEqual([4, 5]);
    });

    it('should handle large capacity', () => {
      const buffer = new CircularBuffer<number>(1000);
      
      for (let i = 0; i < 1000; i++) {
        buffer.push(i);
      }
      expect(buffer.length).toBe(1000);
      expect(buffer.isFull()).toBe(true);
      
      buffer.push(1000);
      expect(buffer.peekFirst()).toBe(1);
      expect(buffer.peekLast()).toBe(1000);
    });
  });
});