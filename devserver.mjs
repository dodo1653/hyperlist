// Local stand-in for Vercel: serves the page and the /api routes (relay proxy, image proxy, config).
// node devserver.mjs   ->  http://127.0.0.1:8805
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(fileURLToPath(import.meta.url))
const RELAY = process.env.RELAY || 'http://127.0.0.1:8798'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' }
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  try {
    if (u.pathname === '/api/r') {
      const p = u.searchParams.get('path'); u.searchParams.delete('path')
      const chunks = []; for await (const c of req) chunks.push(c)
      const r = await fetch(`${RELAY}/v1/${p}${req.method === 'GET' ? '?' + u.searchParams : ''}`, { method: req.method, headers: { 'content-type': 'application/json' }, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined })
      res.writeHead(r.status, { 'content-type': 'application/json' }); return res.end(Buffer.from(await r.arrayBuffer()))
    }
    if (/^\/(m|i)\/[a-f0-9]{24}/.test(u.pathname)) { const r = await fetch(RELAY + u.pathname); res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' }); return res.end(Buffer.from(await r.arrayBuffer())) }
    if (u.pathname === '/api/img') {
      const r = await fetch(u.searchParams.get('u'), { headers: { 'user-agent': 'Mozilla/5.0' } })
      res.writeHead(r.ok ? 200 : 404, { 'content-type': r.headers.get('content-type') || 'image/png', 'cache-control': 'max-age=3600' }); return res.end(Buffer.from(await r.arrayBuffer()))
    }
    if (u.pathname === '/api/config') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ clientId: process.env.DISCORD_CLIENT_ID || '' })) }
    let f = path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname))
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found') }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res)
  } catch (e) { res.writeHead(502); res.end(String(e)) }
}).listen(8805, '127.0.0.1', () => console.log('vccall dev site on http://127.0.0.1:8805'))
