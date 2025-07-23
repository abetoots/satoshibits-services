import { describe, it, expect } from 'vitest';
import { 
  ValidationError, 
  Validation, 
  validators, 
  schema, 
  validateOrThrow
} from './validation.mjs';

describe('ValidationError', () => {
  it('creates error with multiple messages', () => {
    const error = new ValidationError(['Error 1', 'Error 2']);
    expect(error.message).toBe('Validation failed: Error 1, Error 2');
    expect(error.name).toBe('ValidationError');
    expect(error.errors).toEqual(['Error 1', 'Error 2']);
  });

  it('adds errors to existing error', () => {
    const error = new ValidationError(['Error 1']);
    const newError = error.addErrors(['Error 2', 'Error 3']);
    
    expect(newError.errors).toEqual(['Error 1', 'Error 2', 'Error 3']);
    expect(error.errors).toEqual(['Error 1']); // Original unchanged
  });

  it('checks if error contains specific message', () => {
    const error = new ValidationError(['Error 1', 'Error 2']);
    expect(error.hasError('Error 1')).toBe(true);
    expect(error.hasError('Error 3')).toBe(false);
  });

  it('gets first error message', () => {
    const error = new ValidationError(['Error 1', 'Error 2']);
    expect(error.firstError()).toBe('Error 1');
    
    const emptyError = new ValidationError([]);
    expect(emptyError.firstError()).toBeUndefined();
  });
});

describe('Validation combinators', () => {
  describe('success', () => {
    it('creates validator that always succeeds', () => {
      const validator = Validation.success<string>();
      const result = validator('test');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('test');
      }
    });
  });

  describe('failure', () => {
    it('creates validator that always fails', () => {
      const validator = Validation.failure<string>('Always fails');
      const result = validator('test');
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors).toEqual(['Always fails']);
      }
    });
  });

  describe('fromPredicate', () => {
    it('creates validator from predicate function', () => {
      const isPositive = Validation.fromPredicate<number>(
        (n) => n > 0,
        'Must be positive'
      );
      
      const success = isPositive(5);
      expect(success.success).toBe(true);
      if (success.success) {
        expect(success.data).toBe(5);
      }
      
      const failure = isPositive(-5);
      expect(failure.success).toBe(false);
      if (!failure.success) {
        expect(failure.error.errors).toEqual(['Must be positive']);
      }
    });
  });

  describe('all', () => {
    it('combines validators with AND logic', () => {
      const minLength = validators.string.minLength(3);
      const maxLength = validators.string.maxLength(10);
      const combined = Validation.all(minLength, maxLength);
      
      const success = combined('hello');
      expect(success.success).toBe(true);
      
      const tooShort = combined('hi');
      expect(tooShort.success).toBe(false);
      if (!tooShort.success) {
        expect(tooShort.error.errors).toContain('String must be at least 3 characters long');
      }
      
      const tooLong = combined('this is too long');
      expect(tooLong.success).toBe(false);
      if (!tooLong.success) {
        expect(tooLong.error.errors).toContain('String must be at most 10 characters long');
      }
    });

    it('accumulates all errors', () => {
      const minLength = validators.string.minLength(5);
      const email = validators.string.email();
      const combined = Validation.all(minLength, email);
      
      const result = combined('a@');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors).toHaveLength(2);
        expect(result.error.errors).toContain('String must be at least 5 characters long');
        expect(result.error.errors).toContain('Invalid email format');
      }
    });
  });

  describe('any', () => {
    it('combines validators with OR logic', () => {
      const isEmail = validators.string.email();
      const isUrl = validators.string.url();
      const combined = Validation.any(isEmail, isUrl);
      
      const email = combined('test@example.com');
      expect(email.success).toBe(true);
      
      const url = combined('https://example.com');
      expect(url.success).toBe(true);
      
      const neither = combined('not-email-or-url');
      expect(neither.success).toBe(false);
      if (!neither.success) {
        expect(neither.error.errors).toHaveLength(2);
      }
    });
  });

  describe('map', () => {
    it('transforms validated value', () => {
      const toUpperCase = Validation.map((s: string) => s.toUpperCase());
      const validator = toUpperCase(validators.string.nonEmpty());
      
      const result = validator('hello');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('HELLO');
      }
    });

    it('preserves errors', () => {
      const toUpperCase = Validation.map((s: string) => s.toUpperCase());
      const validator = toUpperCase(validators.string.nonEmpty());
      
      const result = validator('   ');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors).toContain('String cannot be empty');
      }
    });
  });

  describe('flatMap', () => {
    it('chains validators based on value', () => {
      const validateAge = Validation.flatMap((age: number) => {
        if (age < 18) {
          return validators.number.min(13); // Teen validation
        } else {
          return validators.number.max(120); // Adult validation
        }
      });
      
      const teenValidator = validateAge(validators.number.positive());
      
      const validTeen = teenValidator(15);
      expect(validTeen.success).toBe(true);
      
      const invalidTeen = teenValidator(10);
      expect(invalidTeen.success).toBe(false);
      
      const validAdult = teenValidator(50);
      expect(validAdult.success).toBe(true);
      
      const invalidAdult = teenValidator(150);
      expect(invalidAdult.success).toBe(false);
    });
  });

  describe('optional', () => {
    it('allows null and undefined', () => {
      const validator = Validation.optional(validators.string.email());
      
      expect(validator(null).success).toBe(true);
      expect(validator(undefined).success).toBe(true);
      
      const valid = validator('test@example.com');
      expect(valid.success).toBe(true);
      
      const invalid = validator('not-email');
      expect(invalid.success).toBe(false);
    });
  });

  describe('required', () => {
    it('fails on null and undefined', () => {
      const validator = Validation.required<string>();
      
      const nullResult = validator(null);
      expect(nullResult.success).toBe(false);
      if (!nullResult.success) {
        expect(nullResult.error.errors).toContain('Value is required');
      }
      
      const undefinedResult = validator(undefined);
      expect(undefinedResult.success).toBe(false);
      
      const valid = validator('value');
      expect(valid.success).toBe(true);
    });

    it('uses custom error message', () => {
      const validator = Validation.required<string>('Custom required message');
      const result = validator(null);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors).toContain('Custom required message');
      }
    });
  });

  describe('array', () => {
    it('validates each item in array', () => {
      const validator = Validation.array(validators.number.positive());
      
      const valid = validator([1, 2, 3]);
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data).toEqual([1, 2, 3]);
      }
      
      const invalid = validator([1, -2, 3]);
      expect(invalid.success).toBe(false);
      if (!invalid.success) {
        expect(invalid.error.errors).toContain('[1]: Number must be positive');
      }
    });

    it('includes index in error messages', () => {
      const validator = Validation.array(validators.string.email());
      const result = validator(['valid@email.com', 'invalid', 'another@email.com']);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors).toContain('[1]: Invalid email format');
      }
    });
  });

  describe('object', () => {
    it('validates object properties', () => {
      const userValidator = Validation.object({
        name: validators.string.nonEmpty(),
        age: validators.number.positive(),
        email: validators.string.email(),
      });
      
      const valid = userValidator({
        name: 'John',
        age: 25,
        email: 'john@example.com',
      });
      
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data).toEqual({
          name: 'John',
          age: 25,
          email: 'john@example.com',
        });
      }
    });

    it('accumulates errors with property names', () => {
      const userValidator = Validation.object({
        name: validators.string.nonEmpty(),
        age: validators.number.positive(),
      });
      
      const result = userValidator({
        name: '',
        age: -5,
      });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors).toContain('name: String cannot be empty');
        expect(result.error.errors).toContain('age: Number must be positive');
      }
    });

    it('ignores properties without validators', () => {
      const validator = Validation.object({
        name: validators.string.nonEmpty(),
      });
      
      const result = validator({
        name: 'John',
        extra: 'ignored',
      } as any);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          name: 'John',
          extra: 'ignored',
        });
      }
    });
  });
});

describe('Common validators', () => {
  describe('string validators', () => {
    it('validates minimum length', () => {
      const validator = validators.string.minLength(5);
      expect(validator('hello').success).toBe(true);
      expect(validator('hi').success).toBe(false);
    });

    it('validates maximum length', () => {
      const validator = validators.string.maxLength(5);
      expect(validator('hello').success).toBe(true);
      expect(validator('too long').success).toBe(false);
    });

    it('validates non-empty strings', () => {
      const validator = validators.string.nonEmpty();
      expect(validator('hello').success).toBe(true);
      expect(validator('   ').success).toBe(false);
      expect(validator('').success).toBe(false);
    });

    it('validates email format', () => {
      const validator = validators.string.email();
      expect(validator('test@example.com').success).toBe(true);
      expect(validator('user.name+tag@domain.co.uk').success).toBe(true);
      expect(validator('invalid-email').success).toBe(false);
      expect(validator('@example.com').success).toBe(false);
      expect(validator('test@').success).toBe(false);
    });

    it('validates URL format', () => {
      const validator = validators.string.url();
      expect(validator('https://example.com').success).toBe(true);
      expect(validator('http://localhost:3000').success).toBe(true);
      expect(validator('ftp://files.example.com').success).toBe(true);
      expect(validator('not-a-url').success).toBe(false);
      expect(validator('://invalid').success).toBe(false);
    });

    it('validates regex matches', () => {
      const validator = validators.string.matches(/^[A-Z]{3}-\d{3}$/);
      expect(validator('ABC-123').success).toBe(true);
      expect(validator('abc-123').success).toBe(false);
      
      const customError = validators.string.matches(/^\d+$/, 'Must be numeric');
      const result = customError('abc');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors).toContain('Must be numeric');
      }
    });

    it('validates oneOf options', () => {
      const validator = validators.string.oneOf(['red', 'green', 'blue']);
      expect(validator('red').success).toBe(true);
      expect(validator('yellow').success).toBe(false);
    });
  });

  describe('number validators', () => {
    it('validates minimum value', () => {
      const validator = validators.number.min(10);
      expect(validator(15).success).toBe(true);
      expect(validator(10).success).toBe(true);
      expect(validator(5).success).toBe(false);
    });

    it('validates maximum value', () => {
      const validator = validators.number.max(10);
      expect(validator(5).success).toBe(true);
      expect(validator(10).success).toBe(true);
      expect(validator(15).success).toBe(false);
    });

    it('validates positive numbers', () => {
      const validator = validators.number.positive();
      expect(validator(5).success).toBe(true);
      expect(validator(0).success).toBe(false);
      expect(validator(-5).success).toBe(false);
    });

    it('validates non-negative numbers', () => {
      const validator = validators.number.nonNegative();
      expect(validator(5).success).toBe(true);
      expect(validator(0).success).toBe(true);
      expect(validator(-5).success).toBe(false);
    });

    it('validates integers', () => {
      const validator = validators.number.integer();
      expect(validator(5).success).toBe(true);
      expect(validator(5.5).success).toBe(false);
      expect(validator(-10).success).toBe(true);
    });

    it('validates range', () => {
      const validator = validators.number.between(1, 10);
      expect(validator(5).success).toBe(true);
      expect(validator(1).success).toBe(true);
      expect(validator(10).success).toBe(true);
      expect(validator(0).success).toBe(false);
      expect(validator(11).success).toBe(false);
    });
  });

  describe('array validators', () => {
    it('validates minimum length', () => {
      const validator = validators.array.minLength(2);
      expect(validator([1, 2, 3]).success).toBe(true);
      expect(validator([1]).success).toBe(false);
    });

    it('validates maximum length', () => {
      const validator = validators.array.maxLength(3);
      expect(validator([1, 2]).success).toBe(true);
      expect(validator([1, 2, 3, 4]).success).toBe(false);
    });

    it('validates non-empty arrays', () => {
      const validator = validators.array.nonEmpty();
      expect(validator([1]).success).toBe(true);
      expect(validator([]).success).toBe(false);
    });

    it('validates unique items', () => {
      const validator = validators.array.unique();
      expect(validator([1, 2, 3]).success).toBe(true);
      expect(validator([1, 2, 2, 3]).success).toBe(false);
      expect(validator(['a', 'b', 'c']).success).toBe(true);
      expect(validator(['a', 'b', 'b']).success).toBe(false);
    });
  });

  describe('date validators', () => {
    it('validates after date', () => {
      const cutoff = new Date('2023-01-01');
      const validator = validators.date.after(cutoff);
      
      expect(validator(new Date('2023-06-01')).success).toBe(true);
      expect(validator(new Date('2022-06-01')).success).toBe(false);
    });

    it('validates before date', () => {
      const cutoff = new Date('2023-01-01');
      const validator = validators.date.before(cutoff);
      
      expect(validator(new Date('2022-06-01')).success).toBe(true);
      expect(validator(new Date('2023-06-01')).success).toBe(false);
    });

    it('validates future dates', () => {
      const validator = validators.date.future();
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      
      expect(validator(future).success).toBe(true);
      expect(validator(new Date('2020-01-01')).success).toBe(false);
    });

    it('validates past dates', () => {
      const validator = validators.date.past();
      const past = new Date('2020-01-01');
      
      expect(validator(past).success).toBe(true);
      
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      expect(validator(future).success).toBe(false);
    });
  });

  describe('object validators', () => {
    it('validates property existence', () => {
      const validator = validators.object.hasProperty<{ name?: string }>('name');
      
      expect(validator({ name: 'John' }).success).toBe(true);
      expect(validator({}).success).toBe(false);
    });

    it('validates non-empty objects', () => {
      const validator = validators.object.notEmpty();
      
      expect(validator({ a: 1 }).success).toBe(true);
      expect(validator({}).success).toBe(false);
    });
  });
});

describe('schema helper', () => {
  it('creates object validator from schema', () => {
    const userSchema = schema({
      name: validators.string.nonEmpty(),
      age: validators.number.min(18),
      email: validators.string.email(),
    });
    
    const valid = userSchema({
      name: 'John Doe',
      age: 25,
      email: 'john@example.com',
    });
    
    expect(valid.success).toBe(true);
    
    const invalid = userSchema({
      name: '',
      age: 16,
      email: 'invalid',
    });
    
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.errors).toHaveLength(3);
    }
  });
});

describe('validateOrThrow', () => {
  it('returns validated value on success', () => {
    const validator = validators.string.email();
    const validate = validateOrThrow(validator);
    
    const result = validate('test@example.com');
    expect(result).toBe('test@example.com');
  });

  it('throws ValidationError on failure', () => {
    const validator = validators.string.email();
    const validate = validateOrThrow(validator);
    
    expect(() => validate('invalid')).toThrow(ValidationError);
    expect(() => validate('invalid')).toThrow('Invalid email format');
  });
});

describe('Complex validation scenarios', () => {
  it('validates nested objects', () => {
    const addressValidator = schema({
      street: validators.string.nonEmpty(),
      city: validators.string.nonEmpty(),
      zipCode: validators.string.matches(/^\d{5}$/),
    });
    
    const userValidator = schema({
      name: validators.string.nonEmpty(),
      age: validators.number.min(18),
      address: addressValidator,
    });
    
    const valid = userValidator({
      name: 'John',
      age: 25,
      address: {
        street: '123 Main St',
        city: 'New York',
        zipCode: '10001',
      },
    });
    
    expect(valid.success).toBe(true);
  });

  it('validates arrays of objects', () => {
    const itemValidator = schema({
      name: validators.string.nonEmpty(),
      price: validators.number.positive(),
    });
    
    const orderValidator = schema({
      items: Validation.array(itemValidator),
      total: validators.number.positive(),
    });
    
    const result = orderValidator({
      items: [
        { name: 'Book', price: 15.99 },
        { name: '', price: -5 },
      ],
      total: 15.99,
    });
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors).toContain('items: [1]: name: String cannot be empty');
      expect(result.error.errors).toContain('items: [1]: price: Number must be positive');
    }
  });

  it('combines multiple validation rules', () => {
    const passwordValidator = Validation.all(
      validators.string.minLength(8),
      validators.string.matches(/[A-Z]/, 'Must contain uppercase letter'),
      validators.string.matches(/[a-z]/, 'Must contain lowercase letter'),
      validators.string.matches(/[0-9]/, 'Must contain number'),
      validators.string.matches(/[!@#$%^&*]/, 'Must contain special character')
    );
    
    const weak = passwordValidator('password');
    expect(weak.success).toBe(false);
    if (!weak.success) {
      expect(weak.error.errors).toContain('Must contain uppercase letter');
      expect(weak.error.errors).toContain('Must contain number');
      expect(weak.error.errors).toContain('Must contain special character');
    }
    
    const strong = passwordValidator('Password123!');
    expect(strong.success).toBe(true);
  });
});