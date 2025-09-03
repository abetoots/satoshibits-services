/**
 * Data Sanitizer for PII Protection
 *
 * Removes or masks sensitive information before sending to backends.
 * Protects user privacy and ensures compliance with data regulations.
 */

import { LRUCache } from "lru-cache";

import { getUnifiedClientInstance } from "../client-instance.mjs";

/**
 * A value that has been sanitized and is safe for serialization.
 * It consists of primitives, plain objects, or arrays of SanitizedValue.
 */
export type SanitizedValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | { [key: string]: SanitizedValue }
  | SanitizedValue[];

/**
 * Marker for circular references detected during sanitization.
 * Returns a simple string sentinel that is clean and readable in logs.
 */
const CIRCULAR_MARKER = "[CIRCULAR]" as const;

/**
 * Sensitive field patterns to redact
 */
const SENSITIVE_FIELD_PATTERNS = [
  // Authentication
  /password/i,
  /passwd/i,
  /pwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /apikey/i,
  /auth/i,
  /credential/i,
  /private[_-]?key/i,

  // Personal Information
  /ssn/i,
  /social[_-]?security/i,
  /tax[_-]?id/i,
  /driver[_-]?license/i,
  /passport/i,
  /birth[_-]?date/i,
  /dob/i,

  // Financial
  /credit[_-]?card/i,
  /card[_-]?number/i,
  /cvv/i,
  /cvc/i,
  /bank[_-]?account/i,
  /routing[_-]?number/i,
  /iban/i,
  /swift/i,

  // Contact Info (when marked sensitive)
  /phone/i,
  /mobile/i,
  /cell/i,
  /address/i,
  /street/i,
  /zip/i,
  /postal/i,

  // Medical
  /medical/i,
  /health/i,
  /diagnosis/i,
  /prescription/i,
  /medication/i,
];

/**
 * Patterns for sensitive data in strings
 */
const SENSITIVE_PATTERNS = {
  // Credit card numbers (basic pattern)
  creditCard: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g,

  // SSN (US)
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,

  // Email (only mask domain if needed)
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,

  // Phone numbers (various formats)
  phone: /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,

  // IP addresses (IPv4)
  ipv4: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,

  // JWT tokens
  jwt: /\beyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g,

  // API keys (common patterns)
  apiKey: /\b[A-Za-z0-9]{32,}\b/g,

  // UUIDs (might be user IDs)
  uuid: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
};

/**
 * Sanitizer options
 */
export interface SanitizerOptions {
  /** Enable email masking */
  maskEmails?: boolean;

  /** Enable phone masking */
  maskPhones?: boolean;

  /** Enable IP masking */
  maskIPs?: boolean;

  /** Enable UUID masking */
  maskUUIDs?: boolean;

  /** Custom fields to always redact */
  customRedactFields?: string[];

  /** Custom patterns to mask */
  customPatterns?: { pattern: RegExp; replacement: string }[];

  /** Redaction string */
  redactionString?: string;

  /** Max depth for object traversal */
  maxDepth?: number;

  /** Enable strict mode (more aggressive sanitization) */
  strictMode?: boolean;
}

/**
 * Predefined sanitizer presets for common compliance requirements
 *
 * Applications can use these presets as starting points and customize them
 * based on their specific requirements.
 */
export class SanitizerPresets {
  /**
   * Minimal sanitization - Only credit cards and SSNs
   *
   * Use for: Internal tools, development environments, trusted contexts
   *
   * Masks:
   * - Credit card numbers (always)
   * - SSN (always)
   * - JWT tokens (always)
   * - Passwords (always)
   */
  static minimal(): SanitizerOptions {
    return {
      maskEmails: false,
      maskPhones: false,
      maskIPs: false,
      maskUUIDs: false,
      strictMode: false,
      customRedactFields: [],
      customPatterns: [],
      redactionString: "[REDACTED]",
      maxDepth: 10,
    };
  }

  /**
   * GDPR-compliant preset (European Union)
   *
   * Use for: EU-based applications, EU users
   *
   * Masks:
   * - Emails (personal data)
   * - Phone numbers (personal data)
   * - IP addresses (personal data under GDPR)
   * - Credit cards, SSNs, JWT tokens, passwords (always)
   *
   * Strict mode: Enabled (includes aggressive field name matching)
   */
  static gdpr(): SanitizerOptions {
    return {
      maskEmails: true,
      maskPhones: true,
      maskIPs: true,
      maskUUIDs: false, // correlation IDs, not PII
      strictMode: true,
      customRedactFields: [],
      customPatterns: [],
      redactionString: "[REDACTED]",
      maxDepth: 10,
    };
  }

  /**
   * CCPA-compliant preset (California Consumer Privacy Act)
   *
   * Use for: California-based users, US applications
   *
   * Masks:
   * - Emails (personal information)
   * - Phone numbers (personal information)
   * - IP addresses (California considers IPs as personal information)
   * - Credit cards, SSNs, JWT tokens, passwords (always)
   *
   * Strict mode: Disabled (less strict than GDPR)
   */
  static ccpa(): SanitizerOptions {
    return {
      maskEmails: true,
      maskPhones: true,
      maskIPs: true,
      maskUUIDs: false,
      strictMode: false,
      customRedactFields: [],
      customPatterns: [],
      redactionString: "[REDACTED]",
      maxDepth: 10,
    };
  }

  /**
   * HIPAA-compliant preset (Health Insurance Portability and Accountability Act)
   *
   * Use for: Healthcare applications, medical records, patient data
   *
   * Masks:
   * - All standard PII (emails, phones, IPs)
   * - UUIDs (more conservative for healthcare)
   * - Healthcare-specific fields (MRN, diagnosis, prescription, etc.)
   * - Credit cards, SSNs, JWT tokens, passwords (always)
   *
   * Strict mode: Enabled (most conservative preset)
   *
   * Custom fields:
   * - ssn, mrn, patient_id, medical_record_number
   * - diagnosis, prescription, insurance_number
   *
   * IMPORTANT: This preset provides a strong baseline for HIPAA compliance, but
   * applications MUST review their data models and extend `customRedactFields`
   * to ensure all Protected Health Information (PHI) is properly redacted.
   * This library provides the mechanism; your application must define the complete
   * policy based on the specific PHI you handle.
   */
  static hipaa(): SanitizerOptions {
    return {
      maskEmails: true,
      maskPhones: true,
      maskIPs: true,
      maskUUIDs: true, // more conservative for healthcare
      strictMode: true,
      customRedactFields: [
        "ssn",
        "mrn",
        "patient_id",
        "medical_record_number",
        "diagnosis",
        "prescription",
        "insurance_number",
      ],
      customPatterns: [],
      redactionString: "[REDACTED]",
      maxDepth: 10,
    };
  }

  /**
   * Internal tools preset (minimal sanitization for trusted environments)
   *
   * Use for: Internal dashboards, admin panels, development tools
   *
   * Masks:
   * - Credit cards (always)
   * - SSNs (always)
   * - JWT tokens (always)
   * - Passwords (always)
   *
   * Does NOT mask:
   * - Emails (needed for support/debugging)
   * - Phone numbers (needed for support/debugging)
   * - IP addresses (needed for debugging)
   *
   * Strict mode: Disabled
   */
  static internal(): SanitizerOptions {
    return {
      maskEmails: false,
      maskPhones: false,
      maskIPs: false,
      maskUUIDs: false,
      strictMode: false,
      customRedactFields: [],
      customPatterns: [],
      redactionString: "[REDACTED]",
      maxDepth: 10,
    };
  }
}

/**
 * Data sanitizer for removing PII
 */
export class DataSanitizer {
  private options: Required<SanitizerOptions>;
  private stringCache: LRUCache<string, string>;
  private readonly optionsCacheKey: string;
  private readonly cacheTTL: number = 0; // TTL removed per consensus decision

  constructor(options: SanitizerOptions = {}) {
    this.options = {
      maskEmails: options.maskEmails ?? false,
      maskPhones: options.maskPhones ?? false, // align with minimal preset
      maskIPs: options.maskIPs ?? false,
      maskUUIDs: options.maskUUIDs ?? false,
      customRedactFields: options.customRedactFields ?? [],
      customPatterns: options.customPatterns ?? [],
      redactionString: options.redactionString ?? "[REDACTED]",
      maxDepth: options.maxDepth ?? 10,
      strictMode: options.strictMode ?? false,
    };

    // Pre-calculate the options part of the cache key for performance
    this.optionsCacheKey = JSON.stringify(this.options);

    // Initialize LRU cache for string sanitization
    // Max 1000 items
    this.stringCache = new LRUCache<string, string>({
      max: 1000,
    });
  }

  /**
   * Sanitize any value
   */
  sanitize(
    value: unknown,
    depth = 0,
    visitedObjects?: WeakSet<object>
  ): SanitizedValue {
    // Create fresh WeakSet for top-level calls (call-scoped circular detection)
    if (depth === 0 && !visitedObjects) {
      visitedObjects = new WeakSet<object>();
    }

    // Prevent infinite recursion
    if (depth >= this.options.maxDepth) {
      return "[MAX_DEPTH_EXCEEDED]";
    }

    // Handle null/undefined
    if (value === null || value === undefined) {
      return value;
    }

    // Handle primitives
    if (typeof value === "string") {
      return this.sanitizeString(value);
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item, depth + 1, visitedObjects));
    }

    // Handle objects
    if (typeof value === "object") {
      return this.sanitizeObject(value as Record<string, unknown>, depth, visitedObjects!);
    }

    // For other types like functions and symbols, we can't serialize them
    // so we return a string representation of their type.
    return `[Unsupported type: ${typeof value}]`;
  }

  /**
   * Sanitize a string value
   */
  private sanitizeString(value: string): string {
    // Check cache first using pre-calculated options key
    const cacheKey = `${value}:${this.optionsCacheKey}`;
    const cached = this.stringCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    let sanitized = value;

    // Apply pattern-based masking
    sanitized = this.maskSensitivePatterns(sanitized);

    // Apply custom patterns
    for (const { pattern, replacement } of this.options.customPatterns) {
      sanitized = sanitized.replace(pattern, replacement);
    }

    // Cache the result
    this.stringCache.set(cacheKey, sanitized);

    return sanitized;
  }

  /**
   * Mask sensitive patterns in a string
   */
  private maskSensitivePatterns(value: string): string {
    let masked = value;

    // Always mask credit cards and SSNs
    masked = masked.replace(
      SENSITIVE_PATTERNS.creditCard,
      this.options.redactionString,
    );
    masked = masked.replace(
      SENSITIVE_PATTERNS.ssn,
      this.options.redactionString,
    );

    // Always mask JWT tokens and API keys
    masked = masked.replace(
      SENSITIVE_PATTERNS.jwt,
      this.options.redactionString,
    );

    // Mask password values (password: <value>)
    masked = masked.replace(/\b(password|passwd|pwd):\s*\S+/gi, (match) => {
      const [key] = match.split(":");
      return `${key}: ${this.options.redactionString}`;
    });

    // Conditionally mask other patterns
    if (this.options.maskEmails) {
      masked = masked.replace(SENSITIVE_PATTERNS.email, (match) => {
        const [local, domain] = match.split("@");
        return `${local?.charAt(0)}***@${domain}`;
      });
    }

    if (this.options.maskPhones) {
      masked = masked.replace(SENSITIVE_PATTERNS.phone, (match) => {
        return match.replace(/\d/g, "*").replace(/\*{3,}/g, "***");
      });
    }

    if (this.options.maskIPs) {
      masked = masked.replace(SENSITIVE_PATTERNS.ipv4, "***.***.***");
    }

    if (this.options.maskUUIDs) {
      masked = masked.replace(
        SENSITIVE_PATTERNS.uuid,
        "********-****-****-****-************",
      );
    }

    // In strict mode, mask potential API keys
    if (this.options.strictMode) {
      masked = masked.replace(
        SENSITIVE_PATTERNS.apiKey,
        this.options.redactionString,
      );
    }

    return masked;
  }

  /**
   * Sanitize an object
   */
  private sanitizeObject(
    obj: Record<string, unknown>,
    depth: number,
    visitedObjects: WeakSet<object>,
  ): SanitizedValue {
    // Prevent circular references
    if (visitedObjects.has(obj)) {
      return CIRCULAR_MARKER;
    }

    visitedObjects.add(obj);

    const sanitized: Record<string, SanitizedValue> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Check if field should be redacted based on key name
      // But only redact primitive values, not objects
      if (this.shouldRedactField(key) && typeof value !== "object") {
        sanitized[key] = this.options.redactionString;
      } else {
        // Recursively sanitize the value
        sanitized[key] = this.sanitize(value, depth + 1, visitedObjects);
      }
    }

    // No need to delete - WeakSet is call-scoped and will be GC'd when sanitize() completes

    return sanitized;
  }

  /**
   * Check if a field should be redacted based on its name
   */
  public shouldRedactField(fieldName: string): boolean {
    // Check custom redact fields
    if (this.options.customRedactFields.includes(fieldName)) {
      return true;
    }

    // Check against sensitive patterns
    for (const pattern of SENSITIVE_FIELD_PATTERNS) {
      if (pattern.test(fieldName)) {
        return true;
      }
    }

    // In strict mode, also redact fields that look like they might be sensitive
    if (this.options.strictMode) {
      const strictPatterns = [
        /key$/i,
        /^id$/i,
        /user/i,
        /customer/i,
        /client/i,
        /account/i,
      ];

      for (const pattern of strictPatterns) {
        if (pattern.test(fieldName)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Sanitize error object (special handling for stack traces)
   */
  sanitizeError(error: Error): Error {
    const sanitized = new Error(this.sanitizeString(error.message));
    sanitized.name = error.name;

    if (error.stack) {
      // Sanitize stack trace but preserve structure
      sanitized.stack = this.sanitizeString(error.stack);
    }

    // Copy and sanitize any additional properties
    for (const key of Object.keys(error)) {
      if (key !== "message" && key !== "name" && key !== "stack") {
        const value = Reflect.get(error, key) as unknown;
        // Check if the property name itself should be redacted
        if (this.shouldRedactField(key)) {
          Reflect.set(sanitized, key, this.options.redactionString);
        } else {
          Reflect.set(sanitized, key, this.sanitize(value));
        }
      }
    }

    return sanitized;
  }

  /**
   * Create a sanitized copy of labels for metrics
   */
  sanitizeLabels(labels: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(labels)) {
      if (this.shouldRedactField(key)) {
        sanitized[key] = this.options.redactionString;
      } else {
        sanitized[key] = this.sanitizeString(value);
      }
    }

    return sanitized;
  }

  /**
   * Clear the string cache
   */
  clearCache(): void {
    this.stringCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; max: number; ttl: number } {
    return {
      size: this.stringCache.size,
      max: this.stringCache.max,
      ttl: this.cacheTTL,
    };
  }
}

interface SanitizationContext {
  tenantId?: string;
  region?: string;
}

/**
 * Sanitizer Manager for multi-tenant support
 * Allows different sanitization rules per tenant or region
 */
export class SanitizerManager {
  private defaultSanitizer: DataSanitizer;
  private defaultOptions?: SanitizerOptions;
  private tenantSanitizers: LRUCache<string, DataSanitizer>;
  private tenantConfigProvider?: (
    context: SanitizationContext,
  ) => SanitizerOptions | undefined;
  private contextProvider?: () => SanitizationContext | undefined;

  constructor(
    defaultOptions?: SanitizerOptions,
    config?: {
      maxTenantSanitizers?: number;
      tenantConfigProvider?: (
        context: SanitizationContext,
      ) => SanitizerOptions | undefined;
      contextProvider?: () => SanitizationContext | undefined;
    },
  ) {
    this.defaultOptions = defaultOptions;
    this.defaultSanitizer = new DataSanitizer(defaultOptions);
    this.tenantSanitizers = new LRUCache<string, DataSanitizer>({
      max: config?.maxTenantSanitizers ?? 100,
    });
    this.tenantConfigProvider = config?.tenantConfigProvider;
    this.contextProvider = config?.contextProvider;
  }

  /**
   * Get sanitizer for given context (tenant-aware)
   */
  getSanitizer(context?: SanitizationContext): DataSanitizer {
    // No context or no tenant ID - use default
    if (!context?.tenantId) {
      return this.defaultSanitizer;
    }

    // Check cache first
    const cacheKey = `${context.tenantId}:${context.region ?? "default"}`;
    let sanitizer = this.tenantSanitizers.get(cacheKey);

    if (!sanitizer) {
      try {
        // Create tenant-specific sanitizer
        const tenantOptions = this.tenantConfigProvider?.(context);
        // If tenant config provider returns undefined, use default options
        sanitizer = new DataSanitizer(tenantOptions ?? this.defaultOptions);
        this.tenantSanitizers.set(cacheKey, sanitizer);
      } catch (error) {
        console.error(
          `[@satoshibits/observability] Failed to create tenant sanitizer for ${cacheKey}. ` +
            `Falling back to default sanitizer. Error:`,
          error,
        );
        // On failure, fall back to the default sanitizer to avoid breaking the application
        return this.defaultSanitizer;
      }
    }

    return sanitizer;
  }

  /**
   * Get the default sanitizer
   */
  getDefault(): DataSanitizer {
    return this.defaultSanitizer;
  }

  /**
   * Clear tenant sanitizer cache
   */
  clearTenantCache(): void {
    this.tenantSanitizers.clear();
  }

  /**
   * Get the current sanitization context
   */
  getContext(
    explicitContext?: SanitizationContext,
  ): SanitizationContext | undefined {
    if (explicitContext) {
      return explicitContext;
    }
    return this.contextProvider?.();
  }
}

/**
 * Initialize a sanitizer manager instance
 * Used by SDK wrappers to create the sanitizer system
 */
export function initializeSanitizer(
  options?: SanitizerOptions,
  config?: {
    maxTenantSanitizers?: number;
    tenantConfigProvider?: (
      context: SanitizationContext,
    ) => SanitizerOptions | undefined;
    contextProvider?: () => SanitizationContext | undefined;
  },
): SanitizerManager {
  return new SanitizerManager(options, config);
}

// Default sanitizer manager for fail-safe operation
let defaultSanitizerManager: SanitizerManager | null = null;

/**
 * Get global sanitizer manager from the unified client instance
 * Returns a default sanitizer if client is not initialized (fail-safe)
 *
 * @internal
 */
function getGlobalSanitizerManager(): SanitizerManager {
  const client = getUnifiedClientInstance();
  if (!client) {
    // Fail-safe: return default sanitizer instead of throwing
    // Observability libraries must not break application code
    if (!defaultSanitizerManager) {
      defaultSanitizerManager = new SanitizerManager();
    }
    return defaultSanitizerManager;
  }
  return client.getSanitizerManager();
}

/**
 * Sanitize a value using context-aware sanitizer
 * Automatically uses tenant-specific sanitizer if tenantId is in context
 */
export function sanitize(
  value: unknown,
  context?: SanitizationContext,
): SanitizedValue {
  const manager = getGlobalSanitizerManager();
  const ctx = manager.getContext(context);
  const sanitizer = manager.getSanitizer(ctx);
  return sanitizer.sanitize(value);
}

/**
 * Sanitize labels using context-aware sanitizer
 */
export function sanitizeLabels(
  labels: Record<string, string>,
  context?: SanitizationContext,
): Record<string, string> {
  const manager = getGlobalSanitizerManager();
  const ctx = manager.getContext(context);
  const sanitizer = manager.getSanitizer(ctx);
  return sanitizer.sanitizeLabels(labels);
}

/**
 * Sanitize error using context-aware sanitizer
 */
export function sanitizeError(
  error: Error,
  context?: SanitizationContext,
): Error {
  const manager = getGlobalSanitizerManager();
  const ctx = manager.getContext(context);
  const sanitizer = manager.getSanitizer(ctx);
  return sanitizer.sanitizeError(error);
}

/**
 * Sanitize an object using context-aware sanitizer
 */
export function sanitizeObject(
  obj: unknown,
  context?: SanitizationContext,
): SanitizedValue {
  const manager = getGlobalSanitizerManager();
  const ctx = manager.getContext(context);
  const sanitizer = manager.getSanitizer(ctx);
  return sanitizer.sanitize(obj);
}

/**
 * Sanitize a string using context-aware sanitizer
 */
export function sanitizeString(
  str: string,
  context?: SanitizationContext,
): string {
  const manager = getGlobalSanitizerManager();
  const ctx = manager.getContext(context);
  const sanitizer = manager.getSanitizer(ctx);
  // sanitize returns SanitizedValue, but for strings we know it returns string
  return sanitizer.sanitize(str) as string;
}

/**
 * Clear the sanitization cache (both default and tenant caches)
 */
export function clearSanitizationCache(): void {
  getGlobalSanitizerManager().getDefault().clearCache();
  getGlobalSanitizerManager().clearTenantCache();
}

/**
 * Get cache statistics from default sanitizer
 */
export function getCacheStats(): { size: number; max: number; ttl: number } {
  return getGlobalSanitizerManager().getDefault().getCacheStats();
}

/**
 * Create a sanitizer instance with custom configuration
 */
export function createSanitizer(config?: SanitizerOptions) {
  const sanitizer = new DataSanitizer(config);
  return {
    sanitize: (value: unknown) => sanitizer.sanitize(value),
    sanitizeString: (str: string) => sanitizer.sanitize(str) as string,
    sanitizeObject: (obj: unknown) => sanitizer.sanitize(obj),
    sanitizeError: (error: Error) => sanitizer.sanitizeError(error),
    sanitizeLabels: (labels: Record<string, string>) =>
      sanitizer.sanitizeLabels(labels),
    clearCache: () => sanitizer.clearCache(),
    getCacheStats: () => sanitizer.getCacheStats(),
  };
}

// Re-export SanitizationConfig type
export type { SanitizerOptions as SanitizationConfig };
