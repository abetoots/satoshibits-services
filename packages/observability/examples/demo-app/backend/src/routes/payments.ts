import express from 'express'

const router = express.Router()

// POST /api/payments - Payment processing with retry correlation
router.post('/', async (req, res) => {
  const client = (req as any).observabilityClient
  const { amount, currency, paymentMethod, orderId, simulateError } = req.body

  try {
    if (client) {
      // get scoped instrumentation for payments module
      const paymentService = client.getInstrumentation('web-store/payments', '1.0.0');

      // note: context.run() is now handled by middleware in server.ts
      await paymentService.trace('process_payment', async (span) => {
          span.setAttributes({
            'payment.amount': amount,
            'payment.currency': currency,
            'payment.method': paymentMethod,
            'payment.order_id': orderId,
            'payment.simulate_error': simulateError || false,
            'service.name': 'web-store-backend'
          })

          // add breadcrumb for payment processing start
          client.context.business.addBreadcrumb('Backend payment processing initiated', {
            category: 'payment_processing',
            level: 'info',
            amount,
            currency,
            method: paymentMethod,
            order_id: orderId,
            simulate_error: simulateError
          })

          // simulate fraud detection
          await paymentService.trace('fraud_detection', async (fraudSpan) => {
            fraudSpan.setAttributes({
              'fraud.amount': amount,
              'fraud.payment_method': paymentMethod,
              'fraud.risk_score': Math.random()
            })

            await new Promise(resolve => setTimeout(resolve, 200))
            
            const riskScore = Math.random()
            const isHighRisk = riskScore > 0.9
            
            fraudSpan.setAttributes({
              'fraud.is_high_risk': isHighRisk,
              'fraud.risk_score': riskScore
            })

            if (isHighRisk) {
              throw new Error('Payment flagged for fraud review')
            }

            client.context.business.addBreadcrumb('Fraud detection completed', {
              category: 'fraud_detection',
              level: 'info',
              risk_score: riskScore.toFixed(3)
            })
          })

          // simulate payment gateway interaction with retry logic
          let paymentResult
          const maxRetries = 3
          let attempt = 0

          while (attempt <= maxRetries) {
            try {
              paymentResult = await paymentService.trace('payment_gateway_call', async (gatewaySpan) => {
                attempt++
                gatewaySpan.setAttributes({
                  'payment.gateway': 'demo-gateway',
                  'payment.attempt': attempt,
                  'payment.max_retries': maxRetries
                })

                // simulate gateway processing time
                await new Promise(resolve => setTimeout(resolve, 300))
                
                // simulate error for demonstration (only first 2 attempts if simulateError is true)
                if (simulateError && attempt <= 2) {
                  throw new Error(`Gateway timeout (attempt ${attempt})`)
                }

                const transactionId = `txn-${Date.now()}-${Math.random().toString(36).substr(2, 12)}`
                
                gatewaySpan.setAttributes({
                  'payment.transaction_id': transactionId,
                  'payment.gateway_response': 'approved'
                })

                client.context.business.addBreadcrumb(`Payment gateway call successful (attempt ${attempt})`, {
                  category: 'payment_gateway',
                  level: 'info',
                  transaction_id: transactionId,
                  attempt
                })

                return { transactionId, status: 'approved' }
              })
              
              break // success, exit retry loop

            } catch (gatewayError) {
              if (client) {
                paymentService.metrics.increment('payment_gateway_failures', {
                  payment_method: paymentMethod,
                  attempt: attempt.toString(),
                  error_type: (gatewayError as Error).message.includes('timeout') ? 'timeout' : 'unknown'
                })

                client.context.business.addBreadcrumb(`Payment gateway attempt ${attempt} failed`, {
                  category: 'payment_retry',
                  level: 'warning',
                  attempt,
                  error: (gatewayError as Error).message,
                  will_retry: attempt < maxRetries
                })
              }

              if (attempt >= maxRetries) {
                throw new Error(`Payment failed after ${attempt} attempts: ${(gatewayError as Error).message}`)
              }

              // exponential backoff
              const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000)
              await new Promise(resolve => setTimeout(resolve, delay))
            }
          }

          // record payment success metrics
          if (paymentResult) {
            paymentService.metrics.increment('payments_processed', {
              currency,
              payment_method: paymentMethod,
              status: 'success',
              attempts: attempt.toString()
            })

            paymentService.metrics.histogram('payment_amount', amount, {
              currency,
              payment_method: paymentMethod
            })

            paymentService.metrics.histogram('payment_processing_duration_ms', 300 * attempt, {
              payment_method: paymentMethod,
              attempts: attempt.toString()
            })
          }

          // simulate payment record persistence
          await paymentService.trace('save_payment_record', async (saveSpan) => {
            const paymentRecordId = `payment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
            
            saveSpan.setAttributes({
              'db.operation': 'insert',
              'db.table': 'payments',
              'payment.record_id': paymentRecordId
            })

            await new Promise(resolve => setTimeout(resolve, 100))

            client.context.business.addBreadcrumb('Payment record saved to database', {
              category: 'database',
              level: 'info',
              payment_record_id: paymentRecordId,
              transaction_id: paymentResult?.transactionId
            })

            return paymentRecordId
          })

          return paymentResult
        })
    }

    // simulate processing without observability if client not available
    let paymentResult
    if (!client) {
      await new Promise(resolve => setTimeout(resolve, 600)) // simulate fraud + gateway time
      
      // simulate retry logic
      let attempt = 0
      const maxRetries = 3
      
      while (attempt <= maxRetries) {
        attempt++
        try {
          await new Promise(resolve => setTimeout(resolve, 300))
          
          if (simulateError && attempt <= 2) {
            throw new Error(`Gateway timeout (attempt ${attempt})`)
          }
          
          paymentResult = {
            transactionId: `txn-${Date.now()}-${Math.random().toString(36).substr(2, 12)}`,
            status: 'approved'
          }
          break
          
        } catch (error) {
          if (attempt >= maxRetries) {
            throw new Error(`Payment failed after ${attempt} attempts: ${(error as Error).message}`)
          }
          await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt - 1), 5000)))
        }
      }
    }

    res.json({
      success: true,
      transactionId: paymentResult?.transactionId || `txn-${Date.now()}-${Math.random().toString(36).substr(2, 12)}`,
      message: 'Payment processed successfully',
      details: {
        amount,
        currency,
        paymentMethod,
        orderId,
        status: 'approved',
        processedAt: new Date().toISOString()
      }
    })

  } catch (error) {
    if (client) {
      client.errors.record(error as Error, {
        tags: {
          component: 'payment_processing',
          order_id: orderId,
          payment_method: paymentMethod
        },
        extra: {
          paymentData: req.body,
          amount,
          currency
        }
      })

      client.context.business.addBreadcrumb('Payment processing failed', {
        category: 'error',
        level: 'error',
        error_message: (error as Error).message,
        order_id: orderId,
        amount
      })

      const paymentService = client.getInstrumentation('web-store/payments', '1.0.0');
      paymentService.metrics.increment('payments_failed', {
        currency,
        payment_method: paymentMethod,
        error_type: (error as Error).message.includes('fraud') ? 'fraud' :
                   (error as Error).message.includes('timeout') ? 'gateway_timeout' : 'unknown'
      })
    }

    console.error('Payment processing failed:', error)
    res.status(400).json({
      success: false,
      error: (error as Error).message,
      transactionId: null
    })
  }
})

export { router as paymentsRouter }