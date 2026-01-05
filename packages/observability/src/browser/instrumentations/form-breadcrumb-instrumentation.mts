/**
 * Form Breadcrumb Instrumentation
 *
 * Captures form submission events as breadcrumbs.
 * Useful for correlating backend errors with frontend form submissions.
 *
 * Features:
 * - Captures metadata only (method, action, field count)
 * - NEVER captures input values
 * - Sanitizes form identifiers
 * - Blocks sensitive forms
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
  isSensitiveElement,
  sanitizeIdentifier,
  sanitizeFormAction,
  matchesBlockedSelector,
  buildSafeSelector,
} from "../utils/dom-privacy.mjs";

export interface BrowserFormBreadcrumbConfig extends InstrumentationConfig {
  /** Custom interaction handler for testing/custom processing */
  interactionHandler?: (type: string, data?: Record<string, unknown>) => void;
  /**
   * Selectors/patterns to block from capture.
   *
   * **Important:** Patterns are matched against the *sanitized* selector (after PII removal).
   * Use `data-observability-block` attribute for reliable blocking of specific forms.
   */
  blockedSelectors?: (string | RegExp)[];
}

export class BrowserFormBreadcrumbInstrumentation extends InstrumentationBase<BrowserFormBreadcrumbConfig> {
  readonly component = "browser-form-breadcrumb";
  readonly version = "1.0.0";
  readonly moduleName = this.component;

  private _isInstrumentationEnabled = false;
  private _submitHandler?: (event: SubmitEvent) => void;

  constructor(config: BrowserFormBreadcrumbConfig = {}) {
    super("@anthropic/browser-form-breadcrumb-instrumentation", "1.0.0", {
      ...config,
      enabled: false,
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
    if (typeof document === "undefined") return;

    this._submitHandler = (event: SubmitEvent) => {
      // guard: target must be an HTMLFormElement
      if (!(event.target instanceof HTMLFormElement)) return;
      const form = event.target;

      // block sensitive forms
      if (isSensitiveElement(form)) return;

      // build form identifier
      const formId = form.id ? sanitizeIdentifier(form.id) : undefined;
      const formName = form.name ? sanitizeIdentifier(form.name) : undefined;
      const formIdentifier = formId || formName || "[unnamed]";

      // check against blocked patterns - check both selector and identifier
      const formSelector = buildSafeSelector(form);
      if (formSelector && matchesBlockedSelector(formSelector, this._config.blockedSelectors)) {
        return;
      }
      if (matchesBlockedSelector(formIdentifier, this._config.blockedSelectors)) {
        return;
      }

      // count fields by type (no values captured!)
      const fieldCounts = this.countFieldTypes(form);

      // build breadcrumb data
      const data: Record<string, unknown> = {
        formId,
        formName,
        method: form.method?.toUpperCase() || "GET",
        action: sanitizeFormAction(form.action),
        fieldCount: form.elements.length,
        fieldTypes: fieldCounts,
        hasFileInput: (fieldCounts.file ?? 0) > 0,
      };

      // record breadcrumb (using 'action' category for UI interactions)
      addBreadcrumb({
        category: "action",
        message: `Form submitted: ${formIdentifier}`,
        level: "info",
        data,
      });

      // call test handler if provided
      this._config.interactionHandler?.("ui.form_submit", data);
    };

    document.addEventListener("submit", this._submitHandler, {
      capture: true,
      passive: true,
    });

    this._isInstrumentationEnabled = true;
  }

  /**
   * Count form fields by type without capturing values.
   */
  private countFieldTypes(form: HTMLFormElement): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const element of form.elements) {
      let type = "unknown";

      if (element instanceof HTMLInputElement) {
        type = element.type || "text";
      } else if (element instanceof HTMLTextAreaElement) {
        type = "textarea";
      } else if (element instanceof HTMLSelectElement) {
        type = "select";
      } else if (element instanceof HTMLButtonElement) {
        type = "button";
      }

      counts[type] = (counts[type] || 0) + 1;
    }

    return counts;
  }

  disable(): void {
    if (this._submitHandler && typeof document !== "undefined") {
      document.removeEventListener("submit", this._submitHandler, {
        capture: true,
      } as EventListenerOptions);
      this._submitHandler = undefined;
    }
    this._isInstrumentationEnabled = false;
  }
}
