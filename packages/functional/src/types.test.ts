/**
 * @module types.test
 * Tests for branded types and type utilities
 */

import { describe, it, expect } from 'vitest';
import {
  brand,
  AccountId,
  UserId,
  CampaignId,
  ProfileId,
  SegmentId,
  EmailTemplateId,
  EngineId,
  ImportId,
  Email,
  Url,
  PositiveInt,
  Percentage,
  ISODateString,
  NonEmptyString,
  isBrand,
  createEnum,
  assertNever,
} from './types.mjs';
import type {
  Brand,
  Unbrand,
  DeepReadonly,
  RequireKeys,
  OptionalKeys,
  KeysOfType,
  Nominal,
  EnumType,
} from './types.mjs';

describe('Branded Types', () => {
  describe('brand function', () => {
    it('should create a branded type constructor', () => {
      const TestId = brand<string, 'TestId'>('TestId');
      const id = TestId('test-123');
      
      // Runtime value is unchanged
      expect(id).toBe('test-123');
      
      // Type system sees it as branded
      const typedId: Brand<string, 'TestId'> = id;
      expect(typedId).toBe('test-123');
    });

    it('should support validation in brand constructor', () => {
      const ValidatedId = brand<string, 'ValidatedId'>('ValidatedId', (value) => {
        if (!value.startsWith('valid_')) {
          throw new Error('ID must start with valid_');
        }
        return value;
      });

      expect(() => ValidatedId('invalid')).toThrow('ID must start with valid_');
      expect(ValidatedId('valid_123')).toBe('valid_123');
    });

    it('should preserve the original value', () => {
      const NumberId = brand<number, 'NumberId'>('NumberId');
      const id = NumberId(42);
      expect(id).toBe(42);
      expect(typeof id).toBe('number');
    });
  });

  describe('Common ID Types', () => {
    it('should create AccountId', () => {
      const id = AccountId('acc_123456');
      expect(id).toBe('acc_123456');
      
      // Type checking
      const typedId: AccountId = id;
      expect(typedId).toBe('acc_123456');
    });

    it('should create UserId', () => {
      const id = UserId('usr_789012');
      expect(id).toBe('usr_789012');
    });

    it('should create CampaignId', () => {
      const id = CampaignId('camp_abc123');
      expect(id).toBe('camp_abc123');
    });

    it('should create ProfileId', () => {
      const id = ProfileId('prof_def456');
      expect(id).toBe('prof_def456');
    });

    it('should create SegmentId', () => {
      const id = SegmentId('seg_ghi789');
      expect(id).toBe('seg_ghi789');
    });

    it('should create EmailTemplateId', () => {
      const id = EmailTemplateId('tpl_jkl012');
      expect(id).toBe('tpl_jkl012');
    });

    it('should create EngineId', () => {
      const id = EngineId('eng_mno345');
      expect(id).toBe('eng_mno345');
    });

    it('should create ImportId', () => {
      const id = ImportId('imp_pqr678');
      expect(id).toBe('imp_pqr678');
    });

    it('should prevent mixing different ID types at compile time', () => {
      const accountId = AccountId('acc_123');
      const userId = UserId('usr_456');
      
      // These would cause TypeScript errors:
      // const wrong: AccountId = userId;
      // const alsoWrong: UserId = accountId;
      
      // But runtime values are just strings
      expect(typeof accountId).toBe('string');
      expect(typeof userId).toBe('string');
    });
  });

  describe('Value Object Types', () => {
    describe('Email', () => {
      it('should accept valid email addresses', () => {
        expect(Email('user@example.com')).toBe('user@example.com');
        expect(Email('test.user+tag@sub.domain.com')).toBe('test.user+tag@sub.domain.com');
      });

      it('should reject invalid email addresses', () => {
        expect(() => Email('invalid')).toThrow('Invalid email format');
        expect(() => Email('missing@')).toThrow('Invalid email format');
        expect(() => Email('@domain.com')).toThrow('Invalid email format');
        expect(() => Email('user@')).toThrow('Invalid email format');
        expect(() => Email('user @domain.com')).toThrow('Invalid email format');
      });

      it('should normalize email to lowercase', () => {
        expect(Email('User@EXAMPLE.com')).toBe('user@example.com');
        expect(Email('TEST@TEST.COM')).toBe('test@test.com');
      });
    });

    describe('Url', () => {
      it('should accept valid URLs', () => {
        expect(Url('https://example.com')).toBe('https://example.com');
        expect(Url('http://localhost:3000')).toBe('http://localhost:3000');
        expect(Url('https://api.example.com/v1/users?id=123')).toBe('https://api.example.com/v1/users?id=123');
      });

      it('should reject invalid URLs', () => {
        expect(() => Url('not-a-url')).toThrow('Invalid URL format');
        expect(() => Url('//missing-protocol.com')).toThrow('Invalid URL format');
        expect(() => Url('http://')).toThrow('Invalid URL format');
      });

      it('should preserve URL exactly as provided', () => {
        const url = 'https://Example.COM/Path';
        expect(Url(url)).toBe(url);
      });
    });

    describe('PositiveInt', () => {
      it('should accept positive integers', () => {
        expect(PositiveInt(1)).toBe(1);
        expect(PositiveInt(42)).toBe(42);
        expect(PositiveInt(1000000)).toBe(1000000);
      });

      it('should reject non-positive numbers', () => {
        expect(() => PositiveInt(0)).toThrow('Value must be a positive integer');
        expect(() => PositiveInt(-1)).toThrow('Value must be a positive integer');
        expect(() => PositiveInt(-100)).toThrow('Value must be a positive integer');
      });

      it('should reject non-integers', () => {
        expect(() => PositiveInt(1.5)).toThrow('Value must be a positive integer');
        expect(() => PositiveInt(0.1)).toThrow('Value must be a positive integer');
        expect(() => PositiveInt(Math.PI)).toThrow('Value must be a positive integer');
      });
    });

    describe('Percentage', () => {
      it('should accept values between 0 and 100', () => {
        expect(Percentage(0)).toBe(0);
        expect(Percentage(50)).toBe(50);
        expect(Percentage(100)).toBe(100);
        expect(Percentage(99.99)).toBe(99.99);
      });

      it('should reject values outside 0-100 range', () => {
        expect(() => Percentage(-1)).toThrow('Percentage must be between 0 and 100');
        expect(() => Percentage(101)).toThrow('Percentage must be between 0 and 100');
        expect(() => Percentage(200)).toThrow('Percentage must be between 0 and 100');
      });
    });

    describe('ISODateString', () => {
      it('should accept valid ISO date strings', () => {
        expect(ISODateString('2024-01-15')).toBe('2024-01-15');
        expect(ISODateString('2024-01-15T10:30:00Z')).toBe('2024-01-15T10:30:00Z');
        expect(ISODateString('2024-01-15T10:30:00.123Z')).toBe('2024-01-15T10:30:00.123Z');
      });

      it('should reject invalid date strings', () => {
        expect(() => ISODateString('invalid-date')).toThrow('Invalid ISO date string');
        expect(() => ISODateString('2024-13-01')).toThrow('Invalid ISO date string');
        expect(() => ISODateString('2024-01-32')).toThrow('Invalid ISO date string');
      });

      it('should preserve the exact format provided', () => {
        const date = '2024-01-15T10:30:00.123+05:30';
        expect(ISODateString(date)).toBe(date);
      });
    });

    describe('NonEmptyString', () => {
      it('should accept non-empty strings', () => {
        expect(NonEmptyString('hello')).toBe('hello');
        expect(NonEmptyString('a')).toBe('a');
        expect(NonEmptyString('  spaces  ')).toBe('  spaces  ');
      });

      it('should reject empty strings', () => {
        expect(() => NonEmptyString('')).toThrow('String cannot be empty');
        expect(() => NonEmptyString('   ')).toThrow('String cannot be empty');
        expect(() => NonEmptyString('\t\n')).toThrow('String cannot be empty');
      });
    });
  });

  describe('Type Utilities', () => {
    describe('Unbrand', () => {
      it('should extract underlying type', () => {
        type TestBrand = Brand<string, 'Test'>;
        type Underlying = Unbrand<TestBrand>;
        
        // Type-level test
        const value: Underlying = 'test';
        expect(value).toBe('test');
      });

      it('should return original type for non-branded types', () => {
        type NotBranded = string;
        type Result = Unbrand<NotBranded>;
        
        const value: Result = 'test';
        expect(value).toBe('test');
      });
    });

    describe('DeepReadonly', () => {
      it('should work with nested objects', () => {
        interface DeepConfig {
          api: {
            endpoint: string;
            timeout: number;
            headers: {
              auth: string;
            };
          };
        }
        
        type ReadonlyConfig = DeepReadonly<DeepConfig>;

        const config: ReadonlyConfig = {
          api: {
            endpoint: 'https://api.example.com',
            timeout: 5000,
            headers: {
              auth: 'Bearer token',
            },
          },
        };

        // These would cause TypeScript errors:
        // config.api.endpoint = 'new';
        // config.api.headers.auth = 'new';

        expect(config.api.endpoint).toBe('https://api.example.com');
      });
    });

    describe('RequireKeys', () => {
      it('should make specified keys required', () => {
        interface User {
          id?: string;
          name?: string;
          email?: string;
        }

        type SavedUser = RequireKeys<User, 'id'>;
        
        const user: SavedUser = {
          id: '123', // Required
          // name and email remain optional
        };

        expect(user.id).toBe('123');
      });
    });

    describe('OptionalKeys', () => {
      it('should make specified keys optional', () => {
        interface Config {
          apiKey: string;
          timeout: number;
          debug: boolean;
        }

        type PartialConfig = OptionalKeys<Config, 'timeout' | 'debug'>;
        
        const config: PartialConfig = {
          apiKey: 'key123',
          // timeout and debug are now optional
        };

        expect(config.apiKey).toBe('key123');
      });
    });

    describe('KeysOfType', () => {
      it('should extract keys with specific value types', () => {
        interface UserForTest {
          id: string;
          name: string;
          age: number;
          isActive: boolean;
        }

        type StringKeys = KeysOfType<UserForTest, string>;
        type NumberKeys = KeysOfType<UserForTest, number>;
        type BooleanKeys = KeysOfType<UserForTest, boolean>;

        // Type-level tests
        const stringKey: StringKeys = 'id'; // or 'name'
        const numberKey: NumberKeys = 'age';
        const booleanKey: BooleanKeys = 'isActive';

        expect(stringKey).toBe('id');
        expect(numberKey).toBe('age');
        expect(booleanKey).toBe('isActive');
      });
    });

    describe('Nominal', () => {
      it('should create nominal types', () => {
        type Miles = Nominal<number, 'Miles'>;
        // Example of nominal types
        // type Kilometers = Nominal<number, 'Kilometers'>;

        const distance: Miles = 100 as Miles;
        
        // These would cause TypeScript errors:
        // const wrong: Kilometers = distance;

        expect(distance).toBe(100);
      });
    });
  });

  describe('Type Guards', () => {
    describe('isBrand', () => {
      it('should create type guard for branded types', () => {
        // Example of brand creation
        // const TestId = brand<string, 'TestId'>('TestId');
        const isTestId = isBrand<string, 'TestId'>('TestId');

        // Note: This is a simplified test since actual branded types
        // don't have runtime __brand property. In practice, you'd
        // track branded values differently.
        
        const value = 'test';
        expect(isTestId(value)).toBe(false);
        
        // If we manually create a branded-like object
        const brandedLike = Object.assign('test', { __brand: 'TestId' });
        expect(isTestId(brandedLike)).toBe(true);
      });
    });
  });

  describe('Enum Utilities', () => {
    describe('createEnum', () => {
      it('should create a frozen enum object', () => {
        const Status = createEnum({
          PENDING: 'pending',
          ACTIVE: 'active',
          COMPLETED: 'completed',
        });

        expect(Status.PENDING).toBe('pending');
        expect(Status.ACTIVE).toBe('active');
        expect(Status.COMPLETED).toBe('completed');

        // Should be frozen
        expect(Object.isFrozen(Status)).toBe(true);
        expect(() => {
          (Status as Record<string, unknown>).NEW = 'new';
        }).toThrow();
      });

      it('should work with EnumType', () => {
        const Status = createEnum({
          PENDING: 'pending',
          ACTIVE: 'active',
          COMPLETED: 'completed',
        });

        type Status = EnumType<typeof Status>;
        
        const status: Status = Status.ACTIVE;
        expect(status).toBe('active');

        // Type checking ensures only valid values
        // const invalid: Status = 'invalid'; // TypeScript error
      });
    });

    describe('assertNever', () => {
      it('should throw for unexpected values', () => {
        const value = 'unexpected' as never;
        expect(() => assertNever(value)).toThrow('Unexpected value: "unexpected"');
      });

      it('should ensure exhaustive switches', () => {
        type Status = 'pending' | 'active' | 'completed';

        function handleStatus(status: Status): string {
          switch (status) {
            case 'pending':
              return 'Waiting...';
            case 'active':
              return 'In progress';
            case 'completed':
              return 'Done!';
            default:
              return assertNever(status);
          }
        }

        expect(handleStatus('pending')).toBe('Waiting...');
        expect(handleStatus('active')).toBe('In progress');
        expect(handleStatus('completed')).toBe('Done!');
      });
    });
  });

  describe('Real-world usage patterns', () => {
    it('should enforce type safety for entity relationships', () => {
      interface User {
        id: UserId;
        accountId: AccountId;
        email: Email;
        name: string;
      }

      interface Campaign {
        id: CampaignId;
        accountId: AccountId;
        name: NonEmptyString;
        openRate: Percentage;
      }

      const user: User = {
        id: UserId('usr_123'),
        accountId: AccountId('acc_456'),
        email: Email('user@example.com'),
        name: 'John Doe',
      };

      const campaign: Campaign = {
        id: CampaignId('camp_789'),
        accountId: AccountId('acc_456'),
        name: NonEmptyString('Summer Sale'),
        openRate: Percentage(25.5),
      };

      // Type system ensures you can't mix IDs
      // user.id = campaign.id; // TypeScript error

      expect(user.accountId).toBe(campaign.accountId);
    });

    it('should work with repository pattern', () => {
      class Repository<T, ID> {
        async findById(_id: ID): Promise<T | null> {
          // Mock implementation
          return Promise.resolve(null);
        }
      }

      class UserRepository extends Repository<{ id: UserId; name: string }, UserId> {}
      class CampaignRepository extends Repository<{ id: CampaignId; name: string }, CampaignId> {}

      const userRepo = new UserRepository();
      const campaignRepo = new CampaignRepository();

      // Type-safe repository calls
      // Example of type-safe repository calls
      // const userId = UserId('usr_123');
      // const campaignId = CampaignId('camp_456');

      // These would be type errors:
      // userRepo.findById(campaignId);
      // campaignRepo.findById(userId);

      expect(userRepo).toBeDefined();
      expect(campaignRepo).toBeDefined();
    });

    it('should validate and transform API inputs', () => {
      interface CreateUserInput {
        email: string;
        name: string;
        accountId: string;
      }

      interface ValidatedUser {
        email: Email;
        name: NonEmptyString;
        accountId: AccountId;
        id: UserId;
      }

      function validateAndCreate(input: CreateUserInput): ValidatedUser {
        return {
          email: Email(input.email),
          name: NonEmptyString(input.name),
          accountId: AccountId(input.accountId),
          id: UserId(`usr_${Date.now()}`),
        };
      }

      const input: CreateUserInput = {
        email: 'newuser@example.com',
        name: 'New User',
        accountId: 'acc_123',
      };

      const validated = validateAndCreate(input);
      expect(validated.email).toBe('newuser@example.com');
      expect(validated.name).toBe('New User');
      expect(validated.accountId).toBe('acc_123');
      expect(validated.id).toMatch(/^usr_\d+$/);
    });
  });
});