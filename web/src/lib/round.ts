/**
 * Round and ticket shapes, decoded defensively.
 *
 * The ABIs are loaded at runtime from `imd-deployment.json`, so wagmi cannot infer result types
 * from a literal ABI. These helpers convert whatever the decoder returned into the shapes the UI
 * uses, and derive the round phase locally so the countdown stays live between reads.
 */

export const PHASE_LABELS = ['Not started', 'Sales open', 'Reveal window', 'Awaiting settlement', 'Settled'] as const
export type PhaseIndex = 0 | 1 | 2 | 3 | 4

export interface RoundState {
  salesEnd: bigint
  revealEnd: bigint
  ticketsSold: number
  revealedCount: number
  settled: boolean
  claimed: boolean
  winner: `0x${string}`
  winningTicket: number
  pot: bigint
  entropy: `0x${string}`
}

export interface TicketState {
  buyer: `0x${string}`
  revealed: boolean
  commitment: `0x${string}`
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function asBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(value)
  if (typeof value === 'string' && value !== '') return BigInt(value)
  return 0n
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value !== '') return Number(value)
  return 0
}

function asHex(value: unknown, fallback: string): `0x${string}` {
  return (typeof value === 'string' && value.startsWith('0x') ? value : fallback) as `0x${string}`
}

/** Accepts both the struct-as-object and struct-as-tuple decodings. */
export function toRound(value: unknown): RoundState | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const source = Array.isArray(value)
    ? {
        salesEnd: value[0],
        revealEnd: value[1],
        ticketsSold: value[2],
        revealedCount: value[3],
        settled: value[4],
        claimed: value[5],
        winner: value[6],
        winningTicket: value[7],
        pot: value[8],
        entropy: value[9],
      }
    : (value as Record<string, unknown>)

  return {
    salesEnd: asBigInt(source.salesEnd),
    revealEnd: asBigInt(source.revealEnd),
    ticketsSold: asNumber(source.ticketsSold),
    revealedCount: asNumber(source.revealedCount),
    settled: source.settled === true,
    claimed: source.claimed === true,
    winner: asHex(source.winner, ZERO_ADDRESS),
    winningTicket: asNumber(source.winningTicket),
    pot: asBigInt(source.pot),
    entropy: asHex(source.entropy, `0x${'0'.repeat(64)}`),
  }
}

export function toTicket(value: unknown): TicketState | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const source = Array.isArray(value)
    ? { buyer: value[0], revealed: value[1], commitment: value[2] }
    : (value as Record<string, unknown>)
  return {
    buyer: asHex(source.buyer, ZERO_ADDRESS),
    revealed: source.revealed === true,
    commitment: asHex(source.commitment, `0x${'0'.repeat(64)}`),
  }
}

/**
 * The same rule as `CommitRevealRaffle.phase`, recomputed from the wall clock so the UI does not
 * wait for the next poll to notice a window closed.
 */
export function derivePhase(round: RoundState | undefined, nowSeconds: number): PhaseIndex {
  if (!round) return 0
  if (round.settled) return 4
  if (round.salesEnd === 0n) return 0
  const now = BigInt(Math.floor(nowSeconds))
  if (now < round.salesEnd) return 1
  if (now < round.revealEnd) return 2
  return 3
}

export function secondsUntil(deadline: bigint, nowSeconds: number): number {
  return Number(deadline) - Math.floor(nowSeconds)
}

/** Ticket indices this wallet holds, from `ticketsOf(roundId, buyer)`. */
export function toTicketIndices(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.map(asNumber)
}
