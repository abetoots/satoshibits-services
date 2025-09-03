import React, { createContext, useContext, ReactNode } from 'react'
import { SmartClient } from '@satoshibits/observability'

type ObservabilityClient = Awaited<ReturnType<typeof SmartClient.initialize>>

const ObservabilityContext = createContext<ObservabilityClient | null>(null)

interface ObservabilityProviderProps {
  client: ObservabilityClient | null
  children: ReactNode
}

export const ObservabilityProvider: React.FC<ObservabilityProviderProps> = ({ client, children }) => {
  return (
    <ObservabilityContext.Provider value={client}>
      {children}
    </ObservabilityContext.Provider>
  )
}

export const useObservability = () => {
  const client = useContext(ObservabilityContext)
  if (!client) {
    console.warn('Observability client not available. Telemetry will be disabled.')
    return null
  }
  return client
}
