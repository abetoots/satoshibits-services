export const observabilityConfig = {
  serviceName: 'web-store-frontend',
  environment: 'browser' as const,
  endpoint: import.meta.env.VITE_OBSERVABILITY_ENDPOINT || 'http://localhost:4318/v1/traces',
  traceFetch: true,
  captureErrors: true,
  captureInteractions: true,
  captureNavigation: true,
  propagateTraceHeaderCorsUrls: [import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'],
  // Optional: enable console exporter for immediate feedback (no infra)
  // Set VITE_USE_CONSOLE_EXPORTER=1 to enable
  useConsoleExporter: (import.meta.env.VITE_USE_CONSOLE_EXPORTER === '1' || import.meta.env.VITE_USE_CONSOLE_EXPORTER === 'true')
}

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'
