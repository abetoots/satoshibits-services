import { describe, it, expect } from 'vitest';
import {
  and,
  or,
  not,
  xor,
  isNotNil,
  isNil,
  isEmpty,
  isNotEmpty,
  equals,
  oneOf,
  inRange,
  matches,
  hasProperty,
  includes,
  alwaysTrue,
  alwaysFalse,
  predicateUtils,
} from './predicates.mjs';

describe('predicates', () => {
  describe('and', () => {
    it('should return true when all predicates are true', () => {
      const isPositive = (n: number) => n > 0;
      const isEven = (n: number) => n % 2 === 0;
      const isPositiveEven = and(isPositive, isEven);
      
      expect(isPositiveEven(4)).toBe(true);
      expect(isPositiveEven(2)).toBe(true);
    });

    it('should return false when any predicate is false', () => {
      const isPositive = (n: number) => n > 0;
      const isEven = (n: number) => n % 2 === 0;
      const isPositiveEven = and(isPositive, isEven);
      
      expect(isPositiveEven(-2)).toBe(false); // not positive
      expect(isPositiveEven(3)).toBe(false);  // not even
    });

    it('should handle empty predicate list', () => {
      const alwaysTrue = and<number>();
      expect(alwaysTrue(42)).toBe(true);
    });

    it('should work with multiple predicates', () => {
      interface User { name?: string; email?: string; age?: number }
      const hasName = (user: User) => !!user.name;
      const hasEmail = (user: User) => !!user.email;
      const isAdult = (user: User) => (user.age ?? 0) >= 18;
      
      const isValidAdultUser = and(hasName, hasEmail, isAdult);
      
      expect(isValidAdultUser({ name: 'John', email: 'john@example.com', age: 25 })).toBe(true);
      expect(isValidAdultUser({ name: 'John', email: 'john@example.com', age: 17 })).toBe(false);
      expect(isValidAdultUser({ name: 'John', age: 25 })).toBe(false);
    });
  });

  describe('or', () => {
    it('should return true when at least one predicate is true', () => {
      const isAdmin = (user: { role: string }) => user.role === 'admin';
      const isModerator = (user: { role: string }) => user.role === 'moderator';
      const hasPrivileges = or(isAdmin, isModerator);
      
      expect(hasPrivileges({ role: 'admin' })).toBe(true);
      expect(hasPrivileges({ role: 'moderator' })).toBe(true);
    });

    it('should return false when all predicates are false', () => {
      const isAdmin = (user: { role: string }) => user.role === 'admin';
      const isModerator = (user: { role: string }) => user.role === 'moderator';
      const hasPrivileges = or(isAdmin, isModerator);
      
      expect(hasPrivileges({ role: 'user' })).toBe(false);
    });

    it('should handle empty predicate list', () => {
      const alwaysFalse = or<number>();
      expect(alwaysFalse(42)).toBe(false);
    });

    it('should work with multiple payment methods', () => {
      const hasCreditCard = (payment: { type: string }) => payment.type === 'credit';
      const hasPayPal = (payment: { type: string }) => payment.type === 'paypal';
      const hasCrypto = (payment: { type: string }) => payment.type === 'crypto';
      
      const acceptsPayment = or(hasCreditCard, hasPayPal, hasCrypto);
      
      expect(acceptsPayment({ type: 'paypal' })).toBe(true);
      expect(acceptsPayment({ type: 'cash' })).toBe(false);
    });
  });

  describe('not', () => {
    it('should invert predicate result', () => {
      const isPositive = (n: number) => n > 0;
      const isNegativeOrZero = not(isPositive);
      
      expect(isNegativeOrZero(-5)).toBe(true);
      expect(isNegativeOrZero(0)).toBe(true);
      expect(isNegativeOrZero(5)).toBe(false);
    });

    it('should work with complex predicates', () => {
      const isError = (log: { level: string }) => log.level === 'error';
      const isNotError = not(isError);
      
      expect(isNotError({ level: 'info' })).toBe(true);
      expect(isNotError({ level: 'error' })).toBe(false);
    });
  });

  describe('xor', () => {
    it('should return true when exactly one predicate is true', () => {
      interface Auth { username?: string; email?: string }
      const hasUsername = (auth: Auth) => !!auth.username;
      const hasEmail = (auth: Auth) => !!auth.email;
      const hasExactlyOneIdentifier = xor(hasUsername, hasEmail);
      
      expect(hasExactlyOneIdentifier({ username: 'john' })).toBe(true);
      expect(hasExactlyOneIdentifier({ email: 'john@example.com' })).toBe(true);
    });

    it('should return false when both or neither predicate is true', () => {
      interface Auth { username?: string; email?: string }
      const hasUsername = (auth: Auth) => !!auth.username;
      const hasEmail = (auth: Auth) => !!auth.email;
      const hasExactlyOneIdentifier = xor(hasUsername, hasEmail);
      
      expect(hasExactlyOneIdentifier({ username: 'john', email: 'j@e.com' })).toBe(false);
      expect(hasExactlyOneIdentifier({})).toBe(false);
    });
  });

  describe('isNotNil', () => {
    it('should return true for non-null/undefined values', () => {
      expect(isNotNil('string')).toBe(true);
      expect(isNotNil(0)).toBe(true);
      expect(isNotNil(false)).toBe(true);
      expect(isNotNil('')).toBe(true);
      expect(isNotNil([])).toBe(true);
      expect(isNotNil({})).toBe(true);
    });

    it('should return false for null and undefined', () => {
      expect(isNotNil(null)).toBe(false);
      expect(isNotNil(undefined)).toBe(false);
    });

    it('should work as type guard in filter', () => {
      const values: (string | null | undefined)[] = ['a', null, 'b', undefined, 'c'];
      const nonNullValues = values.filter(isNotNil);
      expect(nonNullValues).toEqual(['a', 'b', 'c']);
    });
  });

  describe('isNil', () => {
    it('should return true for null and undefined', () => {
      expect(isNil(null)).toBe(true);
      expect(isNil(undefined)).toBe(true);
    });

    it('should return false for non-null/undefined values', () => {
      expect(isNil('string')).toBe(false);
      expect(isNil(0)).toBe(false);
      expect(isNil(false)).toBe(false);
      expect(isNil('')).toBe(false);
    });

    it('should work in filtering', () => {
      const values = [1, null, 2, undefined, 3];
      const nilValues = values.filter(isNil);
      expect(nilValues).toEqual([null, undefined]);
    });
  });

  describe('isEmpty', () => {
    it('should return true for empty values', () => {
      expect(isEmpty(null)).toBe(true);
      expect(isEmpty(undefined)).toBe(true);
      expect(isEmpty('')).toBe(true);
      expect(isEmpty([])).toBe(true);
      expect(isEmpty({})).toBe(true);
    });

    it('should return false for non-empty values', () => {
      expect(isEmpty('hello')).toBe(false);
      expect(isEmpty([1, 2, 3])).toBe(false);
      expect(isEmpty({ a: 1 })).toBe(false);
      expect(isEmpty(0)).toBe(false);
      expect(isEmpty(false)).toBe(false);
    });

    it('should work with form validation', () => {
      const formData = { name: '', email: 'test@example.com', bio: null };
      const emptyFields = Object.entries(formData)
        .filter(([, value]) => isEmpty(value))
        .map(([key]) => key);
      expect(emptyFields).toEqual(['name', 'bio']);
    });
  });

  describe('isNotEmpty', () => {
    it('should return true for non-empty values', () => {
      expect(isNotEmpty('hello')).toBe(true);
      expect(isNotEmpty([1])).toBe(true);
      expect(isNotEmpty({ a: 1 })).toBe(true);
    });

    it('should return false for empty values', () => {
      expect(isNotEmpty('')).toBe(false);
      expect(isNotEmpty([])).toBe(false);
      expect(isNotEmpty({})).toBe(false);
      expect(isNotEmpty(null)).toBe(false);
    });
  });

  describe('equals', () => {
    it('should create a predicate checking equality', () => {
      const isJohn = equals('John');
      expect(isJohn('John')).toBe(true);
      expect(isJohn('Jane')).toBe(false);
    });

    it('should work with filtering', () => {
      const names = ['John', 'Jane', 'John', 'Jack'];
      const johns = names.filter(equals('John'));
      expect(johns).toEqual(['John', 'John']);
    });

    it('should work with numbers', () => {
      const isZero = equals(0);
      expect(isZero(0)).toBe(true);
      expect(isZero(1)).toBe(false);
    });
  });

  describe('oneOf', () => {
    it('should check if value is in array', () => {
      const isWeekend = oneOf(['Saturday', 'Sunday']);
      expect(isWeekend('Saturday')).toBe(true);
      expect(isWeekend('Monday')).toBe(false);
    });

    it('should work with permissions', () => {
      const canEdit = oneOf(['admin', 'editor', 'author']);
      expect(canEdit('admin')).toBe(true);
      expect(canEdit('viewer')).toBe(false);
    });

    it('should handle empty array', () => {
      const neverTrue = oneOf<string>([]);
      expect(neverTrue('anything')).toBe(false);
    });
  });

  describe('inRange', () => {
    it('should check inclusive range', () => {
      const isValidAge = inRange(18, 65);
      expect(isValidAge(17)).toBe(false);
      expect(isValidAge(18)).toBe(true);
      expect(isValidAge(30)).toBe(true);
      expect(isValidAge(65)).toBe(true);
      expect(isValidAge(66)).toBe(false);
    });

    it('should work with decimal numbers', () => {
      const isValidGPA = inRange(0.0, 4.0);
      expect(isValidGPA(-0.1)).toBe(false);
      expect(isValidGPA(2.5)).toBe(true);
      expect(isValidGPA(4.1)).toBe(false);
    });
  });

  describe('matches', () => {
    it('should match regular expressions', () => {
      const isEmail = matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      expect(isEmail('test@example.com')).toBe(true);
      expect(isEmail('invalid-email')).toBe(false);
    });

    it('should work with phone numbers', () => {
      const isPhoneNumber = matches(/^\+?[\d\s-()]+$/);
      expect(isPhoneNumber('+1 (555) 123-4567')).toBe(true);
      expect(isPhoneNumber('not a phone')).toBe(false);
    });

    it('should handle case sensitivity', () => {
      const startsWithHello = matches(/^hello/);
      const startsWithHelloIgnoreCase = matches(/^hello/i);
      
      expect(startsWithHello('Hello world')).toBe(false);
      expect(startsWithHelloIgnoreCase('Hello world')).toBe(true);
    });
  });

  describe('hasProperty', () => {
    it('should check for property existence', () => {
      const hasEmail = hasProperty('email');
      const users = [
        { name: 'John', email: 'john@example.com' },
        { name: 'Jane' }
      ];
      const usersWithEmail = users.filter(hasEmail);
      expect(usersWithEmail).toEqual([{ name: 'John', email: 'john@example.com' }]);
    });

    it('should work as type guard', () => {
      const obj: { a?: number } = { a: 1 };
      if (hasProperty('a')(obj)) {
        // TypeScript knows obj has property 'a' here
        expect(obj.a).toBe(1);
      }
    });

    it('should work with symbol properties', () => {
      const sym = Symbol('test');
      const hasSymbol = hasProperty(sym);
      const obj1 = { [sym]: 'value' };
      const obj2 = {};
      
      expect(hasSymbol(obj1)).toBe(true);
      expect(hasSymbol(obj2)).toBe(false);
    });
  });

  describe('includes', () => {
    it('should check array inclusion', () => {
      const hasFavorite = includes('JavaScript');
      expect(hasFavorite(['Python', 'JavaScript', 'Go'])).toBe(true);
      expect(hasFavorite(['Python', 'Go'])).toBe(false);
    });

    it('should work with tag filtering', () => {
      const hasUrgentTag = includes('urgent');
      const tasks = [
        { name: 'Task 1', tags: ['urgent', 'bug'] },
        { name: 'Task 2', tags: ['feature'] }
      ];
      const urgentTasks = tasks.filter(task => hasUrgentTag(task.tags));
      expect(urgentTasks).toHaveLength(1);
    });

    it('should handle empty arrays', () => {
      const hasAny = includes('any');
      expect(hasAny([])).toBe(false);
    });
  });

  describe('alwaysTrue', () => {
    it('should always return true', () => {
      expect(alwaysTrue(null)).toBe(true);
      expect(alwaysTrue(undefined)).toBe(true);
      expect(alwaysTrue(42)).toBe(true);
      expect(alwaysTrue('string')).toBe(true);
    });

    it('should work as default filter', () => {
      const items = [1, 2, 3];
      const filtered = items.filter(alwaysTrue);
      expect(filtered).toEqual(items);
    });
  });

  describe('alwaysFalse', () => {
    it('should always return false', () => {
      expect(alwaysFalse(null)).toBe(false);
      expect(alwaysFalse(undefined)).toBe(false);
      expect(alwaysFalse(42)).toBe(false);
      expect(alwaysFalse('string')).toBe(false);
    });

    it('should work as disabled filter', () => {
      const items = [1, 2, 3];
      const filtered = items.filter(alwaysFalse);
      expect(filtered).toEqual([]);
    });
  });

  describe('predicateUtils', () => {
    describe('propEquals', () => {
      it('should check property equality', () => {
        interface User { role: string; name: string }
        const isAdminRole = predicateUtils.propEquals<User, 'role'>('role', 'admin');
        expect(isAdminRole({ role: 'admin', name: 'John' })).toBe(true);
        expect(isAdminRole({ role: 'user', name: 'Jane' })).toBe(false);
      });

      it('should work with filtering', () => {
        interface User { id: number; role: string }
        const users: User[] = [
          { id: 1, role: 'admin' },
          { id: 2, role: 'user' },
          { id: 3, role: 'admin' }
        ];
        const admins = users.filter(predicateUtils.propEquals<User, 'role'>('role', 'admin'));
        expect(admins).toHaveLength(2);
      });
    });

    describe('propsMatch', () => {
      it('should check multiple properties', () => {
        interface Person { firstName: string; lastName: string; age?: number }
        const isJohnDoe = predicateUtils.propsMatch<Person>({
          firstName: 'John',
          lastName: 'Doe'
        });
        
        expect(isJohnDoe({ firstName: 'John', lastName: 'Doe', age: 30 })).toBe(true);
        expect(isJohnDoe({ firstName: 'John', lastName: 'Smith' })).toBe(false);
        expect(isJohnDoe({ firstName: 'Jane', lastName: 'Doe' })).toBe(false);
      });

      it('should handle empty object', () => {
        const matchesNothing = predicateUtils.propsMatch({});
        expect(matchesNothing({ a: 1, b: 2 })).toBe(true);
      });
    });

    describe('contramap', () => {
      it('should transform before testing', () => {
        const hasLongName = predicateUtils.contramap(
          (user: { name: string }) => user.name,
          (name: string) => name.length > 10
        );
        
        expect(hasLongName({ name: 'John' })).toBe(false);
        expect(hasLongName({ name: 'Alexander Hamilton' })).toBe(true);
      });

      it('should enable case-insensitive comparison', () => {
        const isCaseInsensitiveMatch = (target: string) =>
          predicateUtils.contramap(
            (s: string) => s.toLowerCase(),
            equals(target.toLowerCase())
          );
        
        const isHello = isCaseInsensitiveMatch('hello');
        expect(isHello('HELLO')).toBe(true);
        expect(isHello('Hello')).toBe(true);
        expect(isHello('hello')).toBe(true);
        expect(isHello('hi')).toBe(false);
      });

      it('should work with complex transformations', () => {
        const hasExpensiveItems = predicateUtils.contramap(
          (order: { items: { price: number }[] }) => 
            order.items.map(item => item.price),
          (prices: number[]) => 
            prices.some(price => price > 100)
        );
        
        expect(hasExpensiveItems({ 
          items: [{ price: 50 }, { price: 150 }] 
        })).toBe(true);
        expect(hasExpensiveItems({ 
          items: [{ price: 50 }, { price: 75 }] 
        })).toBe(false);
      });
    });
  });
});