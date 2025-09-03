import express from 'express'

const router = express.Router()

// POST /api/orders - Order submission with distributed tracing
router.post('/', async (req, res) => {
  const client = req.observabilityClient
  const { productId, quantity, userId } = req.body
  let orderId: string | null = null

  try {
    if (client) {
      // get scoped instrumentation for orders module
      // this provides module-level attribution for all telemetry
      const orderService = client.getInstrumentation('web-store/orders', '1.0.0');

      // note: context.run() is now handled by middleware in server.ts
      // this creates a cleaner pattern with context flowing automatically
      orderId = await orderService.trace('process_order', async (span) => {
          span.setAttributes({
            'order.product_id': productId,
            'order.quantity': quantity,
            'order.user_id': userId,
            'service.name': 'web-store-backend'
          })

          // add breadcrumb for order processing start
          client.context.business.addBreadcrumb('Backend order processing initiated', {
            category: 'order_processing',
            level: 'info',
            productId,
            quantity,
            userId
          })

          // simulate inventory check
          await orderService.trace('check_inventory', async (inventorySpan) => {
            inventorySpan.setAttributes({
              'inventory.product_id': productId,
              'inventory.requested_quantity': quantity
            })

            // simulate async inventory lookup
            await new Promise(resolve => setTimeout(resolve, 150))
            
            const inStock = Math.random() > 0.1 // 90% success rate
            inventorySpan.setAttributes({
              'inventory.available': inStock,
              'inventory.stock_level': inStock ? Math.floor(Math.random() * 100) + quantity : 0
            })

            if (!inStock) {
              throw new Error('Product out of stock')
            }

            client.context.business.addBreadcrumb('Inventory check completed', {
              category: 'inventory',
              level: 'info'
            })
          })

          // simulate payment processing
          await orderService.trace('reserve_payment', async (paymentSpan) => {
            paymentSpan.setAttributes({
              'payment.user_id': userId,
              'payment.amount': 99.99 * quantity,
              'payment.currency': 'USD'
            })

            await new Promise(resolve => setTimeout(resolve, 200))
            
            client.context.business.addBreadcrumb('Payment reserved successfully', {
              category: 'payment',
              level: 'info'
            })
          })

          // simulate order persistence
          return await orderService.trace('save_order', async (saveSpan) => {
            const newOrderId = `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
            
            saveSpan.setAttributes({
              'db.operation': 'insert',
              'db.table': 'orders',
              'order.id': newOrderId
            })

            await new Promise(resolve => setTimeout(resolve, 100))

            // record business metrics with low-cardinality attributes
            // note: high-cardinality data like product_id and user_id are in span attributes
            orderService.metrics.increment('orders_created', {
              source: 'api',
              order_status: 'success'
            })

            orderService.metrics.histogram('order_value_usd', 99.99 * quantity, {
              currency: 'USD',
              source: 'api'
            })

            client.context.business.addBreadcrumb('Order saved to database', {
              category: 'database',
              level: 'info',
              orderId: newOrderId
            })

            return newOrderId
          })
        })
    } else {
      // simulate processing without observability if client not available
      await new Promise(resolve => setTimeout(resolve, 450)) // simulate total processing time
      
      // basic inventory check
      const inStock = Math.random() > 0.1
      if (!inStock) {
        throw new Error('Product out of stock')
      }
      
      orderId = `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }
    
    res.json({
      success: true,
      orderId,
      message: 'Order processed successfully',
      details: {
        productId,
        quantity,
        userId,
        estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        total: 99.99 * quantity
      }
    })

  } catch (error) {
    if (client) {
      client.errors.record(error as Error, {
        tags: {
          component: 'order_processing',
          user_id: userId,
          product_id: productId
        },
        extra: {
          orderData: req.body
        }
      })

      client.context.business.addBreadcrumb('Order processing failed', {
        category: 'error',
        level: 'error',
        error_message: (error as Error).message,
        product_id: productId
      })

      // get scoped instrumentation for error metrics too
      const orderService = client.getInstrumentation('web-store/orders', '1.0.0');
      orderService.metrics.increment('orders_failed', {
        error_type: (error as Error).message.includes('stock') ? 'inventory' : 'unknown',
        source: 'api'
      })
    }

    console.error('Order processing failed:', error)
    res.status(400).json({
      success: false,
      error: (error as Error).message,
      orderId: null
    })
  }
})

export { router as ordersRouter }