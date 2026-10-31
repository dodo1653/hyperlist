// The launchpad's live data: every coin launched here that trades against $HypeEdge, priced through the chain
// coin -> $HypeEdge -> HYPE -> USD, plus $HypeEdge itself and the buyback wallet. Read from the chain, cached 15 s.
import fs from "node:fs"
import path from "node:path"
import { b58, curveOf, tokenMeta, pda, unb58 } from "./sol.js"

export const HYPEEDGE = "6n3kqX8zh36J7uFvPnjj9FtXyaS9uEp74VeFa1tAhype"
const TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"

// curve layout (pump.fun BondingCurve): 8 disc, vTok, vQuote, realTok, realQuote, supply (u64 each), complete @48,
// creator @49, mayhem @81, cashback @82, quote_mint @83, creator_fee_bps (u16) @115
function curve(b) {
  const q = b.subarray(83, 115)
  return { vTok: Number(b.readBigUInt64LE(8)), vQuote: Number(b.readBigUInt64LE(16)), complete: b[48] === 1, creator: b58(b.subarray(49, 81)),
    quoteMint: q.every((x) => x === 0) ? null : b58(q), feeBps: b.length >= 117 ? b.readUInt16LE(115) : 0 }
}

export function createPad({ dir, rpc, prices }) {
  const buyback = (() => { try { return b58(Buffer.from(JSON.parse(fs.readFileSync(path.join(dir, "buyback.json"), "utf8")).pub, "hex")) } catch { return null } })()
  const metaCache = new Map()
  let cache = null, at = 0
  // live trades on pad coins, from pump.fun's TradeEvent: mint @8, token_amount @48, is_buy @56, user @57, creator fee @217;
  // the quote side ($HypeEdge, 6 decimals) from tradeQuote
  const feed = [], stats = new Map()                                              // mint -> { vol: [[t, he]], fees: [[t, he]], trades }
  function onTrade(b, q) {
    const mint = b58(b.subarray(8, 40)), he = q.quoteAmount / 1e6, now = Date.now(), fee = Number(b.readBigUInt64LE(217)) / 1e6
    feed.unshift({ at: now, mint, buy: b[56] === 1, he, user: b58(b.subarray(57, 89)) }); feed.splice(60)
    const s = stats.get(mint) || { vol: [], fees: [], trades: 0 }; s.vol.push([now, he]); if (fee > 0) s.fees.push([now, fee]); s.trades++; stats.set(mint, s)
    const cut = now - 86400_000; for (const a of [s.vol, s.fees]) while (a.length && a[0][0] < cut) a.shift()
    cache = null
  }
  const sum = (a) => a.reduce((x, y) => x + y[1], 0)
  async function meta(mint) {
    if (metaCache.has(mint)) return metaCache.get(mint)
    const m = await tokenMeta(rpc, mint).catch(() => null); let image = null
    const id = m?.uri?.match(/\/m\/([a-f0-9]{24})\.json$/)?.[1]
    if (id) { try { image = JSON.parse(fs.readFileSync(path.join(dir, "meta", id + ".json"), "utf8")).image } catch {} }
    if (!image && m?.uri) { try { image = (await (await fetch(m.uri, { signal: AbortSignal.timeout(6000) })).json()).image } catch {} }
    const out = m ? { name: m.name, symbol: m.symbol, image } : null
    if (out) metaCache.set(mint, out)
    return out
  }
  async function build() {
    const used = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, "vanity.json"), "utf8")).used || [] } catch { return [] } })()
    const mints = [HYPEEDGE, ...used.map((u) => u.mint).filter((m) => m !== HYPEEDGE)]
    const curves = new Map()
    for (let i = 0; i < mints.length; i += 10) {
      const r = await rpc("getMultipleAccounts", [mints.slice(i, i + 10).map(curveOf), { encoding: "base64" }])
      r.value.forEach((a, j) => { if (a) curves.set(mints[i + j], curve(Buffer.from(a.data[0], "base64"))) })
    }
    const he = curves.get(HYPEEDGE)
    // $HypeEdge: 6 decimals, quoted in HYPE (9 decimals)
    const heHype = he && he.vTok ? (he.vQuote / 1e9) / (he.vTok / 1e6) : 0, heUsd = heHype * (prices().hype || 0)
    const coins = []
    for (const u of [...used].reverse()) {
      const c = curves.get(u.mint); if (!c || c.quoteMint !== HYPEEDGE) continue    // only coins that trade against $HypeEdge
      const priceHe = c.vTok ? (c.vQuote / 1e6) / (c.vTok / 1e6) : 0                  // quote $HypeEdge has 6 decimals
      const m = await meta(u.mint)
      coins.push({ mint: u.mint, name: m?.name || "", symbol: m?.symbol || "", image: m?.image || null, createdAt: u.at, signature: u.signature,
        mc: c.complete ? null : Math.round(priceHe * 1e9 * heUsd), graduated: c.complete, quote: "HypeEdge", feeBps: c.feeBps, creator: c.creator,
        vol24: Math.round(sum(stats.get(u.mint)?.vol || []) * heUsd), fees24: +sum(stats.get(u.mint)?.fees || []).toFixed(2), trades: stats.get(u.mint)?.trades || 0 })
    }
    let collected = 0
    if (buyback) {
      const ata = pda([unb58(buyback), unb58(TOKEN22), unb58(HYPEEDGE)], ATA)
      const a = await rpc("getAccountInfo", [ata, { encoding: "base64" }]).catch(() => null)
      if (a?.value) collected = Number(Buffer.from(a.value.data[0], "base64").readBigUInt64LE(64)) / 1e6
    }
    return { hypeedge: { mint: HYPEEDGE, mc: he ? Math.round(heUsd * 1e9) : null, priceHype: heHype, graduated: he?.complete || false },
      buyback: { wallet: buyback, collected, ...(() => { try { const b = JSON.parse(fs.readFileSync(path.join(dir, "burns.json"), "utf8")); return { burned: +b.total.toFixed(2), burns: b.list.slice(0, 20) } } catch { return { burned: 0, burns: [] } } })() }, totals: { launched: coins.length, vol24: coins.reduce((a, c) => a + (c.vol24 || 0), 0) },
      coins, feed: feed.slice(0, 40).map((t) => ({ ...t, usd: Math.round(t.he * heUsd * 100) / 100, symbol: coins.find((c) => c.mint === t.mint)?.symbol || '' })) }
  }
  return {
    buyback, onTrade,
    async get() { if (cache && Date.now() - at < 15000) return cache; cache = await build(); at = Date.now(); return cache },
  }
}
