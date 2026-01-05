/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { SeverityNumber } from "@opentelemetry/api-logs";
import {
  InstrumentationBase,
  InstrumentationConfig,
} from "@opentelemetry/instrumentation";

export interface BrowserErrorInstrumentationConfig
  extends InstrumentationConfig {
  /** Custom error handler for testing/custom processing */
  errorHandler?: (error: Error, context?: Record<string, unknown>) => void;
}

/**
 * Browser Error Instrumentation for OpenTelemetry
 *
 * Instruments window error events and unhandled promise rejections to create spans
 * and call custom error handlers. This provides observability for client-side errors.
 */
export class BrowserErrorInstrumentation extends InstrumentationBase<BrowserErrorInstrumentationConfig> {
  readonly component: string = "browser-error";
  readonly version: string = "1.0.0";
  moduleName = this.component;

  private _errorHandler?: (event: ErrorEvent) => void;
  private _rejectionHandler?: (event: PromiseRejectionEvent) => void;
  private _isInstrumentationEnabled = false;

  constructor(
    config: BrowserErrorInstrumentationConfig = {} as BrowserErrorInstrumentationConfig,
  ) {
    // prevent enable() from being called by the base constructor
    // registerInstrumentations() will call enable() later after full construction
    super("@satoshibits/browser-error-instrumentation", "1.0.0", { ...config, enabled: false });
  }

  protected init() {
    // initialization is handled in enable()
  }

  /**
   * Check if instrumentation is enabled.
   * Note: Browser InstrumentationBase doesn't have isEnabled(), so we track it ourselves.
   */
  isEnabled(): boolean {
    return this._isInstrumentationEnabled;
  }

  enable() {
    if (this.isEnabled()) {
      return;
    }
    this._isInstrumentationEnabled = true;
    // note: browser InstrumentationBase doesn't implement enable(), so no super call

    if (typeof window === "undefined") {
      this.logger.emit({
        severityNumber: SeverityNumber.WARN,
        body: {
          message:
            "BrowserErrorInstrumentation only works in browser environment",
        },
      });
      return;
    }

    this._errorHandler = (event: ErrorEvent) => {
      const error =
        (event.error as Error | DOMException) ?? new Error(event.message);

      // call custom handler if provided
      if (this._config.errorHandler) {
        this._config.errorHandler(error, {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        });
      }

      // create span for tracing
      const span = this.tracer.startSpan("browser.error");
      span?.setAttributes({
        "error.type": "unhandled_error",
        "error.message": event.message,
        "error.filename": event.filename || "",
        "error.lineno": event.lineno || 0,
        "error.colno": event.colno || 0,
      });
      if (event.error) {
        span?.recordException(event.error as Error | DOMException);
      }
      span?.end();
    };

    this._rejectionHandler = (event: PromiseRejectionEvent) => {
      const error =
        event.reason instanceof Error
          ? event.reason
          : new Error(`Unhandled rejection: ${event.reason}`);

      // call custom handler if provided
      if (this._config.errorHandler) {
        this._config.errorHandler(error, {
          source: "unhandledrejection",
          type: "unhandledrejection",
        });
      }

      // create span for tracing
      const span = this.tracer.startSpan("browser.promise_rejection");
      span?.setAttribute("error.type", "unhandled_rejection");
      span?.recordException(error);
      span?.end();
    };

    // register event listeners
    window.addEventListener("error", this._errorHandler);
    window.addEventListener("unhandledrejection", this._rejectionHandler);
  }

  disable() {
    if (!this.isEnabled()) {
      return;
    }
    this._isInstrumentationEnabled = false;
    // note: browser InstrumentationBase doesn't implement disable(), so no super call

    if (typeof window === "undefined") {
      return;
    }

    // remove event listeners
    if (this._errorHandler) {
      window.removeEventListener("error", this._errorHandler);
      this._errorHandler = undefined;
    }

    if (this._rejectionHandler) {
      window.removeEventListener("unhandledrejection", this._rejectionHandler);
      this._rejectionHandler = undefined;
    }
  }
}
