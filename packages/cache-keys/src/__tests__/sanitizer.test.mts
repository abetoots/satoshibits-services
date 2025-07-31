import { describe, it, expect } from 'vitest';
import {
  sanitizeKeyComponent,
  decodeKeyComponent,
  isValidKeyComponent,
  joinKeyComponents,
  splitKeyComponents
} from '../sanitizer.mjs';

describe('sanitizeKeyComponent', () => {
  it('allows normal characters', () => {
    expect(sanitizeKeyComponent('abc123')).toBe('abc123');
    expect(sanitizeKeyComponent('user-id')).toBe('user-id');
    expect(sanitizeKeyComponent('test_component')).toBe('test_component');
  });

  it('encodes components with colons', () => {
    const result = sanitizeKeyComponent('user:admin');
    expect(result).toMatch(/^_e:/); // Should start with encoding prefix
    expect(result).not.toContain('user:admin'); // Original string should be encoded
    expect(decodeKeyComponent(result)).toBe('user:admin');
  });

  it('encodes components with dangerous characters', () => {
    const result = sanitizeKeyComponent('user*');
    expect(result).not.toContain('*');
    expect(decodeKeyComponent(result)).toBe('user*');
  });

  it('allows colons when specified', () => {
    expect(sanitizeKeyComponent('part1:part2', { allowColons: true })).toBe('part1:part2');
  });

  it('encodes empty string', () => {
    const result = sanitizeKeyComponent('');
    expect(result).toBe('');
  });

  it('handles unicode characters', () => {
    const unicode = 'café☕';
    const result = sanitizeKeyComponent(unicode);
    expect(result).toBe(unicode); // Unicode is allowed
  });

  it('encodes backslashes', () => {
    const result = sanitizeKeyComponent('path\\to\\file');
    expect(result).toMatch(/^_e:/);
    expect(decodeKeyComponent(result)).toBe('path\\to\\file');
  });

  it('encodes square brackets', () => {
    const result = sanitizeKeyComponent('array[0]');
    expect(result).toMatch(/^_e:/);
    expect(decodeKeyComponent(result)).toBe('array[0]');
  });

  it('encodes at symbols', () => {
    const result = sanitizeKeyComponent('user@domain');
    expect(result).toMatch(/^_e:/);
    expect(decodeKeyComponent(result)).toBe('user@domain');
  });

  it('encodes question marks', () => {
    const result = sanitizeKeyComponent('query?param');
    expect(result).toMatch(/^_e:/);
    expect(decodeKeyComponent(result)).toBe('query?param');
  });

  it('uses custom encoder', () => {
    const customEncoder = (str: string) => 'custom_' + str;
    const result = sanitizeKeyComponent('test:value', { encoder: customEncoder });
    expect(result).toBe('_e:custom_test:value');
  });
});

describe('decodeKeyComponent', () => {
  it('returns original if not encoded', () => {
    expect(decodeKeyComponent('plain-text')).toBe('plain-text');
  });

  it('decodes base64url encoded components', () => {
    const encoded = '_e:dGVzdDp2YWx1ZQ';
    expect(decodeKeyComponent(encoded)).toBe('test:value');
  });

  it('handles malformed encoded strings gracefully', () => {
    const malformed = '_e:invalid!!!';
    // Should return original string when decoding fails
    expect(decodeKeyComponent(malformed)).toBe(malformed);
  });

  it('handles empty encoding prefix', () => {
    // Empty encoded content represents an empty string
    expect(decodeKeyComponent('_e:')).toBe('');
    
    // Verify round-trip: empty string -> encode -> decode
    const encoded = sanitizeKeyComponent('');
    expect(encoded).toBe(''); // Empty string doesn't need encoding
  });
});

describe('isValidKeyComponent', () => {
  it('validates normal components', () => {
    expect(isValidKeyComponent('abc123')).toBe(true);
    expect(isValidKeyComponent('user-id')).toBe(true);
  });

  it('rejects empty components', () => {
    expect(isValidKeyComponent('')).toBe(false);
  });

  it('rejects components with control characters', () => {
    expect(isValidKeyComponent('test\x00null')).toBe(false);
    expect(isValidKeyComponent('test\x1Fcontrol')).toBe(false);
  });
});

describe('joinKeyComponents', () => {
  it('joins components with default separator', () => {
    expect(joinKeyComponents(['user', 'profile', '123'])).toBe('user:profile:123');
  });

  it('joins components with custom separator', () => {
    expect(joinKeyComponents(['api', 'v1', 'users'], '/')).toBe('api/v1/users');
  });

  it('sanitizes components when requested', () => {
    const result = joinKeyComponents(['user', 'test:admin', '123'], ':', true);
    expect(result).not.toBe('user:test:admin:123');
    // The encoded component will contain colons in the form '_e:...'
    // So we need to use splitKeyComponents to decode properly
    const parts = splitKeyComponents(result, ':', true);
    expect(parts).toEqual(['user', 'test:admin', '123']);
  });

  it('throws on invalid components', () => {
    expect(() => joinKeyComponents(['valid', '', 'component'])).toThrow('Invalid key component');
  });
});

describe('splitKeyComponents', () => {
  it('splits keys with default separator', () => {
    expect(splitKeyComponents('user:profile:123')).toEqual(['user', 'profile', '123']);
  });

  it('splits keys with custom separator', () => {
    expect(splitKeyComponents('api/v1/users', '/')).toEqual(['api', 'v1', 'users']);
  });

  it('decodes components when requested', () => {
    const encoded = sanitizeKeyComponent('test:admin');
    const key = `user:${encoded}:123`;
    const parts = splitKeyComponents(key, ':', true);
    expect(parts).toEqual(['user', 'test:admin', '123']);
  });

  it('does not decode when disabled', () => {
    const encoded = sanitizeKeyComponent('test:admin');
    const key = `user:${encoded}:123`;
    const parts = splitKeyComponents(key, ':', false);
    expect(parts[1]).toBe(encoded);
  });
});