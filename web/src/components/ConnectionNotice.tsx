import { useSwitchChain } from 'wagmi'
import { chainSettings } from '../config'
import { describeError } from '../lib/errors'
import { Button, ExternalLink, Notice } from './ui'

export interface ConnectionState {
  hasInjectedWallet: boolean
  isConnected: boolean
  chainId: number | undefined
  expectedChainId: number
}

/**
 * Disconnected, no wallet installed, or connected to the wrong network. Reads still work in every
 * one of these states; only the transaction controls are withheld.
 */
export function ConnectionNotice({ state }: { state: ConnectionState }) {
  const { switchChain, isPending, error } = useSwitchChain()
  const expected = chainSettings(state.expectedChainId)
  const expectedName = expected ? expected.chain.name : `chain ${state.expectedChainId}`

  if (!state.isConnected) {
    return (
      <Notice tone="info" title="Read-only">
        Round state below is live from the public RPC. Connect a wallet to buy, reveal, settle or claim.
        {state.hasInjectedWallet ? null : (
          <>
            {' '}
            No browser wallet was detected — install one such as{' '}
            <ExternalLink href="https://metamask.io/download/">MetaMask</ExternalLink> or{' '}
            <ExternalLink href="https://rabby.io/">Rabby</ExternalLink>, then reload.
          </>
        )}
      </Notice>
    )
  }

  if (state.chainId !== state.expectedChainId) {
    return (
      <Notice tone="warn" title="Wrong network">
        <p>
          Your wallet is on chain {state.chainId ?? 'unknown'}, but this deployment lives on {expectedName} (
          {state.expectedChainId}). Switch before sending anything.
        </p>
        <Button
          onClick={() => switchChain({ chainId: state.expectedChainId })}
          loading={isPending}
          variant="secondary"
        >
          Switch to {expectedName}
        </Button>
        {error ? <p className="warn-text">{describeError(error)}</p> : null}
      </Notice>
    )
  }

  return null
}
