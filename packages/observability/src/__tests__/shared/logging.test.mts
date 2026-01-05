/**
 * Shared Logging Functionality Tests
 *
 * Tests the public logging API across environments without testing OTEL internals.
 * Uses MockObservabilityClient to verify API behavior and log recording.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { MockObservabilityClient } from "../test-utils/mock-client.mjs";

describe("Logging API - Shared Functionality", () => {
  let client: MockObservabilityClient;

  beforeEach(() => {
    client = new MockObservabilityClient();
  });

  describe("Basic Logging Operations", () => {
    it("Should log info messages", () => {
      client.logs.info("User logged in successfully");

      const logs = client.logs.getRecorded();
      expect(logs).toHaveLength(1);
      expect(logs[0]?.level).toBe("info");
      expect(logs[0]?.message).toBe("User logged in successfully");
      expect(typeof logs[0]?.timestamp).toBe("number");
    });

    it("Should log warn messages", () => {
      client.logs.warn("API rate limit approaching");

      const logs = client.logs.getRecorded();
      expect(logs).toHaveLength(1);
      expect(logs[0]?.level).toBe("warn");
      expect(logs[0]?.message).toBe("API rate limit approaching");
    });

    it("Should log debug messages", () => {
      client.logs.debug("Cache miss for key: user_123");

      const logs = client.logs.getRecorded();
      expect(logs).toHaveLength(1);
      expect(logs[0]?.level).toBe("debug");
      expect(logs[0]?.message).toBe("Cache miss for key: user_123");
    });

    it("Should log error messages", () => {
      const testError = new Error("Database connection failed");
      client.logs.error("Database operation failed", testError);

      const logs = client.logs.getRecorded();
      expect(logs).toHaveLength(1);
      expect(logs[0]?.level).toBe("error");
      expect(logs[0]?.message).toBe("Database operation failed");
      expect(logs[0]?.error).toBe(testError);
    });
  });

  describe("Logging with Attributes", () => {
    it("Should log info with attributes", () => {
      client.logs.info("Order processed", {
        orderId: "order_123",
        userId: "user_456",
        amount: 99.99,
        currency: "USD",
      });

      const logs = client.logs.getRecorded();
      expect(logs).toHaveLength(1);
      expect(logs[0]?.attributes).toEqual({
        orderId: "order_123",
        userId: "user_456",
        amount: 99.99,
        currency: "USD",
      });
    });

    it("Should log warn with attributes", () => {
      client.logs.warn("High memory usage detected", {
        memoryUsage: 85.5,
        threshold: 80.0,
        service: "api-server",
      });

      const logs = client.logs.getRecorded();
      expect(logs[0]?.level).toBe("warn");
      expect(logs[0]?.attributes).toEqual({
        memoryUsage: 85.5,
        threshold: 80.0,
        service: "api-server",
      });
    });

    it("Should log debug with attributes", () => {
      client.logs.debug("Cache operation", {
        operation: "get",
        key: "user_session_789",
        hit: false,
        ttl: 3600,
      });

      const logs = client.logs.getRecorded();
      expect(logs[0]?.level).toBe("debug");
      expect(logs[0]?.attributes).toEqual({
        operation: "get",
        key: "user_session_789",
        hit: false,
        ttl: 3600,
      });
    });

    it("Should log error with both error object and attributes", () => {
      const dbError = new Error("Connection timeout");
      client.logs.error("Database query failed", dbError, {
        query: "SELECT * FROM users WHERE id = ?",
        params: ["123"],
        duration: 5000,
      });

      const logs = client.logs.getRecorded();
      expect(logs[0]?.level).toBe("error");
      expect(logs[0]?.message).toBe("Database query failed");
      expect(logs[0]?.error).toBe(dbError);
      expect(logs[0]?.attributes).toEqual({
        query: "SELECT * FROM users WHERE id = ?",
        params: ["123"],
        duration: 5000,
      });
    });
  });

  describe("Multiple Log Entries", () => {
    it("Should record multiple log entries in order", () => {
      client.logs.info("Process started");
      client.logs.debug("Loading configuration");
      client.logs.warn("Deprecated API used");
      client.logs.info("Process completed");

      const logs = client.logs.getRecorded();
      expect(logs).toHaveLength(4);

      expect(logs[0]?.level).toBe("info");
      expect(logs[0]?.message).toBe("Process started");

      expect(logs[1]?.level).toBe("debug");
      expect(logs[1]?.message).toBe("Loading configuration");

      expect(logs[2]?.level).toBe("warn");
      expect(logs[2]?.message).toBe("Deprecated API used");

      expect(logs[3]?.level).toBe("info");
      expect(logs[3]?.message).toBe("Process completed");
    });

    it("Should handle mixed log levels with attributes", () => {
      client.logs.info("User action", { action: "login", userId: "123" });
      client.logs.error("Validation failed", new Error("Invalid email"), {
        field: "email",
      });
      client.logs.debug("Cache hit", { key: "user_123", value: "cached_data" });

      const logs = client.logs.getRecorded();
      expect(logs).toHaveLength(3);

      // Verify each log has correct structure
      logs.forEach((log) => {
        expect(log).toHaveProperty("level");
        expect(log).toHaveProperty("message");
        expect(log).toHaveProperty("timestamp");
        expect(typeof log.timestamp).toBe("number");
      });

      // Check specific attributes
      expect(logs[0]?.attributes?.userId).toBe("123");
      expect(logs[1]?.error).toBeInstanceOf(Error);
      expect(logs[2]?.attributes?.key).toBe("user_123");
    });
  });

  describe("Error Reporter Factory", () => {
    it("Should create scoped error reporter", () => {
      const scopedReporter = client.logs.createErrorReporter("payment-service");

      expect(scopedReporter).toBeDefined();
      expect(typeof scopedReporter.report).toBe("function");
      expect(typeof scopedReporter.reportResult).toBe("function");
    });

    it("Should report errors through scoped reporter", () => {
      const paymentReporter = client.logs.createErrorReporter("payment-service");
      const paymentError = new Error("Credit card declined");

      paymentReporter.report(paymentError, { cardType: "visa", amount: 150.0 });

      const errors = client.errors.getRecorded();
      expect(errors).toHaveLength(1);
      expect(errors[0]?.error).toBe(paymentError);
      expect(errors[0]?.context).toEqual({
        scope: "payment-service",
        cardType: "visa",
        amount: 150.0,
      });
    });

    it("Should report result errors through scoped reporter", () => {
      const authReporter = client.logs.createErrorReporter("auth-service");

      // Mock a failed result
      const failedResult = {
        isErr: () => true,
        error: new Error("Invalid credentials"),
      };

      authReporter.reportResult(failedResult, {
        attemptCount: 3,
        ip: "192.168.1.1",
      });

      const errors = client.errors.getRecorded();
      expect(errors).toHaveLength(1);
      expect(errors[0]?.error.message).toBe("Invalid credentials");
      expect(errors[0]?.context).toEqual({
        scope: "auth-service",
        attemptCount: 3,
        ip: "192.168.1.1",
      });
    });

    it("Should not report successful results", () => {
      const userReporter = client.logs.createErrorReporter("user-service");

      // Mock a successful result
      const successResult = {
        isErr: () => false,
        value: { id: "123", name: "John Doe" },
      };

      userReporter.reportResult(successResult, { operation: "getUserById" });

      const errors = client.errors.getRecorded();
      expect(errors).toHaveLength(0);
    });
  });

  describe("Integration with Tracing", () => {
    it("Should log within span context", async () => {
      await client.traces.withSpan("traced_operation", () => {
        client.logs.info("Operation started", { step: "initialization" });
        client.logs.debug("Processing data", { recordCount: 42 });
        client.logs.info("Operation completed", { step: "finalization" });
        return Promise.resolve();
      });

      // Verify both tracing and logging worked
      expect(client.traces.hasSpan("traced_operation")).toBe(true);

      const logs = client.logs.getRecorded();
      expect(logs).toHaveLength(3);
      expect(logs[0]?.message).toBe("Operation started");
      expect(logs[1]?.message).toBe("Processing data");
      expect(logs[2]?.message).toBe("Operation completed");
    });

    it("Should maintain log correlation across nested spans", async () => {
      await client.traces.withSpan("parent_operation", async () => {
        client.logs.info("Parent operation started");

        await client.traces.withSpan("child_operation", () => {
          client.logs.debug("Child operation processing");
          client.logs.warn("Child operation warning", {
            concern: "high_latency",
          });
          return Promise.resolve();
        });

        client.logs.info("Parent operation completed");
      });

      expect(client.traces.hasSpan("parent_operation")).toBe(true);
      expect(client.traces.hasSpan("child_operation")).toBe(true);

      const logs = client.logs.getRecorded();
      expect(logs).toHaveLength(4);

      // In a real implementation, these logs would be correlated with trace context
      const parentLogs = logs.filter((l) => l.message.includes("Parent"));
      const childLogs = logs.filter((l) => l.message.includes("Child"));

      expect(parentLogs).toHaveLength(2);
      expect(childLogs).toHaveLength(2);
    });
  });

  describe("Integration with Error Handling", () => {
    it("Should coordinate with error recording", () => {
      const applicationError = new Error("Service unavailable");

      // Both log error and record error
      client.logs.error("Service failure detected", applicationError, {
        service: "external-api",
        endpoint: "/api/v1/users",
      });

      client.errors.record(applicationError, {
        component: "user-service",
        severity: "high",
      });

      const logs = client.logs.getRecorded();
      const errors = client.errors.getRecorded();

      expect(logs).toHaveLength(1);
      expect(logs[0]?.error).toBe(applicationError);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.error).toBe(applicationError);
    });

    it("Should log errors within error boundaries", async () => {
      const boundaryError = new Error("Boundary caught error");

      const result = await client.errors.boundary(
        () => {
          client.logs.info("Entering protected operation");
          throw boundaryError;
        },
        (error) => {
          client.logs.warn("Error boundary activated", {
            errorMessage: error.message,
          });
          return "fallback_result";
        },
      );

      expect(result).toBe("fallback_result");

      const logs = client.logs.getRecorded();
      const errors = client.errors.getRecorded();

      expect(logs).toHaveLength(2);
      expect(logs[0]?.message).toBe("Entering protected operation");
      expect(logs[1]?.message).toBe("Error boundary activated");

      expect(errors).toHaveLength(1);
      expect(errors[0]?.context?.boundary).toBe(true);
    });
  });

  describe("Integration with Context", () => {
    it("Should log with enriched context", () => {
      // Set up context
      client.context.business.setUser("user_789", {
        role: "admin",
        department: "engineering",
      });
      client.context.business.addTag("environment", "production");
      client.context.business.addBreadcrumb("User navigation", {
        page: "/dashboard",
      });

      client.logs.info("Admin action performed", {
        action: "user_management",
        target: "user_456",
      });

      const logs = client.logs.getRecorded();
      expect(logs[0]?.attributes).toEqual({
        action: "user_management",
        target: "user_456",
      });

      // Verify context is available for correlation
      const user = client.context.business.getUser();
      const tags = client.context.business.getTags();
      const breadcrumbs = client.context.business.getBreadcrumbs();

      expect(user?.id).toBe("user_789");
      expect(tags[0]!.key).toBe("environment");
      expect(breadcrumbs[0]!.message).toBe("User navigation");
    });

    it("Should maintain consistent logging across context changes", () => {
      client.context.business.run({ requestId: "req_123" }, () => {
        client.logs.info("Request started", { method: "POST" });

        client.context.business.run({ userId: "user_456" }, () => {
          client.logs.debug("User context established");
          client.logs.info("Processing user data");
        });

        client.logs.info("Request completed");
      });

      const logs = client.logs.getRecorded();
      expect(logs).toHaveLength(4);

      expect(logs[0]?.message).toBe("Request started");
      expect(logs[1]?.message).toBe("User context established");
      expect(logs[2]?.message).toBe("Processing user data");
      expect(logs[3]!.message).toBe("Request completed");
    });
  });

  describe("Test Helpers and Inspection", () => {
    it("Should provide top-level log helpers", () => {
      client.logs.info("Findable log entry", { category: "test" });

      const foundLog = client.findLog("Findable log entry");
      expect(foundLog).toBeDefined();
      expect(foundLog?.level).toBe("info");
      expect(foundLog?.attributes?.category).toBe("test");
    });

    it("Should provide access to all logs", () => {
      client.logs.info("Log 1");
      client.logs.warn("Log 2");
      client.logs.error("Log 3", new Error("Test error"));

      const allLogs = client.getLogs();
      expect(allLogs).toHaveLength(3);

      const levels = allLogs.map((log) => log.level);
      expect(levels).toEqual(["info", "warn", "error"]);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("Should handle null/undefined messages", () => {
      expect(() => {
        //@ts-expect-error testing invalid input
        client.logs.info(null);
      }).not.toThrow();

      expect(() => {
        //@ts-expect-error testing invalid input
        client.logs.debug(undefined);
      }).not.toThrow();

      const logs = client.logs.getRecorded();
      expect(logs).toHaveLength(2);
    });

    it("Should handle null/undefined attributes", () => {
      client.logs.info("Test message", {
        validKey: "value",
        nullKey: null,
        undefinedKey: undefined,
      });

      const logs = client.logs.getRecorded();
      expect(logs[0]?.attributes).toEqual({
        validKey: "value",
        nullKey: null,
        undefinedKey: undefined,
      });
    });

    it("Should handle error logs without error objects", () => {
      client.logs.error("Error without error object");

      const logs = client.logs.getRecorded();
      expect(logs[0]?.level).toBe("error");
      expect(logs[0]?.message).toBe("Error without error object");
      expect(logs[0]?.error).toBeUndefined();
    });

    it("Should handle complex nested attributes", () => {
      client.logs.info("Complex log entry", {
        user: {
          id: "123",
          profile: {
            name: "John Doe",
            preferences: {
              theme: "dark",
              notifications: true,
            },
          },
        },
        metadata: {
          timestamp: Date.now(),
          version: "1.0.0",
        },
      });

      const logs = client.logs.getRecorded();
      const attrs = logs[0]?.attributes as { user?: { id?: string; profile?: { name?: string } }; metadata?: { version?: string } } | undefined;
      expect(attrs?.user?.id).toBe("123");
      expect(attrs?.user?.profile?.name).toBe("John Doe");
      expect(attrs?.metadata?.version).toBe("1.0.0");
    });
  });

  describe("Reset and Cleanup", () => {
    it("Should clear logs when client is reset", () => {
      client.logs.info("Temporary log 1");
      client.logs.warn("Temporary log 2");
      client.logs.error("Temporary log 3", new Error("Temp error"));

      expect(client.logs.getRecorded()).toHaveLength(3);

      client.reset();

      expect(client.logs.getRecorded()).toHaveLength(0);
      expect(client.getLogs()).toHaveLength(0);
    });
  });
});
