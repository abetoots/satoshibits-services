/**
 * Custom error classes for the metrics system
 */

/**
 * Base error class for all metrics-related errors
 */
export class MetricsError extends Error {
  constructor(message: string, public readonly code: string, public readonly context?: unknown) {
    super(message);
    this.name = 'MetricsError';
    
    // maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when cardinality limit is exceeded
 */
export class CardinalityLimitError extends MetricsError {
  constructor(
    public readonly metricName: string,
    public readonly current: number,
    public readonly limit: number
  ) {
    super(
      `Cardinality limit exceeded for metric ${metricName}: ${current} >= ${limit}`,
      'CARDINALITY_LIMIT_EXCEEDED',
      { metricName, current, limit }
    );
    this.name = 'CardinalityLimitError';
  }
}

/**
 * Error thrown when a metric configuration is invalid
 */
export class InvalidMetricConfigError extends MetricsError {
  constructor(message: string, public readonly config: unknown) {
    super(message, 'INVALID_METRIC_CONFIG', { config });
    this.name = 'InvalidMetricConfigError';
  }
}

/**
 * Error thrown when a handler fails
 */
export class HandlerError extends MetricsError {
  constructor(
    public readonly handlerName: string,
    public readonly originalError: Error,
    public readonly operation: 'handle' | 'handleSnapshot'
  ) {
    super(
      `Handler '${handlerName}' failed during ${operation}: ${originalError.message}`,
      'HANDLER_ERROR',
      { handlerName, operation, originalError }
    );
    this.name = 'HandlerError';
  }
}

/**
 * Error thrown when a collector operation fails
 */
export class CollectorError extends MetricsError {
  constructor(
    public readonly collectorName: string,
    public readonly operation: string,
    public readonly originalError?: Error
  ) {
    super(
      `Collector '${collectorName}' failed during ${operation}${originalError ? `: ${originalError.message}` : ''}`,
      'COLLECTOR_ERROR',
      { collectorName, operation, originalError }
    );
    this.name = 'CollectorError';
  }
}

/**
 * Error thrown when an invalid metric value is provided
 */
export class InvalidMetricValueError extends MetricsError {
  constructor(
    public readonly metricName: string,
    public readonly value: unknown,
    public readonly expectedType: string
  ) {
    super(
      `Invalid value for metric ${metricName}: expected ${expectedType}, got ${typeof value}`,
      'INVALID_METRIC_VALUE',
      { metricName, value, expectedType }
    );
    this.name = 'InvalidMetricValueError';
  }
}

/**
 * Error handler interface
 */
export interface ErrorHandler {
  handleError(error: Error): void;
}

/**
 * Default error handler that logs to console
 */
export class ConsoleErrorHandler implements ErrorHandler {
  handleError(error: Error): void {
    if (error instanceof MetricsError) {
      console.error(`[${error.code}] ${error.message}`, error.context);
    } else {
      console.error('Unhandled error in metrics system:', error);
    }
  }
}

/**
 * Error handler that collects errors for later inspection
 */
export class CollectingErrorHandler implements ErrorHandler {
  private errors: Error[] = [];
  private maxErrors: number;

  constructor(maxErrors = 100) {
    this.maxErrors = maxErrors;
  }

  handleError(error: Error): void {
    this.errors.push(error);
    
    // prevent unbounded growth
    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(-this.maxErrors);
    }
  }

  getErrors(): readonly Error[] {
    return [...this.errors];
  }

  clear(): void {
    this.errors = [];
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }
}