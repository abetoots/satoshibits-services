import type { CacheKeyFactory } from './types.mjs';
import { sanitizeKeyComponent, decodeKeyComponent, splitKeyComponents } from './sanitizer.mjs';

/**
 * Create a type-safe cache key factory
 * 
 * @param namespace The namespace for this key type (e.g., 'user', 'account')
 * @param type The specific type within the namespace (e.g., 'profile', 'settings')
 * @param formatter Function to format the key suffix from arguments
 * @param parser Optional function to parse the key back into components
 * @returns A cache key factory
 */
export function createKeyFactory<T extends string, TArgs extends readonly unknown[] = unknown[]>(
  namespace: string,
  type: string,
  formatter: (...args: TArgs) => string,
  parser?: (suffix: string) => Record<string, string> | null
): CacheKeyFactory<T, TArgs> {
  const prefix = type ? `${namespace}:${type}:` : `${namespace}:`;
  
  return {
    key(...args: TArgs): T {
      const suffix = formatter(...args);
      return `${prefix}${suffix}` as T;
    },
    
    parse(key: T): Record<string, string> | null {
      if (!this.matches(key)) return null;
      
      const suffix = key.slice(prefix.length);
      if (parser) {
        return parser(suffix);
      }
      
      // Default parser splits by colon and returns first part as 'id'
      const parts = splitKeyComponents(suffix, ':', true);
      return { id: parts[0] || '' };
    },
    
    matches(key: string): key is T {
      return key.startsWith(prefix);
    },
    
    pattern(): string {
      return `${prefix}*`;
    }
  };
}

/**
 * Create a simple key factory for single ID keys
 * 
 * @param namespace The namespace for this key type
 * @param type The specific type within the namespace
 * @returns A cache key factory for single ID keys
 */
export function createSimpleKeyFactory<T extends string>(
  namespace: string,
  type: string
): CacheKeyFactory<T, [id: string | number]> {
  return createKeyFactory<T, [id: string | number]>(
    namespace,
    type,
    (id) => sanitizeKeyComponent(String(id)),
    (suffix) => ({ id: decodeKeyComponent(suffix) })
  );
}

/**
 * Create a key factory for keys with two IDs
 * 
 * @param namespace The namespace for this key type
 * @param type The specific type within the namespace
 * @param id1Name Name for the first ID in parsed result
 * @param id2Name Name for the second ID in parsed result
 * @returns A cache key factory for dual ID keys
 */
export function createDualKeyFactory<T extends string>(
  namespace: string,
  type: string,
  id1Name = 'id1',
  id2Name = 'id2'
): CacheKeyFactory<T, [id1: string | number, id2: string | number]> {
  return createKeyFactory<T, [id1: string | number, id2: string | number]>(
    namespace,
    type,
    (id1, id2) => 
      `${sanitizeKeyComponent(String(id1))}:${sanitizeKeyComponent(String(id2))}`,
    (suffix) => {
      const parts = splitKeyComponents(suffix, ':', true);
      if (parts.length !== 2) return null;
      return {
        [id1Name]: parts[0] || '',
        [id2Name]: parts[1] || ''
      };
    }
  );
}

/**
 * Create a key factory for paginated lists
 * 
 * @param namespace The namespace for this key type
 * @param type The specific type within the namespace
 * @returns A cache key factory for paginated keys
 */
export function createPaginatedKeyFactory<T extends string>(
  namespace: string,
  type: string
): CacheKeyFactory<T, [id: string | number, page: number, limit: number]> {
  return createKeyFactory<T, [id: string | number, page: number, limit: number]>(
    namespace,
    type,
    (id, page, limit) => 
      `${sanitizeKeyComponent(String(id))}:page_${page}:limit_${limit}`,
    (suffix) => {
      const match = /^(.+?):page_(\d+):limit_(\d+)$/.exec(suffix);
      if (!match) return null;
      return {
        id: decodeKeyComponent(match[1] || ''),
        page: match[2] || '',
        limit: match[3] || '',
      };
    }
  );
}

/**
 * Create a versioned key factory
 * 
 * @param namespace The namespace for this key type
 * @param type The specific type within the namespace
 * @returns A cache key factory for versioned keys
 */
export function createVersionedKeyFactory<T extends string>(
  namespace: string,
  type: string
): CacheKeyFactory<T, [id: string | number, version: number]> {
  return createKeyFactory<T, [id: string | number, version: number]>(
    namespace,
    type,
    (id, version) => `${sanitizeKeyComponent(String(id))}:v${version}`,
    (suffix) => {
      const match = /^(.+?):v(\d+)$/.exec(suffix);
      if (!match) return null;
      return {
        id: decodeKeyComponent(match[1] || ''),
        version: match[2] || '',
      };
    }
  );
}