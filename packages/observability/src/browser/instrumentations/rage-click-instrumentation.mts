/**
 * Rage Click Instrumentation
 *
 * Detects "rage clicks" - rapid repeated clicks on the same element.
 *
 * This is a high-signal indicator of:
 * - Broken UI (button doesn't respond)
 * - Slow API (user thinks nothing happened)
 * - User frustration
 *
 * Features:
 * - Configurable threshold and timing
 * - Cooldown to prevent flooding
 * - Memory-bounded state (auto-cleanup)
 * - Never holds DOM references
 *
 * Note: Like click instrumentation, we do not filter by event.isTrusted
 * to ensure compatibility with framework synthetic events.
 */

import {
  InstrumentationBase,
  InstrumentationConfig,
} from "@opentelemetry/instrumentation";

import { addBreadcrumb } from "../../enrichment/context.mjs";
import {
  buildSafeSelector,
  matchesBlockedSelector,
} from "../utils/dom-privacy.mjs";

export interface BrowserRageClickConfig extends InstrumentationConfig {
  /** Custom interaction handler for testing/custom processing */
  interactionHandler?: (type: string, data?: Record<string, unknown>) => void;
  /**
   * Selectors/patterns to block from capture.
   *
   * **Important:** Patterns are matched against the *sanitized* selector (after PII removal).
   * Use `data-observability-block` attribute for reliable blocking of specific elements.
   */
  blockedSelectors?: (string | RegExp)[];
  /** Number of clicks to trigger rage detection. @default 3 */
  threshold?: number;
  /** Time window for counting clicks (ms). @default 800 */
  windowMs?: number;
  /** Cooldown before re-emitting for same element (ms). @default 2000 */
  cooldownMs?: number;
}

interface ClickState {
  count: number;
  firstTs: number;
  lastTs: number;
  cooldownUntil: number;
}

export class BrowserRageClickInstrumentation extends InstrumentationBase<BrowserRageClickConfig> {
  readonly component = "browser-rage-click";
  readonly version = "1.0.0";
  readonly moduleName = this.component;

  private _isInstrumentationEnabled = false;
  private _clickHandler?: (event: MouseEvent) => void;
  private _clickStates = new Map<string, ClickState>();

  // config with defaults
  private get threshold(): number {
    return this._config.threshold ?? 3;
  }

  private get windowMs(): number {
    return this._config.windowMs ?? 800;
  }

  private get cooldownMs(): number {
    return this._config.cooldownMs ?? 2000;
  }

  constructor(config: BrowserRageClickConfig = {}) {
    super("@satoshibits/browser-rage-click-instrumentation", "1.0.0", {
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

      const element = event.target;

      // build safe selector (returns null for sensitive elements)
      const selector = buildSafeSelector(element);
      if (!selector) return;

      // check against blocked patterns
      if (matchesBlockedSelector(selector, this._config.blockedSelectors)) {
        return;
      }

      const now = Date.now();
      let state = this._clickStates.get(selector);

      if (!state || now - state.lastTs > this.windowMs) {
        // start new click sequence
        state = {
          count: 1,
          firstTs: now,
          lastTs: now,
          cooldownUntil: 0,
        };
      } else {
        // continue existing sequence
        state.count++;
        state.lastTs = now;
      }

      this._clickStates.set(selector, state);

      // check for rage click
      if (state.count >= this.threshold && now > state.cooldownUntil) {
        // set cooldown to prevent duplicate emissions
        state.cooldownUntil = now + this.cooldownMs;

        const data: Record<string, unknown> = {
          selector,
          clickCount: state.count,
          windowMs: now - state.firstTs,
          threshold: this.threshold,
        };

        // record breadcrumb with warning level (high signal)
        // using "action" category which is standard for UI interactions
        addBreadcrumb({
          category: "action",
          message: `Rage click detected: ${selector} (${state.count} clicks in ${now - state.firstTs}ms)`,
          level: "warning",
          data,
        });

        // call test handler if provided
        this._config.interactionHandler?.("ui.rage_click", data);
      }

      // cleanup old entries periodically
      if (this._clickStates.size > 100) {
        this.cleanupStaleEntries(now);
      }
    };

    document.addEventListener("click", this._clickHandler, {
      capture: true,
      passive: true,
    });

    this._isInstrumentationEnabled = true;
  }

  private cleanupStaleEntries(now: number): void {
    const staleThreshold = this.windowMs * 2;
    for (const [key, state] of this._clickStates) {
      if (now - state.lastTs > staleThreshold) {
        this._clickStates.delete(key);
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
    this._clickStates.clear();
    this._isInstrumentationEnabled = false;
  }
}
