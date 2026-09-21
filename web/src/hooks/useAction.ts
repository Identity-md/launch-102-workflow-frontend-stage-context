/**
 * One transaction at a time, with a status a visitor can read.
 *
 * Every write goes through here so the UI reports the same five states everywhere: idle, waiting
 * for the wallet to sign, waiting for the chain to confirm, confirmed, or failed (including a
 * plain "you rejected it" for the common case).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Abi, Hex } from 'viem'
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { describeError, isUserRejection } from '../lib/errors'

export type ActionStatus = 'idle' | 'signing' | 'confirming' | 'confirmed' | 'error'

export interface ActionRequest {
  address: `0x${string}`
  abi: Abi
  functionName: string
  args: readonly unknown[]
  /** Shown while the action runs, e.g. "Buying ticket". */
  label: string
}

export interface Action {
  status: ActionStatus
  /** Which action is in flight, so only the button that started it shows a spinner. */
  pendingLabel: string | undefined
  hash: Hex | undefined
  errorMessage: string | undefined
  rejected: boolean
  busy: boolean
  run: (request: ActionRequest) => void
  reset: () => void
}

export function useAction(onConfirmed?: () => void): Action {
  const { writeContract, data: hash, error: writeError, isPending: signing, reset: resetWrite } = useWriteContract()
  const [label, setLabel] = useState<string | undefined>()
  const [dismissedHash, setDismissedHash] = useState<Hex | undefined>()

  const receipt = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } })

  const confirmedRef = useRef<Hex | undefined>(undefined)
  useEffect(() => {
    if (receipt.isSuccess && hash && confirmedRef.current !== hash) {
      confirmedRef.current = hash
      onConfirmed?.()
    }
  }, [receipt.isSuccess, hash, onConfirmed])

  const run = useCallback(
    (request: ActionRequest) => {
      setLabel(request.label)
      setDismissedHash(undefined)
      writeContract({
        address: request.address,
        abi: request.abi,
        functionName: request.functionName,
        args: request.args as never,
      })
    },
    [writeContract],
  )

  const reset = useCallback(() => {
    setLabel(undefined)
    setDismissedHash(hash)
    resetWrite()
  }, [hash, resetWrite])

  const error = writeError ?? receipt.error
  const visibleHash = hash && hash !== dismissedHash ? hash : undefined

  let status: ActionStatus = 'idle'
  if (signing) status = 'signing'
  else if (error) status = 'error'
  else if (visibleHash && receipt.isSuccess) status = 'confirmed'
  else if (visibleHash) status = 'confirming'

  return {
    status,
    pendingLabel: status === 'idle' ? undefined : label,
    hash: visibleHash,
    errorMessage: error ? describeError(error) : undefined,
    rejected: Boolean(error) && isUserRejection(error),
    busy: status === 'signing' || status === 'confirming',
    run,
    reset,
  }
}
