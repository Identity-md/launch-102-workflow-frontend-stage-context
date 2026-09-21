/**
 * The single place that holds public, non-secret configuration for this frontend.
 *
 * Deliberately NOT here: contract addresses, the chain id, and the ABIs. Those come from
 * `imd-deployment.json`, which is fetched at runtime next to `index.html` (see `deployment.ts`)
 * so there is no second copy that can drift away from the attested deployment handoff.
 *
 * What is here: the public RPC endpoints, chain presentation, the explorer and the optional
 * WalletConnect project id. Never put a private RPC key or any other credential in this file —
 * everything in it is compiled into the public static export.
 */
import type { Chain } from 'viem'
import { sepolia } from 'wagmi/chains'

/** File name of the runtime deployment configuration, resolved relative to the page. */
export const DEPLOYMENT_CONFIG_FILE = 'imd-deployment.json'

export const APP_NAME = 'Raffle'
export const APP_DESCRIPTION = 'Commit-reveal raffle paid in RAFL'

/** Contract names as they appear in the deployment handoff. */
export const TOKEN_CONTRACT = 'RaffleToken'
export const RAFFLE_CONTRACT = 'CommitRevealRaffle'

/**
 * Optional. Supply at build time with `VITE_WALLETCONNECT_PROJECT_ID=...` to offer the
 * WalletConnect / mobile wallet list. A WalletConnect project id is public by design, but it is
 * not required: without one the app still offers every injected browser wallet.
 */
export const WALLETCONNECT_PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '').trim()

export interface ChainSettings {
  chain: Chain
  /** Tried in order for reads; the wallet's own provider is used as the final fallback. */
  rpcUrls: readonly string[]
  explorerName: string
  explorerUrl: string
  faucetUrl?: string
}

/**
 * Chains this build knows how to talk to, keyed by chain id. The active chain is whichever id
 * the runtime deployment configuration names — this map only supplies how to reach it.
 */
export const SUPPORTED_CHAINS: Readonly<Record<number, ChainSettings>> = {
  11155111: {
    chain: sepolia,
    rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://1rpc.io/sepolia'],
    explorerName: 'Etherscan',
    explorerUrl: 'https://sepolia.etherscan.io',
    faucetUrl: 'https://sepoliafaucet.com',
  },
}

export function chainSettings(chainId: number): ChainSettings | undefined {
  return SUPPORTED_CHAINS[chainId]
}

export function explorerAddressUrl(chainId: number, address: string): string | undefined {
  const settings = chainSettings(chainId)
  return settings && `${settings.explorerUrl}/address/${address}`
}

export function explorerTxUrl(chainId: number, hash: string): string | undefined {
  const settings = chainSettings(chainId)
  return settings && `${settings.explorerUrl}/tx/${hash}`
}

/** How often contract reads are refreshed, in milliseconds (roughly one Sepolia block). */
export const READ_REFRESH_MS = 12_000
