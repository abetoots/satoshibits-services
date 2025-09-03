import React, { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom'
import OrderSubmission from './pages/OrderSubmission'
import ProfileUpdate from './pages/ProfileUpdate'
import PaymentProcessing from './pages/PaymentProcessing'
import ProductSearch from './pages/ProductSearch'
import TelemetryConsole from './components/TelemetryConsole'

function App() {
  const [telemetryLogs, setTelemetryLogs] = useState<string[]>([])

  const addTelemetryLog = (log: string) => {
    const timestamp = new Date().toISOString()
    setTelemetryLogs(prev => [...prev, `[${timestamp}] ${log}`])
  }

  return (
    <Router>
      <div className="App">
        <header>
          <h1>Observability Lifecycle Demo</h1>
          <p>Interactive demo showing distributed tracing, error correlation, and metrics collection</p>
          
          <nav style={{ margin: '2rem 0' }}>
            <Link to="/" style={{ margin: '0 1rem' }}>Home</Link>
            <Link to="/order" style={{ margin: '0 1rem' }}>Order Submission</Link>
            <Link to="/profile" style={{ margin: '0 1rem' }}>Profile Update</Link>
            <Link to="/payment" style={{ margin: '0 1rem' }}>Payment Processing</Link>
            <Link to="/search" style={{ margin: '0 1rem' }}>Product Search</Link>
          </nav>
        </header>

        <main>
          <Routes>
            <Route path="/" element={<HomeScenarios onTelemetryLog={addTelemetryLog} />} />
            <Route path="/order" element={<OrderSubmission onTelemetryLog={addTelemetryLog} />} />
            <Route path="/profile" element={<ProfileUpdate onTelemetryLog={addTelemetryLog} />} />
            <Route path="/payment" element={<PaymentProcessing onTelemetryLog={addTelemetryLog} />} />
            <Route path="/search" element={<ProductSearch onTelemetryLog={addTelemetryLog} />} />
          </Routes>
        </main>

        <TelemetryConsole logs={telemetryLogs} />
      </div>
    </Router>
  )
}

function HomeScenarios({ onTelemetryLog }: { onTelemetryLog: (log: string) => void }) {
  return (
    <div>
      <h2>Demo Scenarios</h2>
      <div className="scenario-grid">
        <div className="scenario-card">
          <h3>1. Order Submission</h3>
          <p>Demonstrates distributed tracing with user and business context propagation from frontend to backend.</p>
          <Link to="/order">
            <button>Try Order Flow →</button>
          </Link>
        </div>

        <div className="scenario-card">
          <h3>2. Profile Update</h3>
          <p>Shows session context enrichment with breadcrumb accumulation across user interactions.</p>
          <Link to="/profile">
            <button>Try Profile Flow →</button>
          </Link>
        </div>

        <div className="scenario-card">
          <h3>3. Payment Processing</h3>
          <p>Illustrates error correlation with retry patterns and circuit breaker telemetry.</p>
          <Link to="/payment">
            <button>Try Payment Flow →</button>
          </Link>
        </div>

        <div className="scenario-card">
          <h3>4. Product Search</h3>
          <p>Performance metrics demonstration with caching patterns and search analytics.</p>
          <Link to="/search">
            <button>Try Search Flow →</button>
          </Link>
        </div>
      </div>

      <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#1a1a1a', borderRadius: '8px' }}>
        <h3>🔍 What to Watch For:</h3>
        <ul style={{ textAlign: 'left' }}>
          <li><strong>Console Logs:</strong> Real-time telemetry data export</li>
          <li><strong>Network Tab:</strong> traceparent headers in outgoing requests</li>
          <li><strong>Jaeger UI:</strong> End-to-end distributed traces</li>
          <li><strong>Prometheus Metrics:</strong> Business and technical metrics</li>
        </ul>
      </div>
    </div>
  )
}

export default App