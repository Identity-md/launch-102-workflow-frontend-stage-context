/**
 * Runtime deployment configuration.
 *
 * `dist/imd-deployment.json` is produced by `web/scripts/emit-deployment.mjs` from the validated
 * workflow handoff and is the app's only source of addresses, chain id and ABI locations. It is
 * fetched relative to the document, so the export works unchanged from `/`, from an IPFS gateway
 * subpath (`/ipfs/<cid>/`) or from an ENS name, with no server rewrites.
 */
import type { Abi } from 'viem'
import { DEPLOYMENT_CONFIG_FILE } from './config'

export interface DeploymentContract {
  name: string
  address: `0x${string}`
  abiHash: string
  abiPath: string
}

export interface DeploymentAsset {
  path: string
  sha256: string
}

export interface DeploymentConfig {
  version: 1
  launchId: string
  chainId: number
  sourceCommit: string
  attestationHash: string
  contracts: DeploymentContract[]
  assets: DeploymentAsset[]
}

export interface Deployment {
  config: DeploymentConfig
  /** ABI JSON loaded from `contracts[].abiPath`, keyed by contract name. */
  abis: Record<string, Abi>
  /** Absolute URL the configuration was loaded from, for display. */
  url: string
}

const HEX64 = /^[0-9a-f]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

function fail(message: string): never {
  throw new Error(`${DEPLOYMENT_CONFIG_FILE}: ${message}`)
}

/** Reject URLs, absolute paths and parent traversal; asset paths are relative to the export root. */
export function isSafeExportPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value.includes('\\')) return false
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) || value.startsWith('//') || value.startsWith('/')) return false
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

export function parseDeploymentConfig(value: unknown): DeploymentConfig {
  if (typeof value !== 'object' || value === null) fail('expected a JSON object')
  const raw = value as Record<string, unknown>

  if (raw.version !== 1) fail(`unsupported version ${String(raw.version)}`)
  for (const field of ['launchId', 'sourceCommit'] as const) {
    if (typeof raw[field] !== 'string' || raw[field] === '') fail(`missing ${field}`)
  }
  if (typeof raw.chainId !== 'number' || !Number.isInteger(raw.chainId)) fail('chainId must be an integer')
  if (typeof raw.attestationHash !== 'string' || !HEX64.test(raw.attestationHash)) {
    fail('attestationHash must be 64 lowercase hex characters')
  }
  if (!Array.isArray(raw.contracts) || raw.contracts.length === 0) fail('contracts must be a non-empty array')
  if (!Array.isArray(raw.assets)) fail('assets must be an array')

  const contracts = raw.contracts.map((entry, index): DeploymentContract => {
    const c = entry as Record<string, unknown>
    if (typeof c.name !== 'string' || c.name === '') fail(`contracts[${index}].name is missing`)
    if (typeof c.address !== 'string' || !ADDRESS.test(c.address)) fail(`contracts[${index}].address is not an address`)
    if (typeof c.abiHash !== 'string' || !HEX64.test(c.abiHash)) fail(`contracts[${index}].abiHash is malformed`)
    if (!isSafeExportPath(c.abiPath)) fail(`contracts[${index}].abiPath must be a relative export path`)
    return { name: c.name, address: c.address as `0x${string}`, abiHash: c.abiHash, abiPath: c.abiPath }
  })

  const assets = raw.assets.map((entry, index): DeploymentAsset => {
    const a = entry as Record<string, unknown>
    if (!isSafeExportPath(a.path)) fail(`assets[${index}].path must be a relative export path`)
    if (typeof a.sha256 !== 'string' || !HEX64.test(a.sha256)) fail(`assets[${index}].sha256 is malformed`)
    return { path: a.path, sha256: a.sha256 }
  })

  return {
    version: 1,
    launchId: raw.launchId as string,
    chainId: raw.chainId,
    sourceCommit: raw.sourceCommit as string,
    attestationHash: raw.attestationHash,
    contracts,
    assets,
  }
}

async function fetchJson(url: URL, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-cache', ...(signal ? { signal } : {}) })
  if (!response.ok) throw new Error(`${url.pathname}: HTTP ${response.status} ${response.statusText}`)
  return (await response.json()) as unknown
}

/** Where the app looks for its deployment configuration: next to the loaded document. */
export function deploymentConfigUrl(baseUri: string = document.baseURI): URL {
  return new URL(DEPLOYMENT_CONFIG_FILE, baseUri)
}

/**
 * Load the deployment configuration and every ABI it references. Any failure is fatal: without a
 * verified address/ABI pair the app must not offer transactions at all.
 */
export async function loadDeployment(options: { baseUri?: string; signal?: AbortSignal } = {}): Promise<Deployment> {
  const url = deploymentConfigUrl(options.baseUri ?? document.baseURI)
  const config = parseDeploymentConfig(await fetchJson(url, options.signal))

  const abis: Record<string, Abi> = {}
  for (const contract of config.contracts) {
    const abi = await fetchJson(new URL(contract.abiPath, url), options.signal)
    if (!Array.isArray(abi)) throw new Error(`${contract.abiPath}: expected a JSON array ABI`)
    abis[contract.name] = abi as Abi
  }

  return { config, abis, url: url.href }
}

export function contractByName(deployment: Deployment, name: string): { address: `0x${string}`; abi: Abi } {
  const contract = deployment.config.contracts.find((c) => c.name === name)
  if (!contract) throw new Error(`${DEPLOYMENT_CONFIG_FILE} does not declare a contract named ${name}`)
  const abi = deployment.abis[contract.name]
  if (!abi) throw new Error(`ABI for ${name} was not loaded`)
  return { address: contract.address, abi }
}
