import { formatAmount, formatCountdown, formatTimestamp, shortHex } from '../lib/format'
import { derivePhase, PHASE_LABELS, secondsUntil, ZERO_ADDRESS, type RoundState } from '../lib/round'
import { explorerAddressUrl } from '../config'
import { Badge, Button, ExternalLink, Field, Fields, Mono, Panel } from './ui'
import type { RaffleState } from '../hooks/useRaffleState'

/** Live state of one round: phase, deadlines, tickets, pot, entropy and winner. */
export function RoundPanel({
  state,
  roundId,
  setRoundId,
  now,
  chainId,
  account,
}: {
  state: RaffleState
  roundId: bigint
  setRoundId: (id: bigint) => void
  now: number
  chainId: number
  account: `0x${string}` | undefined
}) {
  const { round, token, constants } = state
  const phase = derivePhase(round, now)
  const current = constants.currentRoundId ?? roundId
  const ticketPrice = constants.ticketPrice

  const tone = phase === 1 ? 'success' : phase === 2 ? 'warn' : phase === 4 ? 'info' : 'info'
  const deadline = phase === 1 ? round?.salesEnd : phase === 2 ? round?.revealEnd : undefined
  const hasWinner = Boolean(round?.settled && round.winner !== ZERO_ADDRESS)
  const youWon = hasWinner && account && round?.winner.toLowerCase() === account.toLowerCase()

  const potInTickets =
    round && ticketPrice && ticketPrice > 0n ? Number(round.pot / ticketPrice) : undefined

  return (
    <Panel
      title={`Round ${roundId.toString()}`}
      subtitle={
        <>
          <Badge tone={tone}>{PHASE_LABELS[phase]}</Badge>
          {deadline ? <> · {formatCountdown(secondsUntil(deadline, now))} left</> : null}
          {roundId === current ? <> · current round</> : <> · past round</>}
        </>
      }
      actions={
        <div className="round-nav">
          <Button
            variant="ghost"
            onClick={() => setRoundId(roundId - 1n)}
            disabled={roundId <= 1n}
            aria-label="Previous round"
          >
            ‹
          </Button>
          <label className="round-nav__label">
            <span className="sr-only">Round number</span>
            <input
              type="number"
              min={1}
              value={roundId.toString()}
              onChange={(event) => {
                const next = event.target.value.trim()
                if (/^\d+$/.test(next) && BigInt(next) >= 1n) setRoundId(BigInt(next))
              }}
            />
          </label>
          <Button
            variant="ghost"
            onClick={() => setRoundId(roundId + 1n)}
            disabled={roundId >= current}
            aria-label="Next round"
          >
            ›
          </Button>
          <Button variant="secondary" onClick={() => setRoundId(current)} disabled={roundId === current}>
            Current
          </Button>
        </div>
      }
    >
      {state.error ? (
        <p className="warn-text" role="alert">
          Could not read the contracts: {state.error.message}
        </p>
      ) : null}

      <Fields>
        <Field label="Tickets sold">
          {round ? `${round.ticketsSold} / ${constants.maxTickets?.toString() ?? '—'}` : '—'}
        </Field>
        <Field label="Revealed" hint={round && round.ticketsSold > 0 ? `${round.revealedCount} of ${round.ticketsSold} eligible` : undefined}>
          {round ? round.revealedCount : '—'}
        </Field>
        <Field
          label="Pot"
          hint={potInTickets !== undefined ? `${potInTickets} ticket${potInTickets === 1 ? '' : 's'} at ${formatAmount(ticketPrice, token.decimals)} ${token.symbol} each` : undefined}
        >
          {round ? `${formatAmount(round.pot, token.decimals)} ${token.symbol}` : '—'}
        </Field>
        <Field label="Sales close">{round && round.salesEnd > 0n ? formatTimestamp(round.salesEnd) : 'not started'}</Field>
        <Field label="Reveal closes">{round && round.revealEnd > 0n ? formatTimestamp(round.revealEnd) : '—'}</Field>
        <Field label="Settled">{round?.settled ? 'yes' : 'no'}</Field>
      </Fields>

      {round?.settled ? (
        <Fields>
          <Field label="Winner">
            {hasWinner ? (
              <>
                <ExternalLink href={explorerAddressUrl(chainId, round.winner)}>
                  <Mono title={round.winner}>{round.winner}</Mono>
                </ExternalLink>
                {youWon ? <> {' '}<Badge tone="success">that is you</Badge></> : null}
              </>
            ) : (
              'nobody revealed — the pot rolled into the next round'
            )}
          </Field>
          {hasWinner ? <Field label="Winning ticket">#{round.winningTicket}</Field> : null}
          {hasWinner ? (
            <Field label="Entropy" hint="keccak256 of every revealed secret, in ticket order">
              <Mono title={round.entropy}>{shortHex(round.entropy, 12, 8)}</Mono>
            </Field>
          ) : null}
          <Field label="Pot claimed">{round.claimed ? 'yes' : 'no'}</Field>
        </Fields>
      ) : null}
    </Panel>
  )
}
