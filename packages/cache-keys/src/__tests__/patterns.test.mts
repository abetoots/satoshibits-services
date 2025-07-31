import { describe, it, expect } from 'vitest';
import { 
  createInvalidationPattern,
  matchKeys,
  createMultiPattern,
  extractNamespace,
  extractKeyType,
  groupKeysByNamespace,
  createHierarchicalPatterns,
  matchesAnyPattern
} from '../patterns.mjs';
import { createSimpleKeyFactory } from '../factory.mjs';

describe('patterns', () => {
  describe('createInvalidationPattern', () => {
    it('should return factory pattern when no prefix args provided', () => {
      const factory = createSimpleKeyFactory('user', 'profile');
      const pattern = createInvalidationPattern(factory);
      expect(pattern).toBe('user:profile:*');
    });

    it('should create pattern with sanitized prefix arguments', () => {
      const factory = createSimpleKeyFactory('campaign', 'list');
      const pattern = createInvalidationPattern(factory, 'account:123');
      expect(pattern).toBe('campaign:list:_e:YWNjb3VudDoxMjM:*');
    });

    it('should handle multiple prefix arguments', () => {
      const factory = createSimpleKeyFactory('user', 'data');
      const pattern = createInvalidationPattern(factory, 'org:456', 'dept:789');
      expect(pattern).toBe('user:data:_e:b3JnOjQ1Ng:_e:ZGVwdDo3ODk:*');
    });

    it('should handle special characters in prefix arguments', () => {
      const factory = createSimpleKeyFactory('cache', 'entry');
      const pattern = createInvalidationPattern(factory, 'key*with*wildcards');
      expect(pattern).toBe('cache:entry:_e:a2V5KndpdGgqd2lsZGNhcmRz:*');
    });

    it('should handle numeric prefix arguments', () => {
      const factory = createSimpleKeyFactory('item', 'details');
      const pattern = createInvalidationPattern(factory, 12345);
      expect(pattern).toBe('item:details:12345:*');
    });
  });

  describe('matchKeys', () => {
    it('should match exact prefix patterns', () => {
      const keys = ['user:123', 'user:456', 'admin:123', 'user:789:profile'];
      const matches = matchKeys(keys, 'user:*');
      expect(matches).toEqual(['user:123', 'user:456', 'user:789:profile']);
    });

    it('should match patterns with wildcards in the middle', () => {
      const keys = ['user:123:profile', 'user:123:settings', 'user:456:profile'];
      const matches = matchKeys(keys, 'user:*:profile');
      expect(matches).toEqual(['user:123:profile', 'user:456:profile']);
    });

    it('should match exact keys without wildcards', () => {
      const keys = ['user:123', 'user:456', 'user:123:profile'];
      const matches = matchKeys(keys, 'user:123');
      expect(matches).toEqual(['user:123']);
    });

    it('should handle special regex characters in pattern', () => {
      const keys = ['user.123', 'user[123]', 'user+123'];
      const matches = matchKeys(keys, 'user.*');
      expect(matches).toEqual(['user.123']);
    });
  });

  describe('createMultiPattern', () => {
    it('should create regex matching any prefix', () => {
      const regex = createMultiPattern(['user:', 'admin:', 'guest:']);
      expect(regex.test('user:123')).toBe(true);
      expect(regex.test('admin:456')).toBe(true);
      expect(regex.test('guest:789')).toBe(true);
      expect(regex.test('other:000')).toBe(false);
    });

    it('should escape special regex characters', () => {
      const regex = createMultiPattern(['user[id]:', 'admin.user:']);
      expect(regex.test('user[id]:123')).toBe(true);
      expect(regex.test('admin.user:456')).toBe(true);
      expect(regex.test('userid:123')).toBe(false);
    });
  });

  describe('extractNamespace', () => {
    it('should extract namespace from key', () => {
      expect(extractNamespace('user:123:profile')).toBe('user');
      expect(extractNamespace('admin:settings')).toBe('admin');
    });

    it('should return null for invalid keys', () => {
      expect(extractNamespace('nonamespace')).toBe(null);
      expect(extractNamespace('')).toBe(null);
    });

    it('should work with custom separators', () => {
      expect(extractNamespace('user|123|profile', '|')).toBe('user');
      expect(extractNamespace('user-123-profile', '-')).toBe('user');
    });
  });

  describe('extractKeyType', () => {
    it('should extract namespace and type from key', () => {
      const result = extractKeyType('user:profile:123');
      expect(result).toEqual({ namespace: 'user', type: 'profile' });
    });

    it('should return null for invalid keys', () => {
      expect(extractKeyType('user')).toBe(null);
      expect(extractKeyType('')).toBe(null);
    });

    it('should handle empty parts', () => {
      const result = extractKeyType(':profile:123');
      expect(result).toEqual({ namespace: '', type: 'profile' });
    });

    it('should work with custom separators', () => {
      const result = extractKeyType('user|profile|123', '|');
      expect(result).toEqual({ namespace: 'user', type: 'profile' });
    });
  });

  describe('groupKeysByNamespace', () => {
    it('should group keys by namespace', () => {
      const keys = [
        'user:123',
        'user:456',
        'admin:789',
        'admin:012',
        'guest:345'
      ];
      const groups = groupKeysByNamespace(keys);
      
      expect(groups.get('user')).toEqual(['user:123', 'user:456']);
      expect(groups.get('admin')).toEqual(['admin:789', 'admin:012']);
      expect(groups.get('guest')).toEqual(['guest:345']);
    });

    it('should ignore keys without namespace', () => {
      const keys = ['user:123', 'invalid', 'admin:456'];
      const groups = groupKeysByNamespace(keys);
      
      expect(groups.has('invalid')).toBe(false);
      expect(groups.size).toBe(2);
    });

    it('should work with custom separators', () => {
      const keys = ['user|123', 'admin|456'];
      const groups = groupKeysByNamespace(keys, '|');
      
      expect(groups.get('user')).toEqual(['user|123']);
      expect(groups.get('admin')).toEqual(['admin|456']);
    });
  });

  describe('createHierarchicalPatterns', () => {
    it('should create patterns from most to least specific', () => {
      const patterns = createHierarchicalPatterns(['user', '123', 'posts']);
      expect(patterns).toEqual([
        'user:123:posts:*',
        'user:123:*',
        'user:*'
      ]);
    });

    it('should handle single part', () => {
      const patterns = createHierarchicalPatterns(['user']);
      expect(patterns).toEqual(['user:*']);
    });

    it('should work with custom separator', () => {
      const patterns = createHierarchicalPatterns(['a', 'b', 'c'], '|');
      expect(patterns).toEqual(['a|b|c|*', 'a|b|*', 'a|*']);
    });
  });

  describe('matchesAnyPattern', () => {
    it('should return true if key matches any pattern', () => {
      const patterns = ['user:*', 'admin:*:profile'];
      expect(matchesAnyPattern('user:123', patterns)).toBe(true);
      expect(matchesAnyPattern('admin:456:profile', patterns)).toBe(true);
      expect(matchesAnyPattern('guest:789', patterns)).toBe(false);
    });

    it('should return false for empty patterns', () => {
      expect(matchesAnyPattern('user:123', [])).toBe(false);
    });

    it('should handle complex patterns efficiently', () => {
      const patterns = [
        'user:*:profile',
        'user:*:settings',
        'admin:*',
        'guest:vip:*',
        'system:*:config:*'
      ];
      
      expect(matchesAnyPattern('user:123:profile', patterns)).toBe(true);
      expect(matchesAnyPattern('admin:anything', patterns)).toBe(true);
      expect(matchesAnyPattern('system:app:config:debug', patterns)).toBe(true);
      expect(matchesAnyPattern('other:123', patterns)).toBe(false);
    });

    it('should handle special characters in patterns', () => {
      // In cache patterns, * is always a wildcard
      // Pattern 'user[*]:*' means: 'user[' + anything + ']:' + anything
      const patterns = ['user[*]:*', 'admin.*:*'];
      
      // 'user[*]:*' matches both because * is a wildcard
      expect(matchesAnyPattern('user[*]:anything', patterns)).toBe(true);
      expect(matchesAnyPattern('user[123]:profile', patterns)).toBe(true);
      expect(matchesAnyPattern('user[]:empty', patterns)).toBe(true);
      
      // 'admin.*:*' means 'admin.' + anything + ':' + anything
      expect(matchesAnyPattern('admin.*:anything', patterns)).toBe(true);
      expect(matchesAnyPattern('admin.test:config', patterns)).toBe(true);
      expect(matchesAnyPattern('admin.:empty', patterns)).toBe(true);
      
      // These don't match the patterns
      expect(matchesAnyPattern('user:123', patterns)).toBe(false);
      expect(matchesAnyPattern('admin:test', patterns)).toBe(false);
    });
  });
});