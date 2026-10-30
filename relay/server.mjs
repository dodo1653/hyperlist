// HypeEdge relay. Everything it serves is read live:
//  - Hyperliquid: the HIP-1 ticker gas auction (spotDeployState), HYPE / SOL prices, the newest HIP-1 tickers (spotMeta)
//  - pump.fun: every bonding-curve trade from the program logs, which carries the creator and the creator's fee (0.30 %)
//  - Solana: each creator's unclaimed fees (pump.fun creator vault + PumpSwap creator vault)
// and keeps one thing of its own: holders binding a Hyperliquid address to their Solana wallet (signed with the wallet).
// node server.mjs   ->  http://127.0.0.1:8798/v1/state
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Buffer } from "node:buffer"
import { b58, unb58, isKey, verify, makeRpc, curveOf, parseCurve, vaults, tokenMeta, tradeQuote, curveQuote, pda, PUMP } from "./sol.js"
const HYPE = "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g"     // HYPE on Solana: a pump.fun listed quote mint
import { createLaunch, twinMsg, snapMsg } from "./launch.js"
import { createVanity } from "./vanity.js"

const PORT = +(process.env.PORT || 8798)
const rpc = makeRpc(process.env.RPC_URL || "https://solana-rpc.publicnode.com")
const WS_URL = process.env.WS_URL || "wss://api.mainnet-beta.solana.com"
const HL = "https://api.hyperliquid.xyz/info"
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), ".data"); fs.mkdirSync(DIR, { recursive: true })
const load = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) } catch { return d } }
const save = (f, v) => { fs.writeFileSync(path.join(DIR, f + ".tmp"), JSON.stringify(v)); fs.renameSync(path.join(DIR, f + ".tmp"), path.join(DIR, f)) }
const HOUR = 3600_000, FLOOR = 500
const CRUDE = /(n[i1]gg|f[a@]gg?ot|retard|rape|hitler|nazi|kike|chink|spic|tranny|porn|cum|fuck|shit|cock|dick|pussy|cunt|boob|tits|sex|anal|penis|vagina|whore|slut|kkk|isis)/i

// ---------------------------------------------------------------- Hyperliquid
const hl = (body) => fetch(HL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }).then((r) => r.json())
let auction = null, prices = { hype: 0, sol: 0 }, tickers = load("tickers.json", { known: 0, list: [] })
async function pollHL() {
  try {
    const [d, mids] = await Promise.all([hl({ type: "spotDeployState", user: "0x0000000000000000000000000000000000000000" }), hl({ type: "allMids" })])
    const g = d.gasAuction
    auction = { start: g.startTimeSeconds * 1000, dur: g.durationSeconds * 1000, startGas: +g.startGas, currentGas: g.currentGas == null ? null : +g.currentGas, endGas: g.endGas == null ? null : +g.endGas, floor: FLOOR, at: Date.now() }
    prices = { hype: +mids.HYPE || prices.hype, sol: +mids.SOL || prices.sol }
  } catch (e) { console.log("hl", e.message) }
}
// the newest HIP-1 tokens: spotMeta lists every token by index; new indexes = tickers someone just bought
async function pollTickers() {
  try {
    const m = await hl({ type: "spotMeta" }), toks = m.tokens
    const top = Math.max(...toks.map((t) => t.index))
    if (!tickers.known) tickers.list = toks.slice().sort((a, b) => b.index - a.index).slice(0, 8).map((t) => ({ name: t.name, index: t.index, at: null }))
    else for (const t of toks.filter((t) => t.index > tickers.known).sort((a, b) => a.index - b.index)) tickers.list.unshift({ name: t.name, index: t.index, at: Date.now() })
    tickers.known = top; tickers.list = tickers.list.slice(0, 12); save("tickers.json", tickers)
  } catch (e) { console.log("spotMeta", e.message) }
}

// ---------------------------------------------------------------- pump.fun trades
const D_TRADE = "bddb7fd34ee661ee", D_CREATE = "1b72a94ddeeb6376"
const coins = new Map()        // mint -> { mint, creator, name, symbol, uri, img, fees: [[t, sol]], vol: [[t, sol]], last, metaTried }
let live = false, lastMsg = 0, trades = 0
const coin = (mint) => { let c = coins.get(mint); if (!c) { c = { mint, creator: null, name: "", symbol: "", uri: "", img: null, fees: [], vol: [], last: 0, metaTried: 0 }; coins.set(mint, c) } return c }
function onLogs(logs) {
  for (const l of logs) {
    if (!l.startsWith("Program data: ")) continue
    const b = Buffer.from(l.slice(14), "base64"); if (b.length < 8) continue
    const d = b.subarray(0, 8).toString("hex")
    try {
      if (d === D_CREATE) {
        let o = 8; const s = () => { const n = b.readUInt32LE(o); const v = b.subarray(o + 4, o + 4 + n).toString("utf8"); o += 4 + n; return v }
        const name = s(), symbol = s(), uri = s(), mint = b58(b.subarray(o, o + 32)); o += 96
        const c = coin(mint); Object.assign(c, { name: name.slice(0, 40), symbol: symbol.slice(0, 16), uri: uri.slice(0, 300), creator: b58(b.subarray(o, o + 32)) })
      } else if (d === D_TRADE && b.length >= 225) {
        // SOL pairs carry the amount in sol_amount; HYPE pairs leave it 0 and carry it (and the creator fee) in HYPE
        let amt = Number(b.readBigUInt64LE(40)) / 1e9, unit = "SOL"
        if (!(amt > 0)) { const q = tradeQuote(b); if (!q || q.quoteMint !== HYPE) continue; amt = q.quoteAmount / 1e9; unit = "HYPE" }
        if (!(amt > 0)) continue
        const sol = amt, c = coin(b58(b.subarray(8, 40))), now = Date.now(), fee = Number(b.readBigUInt64LE(217)) / 1e9
        c.unit = unit
        c.creator = b58(b.subarray(177, 209)); c.last = now; trades++
        c.vol.push([now, sol]); if (fee > 0) c.fees.push([now, fee])
      }
    } catch {}
  }
}
function connect() {
  const ws = new WebSocket(WS_URL)
  ws.onopen = () => { live = true; ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "logsSubscribe", params: [{ mentions: [PUMP] }, { commitment: "confirmed" }] })) }
  ws.onmessage = (e) => { lastMsg = Date.now(); try { const v = JSON.parse(e.data)?.params?.result?.value; if (v?.logs && !v.err) onLogs(v.logs) } catch {} }
  ws.onclose = () => { live = false; setTimeout(connect, 2000) }
  ws.onerror = () => {}
}
const sum = (a) => a.reduce((s, x) => s + x[1], 0)
function prune() {
  const cut = Date.now() - HOUR
  for (const [m, c] of coins) {
    while (c.fees.length && c.fees[0][0] < cut) c.fees.shift()
    while (c.vol.length && c.vol[0][0] < cut) c.vol.shift()
    if (c.last < cut && !watch.has(m)) coins.delete(m)
  }
}

// ---------------------------------------------------------------- creator vaults + names for the coins that matter
const vaultOf = new Map()      // creator -> { pump, amm, at }
const watch = new Set(load("watch.json", []))   // coins people opened a fund page for: kept and refreshed
async function refreshVaults(creators) {
  const need = [...new Set(creators.filter(Boolean))]; if (!need.length) return
  const v = await vaults(rpc, need), at = Date.now()
  for (const [c, x] of v) vaultOf.set(c, { ...x, at })
}
const GATES = ["https://ipfs.filebase.io/ipfs/", "https://pump.mypinata.cloud/ipfs/", "https://gateway.pinata.cloud/ipfs/"]
const cid = (u) => (typeof u === "string" ? u.match(/\/ipfs\/([A-Za-z0-9]{40,80})/)?.[1] || u.match(/^ipfs:\/\/([A-Za-z0-9]{40,80})/)?.[1] : null)
async function ensureMeta(c) {
  if (c.metaTried >= 2 || (c.img && c.symbol)) return
  c.metaTried++
  try {
    if (!c.symbol || !c.uri) { const m = await tokenMeta(rpc, c.mint); if (m) Object.assign(c, { name: m.name.slice(0, 40), symbol: m.symbol.slice(0, 16), uri: m.uri }) }
    const id = cid(c.uri), urls = id ? GATES.map((g) => g + id) : c.uri?.startsWith("http") ? [c.uri] : []
    for (const u of urls) {
      try { const j = await fetch(u, { signal: AbortSignal.timeout(6000) }).then((r) => (r.ok ? r.json() : null)); if (!j) continue
        const ic = cid(j.image); c.img = ic ? GATES[0] + ic : typeof j.image === "string" && j.image.startsWith("https://") ? j.image : null; c.x = String(j.twitter || "").slice(0, 200); break } catch {}
    }
  } catch {}
}
let race = []
async function tickRace() {
  prune()
  const inSol = (c, v) => (c.unit === "HYPE" && prices.sol ? (v * prices.hype) / prices.sol : v)
  const list = [...coins.values()].filter((c) => c.fees.length && c.creator).map((c) => ({ c, f: sum(c.fees), r: inSol(c, sum(c.fees)) })).sort((a, b) => b.r - a.r).slice(0, 30)
  for (const { c } of list.slice(0, 14)) if (!(c.img && c.symbol)) await ensureMeta(c)
  const fresh = list.filter(({ c }) => c.symbol && !CRUDE.test(c.symbol + " " + c.name)).slice(0, 14)
  const missing = fresh.map(({ c }) => c.creator).filter((cr) => !vaultOf.has(cr))
  if (missing.length) await refreshVaults(missing).catch(() => {})
  race = fresh.map(({ c, f }) => view(c, f))
}
// HYPE-paired coins: the creator vault's HYPE account, 10 per call (public RPC limit)
async function refreshHypeVaults(list) {
  const cs = list.filter((c) => c.unit === "HYPE" && c.creator); if (!cs.length) return
  const atas = cs.map((c) => pda([unb58(pda(["creator-vault", unb58(c.creator)], PUMP)), unb58("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), unb58(HYPE)], "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"))
  for (let i = 0; i < atas.length; i += 10) {
    const r = await rpc("getMultipleAccounts", [atas.slice(i, i + 10), { encoding: "base64", dataSlice: { offset: 64, length: 8 } }])
    r.value.forEach((a, j) => (cs[i + j].hypeVault = a ? Number(Buffer.from(a.data[0], "base64").readBigUInt64LE(0)) / 1e9 : 0))
  }
}
async function tickVaults() {
  try { await refreshHypeVaults([...race.map((r) => coins.get(r.mint)).filter(Boolean), ...[...watch].map((m) => coins.get(m)).filter(Boolean)]) } catch (e) { console.log("hype vaults", e.message) }
  try { await refreshVaults([...race.map((r) => r.creator), ...[...watch].map((m) => coins.get(m)?.creator)]) } catch (e) { console.log("vaults", e.message) }
}

// ---------------------------------------------------------------- what the page sees
const target = () => {   // the price of a ticker right now: the live auction price (or the floor when no auction is running)
  if (!auction) return FLOOR
  const t = (Date.now() - auction.start) / auction.dur
  if (auction.endGas != null || t >= 1) return FLOOR
  return Math.max(FLOOR, auction.startGas + (FLOOR - auction.startGas) * t)
}
// a HYPE-paired coin's creator is paid in HYPE: its vault and fees compare straight with the auction's HYPE price
function view(c, fees1h = sum(c.fees)) {
  const hype = c.unit === "HYPE", v = vaultOf.get(c.creator)
  const unclaimed = hype ? (c.hypeVault ?? null) : v ? v.pump + v.amm : null
  const tgtSol = hype ? target() : prices.sol ? (target() * prices.hype) / prices.sol : 0
  return { unit: c.unit || "SOL", mint: c.mint, symbol: c.symbol, name: c.name, img: c.img, creator: c.creator, fees1h: +fees1h.toFixed(4), vol1h: +sum(c.vol).toFixed(2), trades1h: c.vol.length,
    unclaimed: unclaimed == null ? null : +unclaimed.toFixed(4), vaultAt: v?.at || null, pct: unclaimed == null || !tgtSol ? null : +((unclaimed / tgtSol) * 100).toFixed(3),
    etaH: tgtSol && fees1h > 0 ? +(Math.max(0, tgtSol - (unclaimed || 0)) / fees1h).toFixed(1) : null }
}
function state() {
  const tgt = target()
  let fees = 0, vol = 0; for (const c of coins.values()) { fees += sum(c.fees); vol += sum(c.vol) }
  return { now: Date.now(), live: live && Date.now() - lastMsg < 30000, auction, ticker: { hype: +tgt.toFixed(4), usd: Math.round(tgt * prices.hype), sol: prices.sol ? +((tgt * prices.hype) / prices.sol).toFixed(2) : null, floorUsd: Math.round(FLOOR * prices.hype) },
    prices, tickers: tickers.list, race, hour: { fees: +fees.toFixed(3), vol: Math.round(vol), coins: coins.size, trades } }
}

// one coin's fund page: works for any pump.fun coin, traded in the last hour or not
async function coinPage(mint) {
  if (!isKey(mint)) throw new Error("that is not a Solana address")
  const a = await rpc("getAccountInfo", [curveOf(mint), { encoding: "base64" }])
  if (!a?.value) throw new Error("not a pump.fun coin")
  const cv = parseCurve(a.value.data[0]), c = coin(mint), quote = curveQuote(a.value.data[0])
  c.creator = c.creator || cv.creator; if (!c.last) c.last = Date.now()
  if (quote && quote !== HYPE) throw new Error("this coin trades against a token HypeEdge doesn't read yet")
  if (quote === HYPE) {                                        // creator fees sit in the creator vault's HYPE account
    c.unit = "HYPE"
    const ata = pda([unb58(pda(["creator-vault", unb58(c.creator)], PUMP)), unb58("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), unb58(HYPE)], "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
    const va = await rpc("getAccountInfo", [ata, { encoding: "base64", dataSlice: { offset: 64, length: 8 } }])
    c.hypeVault = va?.value ? Number(Buffer.from(va.value.data[0], "base64").readBigUInt64LE(0)) / 1e9 : 0
  }
  if (!watch.has(mint)) { watch.add(mint); save("watch.json", [...watch]) }
  await ensureMeta(c)
  if (!vaultOf.has(c.creator) || Date.now() - vaultOf.get(c.creator).at > 30000) await refreshVaults([c.creator])
  const L = launch.get(mint), sp = launch.snap(mint)
  const twin = L ? { address: L.twin, evmCreator: L.evmCreator, at: L.at, root: await launch.onchainRoot(mint), snapshot: sp && { root: sp.root, at: sp.at, holders: sp.holders, total: sp.total } } : null
  const qUsd = quote === HYPE ? prices.hype : prices.sol
  return { ...view(c), twin, graduated: cv.complete, mc: qUsd ? Math.round((cv.vSol / cv.vTok) * 1e9 * qUsd) : null, binds: Object.keys(binds[mint] || {}).length, ticker: state().ticker }
}

// ---------------------------------------------------------------- holders bind a Hyperliquid address (signed by their Solana wallet)
const binds = load("binds.json", {})
const bindMsg = (mint, sol, hlAddr) => `HypeEdge\nI bind Hyperliquid address ${hlAddr}\nto my Solana wallet ${sol}\nfor the Hyperliquid twin of ${mint}.`
function bind(b) {
  const { mint, sol, hl: hlAddr, sig } = b || {}
  if (!isKey(mint) || !isKey(sol)) throw new Error("bad address")
  if (!/^0x[0-9a-fA-F]{40}$/.test(hlAddr || "")) throw new Error("that is not a Hyperliquid (0x…) address")
  let s; try { s = unb58(String(sig)) } catch { throw new Error("bad signature") }
  if (s.length !== 64 || !verify(s, new TextEncoder().encode(bindMsg(mint, sol, hlAddr)), unb58(sol))) throw new Error("the signature doesn't match that wallet")
  binds[mint] = binds[mint] || {}; binds[mint][sol] = { hl: hlAddr.toLowerCase(), at: Date.now() }; save("binds.json", binds)
  return { ok: true, binds: Object.keys(binds[mint]).length }
}

const launch = createLaunch({ dir: DIR, rpc, coins, binds })
const vanity = createVanity({ dir: DIR, target: +(process.env.VANITY_POOL || 8), threads: +(process.env.VANITY_THREADS || 8) })   // mints ending in "hype"

// ---------------------------------------------------------------- http
const json = (res, v, code = 200) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" }); res.end(JSON.stringify(v)) }
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x")
  try {
    if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" }); return res.end() }
    if (u.pathname === "/v1/state") return json(res, state())
    if (u.pathname === "/v1/coin") return json(res, await coinPage(u.searchParams.get("mint") || ""))
    if (u.pathname === "/v1/bindmsg") return json(res, { msg: bindMsg(u.searchParams.get("mint"), u.searchParams.get("sol"), u.searchParams.get("hl")) })
    const body = async () => { const ch = []; let n = 0; for await (const x of req) { n += x.length; if (n > 3_000_000) throw new Error("too large"); ch.push(x) } return JSON.parse(Buffer.concat(ch).toString() || "{}") }
    if (u.pathname === "/v1/bind" && req.method === "POST") return json(res, bind(await body()))
    if (u.pathname === "/v1/upload" && req.method === "POST") return json(res, launch.upload(await body()))
    if (u.pathname === "/v1/mint") return json(res, vanity.reserve())
    if (u.pathname === "/v1/vanity") return json(res, vanity.status())
    if (u.pathname === "/v1/send" && req.method === "POST") {
      // a launch built around one of our vanity mints: the relay adds the mint's signature after the wallet's
      const b = await body(); if (b.vanity) b.tx = vanity.cosign(b.tx, b.vanity)
      const r = await launch.send(b); if (b.vanity) vanity.spent(b.vanity, r.signature)
      return json(res, r)
    }
    if (u.pathname === "/v1/twin" && req.method === "POST") return json(res, await launch.twin(await body()))
    if (u.pathname === "/v1/snapshot" && req.method === "POST") return json(res, await launch.snapshot(await body()))
    if (u.pathname === "/v1/twinmsg") return json(res, { msg: twinMsg(u.searchParams.get("mint"), u.searchParams.get("twin")) })
    if (u.pathname === "/v1/snapmsg") return json(res, { msg: snapMsg(u.searchParams.get("mint")) })
    if (u.pathname === "/v1/proof") {        // a holder's line in the snapshot: amount + proof for HyperTwin.claim
      const sp = launch.snap(u.searchParams.get("mint") || ""), a = String(u.searchParams.get("account") || "").toLowerCase()
      if (!sp) return json(res, { error: "no snapshot yet" }, 404)
      const e = sp.entries.find((x) => x.account === a)
      return e ? json(res, { amount: e.amount, proof: sp.proofs[a], root: sp.root }) : json(res, { error: "that address is not in the snapshot" }, 404)
    }
    if (u.pathname === "/v1/snapfile") { const sp = launch.snap(u.searchParams.get("mint") || ""); return sp ? json(res, { root: sp.root, at: sp.at, entries: sp.entries.map(({ account, amount }) => ({ account, amount })) }) : json(res, { error: "no snapshot yet" }, 404) }
    if (u.pathname === "/v1/launches") return json(res, { coins: launch.list().slice(0, 40).map((L) => { const c = coins.get(L.mint); return { ...L, fees1h: c ? +sum(c.fees).toFixed(4) : 0, snapshot: !!launch.snap(L.mint) } }) })
    const mi = u.pathname.match(/^\/(m|i)\/([a-f0-9]{24})(\.json)?$/)
    if (mi) { const f = launch.serve(mi[1], mi[2]); if (!f) return json(res, { error: "not found" }, 404); res.writeHead(200, { "content-type": f.type, "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" }); return res.end(f.body) }
    json(res, { error: "not found" }, 404)
  } catch (e) { json(res, { error: e.message || String(e) }, 400) }
}).listen(PORT, "127.0.0.1", () => console.log("hyperlist relay on " + PORT))

connect(); pollHL(); pollTickers()
setInterval(pollHL, 15000); setInterval(pollTickers, 60000)
setInterval(() => tickRace().catch((e) => console.log("race", e.message)), 10000)
setInterval(tickVaults, 30000); setTimeout(tickVaults, 12000)
