import { useState } from 'react'
import { isAddress } from 'viem'
import { explorerAddressUrl } from '../config'
import type { Action } from '../hooks/useAction'
import type { ContractHandle } from '../hooks/useDeployment'
import type { RaffleState } from '../hooks/useRaffleState'
import { formatAmount, parseAmount, shortAddress } from '../lib/format'
import { Button, ExternalLink, Field, Fields, Mono, Panel } from './ui'

/**
 * The RAFL token itself: live balances and the two actions a holder can take directly —
 * `transfer` and `approve`. (`transferFrom` is exercised by the raffle when you buy a ticket.)
 */
export function TokenPanel({
  state,
  chainId,
  canTransact,
  token,
  raffle,
  action,
  account,
}: {
  state: RaffleState
  chainId: number
  canTransact: boolean
  token: ContractHandle
  raffle: ContractHandle
  action: Action
  account: `0x${string}` | undefined
}) {
  const [recipient, setRecipient] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [allowanceAmount, setAllowanceAmount] = useState('')

  const { decimals, symbol, name, totalSupply } = state.token
  const transferValue = parseAmount(transferAmount, decimals)
  const allowanceValue = parseAmount(allowanceAmount, decimals)
  const recipientOk = isAddress(recipient)
  const enoughToTransfer = transferValue !== undefined && state.balance !== undefined && transferValue <= state.balance

  return (
    <Panel
      title={`${name} (${symbol})`}
      subtitle={
        <>
          Fixed supply, {decimals} decimals, no mint.{' '}
          <ExternalLink href={explorerAddressUrl(chainId, token.address)}>
            <Mono>{shortAddress(token.address)}</Mono>
          </ExternalLink>
        </>
      }
    >
      <Fields>
        <Field label="Total supply">
          {formatAmount(totalSupply, decimals, 0)} {symbol}
        </Field>
        <Field label="Your balance">
          {account ? `${formatAmount(state.balance, decimals)} ${symbol}` : 'connect a wallet'}
        </Field>
        <Field label="Approved to the raffle" hint={`spender ${shortAddress(raffle.address)}`}>
          {account ? `${formatAmount(state.allowance, decimals)} ${symbol}` : '—'}
        </Field>
      </Fields>

      <div className="split">
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault()
            if (!recipientOk || transferValue === undefined) return
            action.run({
              ...token,
              functionName: 'transfer',
              args: [recipient as `0x${string}`, transferValue],
              label: `Sending ${transferAmount} ${symbol}`,
            })
          }}
        >
          <h3>Send {symbol}</h3>
          <label>
            <span>Recipient</span>
            <input
              type="text"
              spellCheck={false}
              placeholder="0x…"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </label>
          <label>
            <span>Amount in {symbol}</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="100"
              value={transferAmount}
              onChange={(event) => setTransferAmount(event.target.value)}
            />
          </label>
          <p className="muted">
            {transferValue !== undefined
              ? `Sends ${formatAmount(transferValue, decimals)} ${symbol} (${transferValue} minor units).`
              : `Amounts are in whole ${symbol}; up to ${decimals} decimal places.`}
          </p>
          {transferValue !== undefined && !enoughToTransfer ? (
            <p className="warn-text">That is more than your balance.</p>
          ) : null}
          <Button
            type="submit"
            disabled={!canTransact || !recipientOk || transferValue === undefined || !enoughToTransfer || action.busy}
            loading={action.busy && action.pendingLabel?.startsWith('Sending')}
            variant="secondary"
          >
            Send
          </Button>
        </form>

        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault()
            if (allowanceValue === undefined) return
            action.run({
              ...token,
              functionName: 'approve',
              args: [raffle.address, allowanceValue],
              label: `Setting allowance to ${allowanceAmount} ${symbol}`,
            })
          }}
        >
          <h3>Set the raffle allowance</h3>
          <label>
            <span>Allowance in {symbol}</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="1000"
              value={allowanceAmount}
              onChange={(event) => setAllowanceAmount(event.target.value)}
            />
          </label>
          <p className="muted">
            Replaces the current allowance for the raffle contract. Use <code>0</code> to revoke it entirely.
          </p>
          <Button
            type="submit"
            disabled={!canTransact || allowanceValue === undefined || action.busy}
            loading={action.busy && action.pendingLabel?.startsWith('Setting allowance')}
            variant="secondary"
          >
            Set allowance
          </Button>
        </form>
      </div>
    </Panel>
  )
}
