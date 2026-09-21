import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Abi } from 'viem'
import { RAFFLE_CONTRACT, TOKEN_CONTRACT } from '../config'
import { contractByName, type Deployment } from '../deployment'

const DeploymentContext = createContext<Deployment | null>(null)

export function DeploymentProvider({ deployment, children }: { deployment: Deployment; children: ReactNode }) {
  return <DeploymentContext.Provider value={deployment}>{children}</DeploymentContext.Provider>
}

export function useDeployment(): Deployment {
  const deployment = useContext(DeploymentContext)
  if (!deployment) throw new Error('useDeployment must be used inside <DeploymentProvider>')
  return deployment
}

export interface ContractHandle {
  address: `0x${string}`
  abi: Abi
}

/** The two contracts this app drives, resolved from the runtime deployment configuration. */
export function useContracts(): { token: ContractHandle; raffle: ContractHandle } {
  const deployment = useDeployment()
  return useMemo(
    () => ({
      token: contractByName(deployment, TOKEN_CONTRACT),
      raffle: contractByName(deployment, RAFFLE_CONTRACT),
    }),
    [deployment],
  )
}
