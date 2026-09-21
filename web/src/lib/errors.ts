/**
 * Turn wallet and contract failures into a sentence a visitor can act on.
 *
 * The raffle reverts with custom errors; viem surfaces their names once the ABI is attached, so
 * we map the names the contracts actually declare rather than showing raw revert data.
 */
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem'

/** Custom errors declared by CommitRevealRaffle and RaffleToken, in visitor-facing language. */
const CONTRACT_ERRORS: Record<string, string> = {
  // CommitRevealRaffle
  InvalidToken: 'The raffle was pointed at something that is not a token contract.',
  Reentrancy: 'The raffle rejected a re-entrant call.',
  ZeroCommitment: 'The commitment cannot be zero. Generate a new secret and try again.',
  CommitmentAlreadyUsed: 'That commitment was already used in this round. Generate a new secret.',
  SalesClosed: 'Sales for this round have closed. Wait for the next round to open.',
  RoundFull: 'This round has sold its maximum number of tickets.',
  UnknownRound: 'That round has not started yet.',
  UnknownTicket: 'That ticket does not exist in this round.',
  NotRevealPhase: 'Reveals are only accepted between the end of sales and the end of the reveal window.',
  NotTicketOwner: 'Only the wallet that bought a ticket can reveal it.',
  AlreadyRevealed: 'That ticket has already been revealed.',
  CommitmentMismatch: 'That secret does not match the ticket commitment. Check you pasted the right secret.',
  RevealNotFinished: 'The reveal window has not closed yet, so the round cannot be settled.',
  AlreadySettled: 'This round has already been settled.',
  NotSettled: 'This round has not been settled yet.',
  NoWinner: 'Nobody revealed in this round, so there is no winner — the pot rolled into the next round.',
  NotWinner: 'Only the winning ticket holder can claim this pot.',
  AlreadyClaimed: 'This pot has already been claimed.',
  TokenTransferFailed: 'The RAFL transfer failed. Check your balance and the approval you gave the raffle.',
  // RaffleToken
  InvalidReceiver: 'RAFL cannot be sent to the zero address.',
  InsufficientBalance: 'Your RAFL balance is too low for this transfer.',
  InsufficientAllowance: 'The raffle is not approved to spend enough RAFL. Approve first, then retry.',
}

export function isUserRejection(error: unknown): boolean {
  if (error instanceof UserRejectedRequestError) return true
  if (error instanceof BaseError && error.walk((e) => e instanceof UserRejectedRequestError)) return true
  const code = (error as { code?: unknown } | null)?.code
  if (code === 4001) return true
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && /user rejected|user denied|rejected the request/i.test(message)
}

export function describeError(error: unknown): string {
  if (!error) return ''
  if (isUserRejection(error)) return 'You rejected the request in your wallet. Nothing was sent.'

  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name && CONTRACT_ERRORS[name]) return `${CONTRACT_ERRORS[name]} (${name})`
      if (name) return `The contract reverted with ${name}.`
      if (reverted.reason) return `The contract reverted: ${reverted.reason}`
    }
    // Fall back to viem's own short message, which is already written for humans.
    return error.shortMessage || error.message
  }

  const message = error instanceof Error ? error.message : String(error)
  for (const [name, text] of Object.entries(CONTRACT_ERRORS)) {
    if (message.includes(name)) return `${text} (${name})`
  }
  return message
}
