import { describe, it, expect } from "vitest";
import {
  DataSanitizer,
  SanitizerPresets,
} from "../../enrichment/sanitizer.mjs";

describe("SanitizerPresets", () => {
  describe("minimal preset", () => {
    it("should only mask credit cards and SSNs", () => {
      const sanitizer = new DataSanitizer(SanitizerPresets.minimal());

      // credit cards masked
      expect(sanitizer.sanitize("Card: 4111-1111-1111-1111")).not.toContain(
        "4111-1111-1111-1111",
      );

      // ssn masked
      expect(sanitizer.sanitize("SSN: 123-45-6789")).not.toContain(
        "123-45-6789",
      );

      // emails NOT masked
      expect(sanitizer.sanitize("user@example.com")).toContain(
        "user@example.com",
      );

      // phones NOT masked
      expect(sanitizer.sanitize("Phone: +1-555-123-4567")).toContain(
        "555-123-4567",
      );

      // IPs NOT masked
      expect(sanitizer.sanitize("IP: 192.168.1.1")).toContain("192.168.1.1");
    });

    it("should have strictMode disabled", () => {
      const preset = SanitizerPresets.minimal();
      expect(preset.strictMode).toBe(false);
    });
  });

  describe("gdpr preset", () => {
    it("should mask emails, phones, and IPs for GDPR compliance", () => {
      const sanitizer = new DataSanitizer(SanitizerPresets.gdpr());

      // emails masked
      const emailResult = sanitizer.sanitize("Email: user@example.com");
      expect(emailResult).not.toContain("user@example.com");
      expect(emailResult).toContain("@example.com"); // partial mask

      // phones masked
      expect(sanitizer.sanitize("Phone: +1-555-123-4567")).not.toContain(
        "555-123-4567",
      );

      // IPs masked
      expect(sanitizer.sanitize("IP: 192.168.1.1")).not.toContain(
        "192.168.1.1",
      );

      // credit cards masked
      expect(sanitizer.sanitize("Card: 4111-1111-1111-1111")).not.toContain(
        "4111-1111-1111-1111",
      );
    });

    it("should have strictMode enabled", () => {
      const preset = SanitizerPresets.gdpr();
      expect(preset.strictMode).toBe(true);
    });

    it("should NOT mask UUIDs (correlation IDs)", () => {
      const preset = SanitizerPresets.gdpr();
      expect(preset.maskUUIDs).toBe(false);
    });
  });

  describe("ccpa preset", () => {
    it("should mask emails, phones, and IPs for CCPA compliance", () => {
      const sanitizer = new DataSanitizer(SanitizerPresets.ccpa());

      // emails masked
      expect(sanitizer.sanitize("user@example.com")).not.toContain(
        "user@example.com",
      );

      // phones masked
      expect(sanitizer.sanitize("Phone: +1-555-123-4567")).not.toContain(
        "555-123-4567",
      );

      // IPs masked (california considers IP addresses as personal information)
      expect(sanitizer.sanitize("IP: 192.168.1.1")).not.toContain(
        "192.168.1.1",
      );
    });

    it("should have strictMode disabled (less strict than GDPR)", () => {
      const preset = SanitizerPresets.ccpa();
      expect(preset.strictMode).toBe(false);
    });
  });

  describe("hipaa preset", () => {
    it("should mask all standard PII fields", () => {
      const sanitizer = new DataSanitizer(SanitizerPresets.hipaa());

      // emails masked
      expect(sanitizer.sanitize("user@example.com")).not.toContain(
        "user@example.com",
      );

      // phones masked
      expect(sanitizer.sanitize("Phone: +1-555-123-4567")).not.toContain(
        "555-123-4567",
      );

      // IPs masked
      expect(sanitizer.sanitize("IP: 192.168.1.1")).not.toContain(
        "192.168.1.1",
      );

      // UUIDs masked (more conservative for healthcare)
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      expect(sanitizer.sanitize(uuid)).not.toContain(uuid);
    });

    it("should include healthcare-specific redaction fields", () => {
      const preset = SanitizerPresets.hipaa();

      expect(preset.customRedactFields).toContain("ssn");
      expect(preset.customRedactFields).toContain("mrn");
      expect(preset.customRedactFields).toContain("patient_id");
      expect(preset.customRedactFields).toContain("medical_record_number");
      expect(preset.customRedactFields).toContain("diagnosis");
      expect(preset.customRedactFields).toContain("prescription");
      expect(preset.customRedactFields).toContain("insurance_number");
    });

    it("should have strictMode enabled", () => {
      const preset = SanitizerPresets.hipaa();
      expect(preset.strictMode).toBe(true);
    });

    it("should redact healthcare-specific fields in objects", () => {
      const sanitizer = new DataSanitizer(SanitizerPresets.hipaa());

      const data = {
        patient_id: "12345",
        diagnosis: "test diagnosis",
        prescription: "test medication",
        normal_field: "keep this",
      };

      const sanitized = sanitizer.sanitize(data);

      expect(sanitized.patient_id).toBe("[REDACTED]");
      expect(sanitized.diagnosis).toBe("[REDACTED]");
      expect(sanitized.prescription).toBe("[REDACTED]");
      expect(sanitized.normal_field).toBe("keep this");
    });
  });

  describe("internal preset", () => {
    it("should use minimal sanitization for internal tools", () => {
      const sanitizer = new DataSanitizer(SanitizerPresets.internal());

      // only credit cards and SSNs masked
      expect(sanitizer.sanitize("Card: 4111-1111-1111-1111")).not.toContain(
        "4111-1111-1111-1111",
      );

      // emails NOT masked (internal tools)
      expect(sanitizer.sanitize("user@example.com")).toContain(
        "user@example.com",
      );

      // phones NOT masked
      expect(sanitizer.sanitize("Phone: +1-555-123-4567")).toContain(
        "555-123-4567",
      );

      // IPs NOT masked
      expect(sanitizer.sanitize("IP: 192.168.1.1")).toContain("192.168.1.1");
    });

    it("should have strictMode disabled", () => {
      const preset = SanitizerPresets.internal();
      expect(preset.strictMode).toBe(false);
    });
  });

  describe("preset comparison", () => {
    it("should have gdpr preset stricter than ccpa preset", () => {
      const gdpr = SanitizerPresets.gdpr();
      const ccpa = SanitizerPresets.ccpa();

      // GDPR has strict mode enabled, CCPA doesn't
      expect(gdpr.strictMode).toBe(true);
      expect(ccpa.strictMode).toBe(false);
    });

    it("should have hipaa preset most conservative", () => {
      const hipaa = SanitizerPresets.hipaa();
      const gdpr = SanitizerPresets.gdpr();

      // HIPAA masks UUIDs, GDPR doesn't
      expect(hipaa.maskUUIDs).toBe(true);
      expect(gdpr.maskUUIDs).toBe(false);

      // HIPAA has additional custom fields
      expect(hipaa.customRedactFields!.length).toBeGreaterThan(
        (gdpr.customRedactFields ?? []).length,
      );
    });

    it("should have minimal and internal presets least restrictive", () => {
      const minimal = SanitizerPresets.minimal();
      const internal = SanitizerPresets.internal();

      expect(minimal.maskEmails).toBe(false);
      expect(minimal.maskPhones).toBe(false);
      expect(minimal.maskIPs).toBe(false);

      expect(internal.maskEmails).toBe(false);
      expect(internal.maskPhones).toBe(false);
      expect(internal.maskIPs).toBe(false);
    });
  });

  describe("real-world application scenarios", () => {
    it("should work for B2B SaaS (needs emails for support)", () => {
      // B2B SaaS might start with GDPR but disable email masking for support
      const sanitizer = new DataSanitizer({
        ...SanitizerPresets.gdpr(),
        maskEmails: false, // override for B2B support needs
      });

      // emails NOT masked (support correlation)
      expect(sanitizer.sanitize("Contact: user@company.com")).toContain(
        "user@company.com",
      );

      // phones still masked
      expect(sanitizer.sanitize("Phone: +1-555-123-4567")).not.toContain(
        "555-123-4567",
      );

      // IPs still masked
      expect(sanitizer.sanitize("IP: 192.168.1.1")).not.toContain(
        "192.168.1.1",
      );
    });

    it("should work for multi-region SaaS (different presets per region)", () => {
      const euSanitizer = new DataSanitizer(SanitizerPresets.gdpr());
      const usSanitizer = new DataSanitizer(SanitizerPresets.ccpa());
      const internalSanitizer = new DataSanitizer(SanitizerPresets.internal());

      const testEmail = "user@example.com";

      // EU region: GDPR (masks emails)
      expect(euSanitizer.sanitize(testEmail)).not.toContain(testEmail);

      // US region: CCPA (masks emails)
      expect(usSanitizer.sanitize(testEmail)).not.toContain(testEmail);

      // Internal region: minimal (doesn't mask emails)
      expect(internalSanitizer.sanitize(testEmail)).toContain(testEmail);
    });

    it("should work for healthcare application", () => {
      const sanitizer = new DataSanitizer(SanitizerPresets.hipaa());

      const patientRecord = {
        patient_id: "PAT-12345",
        mrn: "MRN-98765",
        diagnosis: "hypertension",
        email: "patient@example.com",
        phone: "+1-555-123-4567",
        ip: "192.168.1.1",
        notes: "Patient has credit card 4111-1111-1111-1111 on file",
      };

      const sanitized = sanitizer.sanitize(patientRecord);

      // healthcare fields redacted
      expect(sanitized.patient_id).toBe("[REDACTED]");
      expect(sanitized.mrn).toBe("[REDACTED]");
      expect(sanitized.diagnosis).toBe("[REDACTED]");

      // standard PII masked
      expect(sanitized.email).not.toContain("patient@example.com");
      expect(sanitized.phone).not.toContain("555-123-4567");
      expect(sanitized.ip).not.toContain("192.168.1.1");

      // credit card in notes masked
      expect(sanitized.notes).not.toContain("4111-1111-1111-1111");
    });

    it("should work for internal monitoring dashboard", () => {
      const sanitizer = new DataSanitizer(SanitizerPresets.internal());

      const logEntry = {
        user_email: "admin@company.com",
        source_ip: "192.168.1.100",
        contact_number: "+1-555-999-8888", // avoid field name "phone" which is always redacted
        api_key: "sk_live_abc123xyz789",
        credit_card: "4111-1111-1111-1111",
        notes: "Contact at +1-555-123-4567", // phone in string
      };

      const sanitized = sanitizer.sanitize(logEntry);

      // internal tools - emails, IPs NOT masked in field names
      expect(sanitized.user_email).toBe("admin@company.com");
      expect(sanitized.source_ip).toBe("192.168.1.100");

      // phone NUMBER in non-sensitive field name is NOT masked (maskPhones: false)
      expect(sanitized.contact_number).toBe("+1-555-999-8888");

      // phone number in STRING is also NOT masked (maskPhones: false)
      expect(sanitized.notes).toContain("+1-555-123-4567");

      // api_key redacted (always sensitive field name)
      expect(sanitized.api_key).toBe("[REDACTED]");

      // credit card masked (always masked in strings)
      expect(sanitized.credit_card).not.toContain("4111-1111-1111-1111");
    });
  });

  describe("preset extensibility", () => {
    it("should allow extending presets with custom fields", () => {
      const sanitizer = new DataSanitizer({
        ...SanitizerPresets.gdpr(),
        customRedactFields: [
          ...(SanitizerPresets.gdpr().customRedactFields ?? []),
          "company_id",
          "tenant_id",
        ],
      });

      const data = {
        company_id: "COMP-123",
        tenant_id: "TENANT-456",
        normal_field: "keep this",
      };

      const sanitized = sanitizer.sanitize(data);

      expect(sanitized.company_id).toBe("[REDACTED]");
      expect(sanitized.tenant_id).toBe("[REDACTED]");
      expect(sanitized.normal_field).toBe("keep this");
    });

    it("should allow overriding preset options", () => {
      const sanitizer = new DataSanitizer({
        ...SanitizerPresets.gdpr(),
        maskEmails: false, // override
        redactionString: "[PRIVACY]", // custom redaction string
      });

      // emails NOT masked (overridden)
      expect(sanitizer.sanitize("user@example.com")).toContain(
        "user@example.com",
      );

      // credit card masked with custom redactionString
      const ccResult = sanitizer.sanitize(
        "Credit card: 4111-1111-1111-1111",
      );
      expect(ccResult).toContain("[PRIVACY]");

      // field-level redaction uses custom redactionString
      const objResult = sanitizer.sanitize({ password: "secret123" });
      expect(objResult.password).toBe("[PRIVACY]");
    });
  });
});
