import { chainSettings, explorerAddressUrl } from '../config'
import { useDeployment } from '../hooks/useDeployment'
import { shortHex } from '../lib/format'
import { ExternalLink, Field, Fields, Mono, Panel } from './ui'

/**
 * What this page is bound to. Everything shown here was read out of the runtime deployment
 * configuration, so a visitor can check the addresses against the published handoff themselves.
 */
export function DeploymentPanel({ tokenAddressOnChain }: { tokenAddressOnChain: `0x${string}` | undefined }) {
  const { config, url } = useDeployment()
  const settings = chainSettings(config.chainId)

  const configuredToken = config.contracts.find((c) => c.name === 'RaffleToken')?.address
  const tokenMismatch =
    tokenAddressOnChain !== undefined &&
    configuredToken !== undefined &&
    tokenAddressOnChain.toLowerCase() !== configuredToken.toLowerCase()

  return (
    <Panel
      title="Deployment"
      subtitle={
        <>
          Loaded at runtime from <Mono>{url.split('/').pop()}</Mono> — addresses, chain and ABIs all come from that
          one file.
        </>
      }
    >
      <Fields>
        <Field label="Chain">
          {settings ? `${settings.chain.name} (${config.chainId})` : `Chain ${config.chainId}`}
        </Field>
        <Field label="Launch id">
          <Mono title={config.launchId}>{config.launchId}</Mono>
        </Field>
        <Field label="Source commit">
          <Mono title={config.sourceCommit}>{shortHex(config.sourceCommit, 12, 8)}</Mono>
        </Field>
        <Field label="Attestation">
          <Mono title={config.attestationHash}>{shortHex(config.attestationHash, 12, 8)}</Mono>
        </Field>
      </Fields>

      <table className="table">
        <thead>
          <tr>
            <th scope="col">Contract</th>
            <th scope="col">Address</th>
            <th scope="col">ABI keccak</th>
          </tr>
        </thead>
        <tbody>
          {config.contracts.map((contract) => (
            <tr key={contract.name}>
              <th scope="row">{contract.name}</th>
              <td>
                <ExternalLink href={explorerAddressUrl(config.chainId, contract.address)}>
                  <Mono title={contract.address}>{contract.address}</Mono>
                </ExternalLink>
              </td>
              <td>
                <Mono title={`${contract.abiHash} — loaded from ${contract.abiPath}`}>
                  {shortHex(contract.abiHash, 10, 6)}
                </Mono>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {tokenMismatch ? (
        <p className="warn-text" role="alert">
          The raffle contract reports its token as <Mono>{tokenAddressOnChain}</Mono>, which is not the RaffleToken
          address in the deployment configuration. Do not send transactions.
        </p>
      ) : null}
    </Panel>
  )
}
