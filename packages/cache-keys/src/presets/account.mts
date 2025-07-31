import { createSimpleKeyFactory, createKeyFactory } from '../factory.mjs';
import { sanitizeKeyComponent, splitKeyComponents } from '../sanitizer.mjs';
import type { ID } from '../types.mjs';

/**
 * Account-related cache key factories
 */
export const accountKeys = {
  /**
   * Account details key
   * @example accountKeys.details.key('507f1f77bcf86cd799439011')
   * @returns 'account:details:507f1f77bcf86cd799439011'
   */
  details: createSimpleKeyFactory<`account:details:${string}`>(
    'account',
    'details'
  ),
  
  /**
   * Account billing information key
   * @example accountKeys.billing.key('507f1f77bcf86cd799439011')
   * @returns 'account:billing:507f1f77bcf86cd799439011'
   */
  billing: createSimpleKeyFactory<`account:billing:${string}`>(
    'account',
    'billing'
  ),
  
  /**
   * Account usage by period key
   * @example accountKeys.usage.key('507f1f77bcf86cd799439011', '2024-01')
   * @returns 'account:usage:507f1f77bcf86cd799439011:2024-01'
   */
  usage: createKeyFactory<`account:usage:${string}:${string}`, [accountId: ID, period: string]>(
    'account',
    'usage',
    (accountId: ID, period: string) => 
      `${sanitizeKeyComponent(String(accountId))}:${sanitizeKeyComponent(period)}`,
    (suffix: string) => {
      const parts = splitKeyComponents(suffix, ':', true);
      if (parts.length !== 2) return null;
      return {
        accountId: parts[0] || '',
        period: parts[1] || ''
      };
    }
  ),
  
  /**
   * Account settings key
   * @example accountKeys.settings.key('507f1f77bcf86cd799439011')
   * @returns 'account:settings:507f1f77bcf86cd799439011'
   */
  settings: createSimpleKeyFactory<`account:settings:${string}`>(
    'account',
    'settings'
  ),
  
  /**
   * Account members list key
   * @example accountKeys.members.key('507f1f77bcf86cd799439011')
   * @returns 'account:members:507f1f77bcf86cd799439011'
   */
  members: createSimpleKeyFactory<`account:members:${string}`>(
    'account',
    'members'
  ),
  
  /**
   * Account subscription status key
   * @example accountKeys.subscription.key('507f1f77bcf86cd799439011')
   * @returns 'account:subscription:507f1f77bcf86cd799439011'
   */
  subscription: createSimpleKeyFactory<`account:subscription:${string}`>(
    'account',
    'subscription'
  ),
} as const;