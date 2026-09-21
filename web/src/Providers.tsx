import { darkTheme, RainbowKitProvider } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMemo, type ReactNode } from 'react'
import { WagmiProvider, type Config } from 'wagmi'
import type { Deployment } from './deployment'
import { DeploymentProvider } from './hooks/useDeployment'

export function Providers({
  deployment,
  wagmiConfig,
  children,
}: {
  deployment: Deployment
  wagmiConfig: Config
  children: ReactNode
}) {
  const queryClient = useMemo(() => new QueryClient(), [])
  return (
    <DeploymentProvider deployment={deployment}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={darkTheme({ accentColor: '#6ee7b7', accentColorForeground: '#052e26' })}>
            {children}
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </DeploymentProvider>
  )
}
