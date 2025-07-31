import { createSimpleKeyFactory, createKeyFactory, createPaginatedKeyFactory } from '../factory.mjs';
import { sanitizeKeyComponent, splitKeyComponents } from '../sanitizer.mjs';
import type { ID } from '../types.mjs';

/**
 * User-related cache key factories
 */
export const userKeys = {
  /**
   * User profile key
   * @example userKeys.profile.key('507f1f77bcf86cd799439011')
   * @returns 'user:profile:507f1f77bcf86cd799439011'
   */
  profile: createSimpleKeyFactory<`user:profile:${string}`>(
    'user',
    'profile'
  ),
  
  /**
   * User settings key
   * @example userKeys.settings.key('507f1f77bcf86cd799439011')
   * @returns 'user:settings:507f1f77bcf86cd799439011'
   */
  settings: createSimpleKeyFactory<`user:settings:${string}`>(
    'user',
    'settings'
  ),
  
  /**
   * User session key
   * @example userKeys.session.key('507f1f77bcf86cd799439011', 'session123')
   * @returns 'user:session:507f1f77bcf86cd799439011:session123'
   */
  session: createKeyFactory<`user:session:${string}:${string}`, [userId: ID, sessionId: string]>(
    'user',
    'session',
    (userId: ID, sessionId: string) => 
      `${sanitizeKeyComponent(String(userId))}:${sanitizeKeyComponent(sessionId)}`,
    (suffix: string) => {
      const parts = splitKeyComponents(suffix, ':', true);
      if (parts.length !== 2) return null;
      return {
        userId: parts[0] || '',
        sessionId: parts[1] || ''
      };
    }
  ),
  
  /**
   * User permissions key
   * @example userKeys.permissions.key('507f1f77bcf86cd799439011')
   * @returns 'user:permissions:507f1f77bcf86cd799439011'
   */
  permissions: createSimpleKeyFactory<`user:permissions:${string}`>(
    'user',
    'permissions'
  ),
  
  /**
   * User activity feed paginated key
   * @example userKeys.activity.key('507f1f77bcf86cd799439011', 1, 20)
   * @returns 'user:activity:507f1f77bcf86cd799439011:page_1:limit_20'
   */
  activity: createPaginatedKeyFactory<`user:activity:${string}:page_${number}:limit_${number}`>(
    'user',
    'activity'
  ),
  
  /**
   * User preferences key
   * @example userKeys.preferences.key('507f1f77bcf86cd799439011')
   * @returns 'user:preferences:507f1f77bcf86cd799439011'
   */
  preferences: createSimpleKeyFactory<`user:preferences:${string}`>(
    'user',
    'preferences'
  ),
  
  /**
   * User notification settings key
   * @example userKeys.notifications.key('507f1f77bcf86cd799439011')
   * @returns 'user:notifications:507f1f77bcf86cd799439011'
   */
  notifications: createSimpleKeyFactory<`user:notifications:${string}`>(
    'user',
    'notifications'
  ),
  
  /**
   * User API token key
   * @example userKeys.apiTokens.key('507f1f77bcf86cd799439011')
   * @returns 'user:apiTokens:507f1f77bcf86cd799439011'
   */
  apiTokens: createSimpleKeyFactory<`user:apiTokens:${string}`>(
    'user',
    'apiTokens'
  ),
} as const;