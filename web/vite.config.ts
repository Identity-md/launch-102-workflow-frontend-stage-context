import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

import {
  buildManifest,
  loadVerifiedAbis,
  MANIFEST_NAME,
  readHandoff,
  serialiseManifest,
} from './scripts/deployment-lib.mjs'

/**
 * In `vite dev` there is no export directory to hash, so serve the deployment configuration and
 * the verified ABIs from memory at exactly the URLs the built app will fetch. The asset list is
 * empty in dev; `scripts/emit-deployment.mjs` produces the real one after `vite build`.
 */
function devDeploymentConfig(): Plugin {
  return {
    name: 'imd-dev-deployment-config',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/^\/+/, '')
        try {
          const handoff = readHandoff()
          const abis = loadVerifiedAbis(handoff)
          if (pathname === MANIFEST_NAME) {
            const manifest = { ...buildManifest({ handoff, abis, exportDir: null }), assets: [] }
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(serialiseManifest(manifest))
            return
          }
          const abi = abis.find((entry) => entry.contract.abiPath === pathname)
          if (abi) {
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(abi.bytes)
            return
          }
        } catch (error) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: (error as Error).message }))
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  // Relative base: the export must load from an IPFS subpath or an ENS name with no rewrites.
  base: './',
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), devDeploymentConfig()],
  build: {
    outDir: fileURLToPath(new URL('../dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    // Bundle every static asset locally; nothing may be fetched from a third-party origin.
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
})
