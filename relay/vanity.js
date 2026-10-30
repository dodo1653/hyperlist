// Vanity mints: a small stock of mint keys whose address ends in "hype", ground ahead of time on this machine.
// The keys never leave the relay. A launch reserves one (the page builds its transaction around that address), the
// wallet signs as payer, and the relay adds the mint's signature just before sending. A used key is worthless after
// the create (pump.fun takes the mint), so each key signs exactly one create transaction.
//
// Grinding is plain CPU: random ed25519 keys (Node's native crypto) checked against the suffix. The suffix test
// needs no base58 string: the last k base58 digits of a key are its value mod 58^k.
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads"
import { b58 } from "./sol.js"

const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
const HOLD_MS = 15 * 60_000                                   // a reservation lasts 15 minutes, then the key goes back

// ---------------------------------------------------------------- worker: grind until told to stop
if (!isMainThread && workerData?.vanity) {
  const { suffix } = workerData, M = 58 ** suffix.length
  let target = 0; for (const ch of suffix) target = target * 58 + ALPHA.indexOf(ch)
  for (;;) {
    for (let i = 0; i < 2000; i++) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "der" }, privateKeyEncoding: { type: "pkcs8", format: "der" } })
      let r = 0; for (let j = publicKey.length - 32; j < publicKey.length; j++) r = (r * 256 + publicKey[j]) % M
      if (r === target) parentPort.postMessage({ seed: privateKey.subarray(privateKey.length - 32).toString("hex"), pub: publicKey.subarray(publicKey.length - 32).toString("hex") })
    }
    parentPort.postMessage({ tick: 2000 })
  }
}

// ---------------------------------------------------------------- the pool (main thread)
export function createVanity({ dir, suffix = process.env.VANITY_SUFFIX || "hype", target = +(process.env.VANITY_POOL || 12), threads = +(process.env.VANITY_THREADS || Math.max(1, os.cpus().length - 4)) }) {
  const file = path.join(dir, "vanity.json")                  // secret seeds: relay/.data is never committed
  const db = (() => { try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return { keys: [], used: [] } } })()
  const save = () => { fs.writeFileSync(file + ".tmp", JSON.stringify(db)); fs.renameSync(file + ".tmp", file) }
  let workers = [], tried = 0, since = Date.now()

  function grind() {
    if (workers.length || free().length >= target) return
    since = Date.now(); tried = 0
    for (let i = 0; i < threads; i++) {
      const w = new Worker(new URL(import.meta.url), { workerData: { vanity: true, suffix } })
      w.on("message", (m) => {
        if (m.tick) { tried += m.tick; return }
        const mint = b58(Buffer.from(m.pub, "hex"))
        if (!mint.endsWith(suffix) || db.keys.some((k) => k.mint === mint)) return
        db.keys.push({ mint, seed: m.seed, at: Date.now() }); save()
        console.log(`vanity: ${mint} (${free().length}/${target}, ${Math.round(tried / ((Date.now() - since) / 1000))} keys/s)`)
        if (free().length >= target) stop()
      })
      w.on("error", (e) => console.log("vanity worker:", e.message))
      workers.push(w)
    }
  }
  function stop() { for (const w of workers) w.terminate(); workers = [] }
  const free = () => db.keys.filter((k) => !k.until || k.until < Date.now())

  // hand out an address (never the key); the oldest free one first
  function reserve() {
    const k = free()[0]; if (!k) { grind(); return { mint: null } }
    k.until = Date.now() + HOLD_MS; save(); grind()
    return { mint: k.mint, suffix }
  }

  // sign a create transaction for a reserved vanity mint. The transaction must be a pump.fun one that names the mint as
  // a signer; the wallet's own signature is already in place. Returns the transaction (base64) with both signatures.
  function cosign(txB64, mint) {
    const k = db.keys.find((x) => x.mint === mint); if (!k) throw new Error("that vanity mint isn't reserved here")
    const raw = Buffer.from(txB64, "base64")
    let o = 0; const cu16 = () => { let v = 0, s = 0, b; do { b = raw[o++]; v |= (b & 0x7f) << s; s += 7 } while (b & 0x80); return v }
    const nSig = cu16(), sigAt = o; o += 64 * nSig
    const msgAt = o, msg = raw.subarray(msgAt)
    let p = 0; if (msg[0] & 0x80) p = 1                         // versioned message: the version byte comes first
    const nReq = msg[p]; p += 3
    let q = p, nKeys = 0, sh = 0, b; do { b = msg[q++]; nKeys |= (b & 0x7f) << sh; sh += 7 } while (b & 0x80)
    const keys = []; for (let i = 0; i < nKeys; i++) keys.push(b58(msg.subarray(q + 32 * i, q + 32 * i + 32)))
    const slot = keys.indexOf(mint)
    if (slot < 0 || slot >= nReq || nReq !== nSig) throw new Error("the transaction doesn't name this mint as a signer")
    if (!keys.includes(PUMP)) throw new Error("vanity mints only sign pump.fun launches")
    const priv = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(k.seed, "hex")]), format: "der", type: "pkcs8" })
    crypto.sign(null, msg, priv).copy(raw, sigAt + 64 * slot)
    return raw.toString("base64")
  }
  // after the send went through: retire the key (kept in `used` so the address is never handed out again)
  function spent(mint, signature) {
    const i = db.keys.findIndex((x) => x.mint === mint); if (i < 0) return
    db.used.push({ mint, signature, at: Date.now() }); db.keys.splice(i, 1); save(); grind()
  }
  const status = () => ({ suffix, free: free().length, reserved: db.keys.length - free().length, target, grinding: workers.length > 0, used: db.used.length })
  grind()
  return { reserve, cosign, spent, status, isVanity: (m) => db.keys.some((k) => k.mint === m), stop }
}
