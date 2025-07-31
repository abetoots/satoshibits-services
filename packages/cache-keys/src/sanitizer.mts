import type { SanitizeOptions } from './types.mjs';

/**
 * Prefix for encoded components to make decoding deterministic
 */
const ENCODING_PREFIX = '_e:';

/**
 * Default base64url encoder
 */
function base64urlEncode(str: string): string {
  // Use btoa for browser compatibility, with Buffer as fallback for Node
  const base64 = typeof globalThis.Buffer !== 'undefined' 
    ? globalThis.Buffer.from(str).toString('base64')
    : globalThis.btoa(str);
  
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Default base64url decoder
 */
export function base64urlDecode(str: string): string {
  // Validate base64url format
  if (!/^[A-Za-z0-9_-]*$/.test(str)) {
    throw new Error('Invalid base64url string');
  }
  
  // Add padding if needed
  const padding = '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + padding;
  
  // Use Buffer for Node, atob for browser
  return typeof globalThis.Buffer !== 'undefined'
    ? globalThis.Buffer.from(base64, 'base64').toString()
    : globalThis.atob(base64);
}

/**
 * Sanitize a cache key component to prevent injection attacks
 * @param component The component to sanitize
 * @param options Sanitization options
 * @returns Sanitized component
 */
export function sanitizeKeyComponent(
  component: string,
  options: SanitizeOptions = {}
): string {
  const { allowColons = false, encoder = base64urlEncode } = options;
  
  // For components that might contain special characters
  if (!allowColons && component.includes(':')) {
    return ENCODING_PREFIX + encoder(component);
  }
  
  // Check for pattern-matching wildcards or other dangerous characters
  const dangerousChars = /[*?[\]\\@]/g;
  if (dangerousChars.test(component)) {
    return ENCODING_PREFIX + encoder(component);
  }
  
  return component;
}

/**
 * Attempt to decode a potentially encoded component
 * @param component The component that might be encoded
 * @returns Decoded component or original if not encoded
 */
export function decodeKeyComponent(component: string): string {
  // Only decode if it has our encoding prefix
  if (component.startsWith(ENCODING_PREFIX)) {
    const encodedPart = component.substring(ENCODING_PREFIX.length);
    
    // Handle empty encoded part
    if (!encodedPart) {
      return '';
    }
    
    try {
      return base64urlDecode(encodedPart);
    } catch {
      // If decoding fails, return the component as-is to be safe
      return component;
    }
  }
  
  return component;
}

/**
 * Validate that a key component is safe to use
 * @param component The component to validate
 * @returns true if the component is safe
 */
export function isValidKeyComponent(component: string): boolean {
  // Empty components are not allowed
  if (!component || component.length === 0) {
    return false;
  }
  
  // Check for null bytes or other control characters
  if (/[\x00-\x1F\x7F]/.test(component)) {
    return false;
  }
  
  return true;
}

/**
 * Join multiple components into a cache key
 * @param components Components to join
 * @param separator Separator between components
 * @param sanitize Whether to sanitize components
 * @returns Joined cache key
 */
export function joinKeyComponents(
  components: string[],
  separator = ':',
  sanitize = true
): string {
  if (sanitize) {
    components = components.map(c => sanitizeKeyComponent(c));
  }
  
  // Validate all components
  if (!components.every(isValidKeyComponent)) {
    throw new Error('Invalid key component detected');
  }
  
  return components.join(separator);
}

/**
 * Split a cache key into components
 * @param key The key to split
 * @param separator Separator between components
 * @param decode Whether to decode components
 * @returns Array of components
 */
export function splitKeyComponents(
  key: string,
  separator = ':',
  decode = true
): string[] {
  const components: string[] = [];
  let current = '';
  let i = 0;
  
  while (i < key.length) {
    // Check if we're at the start of an encoded component
    if (key.slice(i).startsWith(ENCODING_PREFIX)) {
      // If we have accumulated content, push it as a component
      if (current) {
        components.push(current);
        current = '';
      }
      
      // Find the next separator after the encoding prefix
      const prefixEnd = i + ENCODING_PREFIX.length;
      let nextSeparator = key.indexOf(separator, prefixEnd);
      
      // If no separator found, the rest of the string is the encoded component
      if (nextSeparator === -1) {
        components.push(key.slice(i));
        break;
      }
      
      // Extract the encoded component including the prefix
      components.push(key.slice(i, nextSeparator));
      i = nextSeparator + separator.length;
    } else if (key[i] === separator) {
      // Regular separator - push current component if any
      if (current || components.length > 0) {
        components.push(current);
        current = '';
      }
      i++;
    } else {
      // Regular character - add to current component
      current += key[i];
      i++;
    }
  }
  
  // Don't forget the last component
  if (current) {
    components.push(current);
  }
  
  if (decode) {
    return components.map(decodeKeyComponent);
  }
  
  return components;
}