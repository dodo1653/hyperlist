// The relay's launch flow end to end against a local HyperEVM (ganache) and a faked Solana RPC:
// twin registration (creator signature + on-chain check), holder binds, the snapshot, setRoot, and claims from relay proofs.
// node tools/test_flow.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ganache from 'ganache'
import { ed25519 } from '../relay/node_modules/@noble/curves/ed25519.js'
import { createPublicClient, http, encodeDeployData, encodeFunctionData } from 'viem'

const server = ganache.server({ logging: { quiet: true }, wallet: { totalAccounts: 5 }, chain: { chainId: 999, hardfork: 'shanghai' } })
await new Promise((ok) => server.listen(8549, ok))
process.env.HYPEREVM_RPC = 'http://127.0.0.1:8549'
const { createLaunch, twinMsg, snapMsg } = await import('../relay/launch.js')
const { b58, curveOf } = await import('../relay/sol.js')
const { abi, bytecode } = JSON.parse(fs.readFileSync(new URL('../assets/twin.json', import.meta.url)))
const chain = { id: 999, name: 'local', nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 }, rpcUrls: { default: { http: ['http://127.0.0.1:8549'] } } }
const pub = createPublicClient({ chain, transport: http() })
const P = server.provider, [dev, alice, bob, carol] = await P.request({ method: 'eth_accounts', params: [] })
const tx = async (from, data, to) => { const hash = await P.request({ method: 'eth_sendTransaction', params: [{ from, to, data, gas: '0x2dc6c0' }] }); return pub.waitForTransactionReceipt({ hash }) }

let ok = 0, bad = 0
const check = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m) } }
const throws = async (p, m, re) => { try { await p; bad++; console.log('FAIL (should throw)', m) } catch (e) { if (re && !re.test(e.message)) { bad++; console.log('FAIL wrong error', m, e.message) } else ok++ } }

// a Solana creator + three holders, and a fake RPC that knows the coin's curve and their balances
const kp = () => { const sk = ed25519.utils.randomSecretKey(); return { sk, pk: b58(ed25519.getPublicKey(sk)) } }
const creator = kp(), h1 = kp(), h2 = kp(), h3 = kp(), stranger = kp()
const MINT = b58(crypto.getRandomValues(new Uint8Array(32)))
const curve = Buffer.alloc(150); curve.writeBigUInt64LE(1_073_000_000_000_000n, 8); curve.writeBigUInt64LE(30_000_000_000n, 16); Buffer.from((await import('../relay/sol.js')).unb58(creator.pk)).copy(curve, 49)
const bal = { [h1.pk]: 5_000_000_000n, [h2.pk]: 123_456n, [h3.pk]: 0n }
const rpc = async (method, params) => {
  if (method === 'getAccountInfo') return params[0] === curveOf(MINT) ? { value: { data: [curve.toString('base64'), 'base64'] } } : { value: null }
  if (method === 'getTokenAccountsByOwner') { const a = bal[params[0]] || 0n; return { value: a ? [{ account: { data: { parsed: { info: { tokenAmount: { amount: a.toString() } } } } } }] : [] } }
  throw new Error('unexpected ' + method)
}
const sign = (k, msg) => b58(ed25519.sign(new TextEncoder().encode(msg), k.sk))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-'))
const binds = {}
const L = createLaunch({ dir, rpc, coins: new Map(), binds })

// the twin: deployed by the dev's EVM wallet, then linked by the Solana creator
const twin = (await tx(dev, encodeDeployData({ abi, bytecode, args: ['HyperList', 'HYPERLIST', MINT] }))).contractAddress
const other = (await tx(dev, encodeDeployData({ abi, bytecode, args: ['Other', 'OTH', b58(crypto.getRandomValues(new Uint8Array(32)))] }))).contractAddress
await throws(L.twin({ mint: MINT, twin, sig: sign(stranger, twinMsg(MINT, twin)) }), 'a stranger links the twin', /creator wallet/)
await throws(L.twin({ mint: MINT, twin: other, sig: sign(creator, twinMsg(MINT, other)) }), 'a twin of another coin', /different coin/)
await throws(L.snapshot({ mint: MINT, sig: sign(creator, snapMsg(MINT)) }), 'snapshot before a twin', /no twin/)
const t = await L.twin({ mint: MINT, twin, sig: sign(creator, twinMsg(MINT, twin)) })
check(t.coin.symbol === 'HYPERLIST' && t.coin.evmCreator === dev.toLowerCase(), 'twin registered with its creator')
check(L.list().length === 1, 'listed')

// holders bind (h1 and h2 to the same EVM address is allowed: amounts add up), h3 holds nothing
binds[MINT] = { [h1.pk]: { hl: alice.toLowerCase() }, [h2.pk]: { hl: bob.toLowerCase() }, [h3.pk]: { hl: carol.toLowerCase() } }
await throws(L.snapshot({ mint: MINT, sig: sign(stranger, snapMsg(MINT)) }), 'a stranger takes the snapshot', /creator/)
const sp = await L.snapshot({ mint: MINT, sig: sign(creator, snapMsg(MINT)) })
check(sp.holders === 2, 'zero balances left out')
await throws(L.snapshot({ mint: MINT, sig: sign(creator, snapMsg(MINT)) }), 'second snapshot', /already/)
check((await L.onchainRoot(MINT)) === null, 'no root on chain yet')
await tx(dev, encodeFunctionData({ abi, functionName: 'setRoot', args: [sp.root] }), twin)
check((await L.onchainRoot(MINT)) === sp.root, 'root on chain = public snapshot')

// claims with the relay's proofs
const S = L.snap(MINT)
for (const [who, amt] of [[alice, 5_000_000_000n], [bob, 123_456n]]) {
  const e = S.entries.find((x) => x.account === who.toLowerCase())
  const r = await tx(who, encodeFunctionData({ abi, functionName: 'claim', args: [BigInt(e.amount), S.proofs[who.toLowerCase()]] }), twin)
  check(r.status === 'success', 'claim ' + who.slice(0, 8))
  check((await pub.readContract({ address: twin, abi, functionName: 'balanceOf', args: [who] })) === amt, 'balance ' + who.slice(0, 8))
}
check(!S.entries.find((x) => x.account === carol.toLowerCase()), 'carol (0 balance) not in the snapshot')

// metadata upload + serving
const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 0]).toString('base64')
const up = L.upload({ name: 'HyperList', symbol: 'hyperlist', image: png, origin: 'https://hyperlist.vercel.app', description: 'x' })
check(up.uri === `https://hyperlist.vercel.app/m/${up.id}.json`, 'metadata uri on the site domain')
check(JSON.parse(L.serve('m', up.id).body).symbol === 'HYPERLIST' && L.serve('i', up.id).type === 'image/png', 'served back')
await throws(Promise.resolve().then(() => L.upload({ name: 'x', symbol: 'BAD TICKER', image: png })), 'ticker with a space', /1 to 10/)

console.log(`${ok} passed, ${bad} failed`)
server.close(); process.exit(bad ? 1 : 0)
