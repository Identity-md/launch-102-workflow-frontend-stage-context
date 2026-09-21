import { explorerTxUrl } from '../config'
import type { Action } from '../hooks/useAction'
import { shortHex } from '../lib/format'
import { ExternalLink, Notice } from './ui'

/** The shared transaction status line: signing, confirming, confirmed, rejected or failed. */
export function TxStatus({ action, chainId }: { action: Action; chainId: number }) {
  if (action.status === 'idle') return null

  const link = action.hash ? (
    <>
      {' '}
      <ExternalLink href={explorerTxUrl(chainId, action.hash)}>
        <code>{shortHex(action.hash)}</code>
      </ExternalLink>
    </>
  ) : null

  if (action.status === 'signing') {
    return (
      <Notice tone="info" title="Check your wallet">
        {action.pendingLabel ?? 'This action'} is waiting for you to approve it. Nothing has been sent yet.
      </Notice>
    )
  }
  if (action.status === 'confirming') {
    return (
      <Notice tone="info" title="Waiting for confirmation">
        {action.pendingLabel ?? 'Transaction'} sent.{link}
      </Notice>
    )
  }
  if (action.status === 'confirmed') {
    return (
      <Notice tone="success" title="Confirmed">
        {action.pendingLabel ?? 'Transaction'} confirmed.{link}
      </Notice>
    )
  }
  return (
    <Notice tone={action.rejected ? 'warn' : 'error'} title={action.rejected ? 'Cancelled' : 'Transaction failed'}>
      {action.errorMessage}
      {link}
    </Notice>
  )
}
