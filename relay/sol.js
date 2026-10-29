// Solana reads for HYPEDUAL without web3.js: base58, program addresses, and the pump.fun accounts we need
// (bonding curve, the creator's fee vaults on pump.fun and on PumpSwap, token metadata).
import { Buffer } from "node:buffer"
import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"

const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
export function b58(buf) { let n = 0n; for (const x of buf) n = n * 256n + BigInt(x); let s = ""; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n } for (const x of buf) { if (x) break; s = "1" + s } return s }
export function unb58(s) {
  let n = 0n; for (const ch of s) { const i = A.indexOf(ch); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i) }
  const out = []; while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n }
  for (const ch of s) { if (ch !== "1") break; out.unshift(0) }
  return Uint8Array.from(out)
}
export const isKey = (s) => { try { return typeof s === "string" && unb58(s).length === 32 } catch { return false } }
const onCurve = (b) => { try { ed25519.Point.fromBytes(b); return true } catch { return false } }
export function pda(seeds, program) {
  const prog = unb58(program), tag = new TextEncoder().encode("ProgramDerivedAddress")
  for (let bump = 255; bump >= 0; bump--) {
    const h = sha256(Buffer.concat([...seeds.map((s) => Buffer.from(typeof s === "string" ? new TextEncoder().encode(s) : s)), Buffer.from([bump]), Buffer.from(prog), Buffer.from(tag)]))
    if (!onCurve(h)) return b58(h)
  }
  throw new Error("no program address")
}
export const verify = (sig, msg, pub) => { try { return ed25519.verify(sig, msg, pub) } catch { return false } }

export const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
export const AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
const WSOL = "So11111111111111111111111111111111111111112", TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
const METAPLEX = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
const RENT0 = 890880                                    // a zero-data account's rent-exempt minimum, in lamports

export const curveOf = (mint) => pda(["bonding-curve", unb58(mint)], PUMP)
export const pumpVault = (creator) => pda(["creator-vault", unb58(creator)], PUMP)
export function ammVault(creator) { const auth = pda(["creator_vault", unb58(creator)], AMM); return pda([unb58(auth), unb58(TOKEN), unb58(WSOL)], ATA) }

export function makeRpc(url) {
  return async function rpc(method, params) {
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12000) })
        if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 700 * (i + 1))); continue }
        const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result
      } catch (e) { if (i === 3) throw e; await new Promise((ok) => setTimeout(ok, 400)) }
    }
  }
}

// the bonding curve: creator and whether it graduated
export function parseCurve(data) {
  const b = Buffer.from(data, "base64")
  return { vTok: Number(b.readBigUInt64LE(8)) / 1e6, vSol: Number(b.readBigUInt64LE(16)) / 1e9, complete: b[48] === 1, creator: b.length >= 81 ? b58(b.subarray(49, 81)) : null }
}
// unclaimed creator fees for many creators at once: pump.fun vault (lamports above rent) + PumpSwap vault (WSOL)
export async function vaults(rpc, creators) {
  const out = new Map(), keys = []
  for (const c of creators) keys.push(pumpVault(c), ammVault(c))
  for (let i = 0; i < keys.length; i += 10) {             // public RPCs allow 10 accounts a call
    const r = await rpc("getMultipleAccounts", [keys.slice(i, i + 10), { encoding: "base64", dataSlice: { offset: 64, length: 8 } }])
    r.value.forEach((a, j) => {
      const c = creators[(i + j) >> 1], o = out.get(c) || { pump: 0, amm: 0 }
      if ((i + j) % 2 === 0) o.pump = a ? Math.max(0, a.lamports - RENT0) / 1e9 : 0
      else o.amm = a && a.data?.[0] ? Number(Buffer.from(a.data[0], "base64").readBigUInt64LE(0)) / 1e9 : 0
      out.set(c, o)
    })
  }
  return out
}
// name / symbol / uri from the mint itself (Token-2022 metadata extension) or from Metaplex
function strs(b, o, n) { const out = []; for (let i = 0; i < n; i++) { const l = b.readUInt32LE(o); out.push(b.subarray(o + 4, o + 4 + l).toString("utf8").replace(/\0+$/, "").trim()); o += 4 + l } return out }
export async function tokenMeta(rpc, mint) {
  const a = await rpc("getAccountInfo", [mint, { encoding: "base64" }])
  if (!a?.value) return null
  const b = Buffer.from(a.value.data[0], "base64")
  if (a.value.owner !== TOKEN && b.length > 166) {
    for (let o = 166; o + 4 <= b.length;) {                      // Token-2022 TLV extensions after the account type byte
      const t = b.readUInt16LE(o), l = b.readUInt16LE(o + 2)
      if (t === 19) { const [name, symbol, uri] = strs(b, o + 4 + 64, 3); return { name, symbol, uri } }
      o += 4 + l
    }
  }
  const m = await rpc("getAccountInfo", [pda(["metadata", unb58(METAPLEX), unb58(mint)], METAPLEX), { encoding: "base64" }])
  if (!m?.value) return null
  const [name, symbol, uri] = strs(Buffer.from(m.value.data[0], "base64"), 65, 3)
  return { name, symbol, uri }
}
