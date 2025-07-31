import { describe, it, expect } from 'vitest';
import {
  createKeyFactory,
  createSimpleKeyFactory,
  createDualKeyFactory,
  createPaginatedKeyFactory,
  createVersionedKeyFactory
} from '../factory.mjs';
import { sanitizeKeyComponent } from '../sanitizer.mjs';

describe('createSimpleKeyFactory', () => {
  const factory = createSimpleKeyFactory<`user:profile:${string}`>('user', 'profile');

  it('generates correct keys', () => {
    expect(factory.key('123')).toBe('user:profile:123');
    expect(factory.key(456)).toBe('user:profile:456');
  });

  it('matches keys correctly', () => {
    expect(factory.matches('user:profile:123')).toBe(true);
    expect(factory.matches('user:settings:123')).toBe(false);
    expect(factory.matches('account:profile:123')).toBe(false);
  });

  it('returns correct pattern', () => {
    expect(factory.pattern()).toBe('user:profile:*');
  });

  it('parses keys correctly', () => {
    expect(factory.parse('user:profile:123' as any)).toEqual({ id: '123' });
    expect(factory.parse('invalid:key' as any)).toBeNull();
  });

  it('handles IDs with colons correctly', () => {
    const key = factory.key('user:special:id');
    expect(key).toBe('user:profile:_e:dXNlcjpzcGVjaWFsOmlk');
    const parsed = factory.parse(key as any);
    expect(parsed).toEqual({ id: 'user:special:id' });
  });
});

describe('createDualKeyFactory', () => {
  const factory = createDualKeyFactory<`relation:follows:${string}:${string}`>(
    'relation',
    'follows',
    'userId',
    'targetId'
  );

  it('generates correct keys', () => {
    expect(factory.key('user1', 'user2')).toBe('relation:follows:user1:user2');
    expect(factory.key(123, 456)).toBe('relation:follows:123:456');
  });

  it('parses keys correctly', () => {
    expect(factory.parse('relation:follows:user1:user2' as any)).toEqual({
      userId: 'user1',
      targetId: 'user2'
    });
  });

  it('handles IDs with colons correctly', () => {
    const key = factory.key('org:123', 'team:456');
    expect(key).toBe('relation:follows:_e:b3JnOjEyMw:_e:dGVhbTo0NTY');
    const parsed = factory.parse(key as any);
    expect(parsed).toEqual({
      userId: 'org:123',
      targetId: 'team:456'
    });
  });
});

describe('createPaginatedKeyFactory', () => {
  const factory = createPaginatedKeyFactory<`posts:list:${string}:page_${number}:limit_${number}`>(
    'posts',
    'list'
  );

  it('generates correct keys', () => {
    expect(factory.key('user123', 1, 20)).toBe('posts:list:user123:page_1:limit_20');
  });

  it('parses keys correctly', () => {
    expect(factory.parse('posts:list:user123:page_2:limit_50' as any)).toEqual({
      id: 'user123',
      page: '2',
      limit: '50'
    });
  });
});

describe('createVersionedKeyFactory', () => {
  const factory = createVersionedKeyFactory<`api:schema:${string}:v${number}`>(
    'api',
    'schema'
  );

  it('generates correct keys', () => {
    expect(factory.key('users', 2)).toBe('api:schema:users:v2');
  });

  it('parses keys correctly', () => {
    expect(factory.parse('api:schema:users:v3' as any)).toEqual({
      id: 'users',
      version: '3'
    });
  });
});

describe('createKeyFactory with custom formatter', () => {
  const factory = createKeyFactory<
    `metrics:${string}:${string}:${string}`,
    [metric: string, date: string, hour: number]
  >(
    'metrics',
    '',
    (metric, date, hour) => `${metric}:${date}:h${hour}`,
    (suffix) => {
      const match = /^(.+):(.+):h(\d+)$/.exec(suffix);
      if (!match) return null;
      return {
        metric: match[1] || '',
        date: match[2] || '',
        hour: match[3] || ''
      };
    }
  );

  it('generates correct keys', () => {
    expect(factory.key('pageviews', '2024-01-15', 14)).toBe('metrics:pageviews:2024-01-15:h14');
  });

  it('parses keys correctly', () => {
    expect(factory.parse('metrics:pageviews:2024-01-15:h14' as any)).toEqual({
      metric: 'pageviews',
      date: '2024-01-15',
      hour: '14'
    });
  });
});

describe('createKeyFactory with default parser', () => {
  const factory = createKeyFactory<`custom:type:${string}`, [id: string]>(
    'custom',
    'type',
    (id) => sanitizeKeyComponent(id),
    undefined // Use default parser
  );

  it('handles IDs with colons using default parser', () => {
    const key = factory.key('item:with:colons');
    expect(key).toBe('custom:type:_e:aXRlbTp3aXRoOmNvbG9ucw');
    const parsed = factory.parse(key as any);
    expect(parsed).toEqual({ id: 'item:with:colons' });
  });
});