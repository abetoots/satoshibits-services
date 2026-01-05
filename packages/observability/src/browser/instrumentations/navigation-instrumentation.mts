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

export interface BrowserNavigationInstrumentationConfig
  extends InstrumentationConfig {
  /** Custom interaction handler for testing/custom processing */
  interactionHandler?: (type: string, data?: Record<string, unknown>) => void;
  /** Custom metrics handler for navigation events */
  metricsHandler?: (
    name: string,
    value: number,
    attributes?: Record<string, unknown>,
  ) => void;
}

/**
 * Browser Navigation Instrumentation for OpenTelemetry
 *
 * Instruments SPA navigation events including History API methods (pushState, replaceState)
 * and hash changes to provide observability for client-side routing.
 */
export class BrowserNavigationInstrumentation extends InstrumentationBase<BrowserNavigationInstrumentationConfig> {
  readonly component: string = "browser-navigation";
  readonly version: string = "1.0.0";
  moduleName = this.component;

  private _originalPushState?: typeof window.history.pushState;
  private _originalReplaceState?: typeof window.history.replaceState;
  private _hashChangeHandler?: (event: HashChangeEvent) => void;

  constructor(
    config: BrowserNavigationInstrumentationConfig = {} as BrowserNavigationInstrumentationConfig,
  ) {
    // prevent enable() from being called by the base constructor
    // registerInstrumentations() will call enable() later after full construction
    super("@satoshibits/browser-navigation-instrumentation", "1.0.0", { ...config, enabled: false });
  }

  protected init() {
    // initialization is handled in enable()
  }

  enable() {
    if (typeof window === "undefined") {
      this.logger.emit({
        severityNumber: SeverityNumber.WARN,
        body: {
          message:
            "BrowserNavigationInstrumentation only works in browser environment",
        },
      });
      return;
    }

    // store original History API methods with proper binding
    this._originalPushState = window.history.pushState.bind(window.history);
    this._originalReplaceState = window.history.replaceState.bind(
      window.history,
    );

    const navigationHandler = (
      method: string,
      url: string | null | undefined,
    ) => {
      const toUrl = url?.toString() ?? "";
      const data = {
        from: window.location.pathname,
        to: toUrl,
        method: method,
      };

      // create span for navigation event
      const span = this.tracer.startSpan(`navigation.${method}`);
      span.setAttributes({
        "navigation.from": data.from,
        "navigation.to": data.to,
        "navigation.method": data.method,
      });
      span.end(); // end immediately as it's an event, not a duration

      // create metrics
      const counter = this.meter.createCounter("navigation.spa");
      counter.add(1, {
        route: toUrl,
        method: method,
      });

      // call custom handler if provided
      if (this._config.interactionHandler) {
        this._config.interactionHandler("navigation", data);
      }

      // record metrics
      if (this._config.metricsHandler) {
        this._config.metricsHandler("navigation.spa", 1, {
          route: toUrl,
        });
      }
    };

    // patch pushState (capture original in closure to avoid relying on class state)
    const originalPush = this._originalPushState;
    window.history.pushState = (...args) => {
      const [, , url] = args;
      navigationHandler("pushState", url?.toString());
      return (originalPush ?? window.history.pushState).apply(
        window.history,
        args,
      );
    };

    // patch replaceState (capture original in closure)
    const originalReplace = this._originalReplaceState;
    window.history.replaceState = (...args) => {
      const [, , url] = args;
      navigationHandler("replaceState", url?.toString());
      return (originalReplace ?? window.history.replaceState).apply(
        window.history,
        args,
      );
    };

    // set up hash change handler
    this._hashChangeHandler = (event: HashChangeEvent) => {
      const data = {
        from: new URL(event.oldURL).hash,
        to: new URL(event.newURL).hash,
      };

      // create span for hash change event
      const span = this.tracer.startSpan("navigation.hashchange");
      span.setAttributes({
        "navigation.from": data.from,
        "navigation.to": data.to,
        "navigation.method": "hashchange",
      });
      span.end(); // end immediately as it's an event

      // create metrics
      const counter = this.meter.createCounter("navigation.spa");
      counter.add(1, {
        route: data.to,
        method: "hashchange",
      });

      // call custom handler if provided
      if (this._config.interactionHandler) {
        this._config.interactionHandler("hash_change", data);
      }
    };

    window.addEventListener("hashchange", this._hashChangeHandler);
  }

  disable() {
    if (typeof window === "undefined") {
      return;
    }

    // restore original History API methods
    if (this._originalPushState) {
      window.history.pushState = this._originalPushState;
      this._originalPushState = undefined;
    }

    if (this._originalReplaceState) {
      window.history.replaceState = this._originalReplaceState;
      this._originalReplaceState = undefined;
    }

    // remove hash change handler
    if (this._hashChangeHandler) {
      window.removeEventListener("hashchange", this._hashChangeHandler);
      this._hashChangeHandler = undefined;
    }
  }
}
