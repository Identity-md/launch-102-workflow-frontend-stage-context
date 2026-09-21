import { useState } from 'react'
import type { Hex } from 'viem'
import type { ContractHandle } from '../hooks/useDeployment'
import type { Action } from '../hooks/useAction'
import type { RaffleState } from '../hooks/useRaffleState'
import { commitmentFor, generateSecret, type SecretKey, type SecretVault } from '../lib/secrets'
import { formatAmount } from '../lib/format'
import { derivePhase } from '../lib/round'
import { Button, Field, Fields, Mono, Notice, Panel } from './ui'

/**
 * Buy a ticket: generate a secret in the browser, approve RAFL, then commit to keccak256(secret).
 * Approval is a separate, explicit step and the exact amount being approved is spelled out.
 */
export function BuyPanel({
  state,
  roundId,
  now,
  chainId,
  canTransact,
  token,
  raffle,
  vault,
  action,
}: {
  state: RaffleState
  roundId: bigint
  now: number
  chainId: number
  canTransact: boolean
  token: ContractHandle
  raffle: ContractHandle
  vault: SecretVault
  action: Action
}) {
  const [secret, setSecret] = useState<Hex | undefined>()
  const [copied, setCopied] = useState(false)

  const { decimals, symbol } = state.token
  const price = state.constants.ticketPrice
  const phase = derivePhase(state.round, now)
  const salesOpen = phase === 0 || phase === 1
  const roundIsCurrent = state.constants.currentRoundId === roundId
  const full =
    state.round !== undefined &&
    state.constants.maxTickets !== undefined &&
    BigInt(state.round.ticketsSold) >= state.constants.maxTickets

  const approved = state.allowance !== undefined && price !== undefined && state.allowance >= price
  const funded = state.balance !== undefined && price !== undefined && state.balance >= price
  const secretKey: SecretKey = { chainId, raffle: raffle.address, roundId }

  const priceText = price !== undefined ? `${formatAmount(price, decimals)} ${symbol}` : '…'

  function onGenerate() {
    const next = generateSecret()
    vault.rememberPending(secretKey, next)
    setSecret(next)
    setCopied(false)
  }

  function onDownload() {
    if (!secret) return
    const body = [
      `# Raffle ticket secret — keep this until you have revealed`,
      `chainId: ${chainId}`,
      `raffle: ${raffle.address}`,
      `round: ${roundId.toString()}`,
      `commitment: ${commitmentFor(secret)}`,
      `secret: ${secret}`,
      '',
    ].join('\n')
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `raffle-round-${roundId.toString()}-secret.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Panel
      title="Buy a ticket"
      subtitle={
        <>
          One ticket costs <strong>{priceText}</strong>. The secret is generated here and never leaves your browser
          until you reveal it.
        </>
      }
    >
      {!roundIsCurrent ? (
        <Notice tone="info">
          You are looking at a past round. Switch to round {state.constants.currentRoundId?.toString() ?? '…'} to buy a
          ticket.
        </Notice>
      ) : null}
      {roundIsCurrent && !salesOpen ? (
        <Notice tone="warn">Sales for round {roundId.toString()} are closed. A new round opens once this one is settled.</Notice>
      ) : null}
      {roundIsCurrent && salesOpen && full ? <Notice tone="warn">This round has sold out.</Notice> : null}

      <ol className="steps">
        <li>
          <h3>1. Generate your secret</h3>
          <p className="muted">
            32 random bytes from your browser&rsquo;s CSPRNG. It is saved in this browser&rsquo;s local storage, but
            save a copy — <strong>a ticket you cannot reveal forfeits its eligibility.</strong>
          </p>
          <div className="row">
            <Button variant="secondary" onClick={onGenerate}>
              {secret ? 'Generate another' : 'Generate secret'}
            </Button>
            {secret ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard?.writeText(secret).then(() => setCopied(true))
                  }}
                >
                  {copied ? 'Copied' : 'Copy secret'}
                </Button>
                <Button variant="ghost" onClick={onDownload}>
                  Download
                </Button>
              </>
            ) : null}
          </div>
          {secret ? (
            <Fields>
              <Field label="Secret" hint="keep this private until the reveal window">
                <Mono>{secret}</Mono>
              </Field>
              <Field label="Commitment" hint="keccak256(secret) — this is what goes on chain">
                <Mono>{commitmentFor(secret)}</Mono>
              </Field>
            </Fields>
          ) : null}
        </li>

        <li>
          <h3>2. Approve {priceText}</h3>
          <p className="muted">
            The raffle pulls the ticket price with <code>transferFrom</code>, so it needs an allowance first. Current
            allowance: <strong>{formatAmount(state.allowance, decimals)} {symbol}</strong>. Your balance:{' '}
            <strong>{formatAmount(state.balance, decimals)} {symbol}</strong>.
          </p>
          <div className="row">
            <Button
              onClick={() =>
                price !== undefined &&
                action.run({
                  ...token,
                  functionName: 'approve',
                  args: [raffle.address, price],
                  label: `Approving ${priceText}`,
                })
              }
              disabled={!canTransact || price === undefined || action.busy}
              loading={action.busy && action.pendingLabel?.startsWith('Approving')}
              variant={approved ? 'secondary' : 'primary'}
            >
              Approve one ticket
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                price !== undefined &&
                action.run({
                  ...token,
                  functionName: 'approve',
                  args: [raffle.address, price * 10n],
                  label: `Approving ${formatAmount(price * 10n, decimals)} ${symbol}`,
                })
              }
              disabled={!canTransact || price === undefined || action.busy}
            >
              Approve ten
            </Button>
            {approved ? <span className="ok-text">Allowance covers a ticket.</span> : null}
          </div>
        </li>

        <li>
          <h3>3. Buy the ticket</h3>
          <p className="muted">
            Sends <code>buyTicket(commitment)</code> and transfers {priceText} to the raffle. You can buy more than one
            ticket per round — generate a fresh secret for each.
          </p>
          <Button
            onClick={() =>
              secret &&
              action.run({
                ...raffle,
                functionName: 'buyTicket',
                args: [commitmentFor(secret)],
                label: `Buying a ticket in round ${roundId.toString()}`,
              })
            }
            disabled={!canTransact || !secret || !approved || !funded || !salesOpen || !roundIsCurrent || full || action.busy}
            loading={action.busy && action.pendingLabel?.startsWith('Buying')}
          >
            Buy ticket for {priceText}
          </Button>
          {!secret ? <p className="muted">Generate a secret first.</p> : null}
          {secret && !approved ? <p className="muted">Approve the ticket price first.</p> : null}
          {secret && approved && !funded ? (
            <p className="warn-text">
              Your balance of {formatAmount(state.balance, decimals)} {symbol} is below the {priceText} ticket price.
            </p>
          ) : null}
        </li>
      </ol>
    </Panel>
  )
}
