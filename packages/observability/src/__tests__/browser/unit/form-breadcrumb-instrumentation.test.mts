/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { BrowserFormBreadcrumbInstrumentation } from "../../../browser/instrumentations/form-breadcrumb-instrumentation.mjs";

// mock addBreadcrumb
vi.mock("../../../enrichment/context.mjs", () => ({
  addBreadcrumb: vi.fn(),
}));

import { addBreadcrumb } from "../../../enrichment/context.mjs";

describe("BrowserFormBreadcrumbInstrumentation", () => {
  let instrumentation: BrowserFormBreadcrumbInstrumentation;
  let container: HTMLDivElement;
  let interactionHandler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    interactionHandler = vi.fn();

    container = document.createElement("div");
    container.id = "test-container";
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (instrumentation) {
      instrumentation.disable();
    }
    container.remove();
  });

  describe("enable/disable", () => {
    it("should start disabled", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation();
      expect(instrumentation.isEnabled()).toBe(false);
    });

    it("should enable and track state", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation();
      instrumentation.enable();
      expect(instrumentation.isEnabled()).toBe(true);
    });

    it("should disable and track state", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation();
      instrumentation.enable();
      instrumentation.disable();
      expect(instrumentation.isEnabled()).toBe(false);
    });

    it("should be idempotent for enable", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation();
      instrumentation.enable();
      instrumentation.enable();
      expect(instrumentation.isEnabled()).toBe(true);
    });
  });

  describe("form submission capture", () => {
    it("should capture form submission with id", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "login-form";
      form.method = "POST";
      form.action = "/api/login";
      container.appendChild(form);

      // dispatch submit event (form.submit() doesn't trigger event)
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "action",
          level: "info",
          message: expect.stringContaining("login-form"),
        }),
      );
      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.form_submit",
        expect.objectContaining({
          formId: "login-form",
          method: "POST",
        }),
      );
    });

    it("should capture form submission with name", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.name = "contact-form";
      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.form_submit",
        expect.objectContaining({
          formName: "contact-form",
        }),
      );
    });

    it("should use [unnamed] for forms without id or name", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const form = document.createElement("form");
      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("[unnamed]"),
        }),
      );
    });

    it("should capture form method (default to GET)", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "search-form";
      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.form_submit",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });

    it("should sanitize form action URL", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "payment-form";
      form.action = "/api/pay?token=secret123";
      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.form_submit",
        expect.objectContaining({
          action: expect.not.stringContaining("token=secret"),
        }),
      );
    });
  });

  describe("field counting", () => {
    it("should count form fields by type", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "signup-form";

      // add various input types
      const textInput = document.createElement("input");
      textInput.type = "text";
      form.appendChild(textInput);

      const emailInput = document.createElement("input");
      emailInput.type = "email";
      form.appendChild(emailInput);

      const passwordInput = document.createElement("input");
      passwordInput.type = "password";
      form.appendChild(passwordInput);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      form.appendChild(checkbox);

      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.form_submit",
        expect.objectContaining({
          fieldCount: 4,
          fieldTypes: expect.objectContaining({
            text: 1,
            email: 1,
            password: 1,
            checkbox: 1,
          }),
        }),
      );
    });

    it("should count textarea elements", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "feedback-form";

      const textarea = document.createElement("textarea");
      form.appendChild(textarea);

      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.form_submit",
        expect.objectContaining({
          fieldTypes: expect.objectContaining({
            textarea: 1,
          }),
        }),
      );
    });

    it("should count select elements", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "order-form";

      const select = document.createElement("select");
      form.appendChild(select);

      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.form_submit",
        expect.objectContaining({
          fieldTypes: expect.objectContaining({
            select: 1,
          }),
        }),
      );
    });

    it("should detect file inputs", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "upload-form";

      const fileInput = document.createElement("input");
      fileInput.type = "file";
      form.appendChild(fileInput);

      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.form_submit",
        expect.objectContaining({
          hasFileInput: true,
          fieldTypes: expect.objectContaining({
            file: 1,
          }),
        }),
      );
    });

    it("should not capture input values", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "login-form";

      const usernameInput = document.createElement("input");
      usernameInput.type = "text";
      usernameInput.name = "username";
      usernameInput.value = "john_doe";
      form.appendChild(usernameInput);

      const passwordInput = document.createElement("input");
      passwordInput.type = "password";
      passwordInput.name = "password";
      passwordInput.value = "supersecret123";
      form.appendChild(passwordInput);

      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      // verify no values are captured
      const callData = interactionHandler.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
      const dataString = JSON.stringify(callData);

      expect(dataString).not.toContain("john_doe");
      expect(dataString).not.toContain("supersecret123");
    });
  });

  describe("sensitive form blocking", () => {
    it("should not capture forms with data-observability-block", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "secret-form";
      form.setAttribute("data-observability-block", "");
      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(addBreadcrumb).not.toHaveBeenCalled();
      expect(interactionHandler).not.toHaveBeenCalled();
    });

    it("should not capture forms with sensitive id patterns", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "credit-card-form";
      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });

    it("should not capture forms with sensitive class patterns", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.className = "password-reset-form";
      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });
  });

  describe("blockedSelectors config", () => {
    it("should respect string blockedSelectors on form id", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
        blockedSelectors: ["payment"],
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "payment-form";
      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });

    it("should respect regex blockedSelectors", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
        blockedSelectors: [/admin/i],
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "admin-settings";
      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });

    it("should allow forms not matching blockedSelectors", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
        blockedSelectors: [/payment/i],
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "newsletter-form";
      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(addBreadcrumb).toHaveBeenCalled();
    });
  });

  describe("identifier sanitization", () => {
    it("should sanitize UUIDs in form id", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "form-123e4567-e89b-12d3-a456-426614174000";
      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      const callData = interactionHandler.mock.calls[0]?.[1] as { formId?: string } | undefined;
      expect(callData?.formId).toContain("_uuid_");
      expect(callData?.formId).not.toContain("123e4567");
    });

    it("should sanitize long numeric ids", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "order-12345678-form";
      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      const callData = interactionHandler.mock.calls[0]?.[1] as { formId?: string } | undefined;
      expect(callData?.formId).toContain("_id_");
      expect(callData?.formId).not.toContain("12345678");
    });
  });

  describe("cleanup", () => {
    it("should not capture submissions after disable", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();
      instrumentation.disable();

      const form = document.createElement("form");
      form.id = "test-form";
      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });

    it("should capture submissions after re-enable", () => {
      instrumentation = new BrowserFormBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();
      instrumentation.disable();
      instrumentation.enable();

      const form = document.createElement("form");
      form.id = "test-form";
      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(addBreadcrumb).toHaveBeenCalled();
    });
  });
});
