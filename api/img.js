// Coin pictures through this site (Discord's Activity sandbox only loads from the app's own domain).
export const config = { runtime: 'edge' }
export default async function handler(req) {
  const u = new URL(req.url).searchParams.get('u') || ''
  if (!/^https:\/\/[^\s]{4,400}$/.test(u)) return new Response('bad', { status: 400 })
  const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0' } }).catch(() => null)
  const type = r?.headers.get('content-type') || ''
  if (!r || !r.ok || !/^image\//.test(type)) return new Response('no', { status: 404, headers: { 'cache-control': 'public, s-maxage=300' } })
  return new Response(r.body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400, s-maxage=604800' } })
}
