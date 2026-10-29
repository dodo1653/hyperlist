// The page's door to the relay: live state and coin pages are cached a moment; binds pass straight through.
import { RELAY_BASE } from './_relay.js'
export const config = { runtime: 'edge' }
const GETS = { state: 3, coin: 10, bindmsg: 60 }
const J = { 'content-type': 'application/json' }
export default async function handler(req) {
  const u = new URL(req.url), path = u.searchParams.get('path')
  if (req.method === 'POST' && path === 'bind') {
    const r = await fetch(`${RELAY_BASE}/v1/bind`, { method: 'POST', headers: J, body: await req.text() }).catch(() => null)
    if (!r) return new Response('{"error":"the relay is offline, try again in a minute"}', { status: 502, headers: J })
    return new Response(r.body, { status: r.status, headers: { ...J, 'cache-control': 'no-store' } })
  }
  if (req.method === 'GET' && GETS[path]) {
    u.searchParams.delete('path')
    const r = await fetch(`${RELAY_BASE}/v1/${path}?${u.searchParams}`, { cache: 'no-store' }).catch(() => null)
    if (!r) return new Response('{"error":"relay offline"}', { status: 502, headers: { ...J, 'cache-control': 'no-store' } })
    return new Response(r.body, { status: r.status, headers: { ...J, 'cache-control': r.ok ? `public, s-maxage=${GETS[path]}, stale-while-revalidate=10` : 'no-store' } })
  }
  return new Response('{"error":"unknown"}', { status: 404, headers: J })
}
