import type { Action } from '../hooks/useAction'
import type { ContractHandle } from '../hooks/useDeployment'
import type { RaffleState } from '../hooks/useRaffleState'
import { formatAmount, formatCountdown } from '../lib/format'
import { derivePhase, secondsUntil, ZERO_ADDRESS } from '../lib/round'
import { Button, Notice, Panel } from './ui'

/** Settle (anyone, after the reveal window) and claim (the winner, with no deadline). */
export function SettlePanel({
  state,
  roundId,
  now,
  canTransact,
  raffle,
  action,
  account,
}: {
  state: RaffleState
  roundId: bigint
  now: number
  canTransact: boolean
  raffle: ContractHandle
  action: Action
  account: `0x${string}` | undefined
}) {
  const { round, token } = state
  const phase = derivePhase(round, now)
  const settleable = phase === 3
  const hasWinner = Boolean(round?.settled && round.winner !== ZERO_ADDRESS)
  const isWinner = hasWinner && account !== undefined && round?.winner.toLowerCase() === account.toLowerCase()
  const potText = round ? `${formatAmount(round.pot, token.decimals)} ${token.symbol}` : '—'

  return (
    <Panel
      title="Settle and claim"
      subtitle="Settling picks the winner from the revealed secrets and opens the next round. Anyone can do it."
    >
      <div className="split">
        <div>
          <h3>Settle round {roundId.toString()}</h3>
          {round?.settled ? (
            <p className="muted">Already settled.</p>
          ) : phase === 0 ? (
            <p className="muted">This round has not started — nobody has bought a ticket yet.</p>
          ) : settleable ? (
            <p className="muted">
              The reveal window has closed. Settling computes the winning index from{' '}
              {round?.revealedCount ?? 0} revealed secret{round?.revealedCount === 1 ? '' : 's'} and pays nothing out
              by itself.
              {round?.revealedCount === 0
                ? ' Nobody revealed, so the whole pot rolls into the next round.'
                : null}
            </p>
          ) : (
            <p className="muted">
              Settling opens in {formatCountdown(secondsUntil(round?.revealEnd ?? 0n, now))}, once the reveal window
              closes.
            </p>
          )}
          <Button
            onClick={() =>
              action.run({
                ...raffle,
                functionName: 'settle',
                args: [roundId],
                label: `Settling round ${roundId.toString()}`,
              })
            }
            disabled={!canTransact || !settleable || action.busy}
            loading={action.busy && action.pendingLabel?.startsWith('Settling')}
            variant="secondary"
          >
            Settle round {roundId.toString()}
          </Button>
        </div>

        <div>
          <h3>Claim the pot</h3>
          {!round?.settled ? (
            <p className="muted">Available once the round is settled and you hold the winning ticket.</p>
          ) : !hasWinner ? (
            <Notice tone="info">Nobody revealed in this round, so there is nothing to claim — the pot rolled over.</Notice>
          ) : round.claimed ? (
            <p className="muted">The {potText} pot has already been claimed.</p>
          ) : isWinner ? (
            <Notice tone="success" title="You won">
              Claiming transfers the full {potText} pot to your wallet. There is no deadline.
            </Notice>
          ) : (
            <p className="muted">
              The {potText} pot belongs to ticket #{round.winningTicket}, held by another wallet.
            </p>
          )}
          <Button
            onClick={() =>
              action.run({
                ...raffle,
                functionName: 'claim',
                args: [roundId],
                label: `Claiming round ${roundId.toString()}`,
              })
            }
            disabled={!canTransact || !isWinner || round?.claimed !== false || action.busy}
            loading={action.busy && action.pendingLabel?.startsWith('Claiming')}
          >
            Claim {potText}
          </Button>
        </div>
      </div>
    </Panel>
  )
}
