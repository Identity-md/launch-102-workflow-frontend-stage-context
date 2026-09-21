import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccount, useChainId, useConnectors } from 'wagmi'
import { BuyPanel } from './components/BuyPanel'
import { ConnectionNotice } from './components/ConnectionNotice'
import { DeploymentPanel } from './components/DeploymentPanel'
import { RoundPanel } from './components/RoundPanel'
import { SettlePanel } from './components/SettlePanel'
import { TicketsPanel } from './components/TicketsPanel'
import { TokenPanel } from './components/TokenPanel'
import { TxStatus } from './components/TxStatus'
import { Notice } from './components/ui'
import { APP_DESCRIPTION, APP_NAME, chainSettings } from './config'
import { useAction } from './hooks/useAction'
import { useContracts, useDeployment } from './hooks/useDeployment'
import { useNow } from './hooks/useNow'
import { useRaffleState } from './hooks/useRaffleState'
import { createSecretVault } from './lib/secrets'

export function App() {
  const deployment = useDeployment()
  const { token, raffle } = useContracts()
  const expectedChainId = deployment.config.chainId
  const settings = chainSettings(expectedChainId)

  const { address, isConnected } = useAccount()
  const walletChainId = useChainId()
  const connectors = useConnectors()
  const now = useNow()

  const [roundId, setRoundId] = useState<bigint>(1n)
  const [followCurrent, setFollowCurrent] = useState(true)

  const state = useRaffleState(roundId, address)
  const action = useAction(useCallback(() => state.refetch(), [state]))
  const vault = useMemo(() => createSecretVault(), [])

  // Track the live round until the visitor navigates to a specific one.
  const currentRoundId = state.constants.currentRoundId
  useEffect(() => {
    if (followCurrent && currentRoundId !== undefined && currentRoundId !== roundId) setRoundId(currentRoundId)
  }, [followCurrent, currentRoundId, roundId])

  const selectRound = useCallback(
    (id: bigint) => {
      setFollowCurrent(currentRoundId !== undefined && id === currentRoundId)
      setRoundId(id < 1n ? 1n : id)
    },
    [currentRoundId],
  )

  const onRightChain = walletChainId === expectedChainId
  const canTransact = isConnected && onRightChain
  const hasInjectedWallet = connectors.some((connector) => connector.type === 'injected' && connector.id !== 'mock')

  return (
    <div className="page">
      <header className="masthead">
        <div>
          <h1>{APP_NAME}</h1>
          <p>{APP_DESCRIPTION} on {settings?.chain.name ?? `chain ${expectedChainId}`}.</p>
        </div>
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
      </header>

      <div className="tx-bar">
        <TxStatus action={action} chainId={expectedChainId} />
      </div>

      <ConnectionNotice
        state={{ hasInjectedWallet, isConnected, chainId: walletChainId, expectedChainId }}
      />

      <p className="intro">
        Each round sells tickets for {state.token.symbol}. You buy with a commitment to a secret only you know; after
        sales close everyone reveals, the revealed secrets together pick the winning ticket, and the winner takes the
        pot. A ticket that is never revealed forfeits its eligibility.
      </p>

      <RoundPanel
        state={state}
        roundId={roundId}
        setRoundId={selectRound}
        now={now}
        chainId={expectedChainId}
        account={address}
      />

      <BuyPanel
        state={state}
        roundId={roundId}
        now={now}
        chainId={expectedChainId}
        canTransact={canTransact}
        token={token}
        raffle={raffle}
        vault={vault}
        action={action}
      />

      <TicketsPanel
        state={state}
        roundId={roundId}
        now={now}
        chainId={expectedChainId}
        canTransact={canTransact}
        raffle={raffle}
        vault={vault}
        action={action}
        account={address}
      />

      <SettlePanel
        state={state}
        roundId={roundId}
        now={now}
        canTransact={canTransact}
        raffle={raffle}
        action={action}
        account={address}
      />

      <TokenPanel
        state={state}
        chainId={expectedChainId}
        canTransact={canTransact}
        token={token}
        raffle={raffle}
        action={action}
        account={address}
      />

      <DeploymentPanel tokenAddressOnChain={state.constants.tokenAddress} />

      <footer className="footer">
        <Notice tone="warn" title="Commit-reveal is not unbiasable">
          The last wallet to reveal can see whether revealing wins and may withhold instead, forfeiting its own ticket
          to change the outcome. Treat this as a toy raffle, not a lottery.
        </Notice>
        <p className="muted">
          Reads come from public {settings?.chain.name ?? 'network'} RPC endpoints compiled into this page; signing
          always happens in your own wallet. Nothing on this page holds a key.
          {settings?.faucetUrl ? (
            <>
              {' '}
              Need test ETH for gas? Try a <a href={settings.faucetUrl} target="_blank" rel="noreferrer noopener">Sepolia faucet</a>.
            </>
          ) : null}
        </p>
      </footer>
    </div>
  )
}
