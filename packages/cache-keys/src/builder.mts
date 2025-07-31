import type { KeyBuilderOptions, ID } from './types.mjs';
import { sanitizeKeyComponent, joinKeyComponents } from './sanitizer.mjs';

/**
 * Fluent builder for creating complex cache keys
 */
export class CacheKeyBuilder {
  private parts: string[] = [];
  private options: Required<KeyBuilderOptions>;
  
  constructor(options: KeyBuilderOptions = {}) {
    this.options = {
      separator: options.separator || ':',
      sanitize: options.sanitize !== false,
    };
  }
  
  /**
   * Create a new CacheKeyBuilder instance
   */
  static create(options?: KeyBuilderOptions): CacheKeyBuilder {
    return new CacheKeyBuilder(options);
  }
  
  /**
   * Add a namespace component
   */
  namespace(namespace: string): this {
    if (this.options.sanitize) {
      this.parts.push(sanitizeKeyComponent(namespace));
    } else {
      this.parts.push(namespace);
    }
    return this;
  }
  
  /**
   * Add a type component
   */
  type(type: string): this {
    if (this.options.sanitize) {
      this.parts.push(sanitizeKeyComponent(type));
    } else {
      this.parts.push(type);
    }
    return this;
  }
  
  /**
   * Add an ID component
   */
  id(id: ID): this {
    let idStr: string;
    try {
      idStr = typeof id === 'object' ? id.toString() : String(id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to convert ID to string: ${message}`);
    }
    
    if (this.options.sanitize) {
      this.parts.push(sanitizeKeyComponent(idStr));
    } else {
      this.parts.push(idStr);
    }
    return this;
  }
  
  /**
   * Add a parameter with key-value format
   */
  param(key: string, value: string | number): this {
    const paramStr = `${key}_${value}`;
    if (this.options.sanitize) {
      this.parts.push(sanitizeKeyComponent(paramStr));
    } else {
      this.parts.push(paramStr);
    }
    return this;
  }
  
  /**
   * Add a version component
   */
  version(version: number): this {
    const versionStr = `v${version}`;
    if (this.options.sanitize) {
      this.parts.push(sanitizeKeyComponent(versionStr));
    } else {
      this.parts.push(versionStr);
    }
    return this;
  }
  
  /**
   * Add a custom component
   */
  add(component: string): this {
    if (this.options.sanitize) {
      this.parts.push(sanitizeKeyComponent(component));
    } else {
      this.parts.push(component);
    }
    return this;
  }
  
  /**
   * Add multiple components at once
   */
  addAll(...components: string[]): this {
    components.forEach(c => this.add(c));
    return this;
  }
  
  /**
   * Build the final cache key
   */
  build<T extends string = string>(): T {
    if (this.parts.length === 0) {
      throw new Error('Cannot build empty cache key');
    }
    
    return joinKeyComponents(
      this.parts, 
      this.options.separator, 
      false // Already sanitized if needed
    ) as T;
  }
  
  /**
   * Build a pattern for matching (adds wildcard at the end)
   */
  pattern(): string {
    return this.build() + this.options.separator + '*';
  }
  
  /**
   * Reset the builder
   */
  reset(): this {
    this.parts = [];
    return this;
  }
  
  /**
   * Clone the current builder state
   */
  clone(): CacheKeyBuilder {
    const newBuilder = new CacheKeyBuilder(this.options);
    newBuilder.parts = [...this.parts];
    return newBuilder;
  }
  
  /**
   * Get the current number of parts
   */
  get length(): number {
    return this.parts.length;
  }
}

/**
 * Create a cache key from a template string with replacements
 * 
 * @param template Template string with placeholders like {id}
 * @param values Values to replace in the template
 * @param sanitize Whether to sanitize the values
 * @returns The formatted cache key
 * 
 * @example
 * fromTemplate('user:{id}:profile', { id: '123' }) // 'user:123:profile'
 */
export function fromTemplate(
  template: string,
  values: Record<string, string | number | ID>,
  sanitize = true
): string {
  return template.replace(/{(\w+)}/g, (match, key) => {
    if (!(key in values)) {
      throw new Error(`Missing value for placeholder: ${key}`);
    }
    
    const value = values[key];
    let strValue: string;
    try {
      strValue = typeof value === 'object' ? value.toString() : String(value);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to convert value for placeholder '${key}' to string: ${message}`);
    }
    
    return sanitize ? sanitizeKeyComponent(strValue) : strValue;
  });
}

/**
 * Create a scoped key builder that always starts with specific components
 * 
 * @param baseComponents Initial components for all keys
 * @param options Builder options
 * @returns A new key builder with the base components
 */
export function scopedBuilder(
  baseComponents: string[],
  options?: KeyBuilderOptions
): CacheKeyBuilder {
  const builder = new CacheKeyBuilder(options);
  baseComponents.forEach(component => builder.add(component));
  return builder;
}