/**
 * Demo test showing MockClient usage
 *
 * This test demonstrates how to:
 * - Import and use MockClient from @satoshibits/observability/testing
 * - Test metrics recording
 * - Test trace creation
 * - Test error recording
 * - Verify telemetry in your application code
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockClient } from '@satoshibits/observability/testing';

describe('Order Processing with Observability', () => {
  let mockClient: MockClient;

  beforeEach(() => {
    // create a fresh mock client for each test
    mockClient = new MockClient();
  });

  it('should record metrics when order is created successfully', async () => {
    // simulate order processing logic with instrumentation
    const orderService = mockClient.getInstrumentation('web-store/orders', '1.0.0');

    await orderService.trace('process_order', async () => {
      // simulate successful order creation
      orderService.metrics.increment('orders_created', {
        source: 'api',
        order_status: 'success'
      });

      orderService.metrics.histogram('order_value_usd', 99.99, {
        currency: 'USD',
        source: 'api'
      });
    });

    // verify metrics were recorded
    expect(mockClient.metrics.incremented('orders_created')).toBe(true);

    const orderMetric = mockClient.metrics.getMetric('orders_created');
    expect(orderMetric).toBeDefined();
    expect(orderMetric?.attributes?.source).toBe('api');
    expect(orderMetric?.attributes?.order_status).toBe('success');

    // verify histogram was recorded
    const histogramMetric = mockClient.metrics.getMetric('order_value_usd');
    expect(histogramMetric).toBeDefined();
    expect(histogramMetric?.value).toBe(99.99);
  });

  it('should create trace spans for order processing steps', async () => {
    const orderService = mockClient.getInstrumentation('web-store/orders', '1.0.0');

    await orderService.trace('process_order', async () => {
      await orderService.trace('check_inventory', async () => {
        // simulate inventory check
      });

      await orderService.trace('reserve_payment', async () => {
        // simulate payment processing
      });

      await orderService.trace('save_order', async () => {
        // simulate order persistence
      });
    });

    // verify traces were created
    expect(mockClient.traces.hasSpan('process_order')).toBe(true);
    expect(mockClient.traces.hasSpan('check_inventory')).toBe(true);
    expect(mockClient.traces.hasSpan('reserve_payment')).toBe(true);
    expect(mockClient.traces.hasSpan('save_order')).toBe(true);

    // verify span count
    const spans = mockClient.traces.getSpans();
    expect(spans.length).toBe(4);
  });

  it('should record errors when order processing fails', async () => {
    const orderService = mockClient.getInstrumentation('web-store/orders', '1.0.0');

    try {
      await orderService.trace('process_order', async () => {
        // simulate inventory check failure
        throw new Error('Product out of stock');
      });
    } catch (error) {
      // record error
      mockClient.errors.record(error as Error, {
        tags: {
          component: 'order_processing',
        },
        extra: {
          productId: 'test-product-123'
        }
      });

      // record failure metric
      orderService.metrics.increment('orders_failed', {
        error_type: 'inventory',
        source: 'api'
      });
    }

    // verify error was recorded
    expect(mockClient.errors.recorded()).toHaveLength(1);

    const recordedError = mockClient.errors.getLastError();
    expect(recordedError?.message).toBe('Product out of stock');

    // verify failure metric was recorded
    expect(mockClient.metrics.incremented('orders_failed')).toBe(true);
  });

  it('should capture context and breadcrumbs during order processing', async () => {
    const orderService = mockClient.getInstrumentation('web-store/orders', '1.0.0');

    // add breadcrumbs to track user journey
    mockClient.context.business.addBreadcrumb('Backend order processing initiated', {
      productId: 'test-product-123',
      quantity: 2
    });

    await orderService.trace('process_order', async () => {
      mockClient.context.business.addBreadcrumb('Inventory check completed');
      mockClient.context.business.addBreadcrumb('Payment reserved successfully');
      mockClient.context.business.addBreadcrumb('Order saved to database');
    });

    // verify breadcrumbs were captured
    const breadcrumbs = mockClient.context.getBreadcrumbs();
    expect(breadcrumbs.length).toBe(4);
    expect(breadcrumbs[0]?.message).toBe('Backend order processing initiated');
    expect(breadcrumbs[3]?.message).toBe('Order saved to database');
  });

  it('should demonstrate complete order flow with all telemetry', async () => {
    const orderService = mockClient.getInstrumentation('web-store/orders', '1.0.0');

    // simulate complete order processing
    const orderId = await orderService.trace('process_order', async () => {
      // add breadcrumb
      mockClient.context.business.addBreadcrumb('Starting order process');

      // check inventory
      await orderService.trace('check_inventory', async () => {
        // inventory check passed
      });

      // process payment
      await orderService.trace('reserve_payment', async () => {
        // payment successful
      });

      // save order
      const newOrderId = await orderService.trace('save_order', async () => {
        // record metrics
        orderService.metrics.increment('orders_created', {
          source: 'api',
          order_status: 'success'
        });

        return 'order-12345';
      });

      return newOrderId;
    });

    // verify complete telemetry
    expect(orderId).toBe('order-12345');
    expect(mockClient.traces.hasSpan('process_order')).toBe(true);
    expect(mockClient.traces.hasSpan('check_inventory')).toBe(true);
    expect(mockClient.traces.hasSpan('reserve_payment')).toBe(true);
    expect(mockClient.traces.hasSpan('save_order')).toBe(true);
    expect(mockClient.metrics.incremented('orders_created')).toBe(true);
    expect(mockClient.context.getBreadcrumbs().length).toBeGreaterThan(0);
  });
});
