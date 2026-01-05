import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { SmartClient } from '@satoshibits/observability'
import { ObservabilityProvider } from './contexts/ObservabilityContext.tsx'
import { observabilityConfig } from './config.ts'

// initialize observability SDK for browser environment
async function initializeObservability() {
  try {
    const client = await SmartClient.initialize(observabilityConfig)

    // set user context
    // note: setUser accepts { id, email, name, segment } or (userId, attributes)
    client.context.business.setUser({
      id: 'user-123',
      email: 'demo@example.com',
      name: 'Demo User',
    })

    // add initial breadcrumb
    client.context.business.addBreadcrumb('Application initialized', {
      category: 'lifecycle',
      level: 'info'
    })

    console.log('✅ Observability initialized successfully')
    return client
  } catch (error) {
    console.error('❌ Failed to initialize observability:', error)
    return null
  }
}

// main app initialization
async function main() {
  // render app immediately - don't block on observability
  const root = ReactDOM.createRoot(document.getElementById('root')!)
  
  // attempt to initialize observability in background
  const client = await initializeObservability()
  
  if (!client) {
    console.warn('⚠️ App will continue without observability telemetry')
  }

  root.render(
    <React.StrictMode>
      <ObservabilityProvider client={client}>
        <App />
      </ObservabilityProvider>
    </React.StrictMode>
  )
}

main().catch(error => {
  console.error('Failed to start app:', error)
})