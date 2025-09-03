import React, { useEffect, useRef } from 'react'

interface TelemetryConsoleProps {
  logs: string[]
}

const TelemetryConsole: React.FC<TelemetryConsoleProps> = ({ logs }) => {
  const consoleRef = useRef<HTMLDivElement>(null)

  // auto-scroll to bottom when new logs are added
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [logs])

  const formatLog = (log: string) => {
    // color code different log types
    if (log.includes('ERROR') || log.includes('❌')) return 'error'
    if (log.includes('WARN') || log.includes('⚠️')) return 'warning'
    if (log.includes('INFO') || log.includes('✅')) return 'success'
    return 'info'
  }

  return (
    <div style={{ marginTop: '3rem' }}>
      <h3>🔍 Real-time Telemetry Console</h3>
      <p style={{ fontSize: '0.875rem', opacity: 0.7 }}>
        Watch telemetry data being exported to console. Check browser Network tab for traceparent headers.
      </p>
      
      <div className="telemetry-console" ref={consoleRef}>
        {logs.length === 0 ? (
          <div style={{ opacity: 0.5, fontStyle: 'italic' }}>
            Waiting for telemetry data... Interact with the demo scenarios above.
          </div>
        ) : (
          logs.map((log, index) => (
            <div key={index} className={formatLog(log)}>
              <pre>{log}</pre>
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: '1rem', fontSize: '0.875rem', opacity: 0.7 }}>
        <strong>Pro Tip:</strong> Open browser DevTools → Network tab to see distributed tracing headers (traceparent) being sent to the backend.
      </div>
    </div>
  )
}

export default TelemetryConsole