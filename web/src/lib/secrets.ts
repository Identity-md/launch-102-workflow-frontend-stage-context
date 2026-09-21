/**
 * Ticket secrets.
 *
 * A ticket is bought with `commitment = keccak256(secret)` for a 32-byte secret the buyer keeps.
 * The secret never leaves the browser before the reveal window, and losing it means the ticket
 * forfeits its eligibility — so it is generated with the platform CSPRNG, stored in localStorage
 * keyed by chain/raffle/round/ticket, and can be exported to a file or re-imported by hand.
 */
import { keccak256, isHex, type Hex } from 'viem'

export const SECRET_BYTES = 32
const STORAGE_PREFIX = 'raffle.secret.v1'

/** 32 random bytes from the platform CSPRNG. */
export function generateSecret(crypto: Pick<Crypto, 'getRandomValues'> = globalThis.crypto): Hex {
  const bytes = new Uint8Array(SECRET_BYTES)
  crypto.getRandomValues(bytes)
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

export function isSecret(value: string): value is Hex {
  return isHex(value) && value.length === 2 + SECRET_BYTES * 2
}

/** The on-chain commitment for a secret: keccak256(abi.encodePacked(bytes32 secret)). */
export function commitmentFor(secret: Hex): Hex {
  if (!isSecret(secret)) throw new Error('a secret must be exactly 32 bytes of hex')
  return keccak256(secret)
}

/** Accept a pasted secret with or without the 0x prefix and surrounding whitespace. */
export function normaliseSecret(input: string): Hex | undefined {
  const trimmed = input.trim().toLowerCase()
  const candidate = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`
  return isSecret(candidate) ? (candidate as Hex) : undefined
}

export interface SecretKey {
  chainId: number
  raffle: string
  roundId: bigint | number
}

function keyPrefix({ chainId, raffle, roundId }: SecretKey): string {
  return `${STORAGE_PREFIX}:${chainId}:${raffle.toLowerCase()}:${roundId.toString()}`
}

/** A secret saved before the ticket index is known, addressed by its commitment. */
function pendingKey(key: SecretKey, commitment: Hex): string {
  return `${keyPrefix(key)}:commitment:${commitment.toLowerCase()}`
}

function ticketKey(key: SecretKey, ticketIndex: bigint | number): string {
  return `${keyPrefix(key)}:ticket:${ticketIndex.toString()}`
}

export interface SecretVault {
  rememberPending(key: SecretKey, secret: Hex): void
  /** Look a secret up by ticket index, falling back to the commitment recorded at purchase. */
  lookup(key: SecretKey, ticketIndex: bigint | number, commitment: Hex | undefined): Hex | undefined
  /** Bind a known secret to its ticket index once the purchase is confirmed on chain. */
  bind(key: SecretKey, ticketIndex: bigint | number, secret: Hex): void
  exportAll(key: SecretKey): Array<{ label: string; secret: Hex }>
}

function safeStorage(): Storage | undefined {
  try {
    const probe = '__raffle_probe__'
    globalThis.localStorage.setItem(probe, '1')
    globalThis.localStorage.removeItem(probe)
    return globalThis.localStorage
  } catch {
    // Private browsing, disabled storage, or a non-browser test environment.
    return undefined
  }
}

/**
 * localStorage-backed vault with an in-memory fallback, so a browser that blocks storage still
 * works for the length of the session instead of losing the secret outright.
 */
export function createSecretVault(storage: Storage | undefined = safeStorage()): SecretVault {
  const memory = new Map<string, string>()
  const read = (k: string) => storage?.getItem(k) ?? memory.get(k) ?? null
  const write = (k: string, v: string) => {
    memory.set(k, v)
    try {
      storage?.setItem(k, v)
    } catch {
      // Quota or permission failure: the in-memory copy still covers this session.
    }
  }

  return {
    rememberPending(key, secret) {
      write(pendingKey(key, commitmentFor(secret)), secret)
    },
    lookup(key, ticketIndex, commitment) {
      const direct = read(ticketKey(key, ticketIndex))
      if (direct && isSecret(direct)) return direct
      if (commitment) {
        const byCommitment = read(pendingKey(key, commitment))
        if (byCommitment && isSecret(byCommitment)) {
          write(ticketKey(key, ticketIndex), byCommitment)
          return byCommitment
        }
      }
      return undefined
    },
    bind(key, ticketIndex, secret) {
      write(ticketKey(key, ticketIndex), secret)
      write(pendingKey(key, commitmentFor(secret)), secret)
    },
    exportAll(key) {
      const prefix = `${keyPrefix(key)}:ticket:`
      const out: Array<{ label: string; secret: Hex }> = []
      const seen = new Set<string>()
      const collect = (k: string) => {
        if (!k.startsWith(prefix) || seen.has(k)) return
        seen.add(k)
        const secret = read(k)
        if (secret && isSecret(secret)) out.push({ label: `ticket ${k.slice(prefix.length)}`, secret })
      }
      for (let i = 0; i < (storage?.length ?? 0); i += 1) {
        const k = storage?.key(i)
        if (k) collect(k)
      }
      for (const k of memory.keys()) collect(k)
      return out.sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }))
    },
  }
}
