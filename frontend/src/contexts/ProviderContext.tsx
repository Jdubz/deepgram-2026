import { createContext, useContext, useState, ReactNode } from 'react'

export type TranscriptionProvider = 'local' | 'deepgram'

interface ProviderContextValue {
  provider: TranscriptionProvider
  setProvider: (provider: TranscriptionProvider) => void
}

const ProviderContext = createContext<ProviderContextValue | null>(null)

export function ProviderProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<TranscriptionProvider>('local')

  return (
    <ProviderContext.Provider value={{ provider, setProvider }}>
      {children}
    </ProviderContext.Provider>
  )
}

export function useProvider(): ProviderContextValue {
  const context = useContext(ProviderContext)
  if (!context) {
    throw new Error('useProvider must be used within a ProviderProvider')
  }
  return context
}
