import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SmartClient } from '../../../index.mjs';

describe('errors.wrap options (Node, no-network)', () => {
  beforeEach(() => {
    process.env.OBS_TEST_NO_EXPORT = '1';
  });

  afterEach(async () => {
    await SmartClient.shutdown();
  });

  it('applies retry option for async functions', async () => {
    const client = await SmartClient.create({ serviceName: 'wrap-test', environment: 'node' as const });
    const serviceInstrument = client.getServiceInstrumentation();

    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 2) throw new Error('fail-1');
      return Promise.resolve('ok');
    };

    const wrapped = serviceInstrument.errors.wrap(fn, { retry: 1 });
    await expect(wrapped()).resolves.toBe('ok');
    expect(attempts).toBe(2);
  });

  it('applies timeout option for async functions', async () => {
    const client = await SmartClient.create({ serviceName: 'wrap-test', environment: 'node' as const });
    const serviceInstrument = client.getServiceInstrumentation();

    const slow = async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 'done';
    };

    const wrapped = serviceInstrument.errors.wrap(slow, { timeout: 10 });
    await expect(wrapped()).rejects.toThrow('Operation timed out');
  });

  it('preserves synchronous returns without forcing promises', async () => {
    const client = await SmartClient.create({ serviceName: 'wrap-test', environment: 'node' as const });
    const serviceInstrument = client.getServiceInstrumentation();
    const double = (x: number) => x * 2;
    const wrapped = serviceInstrument.errors.wrap(double as (...args: unknown[]) => unknown) as typeof double;
    expect(wrapped(5)).toBe(10);
  });

  it('does NOT capture args by default for security', async () => {
    const client = await SmartClient.create({ serviceName: 'wrap-test', environment: 'node' as const });
    const serviceInstrument = client.getServiceInstrumentation();

    // mock the errors.capture to intercept the context
    let capturedContext: Record<string, unknown> | undefined;
    const originalCapture = serviceInstrument.errors.capture;
    serviceInstrument.errors.capture = (error: Error, context?: Record<string, unknown>) => {
      capturedContext = context;
      originalCapture(error, context);
    };

    const failingFn = (_password: string, _apiKey: string) => {
      throw new Error('Test error');
    };

    const wrapped = serviceInstrument.errors.wrap(failingFn as (...args: unknown[]) => unknown, { name: 'sensitiveOp' }) as typeof failingFn;

    try {
      wrapped('secret123', 'key-xyz');
    } catch {
      // error expected
    }

    // args should NOT be captured by default
    expect(capturedContext).toBeDefined();
    expect(capturedContext?.function).toBe('sensitiveOp');
    expect(capturedContext?.args).toBeUndefined();
  });

  it('captures args when captureArgs: true is explicitly set', async () => {
    const client = await SmartClient.create({ serviceName: 'wrap-test', environment: 'node' as const });
    const serviceInstrument = client.getServiceInstrumentation();

    // mock the errors.capture to intercept the context
    let capturedContext: Record<string, unknown> | undefined;
    const originalCapture = serviceInstrument.errors.capture;
    serviceInstrument.errors.capture = (error: Error, context?: Record<string, unknown>) => {
      capturedContext = context;
      originalCapture(error, context);
    };

    const failingFn = (_x: number, _y: number) => {
      throw new Error('Test error');
    };

    const wrapped = serviceInstrument.errors.wrap(failingFn as (...args: unknown[]) => unknown, {
      name: 'mathOp',
      captureArgs: true // explicitly enable args capture
    }) as typeof failingFn;

    try {
      wrapped(5, 10);
    } catch {
      // error expected
    }

    // args SHOULD be captured when explicitly enabled
    expect(capturedContext).toBeDefined();
    expect(capturedContext?.function).toBe('mathOp');
    expect(capturedContext?.args).toEqual([5, 10]);
  });

  it('does NOT capture args on async errors by default', async () => {
    const client = await SmartClient.create({ serviceName: 'wrap-test', environment: 'node' as const });
    const serviceInstrument = client.getServiceInstrumentation();

    // mock the errors.capture to intercept the context
    let capturedContext: Record<string, unknown> | undefined;
    const originalCapture = serviceInstrument.errors.capture;
    serviceInstrument.errors.capture = (error: Error, context?: Record<string, unknown>) => {
      capturedContext = context;
      originalCapture(error, context);
    };

    const failingAsync = (_password: string) => {
      return Promise.reject(new Error('Async error'));
    };

    const wrapped = serviceInstrument.errors.wrap(failingAsync as (...args: unknown[]) => unknown, { name: 'asyncOp', retry: 1 }) as typeof failingAsync;

    try {
      await wrapped('secret456');
    } catch {
      // error expected
    }

    // args should NOT be captured by default, even on async errors
    expect(capturedContext).toBeDefined();
    expect(capturedContext?.function).toBe('asyncOp');
    expect(capturedContext?.args).toBeUndefined();
  });
});

