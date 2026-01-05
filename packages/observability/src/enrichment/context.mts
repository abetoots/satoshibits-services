/**
 * Application Context Enrichment
 *
 * Provides rich context for metrics and errors to improve observability.
 * This is YOUR domain knowledge that generic tools can't provide.
 *
 * Uses OpenTelemetry's Context API to maintain context across async boundaries,
 * ensuring context flows through callbacks, promises, and async/await.
 * - In Node.js: Uses AsyncLocalStorage via AsyncContextManager
 * - In Browser: Uses Zone.js via ZoneContextManager
 */

import { createContextKey, context as otelContext } from "@opentelemetry/api";

import type { LabelSet } from "../types.mjs";
import type { SanitizerOptions } from "./sanitizer.mjs";

import { getUnifiedClientInstance } from "../client-instance.mjs";
import { DataSanitizer } from "./sanitizer.mjs";

/**
 * Breadcrumb for tracking user navigation and actions
 */
export interface Breadcrumb {
  timestamp: number;
  category: "navigation" | "action" | "console" | "error" | "http" | "info";
  message: string;
  level: "debug" | "info" | "warning" | "error";
  data?: Record<string, unknown>;
}

/**
 * Configuration for ID generation customization.
 *
 * Default generators return plain UUIDs for maximum portability.
 * Provide custom generators to add prefixes, timestamps, or formats
 * that match your existing infrastructure (AWS X-Ray, Jaeger, etc.).
 */
export interface IDGeneratorOptions {
  /**
   * Custom session ID generator function.
   * If not provided, defaults to plain UUID for portability.
   *
   * @example
   * // Add session prefix if your infrastructure expects it
   * generateSessionId: () => `session_${crypto.randomUUID()}`
   *
   * @example
   * // AWS X-Ray trace ID format
   * generateSessionId: () => {
   *   const timestamp = Math.floor(Date.now() / 1000).toString(16);
   *   const uniqueId = crypto.randomUUID().replace(/-/g, '');
   *   return `1-${timestamp}-${uniqueId}`;
   * }
   *
   * @example
   * // Multi-tenant SaaS with tenant prefix
   * generateSessionId: () => {
   *   const tenantId = getTenantIdFromContext();
   *   return `${tenantId}_session_${ulid()}`;
   * }
   */
  generateSessionId?: () => string;

  /**
   * Custom request ID generator function.
   * If not provided, defaults to plain UUID for portability.
   *
   * @example
   * // Add request prefix if your infrastructure expects it
   * generateRequestId: () => `req_${crypto.randomUUID()}`
   *
   * @example
   * // Kubernetes pod-scoped IDs
   * generateRequestId: () => {
   *   const podName = process.env.HOSTNAME;
   *   return `${podName}_req_${Date.now()}_${crypto.randomUUID()}`;
   * }
   */
  generateRequestId?: () => string;
}

/**
 * Rich application context for metrics and errors
 */
export interface ApplicationContext {
  // User context
  userId?: string;
  userEmail?: string;
  userSegment?: string;
  userName?: string;

  // Session context
  sessionId: string;
  sessionStartTime: number;
  sessionDuration?: number;

  // Request context
  requestId: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;

  // Application context
  environment: "production" | "staging" | "development" | "test";
  release: string;
  version: string;
  buildId?: string;

  // Runtime context
  hostname?: string;
  platform?: string;
  runtime?: string;

  // Navigation context
  breadcrumbs: Breadcrumb[];

  // Custom context
  tags: Record<string, string>;
  extra: Record<string, unknown>;

  // Feature flags
  featureFlags?: Record<string, boolean>;
}

/**
 * Context enricher for adding application context to metrics
 */
export class ContextEnricher {
  private context: Partial<ApplicationContext>;
  private readonly maxBreadcrumbs: number;
  private readonly maxTags: number;
  private readonly maxExtraFields: number;
  private breadcrumbs: Breadcrumb[] = [];
  private readonly sanitizer: DataSanitizer;
  private readonly sessionIdGenerator: () => string;
  private readonly requestIdGenerator: () => string;
  private static idCounter = 0;

  constructor(
    initialContext: Partial<ApplicationContext> = {},
    options: {
      maxBreadcrumbs?: number;
      maxTags?: number;
      maxExtraFields?: number;
      sanitizerOptions?: SanitizerOptions;
      idGenerator?: IDGeneratorOptions;
    } = {},
  ) {
    this.maxBreadcrumbs = options.maxBreadcrumbs ?? 100;
    this.maxTags = options.maxTags ?? 100;
    this.maxExtraFields = options.maxExtraFields ?? 50;

    // Use minimal defaults - applications should explicitly choose their compliance preset
    // Credit cards, SSNs, JWT tokens, and passwords are always masked internally
    const DEFAULT_SANITIZER_OPTIONS: SanitizerOptions = {
      maskEmails: false,  // Applications should use SanitizerPresets.gdpr/ccpa/hipaa if needed
      maskPhones: false,  // Applications should use SanitizerPresets.gdpr/ccpa/hipaa if needed
      maskIPs: false,     // Applications should use SanitizerPresets.gdpr/ccpa/hipaa if needed
      maskUUIDs: false,   // UUIDs are typically correlation IDs, not PII
      strictMode: false,
      customRedactFields: [],
      customPatterns: [],
      redactionString: '[REDACTED]',
      maxDepth: 10,
    };
    
    // Merge user options with secure defaults
    // Note: Credit cards and SSNs are always masked internally for security/compliance
    const finalSanitizerOptions = {
      ...DEFAULT_SANITIZER_OPTIONS,
      ...(options.sanitizerOptions ?? {}),
    };

    this.sanitizer = new DataSanitizer(finalSanitizerOptions);

    // Allow applications to provide their own ID generators
    this.sessionIdGenerator = options.idGenerator?.generateSessionId
      ?? this.defaultSessionIdGenerator.bind(this);
    this.requestIdGenerator = options.idGenerator?.generateRequestId
      ?? this.defaultRequestIdGenerator.bind(this);

    this.context = {
      ...initialContext,
      sessionId: initialContext.sessionId ?? this.sessionIdGenerator(),
      sessionStartTime: initialContext.sessionStartTime ?? Date.now(),
      requestId: initialContext.requestId ?? this.requestIdGenerator(),
      environment: initialContext.environment ?? "development",
      release: initialContext.release ?? "unknown",
      version: initialContext.version ?? "0.0.0",
      tags: initialContext.tags ?? {},
      extra: initialContext.extra ?? {},
      breadcrumbs: [],
    };
  }

  /**
   * Set user context with PII sanitization
   */
  setUser(user: {
    id?: string;
    email?: string;
    name?: string;
    segment?: string;
  }): void {
    if (user.id) this.context.userId = user.id; // IDs are typically safe
    if (user.email) {
      // sanitize email addresses for PII protection
      const sanitized = this.sanitizer.sanitize(user.email);
      // ensure result is string (sanitize might return non-string types)
      this.context.userEmail =
        typeof sanitized === 'string'
          ? sanitized
          : typeof sanitized === 'object'
            ? JSON.stringify(sanitized)
            : String(sanitized);
    }
    if (user.name) {
      // sanitize names which might contain PII
      const sanitized = this.sanitizer.sanitize(user.name);
      // ensure result is string
      this.context.userName =
        typeof sanitized === 'string'
          ? sanitized
          : typeof sanitized === 'object'
            ? JSON.stringify(sanitized)
            : String(sanitized);
    }
    if (user.segment) this.context.userSegment = user.segment; // segments are typically safe
  }

  /**
   * Clear user context (e.g., on logout)
   */
  clearUser(): void {
    delete this.context.userId;
    delete this.context.userEmail;
    delete this.context.userName;
    delete this.context.userSegment;
  }

  /**
   * Set request context
   */
  setRequest(request: {
    requestId?: string;
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
  }): void {
    if (request.requestId) this.context.requestId = request.requestId;
    if (request.traceId) this.context.traceId = request.traceId;
    if (request.spanId) this.context.spanId = request.spanId;
    if (request.parentSpanId) this.context.parentSpanId = request.parentSpanId;
  }

  /**
   * Add a breadcrumb with PII sanitization
   */
  addBreadcrumb(breadcrumb: Omit<Breadcrumb, "timestamp">): void {
    // sanitize breadcrumb message and data for PII
    const rawMessage = this.sanitizer.sanitize(breadcrumb.message);
    // ensure message is string (required by Breadcrumb interface)
    const sanitizedMessage =
      typeof rawMessage === 'string'
        ? rawMessage
        : typeof rawMessage === 'object'
          ? JSON.stringify(rawMessage)
          : String(rawMessage);

    // sanitize breadcrumb data
    const rawData = breadcrumb.data
      ? this.sanitizer.sanitize(breadcrumb.data)
      : undefined;
    // ensure data is Record<string, unknown> or undefined
    const sanitizedData =
      rawData && typeof rawData === 'object' && !Array.isArray(rawData)
        ? rawData
        : undefined;

    const crumb: Breadcrumb = {
      ...breadcrumb,
      message: sanitizedMessage,
      data: sanitizedData,
      timestamp: Date.now(),
    };

    this.breadcrumbs.push(crumb);

    // Maintain max breadcrumbs limit
    if (this.breadcrumbs.length > this.maxBreadcrumbs) {
      this.breadcrumbs.shift();
    }
  }

  /**
   * Set a core context field (release, version, environment)
   * Unlike addTag, this updates the canonical context properties used by getContext() and getLabels()
   */
  setContextField(key: "release" | "version" | "environment", value: string): void {
    if (key === "environment") {
      this.context.environment = value as "production" | "staging" | "development" | "test";
    } else {
      this.context[key] = value;
    }
  }

  /**
   * Add a tag
   */
  addTag(key: string, value: string): void {
    if (!this.context.tags) {
      this.context.tags = {};
    }

    // Check if we've reached the max tags limit
    if (Object.keys(this.context.tags).length >= this.maxTags) {
      console.warn(
        `Maximum tags limit (${this.maxTags}) reached. Tag '${key}' not added.`,
      );
      return;
    }

    this.context.tags[key] = value;
  }

  /**
   * Add tags in bulk
   */
  addTags(tags: Record<string, string>): void {
    if (!this.context.tags) {
      this.context.tags = {};
    }

    // Check how many tags we can add
    const currentCount = Object.keys(this.context.tags).length;
    const availableSlots = this.maxTags - currentCount;

    if (availableSlots <= 0) {
      console.warn(
        `Maximum tags limit (${this.maxTags}) already reached. No tags added.`,
      );
      return;
    }

    const tagsToAdd = Object.entries(tags).slice(0, availableSlots);
    if (tagsToAdd.length < Object.keys(tags).length) {
      console.warn(
        `Only ${tagsToAdd.length} of ${Object.keys(tags).length} tags added due to limit (${this.maxTags}).`,
      );
    }

    for (const [key, value] of tagsToAdd) {
      this.context.tags[key] = value;
    }
  }

  /**
   * Add extra data with PII sanitization
   */
  addExtra(key: string, value: unknown): void {
    if (!this.context.extra) {
      this.context.extra = {};
    }

    // Check if we've reached the max extra fields limit
    if (Object.keys(this.context.extra).length >= this.maxExtraFields) {
      console.warn(
        `Maximum extra fields limit (${this.maxExtraFields}) reached. Field '${key}' not added.`,
      );
      return;
    }

    // sanitize the value for PII before storing
    this.context.extra[key] = this.sanitizer.sanitize(value);
  }

  /**
   * Set feature flags
   */
  setFeatureFlags(flags: Record<string, boolean>): void {
    this.context.featureFlags = flags;
  }

  /**
   * Get enriched context
   */
  getContext(): ApplicationContext {
    return {
      ...this.context,
      breadcrumbs: [...this.breadcrumbs],
      sessionDuration:
        Date.now() - (this.context.sessionStartTime ?? Date.now()),
    } as ApplicationContext;
  }

  /**
   * Get context as metric labels
   */
  getLabels(): LabelSet {
    const labels: LabelSet = {};

    // Add standard labels
    if (this.context.environment) labels.environment = this.context.environment;
    if (this.context.release) labels.release = this.context.release;
    if (this.context.version) labels.version = this.context.version;
    if (this.context.userId) labels.user_id = this.context.userId;
    if (this.context.userSegment)
      labels.user_segment = this.context.userSegment;

    // Add custom tags as labels
    if (this.context.tags) {
      Object.entries(this.context.tags).forEach(([key, value]) => {
        labels[key] = value;
      });
    }

    return labels;
  }

  /**
   * Get context for error reporting (Sentry-compatible format)
   */
  getErrorContext(): {
    user?: { id?: string; email?: string; username?: string; segment?: string };
    tags: Record<string, string>;
    extra: Record<string, unknown>;
    contexts: {
      trace?: { trace_id?: string; span_id?: string; parent_span_id?: string };
      session?: { id: string; started: number; duration: number };
      app?: { app_version: string; app_build?: string };
    };
    breadcrumbs: Breadcrumb[];
  } {
    const context = this.getContext();

    return {
      user: context.userId
        ? {
            id: context.userId,
            email: context.userEmail,
            username: context.userName,
            segment: context.userSegment,
          }
        : undefined,
      tags: context.tags,
      extra: context.extra,
      contexts: {
        trace: context.traceId
          ? {
              trace_id: context.traceId,
              span_id: context.spanId,
              parent_span_id: context.parentSpanId,
            }
          : undefined,
        session: {
          id: context.sessionId,
          started: context.sessionStartTime,
          duration: context.sessionDuration ?? 0,
        },
        app: {
          app_version: context.version,
          app_build: context.buildId,
        },
      },
      breadcrumbs: context.breadcrumbs,
    };
  }

  /**
   * Reset session (starts a new session)
   * Uses custom generator if provided, otherwise uses default
   */
  resetSession(): void {
    this.context.sessionId = this.sessionIdGenerator();
    this.context.sessionStartTime = Date.now();
    this.breadcrumbs = [];
  }

  /**
   * Clear all context
   * Uses custom generators if provided, otherwise uses defaults
   */
  clear(): void {
    this.context = {
      sessionId: this.sessionIdGenerator(),
      sessionStartTime: Date.now(),
      requestId: this.requestIdGenerator(),
      environment: "development",
      release: "unknown",
      version: "0.0.0",
      tags: {},
      extra: {},
    };
    this.breadcrumbs = [];
  }

  /**
   * Default session ID generator (private implementation detail)
   * Returns a plain UUID for maximum portability across infrastructure.
   * Consumers can provide custom generators with prefixes if needed.
   *
   * API Boundary Fix - Issue L1: removed 'session_' prefix from defaults
   * to avoid conflicts with existing infrastructure ID formats.
   */
  private defaultSessionIdGenerator(): string {
    return this.generateUniqueId();
  }

  /**
   * Default request ID generator (private implementation detail)
   * Returns a plain UUID for maximum portability across infrastructure.
   * Consumers can provide custom generators with prefixes if needed.
   *
   * API Boundary Fix - Issue L1: removed 'req_' prefix from defaults
   * to avoid conflicts with existing infrastructure ID formats.
   */
  private defaultRequestIdGenerator(): string {
    return this.generateUniqueId();
  }

  /**
   * Generate a cryptographically secure unique ID when available
   * Uses crypto.randomUUID() when available, otherwise falls back to
   * timestamp + counter + random for better uniqueness
   *
   * Doc 4 M5 Fix: fallback format is `timestamp-counter-random` (all base36)
   */
  private generateUniqueId(): string {
    // Try browser/Node crypto.randomUUID first (best option)
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    // Doc 4 M5 Fix: improved fallback with counter wrap and randomness
    // Format: timestamp-counter-random (all base36, 3 segments)
    const timestamp = Date.now().toString(36);
    // Wrap counter at 36^4 (1,679,616) to keep consistent format
    const counter = (ContextEnricher.idCounter++ % 1679616).toString(36).padStart(4, "0");
    // Codex review: prefer crypto.getRandomValues over Math.random when available
    const random = this.generateRandomComponent();
    return `${timestamp}-${counter}-${random}`;
  }

  /**
   * Generate a random component for fallback IDs
   * Codex review: use crypto.getRandomValues when available for better entropy
   */
  private generateRandomComponent(): string {
    // Try crypto.getRandomValues first (available in most browsers even without randomUUID)
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);
      // Use modulo to get value in range, then format as base36
      return (array[0]! % 1679616).toString(36).padStart(4, "0");
    }
    // Final fallback to Math.random
    return Math.floor(Math.random() * 1679616).toString(36).padStart(4, "0");
  }
}

/**
 * Smart context interface that can be stored in OTel Context
 */
export interface SmartContext {
  userId?: string;
  tenantId?: string;
  feature?: string;
  businessFlow?: string;
  transactionType?: string;
  customerTier?: "free" | "pro" | "enterprise";
  // allow any additional context
  [key: string]: unknown;
}

/**
 * Create a unique key for storing business context in OTel Context
 * This prevents key collisions within the OTel context map
 */
const SMART_CONTEXT_KEY = createContextKey("smart_business_context");

/**
 * Wrap any async operation with business context
 * Context will be available to all async operations within this callback
 * Uses OpenTelemetry's context propagation (Zone.js in browser, AsyncLocalStorage in Node)
 */
export function runWithBusinessContext<T>(ctx: SmartContext, fn: () => T): T {
  const activeContext = otelContext.active();
  const newContext = activeContext.setValue(SMART_CONTEXT_KEY, ctx);
  return otelContext.with(newContext, fn);
}

/**
 * Get current business context from OTel Context
 * Works even deep in async call stacks!
 */
export function getBusinessContext(): SmartContext {
  const activeContext = otelContext.active();
  return (activeContext.getValue(SMART_CONTEXT_KEY) as SmartContext) ?? {};
}

/**
 * Merge business context with existing context
 */
export function mergeBusinessContext(additional: SmartContext): SmartContext {
  const current = getBusinessContext();
  return { ...current, ...additional };
}


// Default context enricher for fail-safe operation
// This is the single source of truth - client will adopt this instance
let defaultContextEnricher: ContextEnricher | null = null;

/**
 * Get global context enricher from the unified client instance
 * Returns a default context enricher if client is not initialized (fail-safe)
 */
export function getGlobalContext(): ContextEnricher {
  const client = getUnifiedClientInstance();
  if (!client) {
    // Fail-safe: return default context enricher instead of throwing
    // Observability libraries must not break application code
    if (!defaultContextEnricher) {
      defaultContextEnricher = new ContextEnricher();
    }
    return defaultContextEnricher;
  }
  return client.getContextEnricher();
}

/**
 * Get or create the default context enricher for adoption by client
 * This ensures data added before client initialization is preserved
 * @see ARCHITECTURE_MULTI_MODEL_REVIEW.md - Issue C3 resolution
 */
export function getOrCreateDefaultEnricher(
  initialContext?: Partial<ApplicationContext>,
  options?: {
    maxBreadcrumbs?: number;
    maxTags?: number;
    maxExtraFields?: number;
    sanitizerOptions?: SanitizerOptions;
    idGenerator?: IDGeneratorOptions;
  },
): ContextEnricher {
  if (!defaultContextEnricher) {
    defaultContextEnricher = new ContextEnricher(initialContext, options);
  } else if (initialContext) {
    // update existing enricher's core context fields with new config if provided
    // preserves any data already added (breadcrumbs, user, tags)
    // uses setContextField to update the canonical context properties (not just tags)
    if (initialContext.release) defaultContextEnricher.setContextField("release", initialContext.release);
    if (initialContext.version) defaultContextEnricher.setContextField("version", initialContext.version);
    if (initialContext.environment) defaultContextEnricher.setContextField("environment", initialContext.environment);
  }
  return defaultContextEnricher;
}

/**
 * Set the default enricher (called when client adopts it)
 * This allows the client to become the owner while preserving existing data
 */
export function setDefaultEnricher(enricher: ContextEnricher): void {
  defaultContextEnricher = enricher;
}

/**
 * Add breadcrumb to global context
 */
export function addBreadcrumb(breadcrumb: Omit<Breadcrumb, "timestamp">): void {
  getGlobalContext().addBreadcrumb(breadcrumb);
}

/**
 * Set user in global context
 */
export function setUser(user: {
  id?: string;
  email?: string;
  name?: string;
  segment?: string;
}): void {
  getGlobalContext().setUser(user);
}

/**
 * Add tag to global context
 */
export function addTag(key: string, value: string): void {
  getGlobalContext().addTag(key, value);
}

/**
 * Get enriched labels for metrics
 * Combines global context, AsyncLocalStorage context, and additional labels
 */
export function getEnrichedLabels(additionalLabels?: LabelSet): LabelSet {
  const contextLabels = getGlobalContext().getLabels();
  const businessCtx = getBusinessContext();

  // convert business context to labels
  const businessLabels: LabelSet = {};
  if (businessCtx.userId) businessLabels.user_id = String(businessCtx.userId);
  if (businessCtx.tenantId)
    businessLabels.tenant_id = String(businessCtx.tenantId);
  if (businessCtx.feature) businessLabels.feature = String(businessCtx.feature);
  if (businessCtx.businessFlow)
    businessLabels.business_flow = String(businessCtx.businessFlow);
  if (businessCtx.transactionType)
    businessLabels.transaction_type = String(businessCtx.transactionType);
  if (businessCtx.customerTier)
    businessLabels.customer_tier = String(businessCtx.customerTier);

  // merge all three sources of labels
  return { ...contextLabels, ...businessLabels, ...additionalLabels };
}

/**
 * Clear the global context
 */
export function clearContext(): void {
  getGlobalContext().clear();
}
