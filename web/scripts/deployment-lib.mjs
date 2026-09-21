// Shared helpers for producing and checking `dist/imd-deployment.json`.
//
// The workflow handoff (web/deployment/handoff.json) is the only place deployment identifiers
// and addresses are written down. ABIs are taken from the repository's implementation-derived
// export at docs/abi/<Contract>.json and re-checked against the handoff `abiHash` before they
// are copied into the export, so the frontend can never ship an ABI the handoff did not attest.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { keccak256, toBytes } from 'viem'

const here = path.dirname(fileURLToPath(import.meta.url))

export const webRoot = path.resolve(here, '..')
export const repoRoot = path.resolve(webRoot, '..')
export const distDir = path.join(repoRoot, 'dist')
export const abiSourceDir = path.join(repoRoot, 'docs', 'abi')
export const handoffPath = path.join(webRoot, 'deployment', 'handoff.json')

export const MANIFEST_NAME = 'imd-deployment.json'
export const MAX_ASSETS = 128
export const MAX_ASSET_BYTES = 8 * 1024 * 1024

const HEX64 = /^[0-9a-f]{64}$/

/** Recursively sort object keys so a JSON value has one canonical serialisation. */
function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = canonicalise(value[key])
    return out
  }
  return value
}

/** The hash the handoff attests: keccak256 of the compact, key-sorted ABI JSON. */
export function canonicalAbiHash(abi) {
  return keccak256(toBytes(JSON.stringify(canonicalise(abi)))).slice(2)
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function readHandoff() {
  const handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf8'))
  if (handoff.version !== 1) throw new Error(`handoff.json: unsupported version ${handoff.version}`)
  for (const field of ['launchId', 'sourceCommit']) {
    if (typeof handoff[field] !== 'string' || handoff[field].length === 0) {
      throw new Error(`handoff.json: missing ${field}`)
    }
  }
  if (!Number.isInteger(handoff.chainId)) throw new Error('handoff.json: chainId must be an integer')
  if (!HEX64.test(handoff.attestationHash)) {
    throw new Error('handoff.json: attestationHash must be 64 lowercase hex characters')
  }
  if (!Array.isArray(handoff.contracts) || handoff.contracts.length === 0) {
    throw new Error('handoff.json: contracts must be a non-empty array')
  }
  for (const contract of handoff.contracts) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(contract.address)) {
      throw new Error(`handoff.json: ${contract.name} has an invalid address`)
    }
    if (!HEX64.test(contract.abiHash)) {
      throw new Error(`handoff.json: ${contract.name} abiHash must be 64 lowercase hex characters`)
    }
    assertRelativeExportPath(contract.abiPath, `${contract.name} abiPath`)
  }
  return handoff
}

/** Export paths are resolved against dist/; reject URLs, absolute paths and parent traversal. */
export function assertRelativeExportPath(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}: must be a non-empty string`)
  if (value !== value.replaceAll('\\', '/')) throw new Error(`${label}: must use forward slashes`)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) || value.startsWith('//')) throw new Error(`${label}: must not be a URL`)
  if (value.startsWith('/')) throw new Error(`${label}: must be relative to dist/`)
  const segments = value.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error(`${label}: must not contain empty or traversal segments`)
  }
}

/**
 * Read docs/abi/<Contract>.json for every handoff contract and verify its canonical keccak hash.
 * Returns the exact bytes to write into the export, pretty-printed for readability.
 */
export function loadVerifiedAbis(handoff) {
  return handoff.contracts.map((contract) => {
    const sourcePath = path.join(abiSourceDir, `${contract.name}.json`)
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`missing implementation-derived ABI: ${path.relative(repoRoot, sourcePath)}`)
    }
    const abi = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
    if (!Array.isArray(abi)) throw new Error(`${contract.name}: ABI export must be a JSON array`)
    const actual = canonicalAbiHash(abi)
    if (actual !== contract.abiHash) {
      throw new Error(
        `${contract.name}: ABI hash mismatch\n  handoff: ${contract.abiHash}\n  docs/abi: ${actual}`,
      )
    }
    return { contract, abi, bytes: Buffer.from(`${JSON.stringify(abi, null, 2)}\n`, 'utf8') }
  })
}

/** Every file under `dir`, as forward-slash paths relative to it, sorted. */
export function listFiles(dir, prefix = '') {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel))
    else out.push(rel)
  }
  return out.sort()
}

/**
 * Build the manifest object for an already-written export directory.
 * The manifest excludes itself; everything else exported is declared with its SHA-256.
 * Pass `exportDir: null` (dev server) to produce the same document with an empty asset list.
 */
export function buildManifest({ handoff, abis, exportDir = distDir }) {
  if (exportDir === null) {
    return { ...buildManifestHeader(handoff), assets: [] }
  }
  const assets = []
  for (const rel of listFiles(exportDir)) {
    if (rel === MANIFEST_NAME) continue
    assertRelativeExportPath(rel, `asset ${rel}`)
    const bytes = fs.readFileSync(path.join(exportDir, rel))
    if (bytes.length > MAX_ASSET_BYTES) {
      throw new Error(`asset ${rel} is ${bytes.length} bytes, over the ${MAX_ASSET_BYTES} byte limit`)
    }
    assets.push({ path: rel, sha256: sha256Hex(bytes) })
  }

  if (!assets.some((a) => a.path === 'index.html')) throw new Error('export is missing index.html')
  for (const { contract } of abis) {
    if (!assets.some((a) => a.path === contract.abiPath)) {
      throw new Error(`export is missing ${contract.abiPath}`)
    }
  }
  if (assets.length > MAX_ASSETS) {
    throw new Error(`export declares ${assets.length} assets, over the ${MAX_ASSETS} limit`)
  }

  return { ...buildManifestHeader(handoff), assets }
}

function buildManifestHeader(handoff) {
  return {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts: handoff.contracts.map((c) => ({
      name: c.name,
      address: c.address,
      abiHash: c.abiHash,
      abiPath: c.abiPath,
    })),
  }
}

export function serialiseManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}
