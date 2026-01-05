import { describe, it, expect } from 'vitest';
import { ContextEnricher } from '../../enrichment/context.mjs';

describe('ID Generation Configuration (Issue #10)', () => {
  // uuid regex for crypto.randomUUID() format
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  // Doc 4 M5 Fix: fallback format is now timestamp-counter-random (3 segments, all base36)
  // Format: [timestamp]-[counter 4 chars]-[random 4 chars]
  const FALLBACK_ID_REGEX = /^[0-9a-z]+-[0-9a-z]{4}-[0-9a-z]{4}$/;

  describe('Default ID generation (L1 fix: plain UUIDs for portability)', () => {
    it('should generate session IDs as plain UUIDs (no prefix)', () => {
      const enricher = new ContextEnricher();
      const context = enricher.getContext();

      // L1 fix: defaults now return plain UUID for portability
      // accepts both crypto.randomUUID format and fallback format
      const sessionId = context.sessionId ?? "";
      expect(sessionId).toMatch(UUID_REGEX.test(sessionId) ? UUID_REGEX : FALLBACK_ID_REGEX);
    });

    it('should generate request IDs as plain UUIDs (no prefix)', () => {
      const enricher = new ContextEnricher();
      const context = enricher.getContext();

      // L1 fix: defaults now return plain UUID for portability
      const requestId = context.requestId ?? "";
      expect(requestId).toMatch(UUID_REGEX.test(requestId) ? UUID_REGEX : FALLBACK_ID_REGEX);
    });

    it('should generate unique session IDs for each instance', () => {
      const enricher1 = new ContextEnricher();
      const enricher2 = new ContextEnricher();

      const sessionId1 = enricher1.getContext().sessionId;
      const sessionId2 = enricher2.getContext().sessionId;

      expect(sessionId1).not.toBe(sessionId2);
    });

    it('should generate unique request IDs for each instance', () => {
      const enricher1 = new ContextEnricher();
      const enricher2 = new ContextEnricher();

      const requestId1 = enricher1.getContext().requestId;
      const requestId2 = enricher2.getContext().requestId;

      expect(requestId1).not.toBe(requestId2);
    });
  });

  describe('Custom session ID generator', () => {
    it('should use custom session ID generator when provided', () => {
      const customSessionId = 'custom-session-12345';

      const enricher = new ContextEnricher({}, {
        idGenerator: {
          generateSessionId: () => customSessionId,
        },
      });

      const context = enricher.getContext();
      expect(context.sessionId).toBe(customSessionId);
    });

    it('should support AWS X-Ray trace ID format', () => {
      const enricher = new ContextEnricher({}, {
        idGenerator: {
          generateSessionId: () => {
            // AWS X-Ray trace ID format: 1-{hex_timestamp}-{hex_uniqueid}
            const timestamp = Math.floor(Date.now() / 1000).toString(16);
            const uniqueId = 'abcdef1234567890abcdef1234567890';
            return `1-${timestamp}-${uniqueId}`;
          },
        },
      });

      const context = enricher.getContext();
      expect(context.sessionId).toMatch(/^1-[0-9a-f]+-[0-9a-f]{32}$/);
    });

    it('should support ULID format for session IDs', () => {
      // Simplified ULID generator (timestamp + random)
      const generateULID = () => {
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2).toUpperCase();
        return `${timestamp}${random}`.padEnd(26, '0').substring(0, 26);
      };

      const enricher = new ContextEnricher({}, {
        idGenerator: {
          generateSessionId: generateULID,
        },
      });

      const context = enricher.getContext();
      expect(context.sessionId).toHaveLength(26);
      expect(context.sessionId).toMatch(/^[0-9A-Z]+$/);
    });

    it('should support multi-tenant session IDs with tenant prefix', () => {
      const tenantId = 'tenant_abc123';

      const enricher = new ContextEnricher({}, {
        idGenerator: {
          generateSessionId: () => {
            return `${tenantId}_session_${Date.now()}`;
          },
        },
      });

      const context = enricher.getContext();
      expect(context.sessionId).toMatch(/^tenant_abc123_session_\d+$/);
    });
  });

  describe('Custom request ID generator', () => {
    it('should use custom request ID generator when provided', () => {
      const customRequestId = 'custom-req-67890';

      const enricher = new ContextEnricher({}, {
        idGenerator: {
          generateRequestId: () => customRequestId,
        },
      });

      const context = enricher.getContext();
      expect(context.requestId).toBe(customRequestId);
    });

    it('should support standard UUID v4 format', () => {
      const enricher = new ContextEnricher({}, {
        idGenerator: {
          generateRequestId: () => {
            // simplified UUID v4 format
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
              const r = Math.random() * 16 | 0;
              const v = c === 'x' ? r : (r & 0x3 | 0x8);
              return v.toString(16);
            });
          },
        },
      });

      const context = enricher.getContext();
      expect(context.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should support Kubernetes pod-scoped request IDs', () => {
      const podName = 'my-app-pod-abc123';

      const enricher = new ContextEnricher({}, {
        idGenerator: {
          generateRequestId: () => {
            return `${podName}_req_${Date.now()}`;
          },
        },
      });

      const context = enricher.getContext();
      expect(context.requestId).toMatch(/^my-app-pod-abc123_req_\d+$/);
    });
  });

  describe('Both custom generators', () => {
    it('should use both custom session and request ID generators', () => {
      const customSessionId = 'aws-session-123';
      const customRequestId = 'uuid-req-456';

      const enricher = new ContextEnricher({}, {
        idGenerator: {
          generateSessionId: () => customSessionId,
          generateRequestId: () => customRequestId,
        },
      });

      const context = enricher.getContext();
      expect(context.sessionId).toBe(customSessionId);
      expect(context.requestId).toBe(customRequestId);
    });
  });

  describe('Session reset with custom generator', () => {
    it('should use custom generator when resetting session', () => {
      let counter = 0;

      const enricher = new ContextEnricher({}, {
        idGenerator: {
          generateSessionId: () => `session-${++counter}`,
        },
      });

      const initialSessionId = enricher.getContext().sessionId;
      expect(initialSessionId).toBe('session-1');

      enricher.resetSession();

      const newSessionId = enricher.getContext().sessionId;
      expect(newSessionId).toBe('session-2');
      expect(newSessionId).not.toBe(initialSessionId);
    });

    it('should use default generator when resetting session without custom generator', () => {
      const enricher = new ContextEnricher();

      const initialSessionId = enricher.getContext().sessionId ?? "";
      // L1 fix: defaults now return plain UUID for portability
      expect(initialSessionId).toMatch(UUID_REGEX.test(initialSessionId) ? UUID_REGEX : FALLBACK_ID_REGEX);

      enricher.resetSession();

      const newSessionId = enricher.getContext().sessionId ?? "";
      expect(newSessionId).toMatch(UUID_REGEX.test(newSessionId) ? UUID_REGEX : FALLBACK_ID_REGEX);
      expect(newSessionId).not.toBe(initialSessionId);
    });
  });

  describe('Initial IDs can still be provided', () => {
    it('should use initial sessionId if provided, ignoring generator', () => {
      const initialSessionId = 'provided-session-id';

      const enricher = new ContextEnricher({
        sessionId: initialSessionId,
      }, {
        idGenerator: {
          generateSessionId: () => 'generator-should-not-be-called',
        },
      });

      const context = enricher.getContext();
      expect(context.sessionId).toBe(initialSessionId);
    });

    it('should use initial requestId if provided, ignoring generator', () => {
      const initialRequestId = 'provided-request-id';

      const enricher = new ContextEnricher({
        requestId: initialRequestId,
      }, {
        idGenerator: {
          generateRequestId: () => 'generator-should-not-be-called',
        },
      });

      const context = enricher.getContext();
      expect(context.requestId).toBe(initialRequestId);
    });
  });

  describe('Clear context with custom generator', () => {
    it('should use custom generator when clearing context', () => {
      let counter = 0;

      const enricher = new ContextEnricher({}, {
        idGenerator: {
          generateSessionId: () => `session-${++counter}`,
          generateRequestId: () => `req-${counter}`,
        },
      });

      expect(enricher.getContext().sessionId).toBe('session-1');
      expect(enricher.getContext().requestId).toBe('req-1');

      enricher.clear();

      expect(enricher.getContext().sessionId).toBe('session-2');
      expect(enricher.getContext().requestId).toBe('req-2');
    });
  });

  describe('Real-world integration scenarios', () => {
    it('should support AWS Lambda with X-Ray trace correlation', () => {
      const generateXRayTraceId = () => {
        const timestamp = Math.floor(Date.now() / 1000).toString(16);
        const uniqueId = crypto.randomUUID().replace(/-/g, '');
        return `1-${timestamp}-${uniqueId}`;
      };

      const enricher = new ContextEnricher({}, {
        idGenerator: {
          generateSessionId: generateXRayTraceId,
          generateRequestId: () => crypto.randomUUID(),
        },
      });

      const context = enricher.getContext();
      expect(context.sessionId).toMatch(/^1-[0-9a-f]+-[0-9a-f]{32}$/);
      expect(context.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should support distributed tracing with correlation IDs', () => {
      const correlationId = 'trace-12345';
      let requestCounter = 0;

      const enricher = new ContextEnricher({}, {
        idGenerator: {
          generateSessionId: () => correlationId,
          generateRequestId: () => `${correlationId}.req-${++requestCounter}`,
        },
      });

      expect(enricher.getContext().sessionId).toBe('trace-12345');
      expect(enricher.getContext().requestId).toBe('trace-12345.req-1');

      // simulate new request in same trace
      enricher.clear();
      expect(enricher.getContext().sessionId).toBe('trace-12345');
      expect(enricher.getContext().requestId).toBe('trace-12345.req-2');
    });

    it('should support regulatory compliance with audit-friendly IDs', () => {
      const generateAuditId = () => {
        const date = new Date().toISOString().split('T')[0]!.replace(/-/g, '');
        const sequence = Math.random().toString(36).substring(2, 10).toUpperCase();
        return `AUDIT-${date}-${sequence}`;
      };

      const enricher = new ContextEnricher({}, {
        idGenerator: {
          generateSessionId: generateAuditId,
          generateRequestId: generateAuditId,
        },
      });

      const context = enricher.getContext();
      expect(context.sessionId).toMatch(/^AUDIT-\d{8}-[0-9A-Z]+$/);
      expect(context.requestId).toMatch(/^AUDIT-\d{8}-[0-9A-Z]+$/);
    });
  });
});
