// Launching on both chains: the pump.fun coin's metadata (served on the site's own domain), sending the signed
// launch, registering the coin's HyperEVM twin (checked on chain, linked by the Solana creator's signature), and the
// one-time holder snapshot the twin's claims follow.
import fs from "node:fs"
import path from "node:path"
import { createPublicClient, http as viemHttp } from "viem"
import { unb58, isKey, verify, curveOf, parseCurve } from "./sol.js"
import { build } from "./merkle.js"

export const HYPEREVM = { id: 999, name: "HyperEVM", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.hyperliquid.xyz/evm"] } } }
const TWIN_ABI = ["name", "symbol", "solMint"].map((n) => ({ type: "function", name: n, stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }))
  .concat([{ type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }, { type: "function", name: "root", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }])

export const twinMsg = (mint, twin) => `HYPERLIST\nThe HyperEVM twin of ${mint}\nis ${twin}.`
export const snapMsg = (mint) => `HYPERLIST\nTake the holder snapshot of ${mint} now.\nIt can only be taken once.`

export function createLaunch({ dir, rpc, coins, binds }) {
  const evm = createPublicClient({ chain: HYPEREVM, transport: viemHttp(process.env.HYPEREVM_RPC || "https://rpc.hyperliquid.xyz/evm") })
  const META = path.join(dir, "meta"); fs.mkdirSync(META, { recursive: true })
  const file = path.join(dir, "launches.json")
  const db = (() => { try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return { coins: {}, snaps: {} } } })()
  const save = () => { fs.writeFileSync(file + ".tmp", JSON.stringify(db)); fs.renameSync(file + ".tmp", file) }
  const s = (x, n) => String(x || "").trim().slice(0, n)
  const link = (x) => (/^https:\/\/[^\s]{3,200}$/.test(String(x || "")) ? String(x) : "")

  // the coin's launch JSON + picture, kept by the relay and served under the site's own domain (/m/<id>.json, /i/<id>)
  function upload(b) {
    const name = s(b.name, 32), symbol = s(b.symbol, 10).replace(/^\$+/, "").toUpperCase(), description = s(b.description, 600)
    if (!name || !symbol) throw new Error("name and ticker are required")
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) throw new Error("tickers are 1 to 10 letters or digits")
    const hour = Date.now() - 3600_000
    for (const c of coins.values()) if (c.last > hour && c.symbol && c.symbol.toUpperCase() === symbol) throw new Error(`$${c.symbol} traded on pump.fun in the last hour. pick a ticker that's yours`)
    const origin = /^https:\/\/[a-z0-9.-]{3,80}$/.test(String(b.origin || "")) ? b.origin : "https://hyperlist-pad.vercel.app"
    const m = String(b.image || "").match(/^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/)
    if (!m) throw new Error("the image must be png, jpg, webp or gif")
    const bytes = Buffer.from(m[3], "base64"); if (bytes.length > 1_900_000) throw new Error("the image is too large (max 1.9 MB)")
    const id = [...crypto.getRandomValues(new Uint8Array(12))].map((x) => x.toString(16).padStart(2, "0")).join("")
    const image = `${origin}/i/${id}`
    fs.writeFileSync(path.join(META, id + ".img"), bytes); fs.writeFileSync(path.join(META, id + ".type"), m[1])
    fs.writeFileSync(path.join(META, id + ".json"), JSON.stringify({ name, symbol, description, image, showName: true, createdOn: origin, twitter: link(b.twitter), telegram: link(b.telegram), website: link(b.website) || origin }))
    return { uri: `${origin}/m/${id}.json`, image, id }
  }
  function serve(kind, id) {
    if (!/^[a-f0-9]{24}$/.test(id)) return null
    const f = path.join(META, id + (kind === "m" ? ".json" : ".img")); if (!fs.existsSync(f)) return null
    return { type: kind === "m" ? "application/json" : fs.readFileSync(path.join(META, id + ".type"), "utf8"), body: fs.readFileSync(f) }
  }
  async function send(b) {
    if (typeof b.tx !== "string" || b.tx.length > 3000) throw new Error("bad transaction")
    return { signature: await rpc("sendTransaction", [b.tx, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }]) }
  }
  async function creatorOf(mint) {
    const a = await rpc("getAccountInfo", [curveOf(mint), { encoding: "base64" }])
    if (!a?.value) throw new Error("not a pump.fun coin (yet). if you just launched it, wait a few seconds")
    return parseCurve(a.value.data[0]).creator
  }
  const read = (address, functionName) => evm.readContract({ address, abi: TWIN_ABI, functionName })

  // the twin is registered when (1) the contract on HyperEVM names this mint and (2) the coin's Solana creator signed the link
  async function twin(b) {
    const { mint, twin: addr, sig, meta } = b || {}
    if (!isKey(mint) || !/^0x[0-9a-fA-F]{40}$/.test(addr || "")) throw new Error("bad address")
    const creator = await creatorOf(mint)
    let sg; try { sg = unb58(String(sig)) } catch { throw new Error("bad signature") }
    if (sg.length !== 64 || !verify(sg, new TextEncoder().encode(twinMsg(mint, addr)), unb58(creator))) throw new Error("only the coin's creator wallet can link its twin")
    let solMint, name, symbol, evmCreator
    for (let i = 0; i < 6; i++) {                                     // the deploy may still be landing
      try { [solMint, name, symbol, evmCreator] = await Promise.all([read(addr, "solMint"), read(addr, "name"), read(addr, "symbol"), read(addr, "creator")]); break }
      catch (e) { if (i === 5) throw new Error("no HyperTwin contract at that address on HyperEVM"); await new Promise((ok) => setTimeout(ok, 2500)) }
    }
    if (solMint !== mint) throw new Error("that contract twins a different coin")
    db.coins[mint] = { mint, twin: addr.toLowerCase(), creator, evmCreator: evmCreator.toLowerCase(), name, symbol, img: s(meta?.image, 300) || null, at: db.coins[mint]?.at || Date.now() }
    save(); return { ok: true, coin: db.coins[mint] }
  }

  // one snapshot per coin, asked for by its creator: every bound holder's balance right now -> the twin's claim tree
  async function snapshot(b) {
    const { mint, sig } = b || {}
    const L = db.coins[mint]; if (!L) throw new Error("this coin has no twin registered")
    if (db.snaps[mint]) throw new Error("the snapshot was already taken")
    let sg; try { sg = unb58(String(sig)) } catch { throw new Error("bad signature") }
    if (sg.length !== 64 || !verify(sg, new TextEncoder().encode(snapMsg(mint)), unb58(L.creator))) throw new Error("only the coin's creator can take the snapshot")
    const by = new Map(), wallets = Object.entries(binds[mint] || {})
    for (const [sol, { hl }] of wallets) {
      const r = await rpc("getTokenAccountsByOwner", [sol, { mint }, { encoding: "jsonParsed" }])
      const amt = (r?.value || []).reduce((t, a) => t + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n)
      if (amt > 0n) { const e = by.get(hl) || { account: hl, amount: 0n, wallets: [] }; e.amount += amt; e.wallets.push(sol); by.set(hl, e) }
    }
    const entries = [...by.values()].map((e) => ({ account: e.account, amount: e.amount.toString(), wallets: e.wallets }))
    if (!entries.length) throw new Error("no bound holder holds the coin right now")
    const { root, proofs } = build(entries)
    db.snaps[mint] = { root, at: Date.now(), holders: entries.length, total: entries.reduce((t, e) => t + BigInt(e.amount), 0n).toString(), entries, proofs }
    save(); return { root, holders: entries.length }
  }
  const snap = (mint) => db.snaps[mint] || null
  async function onchainRoot(mint) { const L = db.coins[mint]; if (!L) return null; try { const r = await read(L.twin, "root"); return /^0x0+$/.test(r) ? null : r } catch { return undefined } }
  const list = () => Object.values(db.coins).sort((a, b) => b.at - a.at)
  return { upload, serve, send, twin, snapshot, snap, onchainRoot, list, get: (m) => db.coins[m] || null }
}
