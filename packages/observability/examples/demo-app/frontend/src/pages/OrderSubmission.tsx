import React, { useState } from 'react'
import { useObservability } from '../contexts/ObservabilityContext'
import { apiBaseUrl } from '../config'

interface OrderSubmissionProps {
  onTelemetryLog: (log: string) => void
}

const OrderSubmission: React.FC<OrderSubmissionProps> = ({ onTelemetryLog }) => {
  const [orderData, setOrderData] = useState({
    productId: 'prod-123',
    quantity: 1,
    userId: 'user-123'
  })
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const submitOrder = async () => {
    setIsProcessing(true)
    setResult(null)
    
    try {
      // get observability client from context
      const client = useObservability()

      onTelemetryLog('📦 Starting order submission flow...')

      // add breadcrumb for order start (gracefully handle missing client)
      if (client) {
        client.context.business.addBreadcrumb('Order submission initiated', {
          category: 'user_action',
          level: 'info',
          productId: orderData.productId,
          quantity: orderData.quantity
        })
      }

      // create span for the order flow (only if client available)
      const result = client ? await client.trace('submit_order', async (span) => {
        // enrich span with business context
        span.setAttributes({
          'order.product_id': orderData.productId,
          'order.quantity': orderData.quantity,
          'order.user_id': orderData.userId,
          'business.flow': 'order_submission'
        })

        onTelemetryLog('🔄 Creating distributed trace for order submission')

        // simulate validation step
        await client.trace('validate_order', async (validationSpan) => {
          validationSpan.setAttributes({
            'validation.product_exists': true,
            'validation.stock_available': true
          })
          
          // simulate API delay
          await new Promise(resolve => setTimeout(resolve, 300))
          onTelemetryLog('✅ Order validation completed')
        })

        // make actual API call to backend (this will propagate trace context)
        const response = await fetch(`${apiBaseUrl}/api/orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(orderData)
        })

        if (!response.ok) {
          throw new Error(`Failed to submit order: ${response.status}`)
        }

        const orderResult = await response.json()
        
        // record success metric
        if (client) {
          client.metrics.increment('orders_submitted', {
            product_id: orderData.productId,
            user_id: orderData.userId
          })
        }

        onTelemetryLog('✅ Order submitted successfully with distributed tracing')
        onTelemetryLog(`📊 Recorded order metric for product: ${orderData.productId}`)

        return orderResult
      }) : await (async () => {
        // fallback when no observability client - just make API call
        const response = await fetch(`${apiBaseUrl}/api/orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(orderData)
        })
        
        if (!response.ok) {
          throw new Error(`Failed to submit order: ${response.status}`)
        }
        
        return response.json()
      })()

      setResult(`Order submitted successfully! Order ID: ${result.orderId}`)
      
    } catch (error) {
      const client = useObservability()
      
      // capture error with context (if client available)
      if (client) {
        client.errors.capture(error as Error, {
          tags: {
            component: 'order_submission',
            user_id: orderData.userId
          },
          extra: {
            orderData
          }
        })
      }

      onTelemetryLog(`❌ Order submission failed: ${(error as Error).message}`)
      setResult(`Error: ${(error as Error).message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div>
      <h2>📦 Order Submission Demo</h2>
      <p>This scenario demonstrates <strong>distributed tracing</strong> with user and business context propagation.</p>

      <div className="card">
        <h3>Order Details</h3>
        <div style={{ marginBottom: '1rem' }}>
          <label>Product ID: </label>
          <input
            type="text"
            value={orderData.productId}
            onChange={(e) => setOrderData({...orderData, productId: e.target.value})}
            style={{ marginLeft: '1rem', padding: '0.5rem' }}
          />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>Quantity: </label>
          <input
            type="number"
            value={orderData.quantity}
            onChange={(e) => setOrderData({...orderData, quantity: parseInt(e.target.value)})}
            style={{ marginLeft: '1rem', padding: '0.5rem', width: '80px' }}
          />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>User ID: </label>
          <input
            type="text"
            value={orderData.userId}
            onChange={(e) => setOrderData({...orderData, userId: e.target.value})}
            style={{ marginLeft: '1rem', padding: '0.5rem' }}
          />
        </div>

        <button 
          onClick={submitOrder} 
          disabled={isProcessing}
          style={{ 
            padding: '1rem 2rem', 
            fontSize: '1.1rem',
            backgroundColor: isProcessing ? '#666' : '#646cff'
          }}
        >
          {isProcessing ? 'Processing Order...' : 'Submit Order'}
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
          <li><strong>Distributed Tracing:</strong> Trace spans from frontend to backend</li>
          <li><strong>Business Context:</strong> Product ID, user ID, order details in spans</li>
          <li><strong>Breadcrumbs:</strong> User action tracking with order initiation</li>
          <li><strong>Metrics:</strong> Order submission counter with labels</li>
          <li><strong>Error Correlation:</strong> Failed orders linked to traces</li>
        </ul>
      </div>
    </div>
  )
}

export default OrderSubmission