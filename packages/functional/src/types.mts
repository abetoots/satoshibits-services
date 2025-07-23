/**
 * @module types
 * @description Branded types and common type utilities for type-safe domain modeling.
 * Provides compile-time guarantees for entity IDs and other domain primitives.
 * Branded types (also known as nominal types) prevent accidental mixing of
 * semantically different values that have the same underlying type. This module
 * provides utilities for creating branded types, common domain types, and
 * advanced TypeScript type utilities.
 * 
 * @example
 * ```typescript
 * import { brand, Brand, UserId, Email, assertNever } from './types.mts';
 * 
 * // create custom branded types
 * type OrderId = Brand<string, 'OrderId'>;
 * const OrderId = brand<string, 'OrderId'>('OrderId');
 * 
 * // use predefined domain types
 * const userId = UserId('usr_123');
 * const email = Email('user@example.com');
 * 
 * // type-safe function parameters
 * function getUser(id: UserId): Promise<User> {
 *   // TypeScript prevents passing wrong ID types
 *   return userRepository.findById(id);
 * }
 * 
 * // exhaustive pattern matching
 * type Status = 'pending' | 'active' | 'completed';
 * function handleStatus(status: Status): string {
 *   switch (status) {
 *     case 'pending': return 'Waiting...';
 *     case 'active': return 'In progress';
 *     case 'completed': return 'Done!';
 *     default: return assertNever(status);
 *   }
 * }
 * ```
 * 
 * @category Core
 * @since 2025-07-03
 */

/**
 * Brand type helper that creates nominal types from structural types.
 * Prevents accidental mixing of different ID types at compile time.
 * 
 * @category Core Types
 */
export type Brand<T, B> = T & { readonly __brand: B };

/**
 * Creates a branded type constructor.
 * 
 * @category Constructors
 * @example
 * const UserId = brand<string, 'UserId'>('UserId');
 * const userId = UserId('user_123');
 * 
 * @example
 * // Type-safe ID creation
 * const AccountId = brand<string, 'AccountId'>('AccountId');
 * const CampaignId = brand<string, 'CampaignId'>('CampaignId');
 * 
 * // This will cause a compile error:
 * // const wrong: AccountId = campaignId;
 * 
 * @example
 * // With validation
 * const PositiveNumber = brand<number, 'PositiveNumber'>('PositiveNumber', 
 *   (n) => n > 0 ? n : throw new Error('Must be positive')
 * );
 */
export const brand = <T, B extends string>(
  _brandName: B,
  validate?: (value: T) => T
) => {
  return (value: T): Brand<T, B> => {
    const validated = validate ? validate(value) : value;
    return validated as Brand<T, B>;
  };
};

/**
 * Extracts the underlying type from a branded type.
 * 
 * @category Type Utilities
 * @example
 * type UserId = Brand<string, 'UserId'>;
 * type RawId = Unbrand<UserId>; // string
 */
export type Unbrand<T> = T extends Brand<infer U, unknown> ? U : T;

/**
 * Common ID types for the application domain.
 * These provide type safety for entity relationships.
 * 
 * @category Domain Types
 */

/**
 * Account ID type - identifies a customer account.
 * 
 * @example
 * const accountId = AccountId('acc_123456');
 * 
 * @example
 * // Type-safe function parameters
 * function getAccount(id: AccountId): Promise<Account> {
 *   return accountRepository.findById(id);
 * }
 * 
 * @example
 * // Prevents mixing IDs
 * const userId = UserId('usr_789');
 * // getAccount(userId); // Compile error!
 */
export type AccountId = Brand<string, 'AccountId'>;
export const AccountId = brand<string, 'AccountId'>('AccountId');

/**
 * User ID type - identifies a user within an account.
 * 
 * @example
 * const userId = UserId('usr_789012');
 * 
 * @example
 * // Domain modeling
 * interface User {
 *   id: UserId;
 *   accountId: AccountId;
 *   email: Email;
 *   name: string;
 * }
 */
export type UserId = Brand<string, 'UserId'>;
export const UserId = brand<string, 'UserId'>('UserId');

/**
 * Campaign ID type - identifies an email campaign.
 * 
 * @example
 * const campaignId = CampaignId('camp_abc123');
 * 
 * @example
 * // Repository methods
 * class CampaignRepository {
 *   async findById(id: CampaignId): Promise<Campaign | null> {
 *     // Implementation
 *   }
 * }
 */
export type CampaignId = Brand<string, 'CampaignId'>;
export const CampaignId = brand<string, 'CampaignId'>('CampaignId');

/**
 * Profile ID type - identifies a subscriber profile.
 * 
 * @example
 * const profileId = ProfileId('prof_def456');
 */
export type ProfileId = Brand<string, 'ProfileId'>;
export const ProfileId = brand<string, 'ProfileId'>('ProfileId');

/**
 * Segment ID type - identifies a subscriber segment.
 * 
 * @example
 * const segmentId = SegmentId('seg_ghi789');
 */
export type SegmentId = Brand<string, 'SegmentId'>;
export const SegmentId = brand<string, 'SegmentId'>('SegmentId');

/**
 * Email Template ID type - identifies an email template.
 * 
 * @example
 * const templateId = EmailTemplateId('tpl_jkl012');
 */
export type EmailTemplateId = Brand<string, 'EmailTemplateId'>;
export const EmailTemplateId = brand<string, 'EmailTemplateId'>('EmailTemplateId');

/**
 * Engine ID type - identifies an automation engine.
 * 
 * @example
 * const engineId = EngineId('eng_mno345');
 */
export type EngineId = Brand<string, 'EngineId'>;
export const EngineId = brand<string, 'EngineId'>('EngineId');

/**
 * Import ID type - identifies a data import job.
 * 
 * @example
 * const importId = ImportId('imp_pqr678');
 */
export type ImportId = Brand<string, 'ImportId'>;
export const ImportId = brand<string, 'ImportId'>('ImportId');

/**
 * Value object types for domain modeling.
 * These ensure data integrity at the type level.
 * 
 * @category Value Objects
 */

/**
 * Email address type with basic validation.
 * 
 * @example
 * const email = Email('user@example.com');
 * 
 * @example
 * // With validation
 * try {
 *   const email = Email('invalid-email');
 * } catch (e) {
 *   console.error('Invalid email format');
 * }
 * 
 * @example
 * // Type-safe email handling
 * function sendEmail(to: Email, subject: string): Promise<void> {
 *   return emailService.send(to, subject);
 * }
 */
export type Email = Brand<string, 'Email'>;
export const Email = brand<string, 'Email'>('Email', (value) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    throw new Error(`Invalid email format: ${value}`);
  }
  return value.toLowerCase();
});

/**
 * URL type with validation.
 * 
 * @example
 * const website = Url('https://example.com');
 * 
 * @example
 * // API endpoints
 * const apiEndpoint = Url('https://api.example.com/v1/users');
 * 
 * @example
 * // Validation
 * try {
 *   const invalid = Url('not-a-url');
 * } catch (e) {
 *   console.error('Invalid URL');
 * }
 */
export type Url = Brand<string, 'Url'>;
export const Url = brand<string, 'Url'>('Url', (value) => {
  try {
    new URL(value);
    return value;
  } catch {
    throw new Error(`Invalid URL format: ${value}`);
  }
});

/**
 * Positive integer type.
 * 
 * @example
 * const count = PositiveInt(42);
 * 
 * @example
 * // Domain constraints
 * interface PaginationParams {
 *   page: PositiveInt;
 *   limit: PositiveInt;
 * }
 * 
 * @example
 * // Validation
 * try {
 *   const invalid = PositiveInt(-5);
 * } catch (e) {
 *   console.error('Must be positive');
 * }
 */
export type PositiveInt = Brand<number, 'PositiveInt'>;
export const PositiveInt = brand<number, 'PositiveInt'>('PositiveInt', (value) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Value must be a positive integer: ${value}`);
  }
  return value;
});

/**
 * Percentage type (0-100).
 * 
 * @example
 * const discount = Percentage(15);
 * 
 * @example
 * // Business rules
 * interface Campaign {
 *   openRate: Percentage;
 *   clickRate: Percentage;
 *   bounceRate: Percentage;
 * }
 */
export type Percentage = Brand<number, 'Percentage'>;
export const Percentage = brand<number, 'Percentage'>('Percentage', (value) => {
  if (value < 0 || value > 100) {
    throw new Error(`Percentage must be between 0 and 100: ${value}`);
  }
  return value;
});

/**
 * ISO date string type.
 * 
 * @example
 * const date = ISODateString('2024-01-15T10:30:00Z');
 * 
 * @example
 * // API contracts
 * interface Event {
 *   id: string;
 *   timestamp: ISODateString;
 *   type: string;
 * }
 */
export type ISODateString = Brand<string, 'ISODateString'>;
export const ISODateString = brand<string, 'ISODateString'>('ISODateString', (value) => {
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date string: ${value}`);
  }
  return value;
});

/**
 * Non-empty string type.
 * 
 * @example
 * const name = NonEmptyString('John Doe');
 * 
 * @example
 * // Form validation
 * interface UserForm {
 *   firstName: NonEmptyString;
 *   lastName: NonEmptyString;
 *   bio?: string;
 * }
 */
export type NonEmptyString = Brand<string, 'NonEmptyString'>;
export const NonEmptyString = brand<string, 'NonEmptyString'>('NonEmptyString', (value) => {
  if (value.trim().length === 0) {
    throw new Error('String cannot be empty');
  }
  return value;
});

/**
 * Utility type helpers.
 * 
 * @category Type Utilities
 */

/**
 * Deep readonly type for immutable data structures.
 * 
 * @example
 * type Config = DeepReadonly<{
 *   api: {
 *     endpoint: string;
 *     timeout: number;
 *   };
 * }>;
 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

/**
 * Makes specified keys required while keeping others optional.
 * 
 * @example
 * type User = {
 *   id?: string;
 *   name?: string;
 *   email?: string;
 * };
 * 
 * type SavedUser = RequireKeys<User, 'id'>;
 * // { id: string; name?: string; email?: string; }
 */
export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Makes specified keys optional while keeping others required.
 * 
 * @example
 * type Config = {
 *   apiKey: string;
 *   timeout: number;
 *   debug: boolean;
 * };
 * 
 * type PartialConfig = OptionalKeys<Config, 'timeout' | 'debug'>;
 * // { apiKey: string; timeout?: number; debug?: boolean; }
 */
export type OptionalKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Extracts keys of type T that have values of type V.
 * 
 * @example
 * type User = {
 *   id: string;
 *   name: string;
 *   age: number;
 *   isActive: boolean;
 * };
 * 
 * type StringKeys = KeysOfType<User, string>; // 'id' | 'name'
 * type NumberKeys = KeysOfType<User, number>; // 'age'
 */
export type KeysOfType<T, V> = {
  [K in keyof T]: T[K] extends V ? K : never;
}[keyof T];

/**
 * Nominal type helper for creating distinct types from primitives.
 * Similar to Brand but more lightweight.
 * 
 * @example
 * type Miles = Nominal<number, 'Miles'>;
 * type Kilometers = Nominal<number, 'Kilometers'>;
 * 
 * const distance: Miles = 100 as Miles;
 * // const wrong: Kilometers = distance; // Error!
 */
export type Nominal<T, K> = T & { readonly __nominal: K };

/**
 * Type guard creator for branded types.
 * 
 * @category Type Guards
 * @example
 * const isUserId = isBrand<string, 'UserId'>('UserId');
 * 
 * if (isUserId(value)) {
 *   // TypeScript knows value is UserId
 * }
 * 
 * @example
 * // Array filtering
 * const userIds = mixedIds.filter(isUserId);
 */
export const isBrand = <T, B extends string>(brandName: B) => {
  return (value: unknown): value is Brand<T, B> => {
    return typeof value === 'object' && 
           value !== null && 
           '__brand' in value && 
           (value as Record<string, unknown>).__brand === brandName;
  };
};

/**
 * Creates a type-safe enum from an object.
 * 
 * @category Enum Utilities
 * @example
 * const Status = createEnum({
 *   PENDING: 'pending',
 *   ACTIVE: 'active',
 *   COMPLETED: 'completed'
 * });
 * 
 * type Status = EnumType<typeof Status>;
 * // 'pending' | 'active' | 'completed'
 * 
 * @example
 * // Usage in interfaces
 * interface Task {
 *   id: string;
 *   status: Status;
 * }
 */
export const createEnum = <T extends Record<string, string>>(obj: T): Readonly<T> => {
  return Object.freeze(obj);
};

export type EnumType<T> = T[keyof T];

/**
 * Assertion function for exhaustive checks.
 * 
 * @category Type Guards
 * @example
 * type Status = 'pending' | 'active' | 'completed';
 * 
 * function handleStatus(status: Status) {
 *   switch (status) {
 *     case 'pending':
 *       return 'Waiting...';
 *     case 'active':
 *       return 'In progress';
 *     case 'completed':
 *       return 'Done!';
 *     default:
 *       return assertNever(status); // Ensures all cases handled
 *   }
 * }
 */
export const assertNever = (value: never): never => {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
};