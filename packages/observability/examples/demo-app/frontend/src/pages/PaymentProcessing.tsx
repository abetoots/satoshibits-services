import React, { useState } from 'react'
import { useObservability } from '../contexts/ObservabilityContext'
import { apiBaseUrl } from '../config'

interface PaymentProcessingProps {
  onTelemetryLog: (log: string) => void
}

const PaymentProcessing: React.FC<PaymentProcessingProps> = ({ onTelemetryLog }) => {
  const [paymentData, setPaymentData] = useState({
    amount: 99.99,
    currency: 'USD',
    paymentMethod: 'card',
    orderId: 'order-456'
  })
  const [simulateError, setSimulateError] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  const processPayment = async () => {
    setIsProcessing(true)
    setResult(null)
    
    try {
      // get observability client from context
      const client = useObservability()

      onTelemetryLog('💳 Starting payment processing with error correlation...')

      // add breadcrumb for payment start (if client available)
      if (client) {
        client.context.business.addBreadcrumb('Payment processing initiated', {
          category: 'payment',
          level: 'info',
          amount: paymentData.amount,
          currency: paymentData.currency,
          method: paymentData.paymentMethod,
          simulate_error: simulateError
        })
      }

      // implement retry logic with circuit breaker pattern
      const maxRetries = 3
      let currentRetry = 0

      const result = client ? await client.trace('payment_processing', async (span) => {
        span.setAttributes({
          'payment.amount': paymentData.amount,
          'payment.currency': paymentData.currency,
          'payment.method': paymentData.paymentMethod,
          'payment.order_id': paymentData.orderId,
          'payment.simulate_error': simulateError
        })

        while (currentRetry <= maxRetries) {
          try {
            await client.trace('payment_attempt', async (attemptSpan) => {
              attemptSpan.setAttributes({
                'payment.attempt': currentRetry + 1,
                'payment.max_retries': maxRetries
              })

              setRetryCount(currentRetry + 1)

              if (currentRetry > 0) {
                onTelemetryLog(`🔄 Payment retry attempt ${currentRetry + 1}/${maxRetries + 1}`)
                client.context.business.addBreadcrumb(`Payment retry attempt ${currentRetry + 1}`, {
                  category: 'payment_retry',
                  level: 'warning',
                  attempt: currentRetry + 1
                })
              }

              // simulate payment gateway call
              const response = await fetch(`${apiBaseUrl}/api/payments`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  ...paymentData,
                  simulateError: simulateError && currentRetry < 2 // fail first 2 attempts if error simulation enabled
                })
              })

              if (!response.ok) {
                const errorData = await response.json()
                throw new Error(`Payment failed: ${errorData.message || response.status}`)
              }

              const paymentResult = await response.json()
              
              // record success metrics (if client available)
              if (client) {
                client.metrics.increment('payments_processed', {
                  currency: paymentData.currency,
                  payment_method: paymentData.paymentMethod,
                  status: 'success',
                  attempts: (currentRetry + 1).toString()
                })

                // record payment amount histogram
                client.metrics.histogram('payment_amount', paymentData.amount, {
                  currency: paymentData.currency,
                  payment_method: paymentData.paymentMethod
                })
              }

              if (client) {
                client.context.business.addBreadcrumb('Payment processed successfully', {
                  category: 'payment_success',
                  level: 'info',
                  transaction_id: paymentResult.transactionId,
                  attempts: currentRetry + 1
                })
              }

              onTelemetryLog('✅ Payment processed successfully with retry correlation')
              onTelemetryLog(`📊 Recorded payment metrics (attempts: ${currentRetry + 1})`)

              return paymentResult
            })

            // if we reach here, payment succeeded
            break

          } catch (attemptError) {
            currentRetry++
            
            // record failed attempt metric (if client available)
            if (client) {
              client.metrics.increment('payment_attempts_failed', {
                currency: paymentData.currency,
                payment_method: paymentData.paymentMethod,
                attempt: currentRetry.toString()
              })
            }

            if (currentRetry > maxRetries) {
              // final failure - capture error with full context (if client available)
              if (client) {
                client.errors.capture(attemptError as Error, {
                  tags: {
                    component: 'payment_processing',
                    order_id: paymentData.orderId,
                    circuit_breaker: 'open'
                  },
                  extra: {
                    paymentData,
                    totalAttempts: currentRetry,
                    maxRetries
                  }
                })

                client.context.business.addBreadcrumb('Payment failed after all retry attempts', {
                  category: 'payment_failure',
                  level: 'error',
                  total_attempts: currentRetry,
                  final_error: (attemptError as Error).message
                })
              }

              throw new Error(`Payment failed after ${currentRetry} attempts: ${(attemptError as Error).message}`)
            }

            // add breadcrumb for retry (if client available)
            if (client) {
              client.context.business.addBreadcrumb(`Payment attempt ${currentRetry} failed, retrying`, {
                category: 'payment_retry',
                level: 'warning',
                attempt: currentRetry,
                error: (attemptError as Error).message,
                will_retry: currentRetry <= maxRetries
              })
            }

            onTelemetryLog(`⚠️ Payment attempt ${currentRetry} failed: ${(attemptError as Error).message}`)
            
            // exponential backoff delay
            const delay = Math.min(1000 * Math.pow(2, currentRetry - 1), 5000)
            await new Promise(resolve => setTimeout(resolve, delay))
          }
        }
      }) : await (async () => {
        // fallback payment processing without tracing
        let currentRetry = 0
        const maxRetries = 3
        
        while (currentRetry <= maxRetries) {
          try {
            setRetryCount(currentRetry + 1)
            
            const response = await fetch(`${apiBaseUrl}/api/payments`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                ...paymentData,
                simulateError: simulateError && currentRetry < 2
              })
            })

            if (!response.ok) {
              const errorData = await response.json()
              throw new Error(`Payment failed: ${errorData.message || response.status}`)
            }

            return response.json()
          } catch (attemptError) {
            currentRetry++
            if (currentRetry > maxRetries) {
              throw new Error(`Payment failed after ${currentRetry} attempts: ${(attemptError as Error).message}`)
            }
            onTelemetryLog(`⚠️ Payment attempt ${currentRetry} failed: ${(attemptError as Error).message}`)
            const delay = Math.min(1000 * Math.pow(2, currentRetry - 1), 5000)
            await new Promise(resolve => setTimeout(resolve, delay))
          }
        }
      })()

      setResult(`Payment successful! Transaction ID: ${result.transactionId} (${retryCount} attempts)`)
      
    } catch (error) {
      onTelemetryLog(`❌ Payment processing failed: ${(error as Error).message}`)
      setResult(`Error: ${(error as Error).message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div>
      <h2>💳 Payment Processing Demo</h2>
      <p>This scenario demonstrates <strong>error correlation</strong> with retry patterns and circuit breaker telemetry.</p>

      <div className="card">
        <h3>Payment Details</h3>
        <div style={{ marginBottom: '1rem' }}>
          <label>Amount: $</label>
          <input
            type="number"
            step="0.01"
            value={paymentData.amount}
            onChange={(e) => setPaymentData({...paymentData, amount: parseFloat(e.target.value)})}
            style={{ marginLeft: '1rem', padding: '0.5rem', width: '100px' }}
          />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>Currency: </label>
          <select
            value={paymentData.currency}
            onChange={(e) => setPaymentData({...paymentData, currency: e.target.value})}
            style={{ marginLeft: '1rem', padding: '0.5rem' }}
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>Payment Method: </label>
          <select
            value={paymentData.paymentMethod}
            onChange={(e) => setPaymentData({...paymentData, paymentMethod: e.target.value})}
            style={{ marginLeft: '1rem', padding: '0.5rem' }}
          >
            <option value="card">Credit Card</option>
            <option value="paypal">PayPal</option>
            <option value="bank">Bank Transfer</option>
          </select>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>Order ID: </label>
          <input
            type="text"
            value={paymentData.orderId}
            onChange={(e) => setPaymentData({...paymentData, orderId: e.target.value})}
            style={{ marginLeft: '1rem', padding: '0.5rem' }}
          />
        </div>
        
        <div style={{ marginBottom: '1rem' }}>
          <label>
            <input
              type="checkbox"
              checked={simulateError}
              onChange={(e) => setSimulateError(e.target.checked)}
              style={{ marginRight: '0.5rem' }}
            />
            Simulate payment failures (will retry with exponential backoff)
          </label>
        </div>

        <button 
          onClick={processPayment} 
          disabled={isProcessing}
          style={{ 
            padding: '1rem 2rem', 
            fontSize: '1.1rem',
            backgroundColor: isProcessing ? '#666' : '#646cff'
          }}
        >
          {isProcessing ? `Processing Payment... (Attempt ${retryCount})` : 'Process Payment'}
        </button>

        {result && (
          <div style={{ 
            marginTop: '1rem', 
            padding: '1rem', 
            backgroundColor: result.includes('Error') ? '#dc3545' : '#28a745',
            borderRadius: '4px'
          }}>
            {result}
          </div>
        )}
      </div>

      <div className="card">
        <h3>🔍 What This Demonstrates</h3>
        <ul style={{ textAlign: 'left' }}>
          <li><strong>Error Correlation:</strong> Failed payments linked to distributed traces</li>
          <li><strong>Retry Pattern:</strong> Exponential backoff with attempt tracking</li>
          <li><strong>Circuit Breaker:</strong> Failure threshold and recovery patterns</li>
          <li><strong>Business Metrics:</strong> Payment amounts, success/failure rates</li>
          <li><strong>Breadcrumb Tracking:</strong> Complete payment journey with failures</li>
        </ul>
      </div>
    </div>
  )
}

export default PaymentProcessing