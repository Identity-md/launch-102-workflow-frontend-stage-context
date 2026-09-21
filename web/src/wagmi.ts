/**
 * wagmi/RainbowKit wiring. The chain comes from the runtime deployment configuration; the RPC
 * endpoints for that chain come from `config.ts`. Transaction signing always stays with the
 * visitor's wallet — this app never holds a key.
 */
import {
  connectorsForWallets,
  getDefaultConfig,
  type WalletList,
} from '@rainbow-me/rainbowkit'
import {
  braveWallet,
  injectedWallet,
  rabbyWallet,
  safeWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { fallback, http, type Chain, type Transport } from 'viem'
import { createConfig, type Config } from 'wagmi'
import { APP_NAME, chainSettings, WALLETCONNECT_PROJECT_ID } from './config'

export class UnsupportedChainError extends Error {
  constructor(public readonly chainId: number) {
    super(
      `The deployment configuration names chain ${chainId}, which this build has no RPC settings for. ` +
        'Add it to SUPPORTED_CHAINS in web/src/config.ts and rebuild.',
    )
    this.name = 'UnsupportedChainError'
  }
}

/** Public RPCs in order, then the wallet's own provider if all of them fail. */
export function transportForChain(rpcUrls: readonly string[]): Transport {
  return fallback([...rpcUrls.map((url) => http(url)), http()], { rank: false })
}

/**
 * Browser wallets that need no WalletConnect project id. Used when none was configured, so the
 * app still connects out of the box; set VITE_WALLETCONNECT_PROJECT_ID to add mobile wallets.
 */
function injectedOnlyWallets(): WalletList {
  return [
    {
      groupName: 'Installed',
      wallets: [injectedWallet, rabbyWallet, braveWallet, safeWallet],
    },
  ]
}

export function createWagmiConfig(chainId: number): { config: Config; chain: Chain; usingWalletConnect: boolean } {
  const settings = chainSettings(chainId)
  if (!settings) throw new UnsupportedChainError(chainId)

  const { chain, rpcUrls } = settings
  const transports = { [chain.id]: transportForChain(rpcUrls) }
  const usingWalletConnect = WALLETCONNECT_PROJECT_ID.length > 0

  const config = usingWalletConnect
    ? getDefaultConfig({
        appName: APP_NAME,
        projectId: WALLETCONNECT_PROJECT_ID,
        chains: [chain],
        transports,
        ssr: false,
      })
    : createConfig({
        chains: [chain],
        transports,
        connectors: connectorsForWallets(injectedOnlyWallets(), {
          appName: APP_NAME,
          projectId: '',
        }),
      })

  return { config, chain, usingWalletConnect }
}
