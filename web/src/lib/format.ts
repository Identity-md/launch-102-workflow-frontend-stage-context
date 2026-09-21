import { formatUnits, parseUnits } from 'viem'

/** Format a token amount using that token's own decimals, grouped and trimmed for reading. */
export function formatAmount(value: bigint | undefined, decimals: number, maxFractionDigits = 4): string {
  if (value === undefined) return '—'
  const exact = formatUnits(value, decimals)
  const [whole = '0', fraction = ''] = exact.split('.')
  const grouped = BigInt(whole).toLocaleString('en-US')
  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, '')
  return trimmed ? `${grouped}.${trimmed}` : grouped
}

export function formatToken(value: bigint | undefined, decimals: number, symbol: string): string {
  return `${formatAmount(value, decimals)} ${symbol}`
}

/** Parse user input in whole token units. Returns undefined for anything unusable. */
export function parseAmount(input: string, decimals: number): bigint | undefined {
  const trimmed = input.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined
  const [, fraction = ''] = trimmed.split('.')
  if (fraction.length > decimals) return undefined
  try {
    return parseUnits(trimmed, decimals)
  } catch {
    return undefined
  }
}

export function shortAddress(address: string | undefined): string {
  if (!address) return '—'
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function shortHex(value: string | undefined, lead = 10, tail = 8): string {
  if (!value) return '—'
  return value.length <= lead + tail + 1 ? value : `${value.slice(0, lead)}…${value.slice(-tail)}`
}

/** A UTC timestamp, so two people reading the same round agree on when it closes. */
export function formatTimestamp(seconds: bigint | number | undefined): string {
  if (seconds === undefined) return '—'
  const value = Number(seconds)
  if (!Number.isFinite(value) || value === 0) return '—'
  return `${new Date(value * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC`
}

/** "2d 03h 14m" style countdown; negative and zero both render as "ended". */
export function formatCountdown(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return 'ended'
  const days = Math.floor(secondsRemaining / 86_400)
  const hours = Math.floor((secondsRemaining % 86_400) / 3600)
  const minutes = Math.floor((secondsRemaining % 3600) / 60)
  const seconds = Math.floor(secondsRemaining % 60)
  if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}
