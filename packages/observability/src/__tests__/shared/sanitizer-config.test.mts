import { describe, it, expect, afterEach } from 'vitest';
import { SmartClient } from '../../index.mjs';
import { sanitizeString, sanitize } from '../../enrichment/sanitizer.mjs';

describe('Sanitizer config propagation', () => {
  afterEach(async () => {
    await SmartClient.shutdown();
  });

  it('applies sanitizerOptions from SmartClient initialization (global)', async () => {
    await SmartClient.initialize({
      serviceName: 'sanitizer-test',
      environment: 'node',
      sanitize: true,
      sanitizerOptions: {
        maskEmails: true,
        redactionString: '[MASK]',
      },
    });

    const masked = sanitizeString('user@example.com');
    expect(masked).toBe('u***@example.com');

    const obj = sanitize({ password: 'secret', user: 'ok' }) as Record<string, unknown>;
    expect(obj.password).toBe('[MASK]');
    expect(obj.user).toBe('ok');
  });
});

