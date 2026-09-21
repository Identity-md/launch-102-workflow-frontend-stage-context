import { useState } from 'react'
import type { Action } from '../hooks/useAction'
import type { ContractHandle } from '../hooks/useDeployment'
import type { RaffleState } from '../hooks/useRaffleState'
import { shortHex } from '../lib/format'
import { derivePhase } from '../lib/round'
import { commitmentFor, normaliseSecret, type SecretKey, type SecretVault } from '../lib/secrets'
import { Badge, Button, Mono, Notice, Panel } from './ui'

/**
 * The connected wallet's tickets in this round, and the reveal control for each one.
 *
 * A secret stored at purchase time is matched back to its ticket by commitment. If it is missing —
 * different browser, cleared storage — the secret can be pasted in, and it is checked against the
 * on-chain commitment before the transaction is offered.
 */
export function TicketsPanel({
  state,
  roundId,
  now,
  chainId,
  canTransact,
  raffle,
  vault,
  action,
  account,
}: {
  state: RaffleState
  roundId: bigint
  now: number
  chainId: number
  canTransact: boolean
  raffle: ContractHandle
  vault: SecretVault
  action: Action
  account: `0x${string}` | undefined
}) {
  const [manual, setManual] = useState<Record<number, string>>({})
  const phase = derivePhase(state.round, now)
  const revealOpen = phase === 2
  const secretKey: SecretKey = { chainId, raffle: raffle.address, roundId }
  const saved = vault.exportAll(secretKey)

  function downloadBackup() {
    const body = [
      `# Raffle secrets backup`,
      `chainId: ${chainId}`,
      `raffle: ${raffle.address}`,
      `round: ${roundId.toString()}`,
      ...saved.map((entry) => `${entry.label}: ${entry.secret}`),
      '',
    ].join('\n')
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `raffle-round-${roundId.toString()}-secrets.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Panel
      title="Your tickets"
      subtitle={
        revealOpen
          ? 'The reveal window is open. Reveal every ticket you hold — an unrevealed ticket forfeits its eligibility.'
          : 'Reveals are only accepted between the end of sales and the end of the reveal window.'
      }
      actions={
        saved.length > 0 ? (
          <Button variant="ghost" onClick={downloadBackup}>
            Back up {saved.length} secret{saved.length === 1 ? '' : 's'}
          </Button>
        ) : null
      }
    >
      {!account ? (
        <Notice tone="info">Connect a wallet to see the tickets it holds in round {roundId.toString()}.</Notice>
      ) : state.ownedTickets.length === 0 ? (
        <p className="muted">This wallet holds no tickets in round {roundId.toString()}.</p>
      ) : (
        <ul className="tickets">
          {state.ownedTickets.map(({ index, ticket }) => {
            const stored = vault.lookup(secretKey, index, ticket?.commitment)
            const typed = normaliseSecret(manual[index] ?? '')
            const secret = stored ?? typed
            const matches = secret !== undefined && ticket !== undefined && commitmentFor(secret) === ticket.commitment
            const isWinner =
              state.round?.settled && state.round.winner.toLowerCase() === account.toLowerCase() &&
              state.round.winningTicket === index

            return (
              <li key={index} className="ticket">
                <div className="ticket__head">
                  <h3>Ticket #{index}</h3>
                  {ticket?.revealed ? <Badge tone="success">revealed</Badge> : <Badge tone="warn">not revealed</Badge>}
                  {isWinner ? <Badge tone="success">winning ticket</Badge> : null}
                </div>
                <p className="muted">
                  Commitment <Mono title={ticket?.commitment}>{shortHex(ticket?.commitment, 12, 8)}</Mono>
                  {stored ? ' · secret found in this browser' : ' · no secret stored here'}
                </p>

                {ticket?.revealed ? null : (
                  <>
                    {stored ? null : (
                      <label className="manual-secret">
                        <span>Paste the secret for this ticket</span>
                        <input
                          type="text"
                          inputMode="text"
                          spellCheck={false}
                          placeholder="0x… (32 bytes)"
                          value={manual[index] ?? ''}
                          onChange={(event) => setManual((prev) => ({ ...prev, [index]: event.target.value }))}
                        />
                        {manual[index] && !typed ? (
                          <span className="warn-text">That is not 32 bytes of hex.</span>
                        ) : null}
                        {typed && ticket && !matches ? (
                          <span className="warn-text">That secret does not match this ticket&rsquo;s commitment.</span>
                        ) : null}
                      </label>
                    )}
                    <Button
                      onClick={() => {
                        if (!secret) return
                        vault.bind(secretKey, index, secret)
                        action.run({
                          ...raffle,
                          functionName: 'reveal',
                          args: [roundId, BigInt(index), secret],
                          label: `Revealing ticket #${index}`,
                        })
                      }}
                      disabled={!canTransact || !revealOpen || !matches || action.busy}
                      loading={action.busy && action.pendingLabel === `Revealing ticket #${index}`}
                    >
                      Reveal ticket #{index}
                    </Button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
