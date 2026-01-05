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
 * WITHOUT WARRANTIES OR CONDITIONS OF any KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { SeverityNumber } from "@opentelemetry/api-logs";
import {
  InstrumentationBase,
  InstrumentationConfig,
} from "@opentelemetry/instrumentation";

export interface BrowserConsoleInstrumentationConfig
  extends InstrumentationConfig {
  /** Custom error handler for testing/custom processing */
  errorHandler?: (error: Error, context?: Record<string, unknown>) => void;
}

/**
 * Browser Console Instrumentation for OpenTelemetry
 *
 * Instruments console.error to capture error messages and call custom handlers.
 * This provides observability for console-based error reporting.
 */
export class BrowserConsoleInstrumentation extends InstrumentationBase<BrowserConsoleInstrumentationConfig> {
  readonly component: string = "browser-console";
  readonly version: string = "1.0.0";
  moduleName = this.component;

  private _originalConsoleError?: (...args: unknown[]) => void;
  private _isInstrumentationEnabled = false;
  // Doc 4 H3 Fix: reentrancy guard to prevent infinite recursion
  // if tracer or errorHandler calls console.error
  private _isHandlingConsoleError = false;

  constructor(
    config: BrowserConsoleInstrumentationConfig = {} as BrowserConsoleInstrumentationConfig,
  ) {
    // prevent enable() from being called by the base constructor
    // registerInstrumentations() will call enable() later after full construction
    super("@satoshibits/browser-console-instrumentation", "1.0.0", { ...config, enabled: false });
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

    if (typeof window === "undefined" || typeof console === "undefined") {
      this.logger.emit({
        severityNumber: SeverityNumber.WARN,
        body: {
          message:
            "BrowserConsoleInstrumentation only works in browser environment with console",
        },
      });
      return;
    }

    // store original console.error
    this._originalConsoleError = console.error;

    // patch console.error
    console.error = (...args: unknown[]) => {
      // call original console.error first
      if (this._originalConsoleError) {
        this._originalConsoleError.apply(console, args);
      }

      // Doc 4 H3 Fix: reentrancy guard - skip telemetry if we're already handling
      // a console.error (prevents infinite recursion if tracer/handler logs errors)
      if (this._isHandlingConsoleError) {
        return;
      }

      // create error from console message
      const message = args
        .map((arg) => {
          if (arg === null || arg === undefined) {
            return String(arg);
          }
          if (typeof arg === "object") {
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg as unknown);
            }
          }
          return String(arg as unknown);
        })
        .join(" ");
      const error = new Error(message);

      // Doc 4 H3 Fix: wrap telemetry code in try/catch to prevent
      // exceptions from span creation/recording from interfering with console.error
      this._isHandlingConsoleError = true;
      try {
        // create span for observability
        const span = this.tracer.startSpan("console.error");
        span.recordException(error);
        span.end();

        // call custom handler if provided
        if (this._config.errorHandler) {
          this._config.errorHandler(error, { source: "console.error" });
        }
      } catch (telemetryError) {
        // Doc 4 H3 Fix: log telemetry errors via original console.error for visibility
        // (won't recurse since we check _isHandlingConsoleError above)
        if (this._originalConsoleError) {
          this._originalConsoleError.call(
            console,
            "[ConsoleInstrumentation] telemetry failed:",
            telemetryError
          );
        }
      } finally {
        this._isHandlingConsoleError = false;
      }
    };
  }

  disable() {
    if (!this.isEnabled()) {
      return;
    }
    this._isInstrumentationEnabled = false;

    if (typeof window === "undefined" || typeof console === "undefined") {
      return;
    }

    // restore original console.error
    if (this._originalConsoleError) {
      console.error = this._originalConsoleError;
      this._originalConsoleError = undefined;
    }
  }
}
