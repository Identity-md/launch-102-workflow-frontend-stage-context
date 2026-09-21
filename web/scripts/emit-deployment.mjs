#!/usr/bin/env node
// Post-build step: copy the verified ABIs into the export, then write dist/imd-deployment.json
// describing the final bytes. Run after every `vite build`; the manifest hashes the export it
// sits next to, so it must be regenerated whenever any exported file changes.

import fs from 'node:fs'
import path from 'node:path'
import {
  buildManifest,
  distDir,
  loadVerifiedAbis,
  MANIFEST_NAME,
  readHandoff,
  repoRoot,
  serialiseManifest,
} from './deployment-lib.mjs'

const handoff = readHandoff()
const abis = loadVerifiedAbis(handoff)

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  throw new Error(`no export found at ${path.relative(repoRoot, distDir)} — run "vite build" first`)
}

for (const { contract, bytes } of abis) {
  const target = path.join(distDir, contract.abiPath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, bytes)
  console.log(`abi   ${contract.abiPath} (${bytes.length} bytes, keccak ${contract.abiHash})`)
}

const manifest = buildManifest({ handoff, abis })
fs.writeFileSync(path.join(distDir, MANIFEST_NAME), serialiseManifest(manifest))

const total = manifest.assets.reduce(
  (sum, a) => sum + fs.statSync(path.join(distDir, a.path)).size,
  0,
)
console.log(
  `wrote ${MANIFEST_NAME}: ${manifest.assets.length} assets, ${(total / 1024).toFixed(1)} KiB total`,
)
