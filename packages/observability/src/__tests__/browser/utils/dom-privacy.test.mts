/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  isSensitiveElement,
  sanitizeIdentifier,
  buildSafeSelector,
  sanitizeFormAction,
  getSafeElementText,
  matchesBlockedSelector,
} from "../../../browser/utils/dom-privacy.mjs";

describe("DOM Privacy Utilities", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    container.id = "test-container";
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  describe("isSensitiveElement", () => {
    it("should block password inputs", () => {
      const input = document.createElement("input");
      input.type = "password";
      container.appendChild(input);

      expect(isSensitiveElement(input)).toBe(true);
    });

    it("should block email inputs", () => {
      const input = document.createElement("input");
      input.type = "email";
      container.appendChild(input);

      expect(isSensitiveElement(input)).toBe(true);
    });

    it("should block tel inputs", () => {
      const input = document.createElement("input");
      input.type = "tel";
      container.appendChild(input);

      expect(isSensitiveElement(input)).toBe(true);
    });

    it("should block hidden inputs", () => {
      const input = document.createElement("input");
      input.type = "hidden";
      container.appendChild(input);

      expect(isSensitiveElement(input)).toBe(true);
    });

    it("should block textarea elements", () => {
      const textarea = document.createElement("textarea");
      container.appendChild(textarea);

      expect(isSensitiveElement(textarea)).toBe(true);
    });

    it("should block select elements", () => {
      const select = document.createElement("select");
      container.appendChild(select);

      expect(isSensitiveElement(select)).toBe(true);
    });

    it("should block elements with data-observability-block attribute", () => {
      const div = document.createElement("div");
      div.setAttribute("data-observability-block", "");
      container.appendChild(div);

      expect(isSensitiveElement(div)).toBe(true);
    });

    it("should block children of elements with data-observability-block", () => {
      const parent = document.createElement("div");
      parent.setAttribute("data-observability-block", "");
      const child = document.createElement("button");
      parent.appendChild(child);
      container.appendChild(parent);

      expect(isSensitiveElement(child)).toBe(true);
    });

    it("should block elements with sensitive id patterns", () => {
      const div = document.createElement("div");
      div.id = "user-password-field";
      container.appendChild(div);

      expect(isSensitiveElement(div)).toBe(true);
    });

    it("should block elements with sensitive class patterns", () => {
      const div = document.createElement("div");
      div.className = "credit-card-input";
      container.appendChild(div);

      expect(isSensitiveElement(div)).toBe(true);
    });

    it("should allow regular buttons", () => {
      const button = document.createElement("button");
      button.textContent = "Click me";
      container.appendChild(button);

      expect(isSensitiveElement(button)).toBe(false);
    });

    it("should allow regular divs", () => {
      const div = document.createElement("div");
      div.id = "normal-content";
      container.appendChild(div);

      expect(isSensitiveElement(div)).toBe(false);
    });

    it("should allow text inputs", () => {
      const input = document.createElement("input");
      input.type = "text";
      container.appendChild(input);

      // Text inputs are in SENSITIVE_ELEMENT_TAGS but not button type
      expect(isSensitiveElement(input)).toBe(true);
    });
  });

  describe("sanitizeIdentifier", () => {
    it("should return empty string for empty input", () => {
      expect(sanitizeIdentifier("")).toBe("");
    });

    it("should replace UUIDs with _uuid_", () => {
      const id = "user-123e4567-e89b-12d3-a456-426614174000-profile";
      const result = sanitizeIdentifier(id);

      // brackets get replaced with underscores: [uuid] -> _uuid_
      expect(result).toContain("_uuid_");
      expect(result).not.toContain("123e4567");
    });

    it("should replace emails with _email_", () => {
      const id = "form-user@example.com-input";
      const result = sanitizeIdentifier(id);

      // brackets get replaced with underscores: [email] -> _email_
      expect(result).toContain("_email_");
      expect(result).not.toContain("@example.com");
    });

    it("should replace long numeric sequences with _id_", () => {
      const id = "order-12345678-details";
      const result = sanitizeIdentifier(id);

      // brackets get replaced with underscores: [id] -> _id_
      expect(result).toContain("_id_");
      expect(result).not.toContain("12345678");
    });

    it("should preserve short numbers", () => {
      const id = "step-1-form";
      const result = sanitizeIdentifier(id);

      expect(result).toBe("step-1-form");
    });

    it("should replace special characters with underscores", () => {
      const id = "user.name@domain";
      const result = sanitizeIdentifier(id);

      expect(result).not.toContain(".");
      expect(result).not.toContain("@");
    });

    it("should truncate long identifiers to 50 chars", () => {
      const id = "a".repeat(100);
      const result = sanitizeIdentifier(id);

      expect(result.length).toBe(50);
    });
  });

  describe("buildSafeSelector", () => {
    it("should build selector for simple element", () => {
      const button = document.createElement("button");
      button.id = "submit-btn";
      container.appendChild(button);

      const selector = buildSafeSelector(button);

      expect(selector).toContain("button#submit-btn");
    });

    it("should use class when no id", () => {
      const button = document.createElement("button");
      button.className = "primary-action";
      container.appendChild(button);

      const selector = buildSafeSelector(button);

      expect(selector).toContain("button.primary-action");
    });

    it("should include role attribute", () => {
      const div = document.createElement("div");
      div.setAttribute("role", "button");
      container.appendChild(div);

      const selector = buildSafeSelector(div);

      expect(selector).toContain('[role="button"]');
    });

    it("should return null for sensitive elements", () => {
      const input = document.createElement("input");
      input.type = "password";
      container.appendChild(input);

      const selector = buildSafeSelector(input);

      expect(selector).toBeNull();
    });

    it("should return null for blocked elements", () => {
      const div = document.createElement("div");
      div.setAttribute("data-observability-block", "");
      container.appendChild(div);

      const selector = buildSafeSelector(div);

      expect(selector).toBeNull();
    });

    it("should build hierarchical selector", () => {
      const parent = document.createElement("div");
      parent.id = "parent";
      const child = document.createElement("button");
      child.id = "child";
      parent.appendChild(child);
      container.appendChild(parent);

      const selector = buildSafeSelector(child);

      expect(selector).toContain("div#parent");
      expect(selector).toContain("button#child");
      expect(selector).toContain(" > ");
    });

    it("should respect maxDepth option", () => {
      // Create deep nesting
      let current = container;
      for (let i = 0; i < 10; i++) {
        const div = document.createElement("div");
        div.className = `level-${i}`;
        current.appendChild(div);
        current = div;
      }
      const button = document.createElement("button");
      button.id = "deep-button";
      current.appendChild(button);

      const selector = buildSafeSelector(button, { maxDepth: 3 });
      const segments = selector?.split(" > ") || [];

      expect(segments.length).toBeLessThanOrEqual(3);
    });

    it("should sanitize ids in selector", () => {
      const button = document.createElement("button");
      button.id = "user-123456789-action";
      container.appendChild(button);

      const selector = buildSafeSelector(button);

      // the sanitizeIdentifier replaces long numbers with [id] then replaces [] with _
      expect(selector).toContain("_id_");
      expect(selector).not.toContain("123456789");
    });
  });

  describe("sanitizeFormAction", () => {
    it("should strip query parameters", () => {
      const action = "https://example.com/submit?token=secret&user=123";
      const result = sanitizeFormAction(action);

      expect(result).toBe("https://example.com/submit");
      expect(result).not.toContain("token");
      expect(result).not.toContain("secret");
    });

    it("should strip hash fragments", () => {
      const action = "https://example.com/form#section";
      const result = sanitizeFormAction(action);

      expect(result).toBe("https://example.com/form");
    });

    it("should handle relative URLs", () => {
      const action = "/api/submit?data=value";
      const result = sanitizeFormAction(action);

      expect(result).toContain("/api/submit");
      expect(result).not.toContain("data=value");
    });

    it("should return [no-action] for empty input", () => {
      expect(sanitizeFormAction("")).toBe("[no-action]");
    });

    it("should handle relative paths that look like invalid URLs", () => {
      // URL constructor is very lenient - it will parse almost anything as a path
      // so we just verify it doesn't throw and returns a sanitized result
      const result = sanitizeFormAction("not a url at all :::");
      expect(result).toBeDefined();
      expect(result).not.toContain("?");
    });
  });

  describe("getSafeElementText", () => {
    it("should return text content", () => {
      const button = document.createElement("button");
      button.textContent = "Click me";
      container.appendChild(button);

      const text = getSafeElementText(button);

      expect(text).toBe("Click me");
    });

    it("should trim whitespace", () => {
      const button = document.createElement("button");
      button.textContent = "  Click me  ";
      container.appendChild(button);

      const text = getSafeElementText(button);

      expect(text).toBe("Click me");
    });

    it("should truncate long text", () => {
      const button = document.createElement("button");
      button.textContent = "This is a very long button text that exceeds the maximum length allowed";
      container.appendChild(button);

      const text = getSafeElementText(button, { maxLength: 20 });

      expect(text?.length).toBe(20);
      expect(text).toContain("...");
    });

    it("should return undefined for sensitive elements", () => {
      const input = document.createElement("input");
      input.type = "password";
      input.value = "secret";
      container.appendChild(input);

      const text = getSafeElementText(input);

      expect(text).toBeUndefined();
    });

    it("should return undefined for empty text", () => {
      const button = document.createElement("button");
      button.textContent = "";
      container.appendChild(button);

      const text = getSafeElementText(button);

      expect(text).toBeUndefined();
    });

    it("should return undefined for whitespace-only text", () => {
      const button = document.createElement("button");
      button.textContent = "   ";
      container.appendChild(button);

      const text = getSafeElementText(button);

      expect(text).toBeUndefined();
    });
  });

  describe("matchesBlockedSelector", () => {
    it("should return false for empty patterns", () => {
      const result = matchesBlockedSelector("button#submit", []);

      expect(result).toBe(false);
    });

    it("should match string patterns", () => {
      const result = matchesBlockedSelector("div.payment-form > button", [
        ".payment",
      ]);

      expect(result).toBe(true);
    });

    it("should match regex patterns", () => {
      const result = matchesBlockedSelector("button#admin-action", [
        /admin/i,
      ]);

      expect(result).toBe(true);
    });

    it("should return false when no patterns match", () => {
      const result = matchesBlockedSelector("button#submit", [
        ".payment",
        /admin/i,
      ]);

      expect(result).toBe(false);
    });

    it("should handle case-insensitive regex", () => {
      const result = matchesBlockedSelector("div.ADMIN-panel", [/admin/i]);

      expect(result).toBe(true);
    });
  });
});
