import { describe, it, expect } from 'vitest';
import { mapValues, pick, omit, merge } from './object-utils.mjs';

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

describe('object-utils', () => {
  describe('mapValues', () => {
    it('should map over object values', () => {
      const doubled = mapValues((n: number) => n * 2)({ a: 1, b: 2, c: 3 });
      expect(doubled).toEqual({ a: 2, b: 4, c: 6 });
    });

    it('should handle empty objects', () => {
      const result = mapValues((n: number) => n * 2)({});
      expect(result).toEqual({});
    });

    it('should work with string transformations', () => {
      const config = { host: 'localhost', env: 'dev', mode: 'debug' };
      const upperConfig = mapValues((s: string) => s.toUpperCase())(config);
      expect(upperConfig).toEqual({ host: 'LOCALHOST', env: 'DEV', mode: 'DEBUG' });
    });

    it('should handle type transformations', () => {
      const scores = { math: 85, science: 92, history: 78 };
      const percentages = mapValues((score: number) => `${score}%`)(scores);
      expect(percentages).toEqual({ math: '85%', science: '92%', history: '78%' });
    });

    it('should preserve keys exactly', () => {
      const input = { 'key-with-dash': 1, 'key.with.dot': 2, 'key with space': 3 };
      const result = mapValues((n: number) => n * 10)(input);
      expect(result).toEqual({ 
        'key-with-dash': 10, 
        'key.with.dot': 20, 
        'key with space': 30 
      });
    });

    it('should handle complex transformations', () => {
      const users = {
        alice: { age: 25, role: 'admin' },
        bob: { age: 30, role: 'user' },
      };
      const summaries = mapValues((user: { age: number; role: string }) => 
        `${user.role} (${user.age} years old)`
      )(users);
      expect(summaries).toEqual({
        alice: 'admin (25 years old)',
        bob: 'user (30 years old)',
      });
    });

    it('should handle undefined values', () => {
      const input = { a: 1, b: undefined, c: 3 };
      const result = mapValues((n: number | undefined) => n ?? 0)(input);
      expect(result).toEqual({ a: 1, b: 0, c: 3 });
    });
  });

  describe('pick', () => {
    it('should pick specified keys', () => {
      const user = { id: 1, name: 'Alice', email: 'alice@example.com', password: 'secret' };
      const publicData = pick<typeof user, 'id' | 'name' | 'email'>(['id', 'name', 'email'])(user);
      expect(publicData).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    });

    it('should handle empty key array', () => {
      const user = { id: 1, name: 'Alice' };
      const result = pick<typeof user, never>([])(user);
      expect(result).toEqual({});
    });

    it('should ignore non-existent keys', () => {
      const user = { id: 1, name: 'Alice' };
      const result = pick<typeof user, 'id' | 'name'>(['id', 'name'])(user);
      expect(result).toEqual({ id: 1, name: 'Alice' });
    });

    it('should preserve property types', () => {
      const data = {
        str: 'hello',
        num: 42,
        bool: true,
        obj: { nested: 'value' },
        arr: [1, 2, 3],
      };
      const picked = pick<typeof data, 'str' | 'num' | 'obj'>(['str', 'num', 'obj'])(data);
      expect(picked).toEqual({
        str: 'hello',
        num: 42,
        obj: { nested: 'value' },
      });
      expect(Array.isArray(picked.obj)).toBe(false);
    });

    it('should work with nested objects', () => {
      const config = {
        apiUrl: 'https://api.example.com',
        apiKey: 'secret-key',
        timeout: 5000,
        debug: true,
        version: '1.0.0'
      };
      const clientConfig = pick<typeof config, 'apiUrl' | 'timeout'>(['apiUrl', 'timeout'])(config);
      expect(clientConfig).toEqual({ 
        apiUrl: 'https://api.example.com', 
        timeout: 5000 
      });
    });

    it('should handle duplicate keys', () => {
      const obj = { a: 1, b: 2, c: 3 };
      const result = pick<typeof obj, 'a' | 'b'>(['a', 'b', 'a'])(obj);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should maintain key order', () => {
      const obj = { c: 3, a: 1, b: 2 };
      const result = pick<typeof obj, 'a' | 'b' | 'c'>(['a', 'b', 'c'])(obj);
      const keys = Object.keys(result);
      expect(keys).toEqual(['a', 'b', 'c']);
    });
  });

  describe('omit', () => {
    it('should omit specified keys', () => {
      const user = { id: 1, name: 'Alice', email: 'alice@example.com', password: 'secret' };
      const safeUser = omit<typeof user, 'password'>(['password'])(user);
      expect(safeUser).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    });

    it('should handle empty key array', () => {
      const user = { id: 1, name: 'Alice' };
      const result = omit<typeof user, never>([])(user);
      expect(result).toEqual({ id: 1, name: 'Alice' });
    });

    it('should ignore non-existent keys', () => {
      const user = { id: 1, name: 'Alice' };
      const result = omit<typeof user, 'id'>([])(user);
      expect(result).toEqual({ id: 1, name: 'Alice' });
    });

    it('should remove internal fields', () => {
      const data = {
        value: 42,
        label: 'Answer',
        _internal: true,
        _timestamp: Date.now()
      };
      const publicData = omit<typeof data, '_internal' | '_timestamp'>(['_internal', '_timestamp'])(data);
      expect(publicData).toEqual({ value: 42, label: 'Answer' });
    });

    it('should work with multiple keys', () => {
      const entity = {
        id: '123',
        name: 'Updated Name',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-15',
        deletedAt: null,
      };
      const updatePayload = omit<typeof entity, 'id' | 'createdAt' | 'deletedAt'>(['id', 'createdAt', 'deletedAt'])(entity);
      expect(updatePayload).toEqual({ 
        name: 'Updated Name', 
        updatedAt: '2024-01-15' 
      });
    });

    it('should handle duplicate keys', () => {
      const obj = { a: 1, b: 2, c: 3 };
      const result = omit<typeof obj, 'a' | 'b'>(['a', 'b', 'a'])(obj);
      expect(result).toEqual({ c: 3 });
    });

    it('should create a new object', () => {
      const original = { a: 1, b: 2 };
      const result = omit<typeof original, 'a'>(['a'])(original);
      expect(result).not.toBe(original);
      expect(original).toEqual({ a: 1, b: 2 }); // original unchanged
    });
  });

  describe('merge', () => {
    it('should merge two objects', () => {
      const base = { a: 1, b: { x: 2, y: 3 }, c: 4 };
      const updates = { b: { y: 5, z: 6 }, d: 7 };
      const merged = merge(base, updates);
      expect(merged).toEqual({ a: 1, b: { x: 2, y: 5, z: 6 }, c: 4, d: 7 });
    });

    it('should handle empty objects', () => {
      const base = { a: 1, b: 2 };
      expect(merge(base, {})).toEqual({ a: 1, b: 2 });
      expect(merge({}, base)).toEqual({ a: 1, b: 2 });
    });

    it('should handle null values', () => {
      const base = { a: { b: 2 }, c: 3 };
      const updates = { a: null, c: null };
      const merged = merge(base, updates);
      expect(merged).toEqual({ a: null, c: null });
    });

    it('should replace arrays, not merge them', () => {
      const base = { arr: [1, 2, 3], other: 'value' };
      const updates = { arr: [4, 5] };
      const merged = merge(base, updates);
      expect(merged).toEqual({ arr: [4, 5], other: 'value' });
    });

    it('should ignore undefined values in source', () => {
      const base = { a: 1, b: 2, c: 3 };
      const updates = { a: undefined, b: 4, d: undefined };
      const merged = merge(base, updates);
      expect(merged).toEqual({ a: 1, b: 4, c: 3 });
    });

    it('should handle deep nesting', () => {
      const defaults = {
        server: { port: 3000, host: 'localhost' },
        database: { pool: { min: 2, max: 10 } },
        logging: { level: 'info' }
      };
      const userConfig = {
        server: { port: 8080 },
        database: { pool: { max: 20 } }
      } as DeepPartial<typeof defaults>;
      const finalConfig = merge(defaults, userConfig);
      expect(finalConfig).toEqual({
        server: { port: 8080, host: 'localhost' },
        database: { pool: { min: 2, max: 20 } },
        logging: { level: 'info' }
      });
    });

    it('should handle nested state updates', () => {
      const state = {
        user: { id: 1, preferences: { theme: 'light', lang: 'en' } },
        app: { version: '1.0.0' }
      };
      const updates = {
        user: { preferences: { theme: 'dark' } }
      } as DeepPartial<typeof state>;
      const newState = merge(state, updates);
      expect(newState).toEqual({
        user: { id: 1, preferences: { theme: 'dark', lang: 'en' } },
        app: { version: '1.0.0' }
      });
    });

    it('should create new objects during merge', () => {
      const base = { a: { b: 1 } };
      const updates = { a: { c: 2 } } as DeepPartial<typeof base> & { a: { c: number } };
      const merged = merge(base, updates);
      
      // Verify immutability
      expect(merged).not.toBe(base);
      expect(merged.a).not.toBe(base.a);
      expect(base.a).toEqual({ b: 1 }); // original unchanged
    });

    it('should handle missing nested objects', () => {
      const base = { a: 1 };
      const updates = { b: { c: { d: 2 } } } as DeepPartial<typeof base> & { b: { c: { d: number } } };
      const merged = merge(base, updates);
      expect(merged).toEqual({ a: 1, b: { c: { d: 2 } } });
    });

    it('should handle Date objects', () => {
      const date1 = new Date('2024-01-01');
      const date2 = new Date('2024-02-01');
      const base = { date: date1, other: 'value' };
      const updates = { date: date2 };
      const merged = merge(base, updates);
      expect(merged).toEqual({ date: date2, other: 'value' });
      expect(merged.date).toBe(date2); // Date replaced, not merged
    });

    it('should handle complex nested structures', () => {
      const base = {
        level1: {
          level2: {
            level3: {
              value: 'original',
              keep: 'this'
            }
          },
          sibling: 'value'
        }
      };
      const updates = {
        level1: {
          level2: {
            level3: {
              value: 'updated',
              new: 'field'
            }
          }
        }
      } as DeepPartial<typeof base> & { level1: { level2: { level3: { new: string } } } };
      const merged = merge(base, updates);
      expect(merged).toEqual({
        level1: {
          level2: {
            level3: {
              value: 'updated',
              keep: 'this',
              new: 'field'
            }
          },
          sibling: 'value'
        }
      });
    });
  });
});