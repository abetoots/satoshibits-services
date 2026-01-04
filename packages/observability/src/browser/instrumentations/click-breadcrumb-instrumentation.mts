/**
 * Click Breadcrumb Instrumentation
 *
 * Captures click events on interactive elements as breadcrumbs.
 * Useful for understanding user flow before errors.
 *
 * Features:
 * - Uses capture phase for reliability
 * - Blocks sensitive elements automatically
 * - Sanitizes all identifiers
 * - Never holds DOM references
 * - Supports sampling and throttling for high-traffic UIs
 *
 * Design Decision: event.isTrusted filtering
 * -------------------------------------------
 * We intentionally do NOT filter events by `event.isTrusted`. While this means
 * programmatic clicks (e.g., `element.click()`) are captured, filtering would
 * incorrectly exclude legitimate interactions from:
 * - React synthetic events
 * - Other framework event delegation
 * - Accessibility tools triggering clicks
 * - Testing frameworks
 *
 * For applications needing to exclude automated interactions, consider:
 * - Using sampling (`sampleRate`) to reduce volume
 * - Filtering breadcrumbs on your backend by pattern
 */

import {
  InstrumentationBase,
  InstrumentationConfig,
} from "@opentelemetry/instrumentation";

import { addBreadcrumb } from "../../enrichment/context.mjs";
import {
  buildSafeSelector,
  getSafeElementText,
  matchesBlockedSelector,
  sanitizeIdentifier,
} from "../utils/dom-privacy.mjs";

export interface BrowserClickBreadcrumbConfig extends InstrumentationConfig {
  /** Custom interaction handler for testing/custom processing */
  interactionHandler?: (type: string, data?: Record<string, unknown>) => void;
  /**
   * Selectors/patterns to block from capture.
   *
   * **Important:** Patterns are matched against the *sanitized* selector (after PII removal).
   * For example, an element with id="user-12345" becomes "tag#[id]" after sanitization.
   *
   * To block elements:
   * - Use `data-observability-block` attribute on the element (recommended)
   * - Use tag names: "button", "div"
   * - Use sanitized patterns: "#[id]", "#[uuid]"
   * - Use class names (non-PII): ".nav-button"
   *
   * @example
   * blockedSelectors: [".admin-panel", /\[role="menu"\]/]
   */
  blockedSelectors?: (string | RegExp)[];
  /** Sample rate (0.0 to 1.0). @default 1.0 */
  sampleRate?: number;
  /** Throttle interval (ms) per element. @default 500 */
  throttleMs?: number;
}

export class BrowserClickBreadcrumbInstrumentation extends InstrumentationBase<BrowserClickBreadcrumbConfig> {
  readonly component = "browser-click-breadcrumb";
  readonly version = "1.0.0";
  readonly moduleName = this.component;

  private _isInstrumentationEnabled = false;
  private _clickHandler?: (event: MouseEvent) => void;
  private _lastClickTimes = new Map<string, number>();

  // config with defaults
  private get sampleRate(): number {
    return this._config.sampleRate ?? 1.0;
  }

  private get throttleMs(): number {
    return this._config.throttleMs ?? 500;
  }

  constructor(config: BrowserClickBreadcrumbConfig = {}) {
    super("@anthropic/browser-click-breadcrumb-instrumentation", "1.0.0", {
      ...config,
      enabled: false, // prevent auto-enable, we handle it manually
    });
  }

  protected init(): void {
    // initialization handled in enable()
  }

  isEnabled(): boolean {
    return this._isInstrumentationEnabled;
  }

  enable(): void {
    if (this._isInstrumentationEnabled) return;
    if (typeof document === "undefined") return; // SSR guard

    this._clickHandler = (event: MouseEvent) => {
      // guard: target must be an Element (not text node or other node type)
      if (!(event.target instanceof Element)) return;

      // apply sampling (check before expensive work)
      if (this.sampleRate < 1.0 && Math.random() > this.sampleRate) {
        return;
      }

      const element = event.target;

      // build safe selector (returns null for sensitive elements)
      const selector = buildSafeSelector(element);
      if (!selector) return;

      // check against blocked patterns
      if (matchesBlockedSelector(selector, this._config.blockedSelectors)) {
        return;
      }

      // apply throttling per element
      const now = Date.now();
      const lastClick = this._lastClickTimes.get(selector) ?? 0;
      if (now - lastClick < this.throttleMs) {
        return; // throttled - skip this click
      }
      this._lastClickTimes.set(selector, now);

      // cleanup old throttle entries periodically
      if (this._lastClickTimes.size > 100) {
        this.cleanupThrottleMap(now);
      }

      // build breadcrumb data (no DOM refs, only primitives)
      const data: Record<string, unknown> = {
        selector,
        tag: element.tagName.toLowerCase(),
      };

      // add optional metadata
      const role = element.getAttribute("role");
      if (role) data.role = role;

      const text = getSafeElementText(element);
      if (text) data.text = text;

      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) data.ariaLabel = sanitizeIdentifier(ariaLabel);

      // record breadcrumb (using 'action' category for UI interactions)
      addBreadcrumb({
        category: "action",
        message: `Clicked ${selector}`,
        level: "info",
        data,
      });

      // call test handler if provided
      this._config.interactionHandler?.("ui.click", data);
    };

    document.addEventListener("click", this._clickHandler, {
      capture: true,
      passive: true,
    });

    this._isInstrumentationEnabled = true;
  }

  private cleanupThrottleMap(now: number): void {
    for (const [key, time] of this._lastClickTimes) {
      if (now - time > this.throttleMs * 2) {
        this._lastClickTimes.delete(key);
      }
    }
  }

  disable(): void {
    if (this._clickHandler && typeof document !== "undefined") {
      document.removeEventListener("click", this._clickHandler, {
        capture: true,
      } as EventListenerOptions);
      this._clickHandler = undefined;
    }
    this._lastClickTimes.clear();
    this._isInstrumentationEnabled = false;
  }
}
