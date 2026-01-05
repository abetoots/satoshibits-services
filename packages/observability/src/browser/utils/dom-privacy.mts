/**
 * DOM Privacy Utilities
 *
 * Provides safe element identification without capturing sensitive data.
 * Used by interaction breadcrumb instrumentations.
 */

// ===== CONSTANTS =====

const SENSITIVE_INPUT_TYPES = new Set([
  "password",
  "email",
  "tel",
  "number",
  "hidden",
  "date",
  "datetime-local",
]);

const SENSITIVE_ELEMENT_TAGS = new Set(["input", "textarea", "select"]);

const SENSITIVE_PATTERNS =
  /password|secret|token|ssn|credit|card|cvv|pin|auth/i;

const PII_PATTERNS = {
  uuid: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  numericId: /\d{4,}/g,
};

// ===== EXPORTS =====

/**
 * Check if an element should be blocked from capture.
 *
 * Blocks:
 * - Elements with data-observability-block attribute
 * - Password/email/tel/hidden inputs
 * - Elements with sensitive class/id names
 * - Children of blocked ancestors
 */
export function isSensitiveElement(element: Element): boolean {
  // Check explicit block attribute (on element or ancestor)
  if (element.closest("[data-observability-block]")) {
    return true;
  }

  // Check input types
  if (element instanceof HTMLInputElement) {
    if (SENSITIVE_INPUT_TYPES.has(element.type)) {
      return true;
    }
  }

  // Check sensitive element types (but allow buttons)
  const tag = element.tagName.toLowerCase();
  if (SENSITIVE_ELEMENT_TAGS.has(tag)) {
    // Allow buttons inside forms, block actual input fields
    if (tag !== "button" && element.getAttribute("type") !== "button") {
      return true;
    }
  }

  // Check class/id for sensitive patterns
  const id = element.id || "";
  const className =
    typeof element.className === "string" ? element.className : "";

  if (SENSITIVE_PATTERNS.test(id) || SENSITIVE_PATTERNS.test(className)) {
    return true;
  }

  return false;
}

/**
 * Sanitize an identifier (id/class) by removing PII patterns.
 */
export function sanitizeIdentifier(id: string): string {
  if (!id) return "";

  return id
    .replace(PII_PATTERNS.uuid, "[uuid]")
    .replace(PII_PATTERNS.email, "[email]")
    .replace(PII_PATTERNS.numericId, "[id]")
    .replace(/[^\w-]/g, "_")
    .slice(0, 50);
}

/**
 * Build a safe CSS-like selector for an element.
 *
 * Returns null if:
 * - Element is sensitive
 * - Element is in a blocked subtree
 *
 * Sanitizes:
 * - UUIDs → [uuid]
 * - Long numbers → [id]
 * - Email patterns → [email]
 */
export function buildSafeSelector(
  element: Element,
  options: { maxDepth?: number } = {},
): string | null {
  const { maxDepth = 5 } = options;

  if (isSensitiveElement(element)) {
    return null;
  }

  const segments: string[] = [];
  let node: Element | null = element;

  while (
    node &&
    segments.length < maxDepth &&
    node !== document.documentElement
  ) {
    const tag = node.tagName.toLowerCase();

    // Build segment: tag#id.class[role]
    let segment = tag;

    if (node.id) {
      const safeId = sanitizeIdentifier(node.id);
      if (safeId) {
        segment += `#${safeId}`;
      }
    } else if (node.classList.length > 0) {
      const safeClass = sanitizeIdentifier(node.classList[0]!);
      if (safeClass) {
        segment += `.${safeClass}`;
      }
    }

    const role = node.getAttribute("role");
    if (role) {
      segment += `[role="${role}"]`;
    }

    segments.unshift(segment);
    node = node.parentElement;
  }

  return segments.length > 0 ? segments.join(" > ") : null;
}

/**
 * Sanitize a form action URL by stripping query parameters.
 */
export function sanitizeFormAction(action: string): string {
  if (!action) return "[no-action]";

  try {
    const url = new URL(action, globalThis.location?.origin || "http://localhost");
    // Return origin + pathname only, strip query/hash
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

/**
 * Get safe display text from an element.
 * Returns undefined if element is sensitive or text is empty.
 */
export function getSafeElementText(
  element: Element,
  options: { maxLength?: number } = {},
): string | undefined {
  const { maxLength = 50 } = options;

  if (isSensitiveElement(element)) {
    return undefined;
  }

  const text = element.textContent?.trim();
  if (!text) return undefined;

  // Truncate and indicate if truncated
  if (text.length > maxLength) {
    return text.slice(0, maxLength - 3) + "...";
  }

  return text;
}

/**
 * Check if a selector matches blocked patterns.
 */
export function matchesBlockedSelector(
  selector: string,
  blockedPatterns: (string | RegExp)[] = [],
): boolean {
  return blockedPatterns.some((pattern) => {
    if (typeof pattern === "string") {
      return selector.includes(pattern);
    }
    // reset lastIndex to avoid stateful matching with global regexes
    pattern.lastIndex = 0;
    return pattern.test(selector);
  });
}
