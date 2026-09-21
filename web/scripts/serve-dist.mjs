#!/usr/bin/env node
// Serves the committed export as plain immutable files under a nested path, the way an IPFS
// gateway does (`/ipfs/<cid>/...`). No rewrites, no SPA fallback — if the app needs a server
// rule to boot, it fails here.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { distDir } from './deployment-lib.mjs'

const port = Number(process.env.PORT ?? 8789)
const prefix = process.env.PREFIX ?? '/ipfs/bafyplaceholdercid'

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let rel = decodeURIComponent(url.pathname)
  if (!rel.startsWith(prefix)) {
    res.writeHead(404).end('outside the gateway prefix')
    return
  }
  rel = rel.slice(prefix.length) || '/'
  if (rel === '/' || rel.endsWith('/')) rel += 'index.html'

  const file = path.join(distDir, path.normalize(rel))
  if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' })
  res.end(fs.readFileSync(file))
})

server.listen(port, () => {
  console.log(`serving dist/ at http://localhost:${port}${prefix}/`)
})
