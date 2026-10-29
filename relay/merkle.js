// The snapshot tree HyperTwin.claim checks: leaf = keccak256(abi.encodePacked(address, uint256)), pairs hashed sorted.
// Used by the relay (to build a coin's snapshot) and by the page (to check a posted root against the public snapshot).
import { keccak_256 } from "@noble/hashes/sha3.js"

const hex = (u8) => "0x" + [...u8].map((b) => b.toString(16).padStart(2, "0")).join("")
const unhex = (h) => Uint8Array.from(h.replace(/^0x/, "").match(/../g).map((x) => parseInt(x, 16)))
const cat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o }
const less = (a, b) => { for (let i = 0; i < 32; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false }
const pair = (a, b) => keccak_256(less(a, b) ? cat(a, b) : cat(b, a))

export function leaf(account, amount) {
  const amt = new Uint8Array(32); let v = BigInt(amount)
  for (let i = 31; i >= 0; i--) { amt[i] = Number(v & 255n); v >>= 8n }
  return keccak_256(cat(unhex(account.toLowerCase()), amt))
}
// entries: [{ account: '0x…', amount: '123' }] -> { root, proofs: { account: [hex…] } }
export function build(entries) {
  const leaves = entries.map((e) => leaf(e.account, e.amount))
  if (!leaves.length) return { root: null, proofs: {} }
  const layers = [leaves]
  while (layers.at(-1).length > 1) {
    const l = layers.at(-1), up = []
    for (let i = 0; i < l.length; i += 2) up.push(i + 1 < l.length ? pair(l[i], l[i + 1]) : l[i])
    layers.push(up)
  }
  const proofs = {}
  entries.forEach((e, i) => {
    const p = []; let k = i
    for (let d = 0; d < layers.length - 1; d++) { const sib = k ^ 1; if (sib < layers[d].length) p.push(hex(layers[d][sib])); k >>= 1 }
    proofs[e.account.toLowerCase()] = p
  })
  return { root: hex(layers.at(-1)[0]), proofs }
}
export const rootOf = (entries) => build(entries).root
