#!/usr/bin/env node
// Independent re-check of the committed export. Recomputes every declared SHA-256 from the
// files on disk, re-derives the ABI hashes, and compares the manifest against the handoff.
// Exits non-zero on the first disagreement so it can be used as a gate.

import fs from 'node:fs'
import path from 'node:path'
import {
  assertRelativeExportPath,
  canonicalAbiHash,
  distDir,
  listFiles,
  MANIFEST_NAME,
  MAX_ASSET_BYTES,
  MAX_ASSETS,
  readHandoff,
  repoRoot,
  sha256Hex,
} from './deployment-lib.mjs'

const problems = []
const check = (ok, message) => {
  if (!ok) problems.push(message)
  return ok
}

const handoff = readHandoff()
const manifestPath = path.join(distDir, MANIFEST_NAME)
if (!fs.existsSync(manifestPath)) {
  console.error(`missing ${path.relative(repoRoot, manifestPath)}`)
  process.exit(1)
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

check(manifest.version === 1, `version: expected 1, got ${manifest.version}`)
for (const field of ['launchId', 'chainId', 'sourceCommit', 'attestationHash']) {
  check(
    manifest[field] === handoff[field],
    `${field}: manifest ${JSON.stringify(manifest[field])} != handoff ${JSON.stringify(handoff[field])}`,
  )
}

check(
  manifest.contracts.length === handoff.contracts.length,
  `contracts: manifest has ${manifest.contracts.length}, handoff has ${handoff.contracts.length}`,
)
for (const expected of handoff.contracts) {
  const actual = manifest.contracts.find((c) => c.name === expected.name)
  if (!check(Boolean(actual), `contracts: ${expected.name} missing from manifest`)) continue
  check(actual.address === expected.address, `${expected.name}: address ${actual.address} != ${expected.address}`)
  check(actual.abiHash === expected.abiHash, `${expected.name}: abiHash ${actual.abiHash} != ${expected.abiHash}`)
  check(actual.abiPath === expected.abiPath, `${expected.name}: abiPath ${actual.abiPath} != ${expected.abiPath}`)

  const abiFile = path.join(distDir, actual.abiPath)
  if (!check(fs.existsSync(abiFile), `${expected.name}: ${actual.abiPath} not present in the export`)) continue
  const exported = JSON.parse(fs.readFileSync(abiFile, 'utf8'))
  check(Array.isArray(exported), `${expected.name}: exported ABI is not a JSON array`)
  check(
    canonicalAbiHash(exported) === expected.abiHash,
    `${expected.name}: exported ABI hashes to ${canonicalAbiHash(exported)}, handoff says ${expected.abiHash}`,
  )

  const sourceAbi = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs', 'abi', `${expected.name}.json`), 'utf8'))
  check(
    JSON.stringify(sourceAbi) === JSON.stringify(exported),
    `${expected.name}: exported ABI differs from docs/abi/${expected.name}.json`,
  )
}

check(manifest.assets.length <= MAX_ASSETS, `assets: ${manifest.assets.length} declared, limit is ${MAX_ASSETS}`)
check(
  manifest.assets.some((a) => a.path === 'index.html'),
  'assets: index.html is not declared',
)
check(
  !manifest.assets.some((a) => a.path === MANIFEST_NAME),
  `assets: ${MANIFEST_NAME} must not declare itself`,
)

const declared = new Map()
for (const asset of manifest.assets) {
  try {
    assertRelativeExportPath(asset.path, `asset path ${JSON.stringify(asset.path)}`)
  } catch (error) {
    problems.push(error.message)
    continue
  }
  check(/^[0-9a-f]{64}$/.test(asset.sha256), `${asset.path}: sha256 must be 64 lowercase hex characters`)
  check(!declared.has(asset.path), `${asset.path}: declared more than once`)
  declared.set(asset.path, asset.sha256)

  const file = path.join(distDir, asset.path)
  if (!check(fs.existsSync(file), `${asset.path}: declared but not present in the export`)) continue
  const bytes = fs.readFileSync(file)
  check(bytes.length <= MAX_ASSET_BYTES, `${asset.path}: ${bytes.length} bytes exceeds the per-file limit`)
  check(sha256Hex(bytes) === asset.sha256, `${asset.path}: sha256 ${sha256Hex(bytes)} != declared ${asset.sha256}`)
}

for (const rel of listFiles(distDir)) {
  if (rel === MANIFEST_NAME) continue
  check(declared.has(rel), `${rel}: exported but not declared in ${MANIFEST_NAME}`)
}

const totalBytes = listFiles(distDir).reduce((sum, rel) => sum + fs.statSync(path.join(distDir, rel)).size, 0)

if (problems.length > 0) {
  console.error(`FAIL — ${problems.length} problem(s):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log('OK  manifest matches the handoff and every declared hash matches the exported bytes')
console.log(`    launchId        ${manifest.launchId}`)
console.log(`    chainId         ${manifest.chainId}`)
console.log(`    sourceCommit    ${manifest.sourceCommit}`)
console.log(`    attestationHash ${manifest.attestationHash}`)
console.log(`    contracts       ${manifest.contracts.map((c) => `${c.name}@${c.address}`).join(', ')}`)
console.log(`    assets          ${manifest.assets.length} files, ${(totalBytes / 1024).toFixed(1)} KiB including the manifest`)
