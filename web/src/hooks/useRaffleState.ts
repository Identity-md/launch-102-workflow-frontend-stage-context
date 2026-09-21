/**
 * Every contract read the page needs, in one place.
 *
 * Reads go through the public RPCs configured in `config.ts` and refresh on a timer, so the page
 * shows live contract state — balances, allowance, round phase, tickets, pot and winner — before
 * it ever asks for a transaction.
 */
import { useCallback, useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { READ_REFRESH_MS } from '../config'
import { toRound, toTicket, toTicketIndices, type RoundState, type TicketState } from '../lib/round'
import { useContracts } from './useDeployment'

export interface TokenInfo {
  name: string
  symbol: string
  decimals: number
  totalSupply: bigint | undefined
}

export interface RaffleConstants {
  currentRoundId: bigint | undefined
  ticketPrice: bigint | undefined
  maxTickets: bigint | undefined
  salesDuration: bigint | undefined
  revealDuration: bigint | undefined
  /** The token the raffle was constructed with; compared against the configured token address. */
  tokenAddress: `0x${string}` | undefined
}

export interface OwnedTicket {
  index: number
  ticket: TicketState | undefined
}

export interface RaffleState {
  token: TokenInfo
  constants: RaffleConstants
  round: RoundState | undefined
  balance: bigint | undefined
  allowance: bigint | undefined
  ownedTickets: OwnedTicket[]
  isLoading: boolean
  error: Error | undefined
  refetch: () => void
}

const query = { refetchInterval: READ_REFRESH_MS, retry: 2 } as const

function value<T>(entry: { status: string; result?: unknown } | undefined): T | undefined {
  return entry?.status === 'success' ? (entry.result as T) : undefined
}

export function useRaffleState(roundId: bigint, account: `0x${string}` | undefined): RaffleState {
  const { token, raffle } = useContracts()

  const constantsRead = useReadContracts({
    contracts: [
      { ...token, functionName: 'name' },
      { ...token, functionName: 'symbol' },
      { ...token, functionName: 'decimals' },
      { ...token, functionName: 'totalSupply' },
      { ...raffle, functionName: 'currentRoundId' },
      { ...raffle, functionName: 'TICKET_PRICE' },
      { ...raffle, functionName: 'MAX_TICKETS_PER_ROUND' },
      { ...raffle, functionName: 'SALES_DURATION' },
      { ...raffle, functionName: 'REVEAL_DURATION' },
      { ...raffle, functionName: 'token' },
    ],
    query,
  })

  const roundRead = useReadContracts({
    contracts: [{ ...raffle, functionName: 'getRound', args: [roundId] }],
    query,
  })

  const accountRead = useReadContracts({
    contracts: account
      ? [
          { ...token, functionName: 'balanceOf', args: [account] },
          { ...token, functionName: 'allowance', args: [account, raffle.address] },
          { ...raffle, functionName: 'ticketsOf', args: [roundId, account] },
        ]
      : [],
    query: { ...query, enabled: Boolean(account) },
  })

  const ticketIndices = useMemo(
    () => toTicketIndices(value(accountRead.data?.[2])),
    [accountRead.data],
  )

  const ticketsRead = useReadContracts({
    contracts: ticketIndices.map((index) => ({
      ...raffle,
      functionName: 'getTicket',
      args: [roundId, BigInt(index)],
    })),
    query: { ...query, enabled: ticketIndices.length > 0 },
  })

  const refetch = useCallback(() => {
    void constantsRead.refetch()
    void roundRead.refetch()
    void accountRead.refetch()
    void ticketsRead.refetch()
  }, [constantsRead, roundRead, accountRead, ticketsRead])

  const constants = constantsRead.data
  const decimals = Number(value<number | bigint>(constants?.[2]) ?? 18)

  const ownedTickets = useMemo<OwnedTicket[]>(
    () =>
      ticketIndices.map((index, position) => ({
        index,
        ticket: toTicket(value(ticketsRead.data?.[position])),
      })),
    [ticketIndices, ticketsRead.data],
  )

  return {
    token: {
      name: value<string>(constants?.[0]) ?? 'Token',
      symbol: value<string>(constants?.[1]) ?? '…',
      decimals: Number.isFinite(decimals) ? decimals : 18,
      totalSupply: value<bigint>(constants?.[3]),
    },
    constants: {
      currentRoundId: value<bigint>(constants?.[4]),
      ticketPrice: value<bigint>(constants?.[5]),
      maxTickets: value<bigint>(constants?.[6]),
      salesDuration: value<bigint>(constants?.[7]),
      revealDuration: value<bigint>(constants?.[8]),
      tokenAddress: value<`0x${string}`>(constants?.[9]),
    },
    round: toRound(value(roundRead.data?.[0])),
    balance: value<bigint>(accountRead.data?.[0]),
    allowance: value<bigint>(accountRead.data?.[1]),
    ownedTickets,
    isLoading: constantsRead.isLoading || roundRead.isLoading,
    error: (constantsRead.error ?? roundRead.error ?? undefined) as Error | undefined,
    refetch,
  }
}
