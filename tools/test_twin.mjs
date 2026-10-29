// Deploys HyperTwin on a local chain and runs the whole life: snapshot, claims, refusals, transfers.
// node tools/test_twin.mjs
import fs from 'node:fs'
import ganache from 'ganache'
import { createPublicClient, custom, encodeDeployData, encodeFunctionData } from 'viem'
import { build } from '../relay/merkle.js'
const { abi, bytecode } = JSON.parse(fs.readFileSync(new URL('../assets/twin.json', import.meta.url)))
const provider = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 6 }, chain: { chainId: 999, hardfork: 'shanghai' } })
const chain = { id: 999, name: 'local', nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 }, rpcUrls: { default: { http: ['x'] } } }
const pub = createPublicClient({ chain, transport: custom(provider) })
const accts = await provider.request({ method: 'eth_accounts', params: [] })
const tx = async (from, data, to) => { const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from, to, data, gas: '0x2dc6c0' }] }); return pub.waitForTransactionReceipt({ hash }) }
const [creator, alice, bob, carol, mallory] = accts
let ok = 0, bad = 0
const check = (cond, msg) => { if (cond) ok++; else { bad++; console.log('FAIL', msg) } }
const rejects = async (p, msg) => { try { await p; bad++; console.log('FAIL (should revert)', msg) } catch { ok++ } }
const send = async (a, fn, args) => { const r = await tx(a, encodeFunctionData({ abi, functionName: fn, args }), twin); if (r.status !== 'success') throw new Error('reverted'); return r }
const read = (fn, args = []) => pub.readContract({ address: twin, abi, functionName: fn, args })

const MINT = 'CiXUtggr2rKf9tjSMueF7JThXGcF5oK1w2GKXjppump'
const dr = await tx(creator, encodeDeployData({ abi, bytecode, args: ['HypeDual', 'HYPEDUAL', MINT] })); const twin = dr.contractAddress
console.log('deployed', twin, 'gas', dr.gasUsed)
check(dr.gasUsed < 2_000_000n, 'fits a HyperEVM small block (2M gas)')
check((await read('solMint')) === MINT, 'solMint'); check((await read('creator')).toLowerCase() === creator.toLowerCase(), 'creator')
check((await read('balanceOf', [twin])) === 1_000_000_000_000_000n, 'all supply in the contract')

const snap = [{ account: alice, amount: '25000000000000' }, { account: bob, amount: '1234567' }, { account: carol, amount: '999000000' }]
const { root, proofs } = build(snap)
await rejects(send(alice, 'claim', ['25000000000000', proofs[alice.toLowerCase()]]), 'claim before snapshot')
await rejects(send(mallory, 'setRoot', [root]), 'non-creator setRoot')
await send(creator, 'setRoot', [root]); check((await read('root')) === root, 'root set')
await rejects(send(creator, 'setRoot', ['0x' + '11'.repeat(32)]), 'root changed twice')
const r1 = await send(alice, 'claim', ['25000000000000', proofs[alice.toLowerCase()]]); console.log('claim gas', r1.gasUsed)
check((await read('balanceOf', [alice])) === 25000000000000n, 'alice got her amount')
await rejects(send(alice, 'claim', ['25000000000000', proofs[alice.toLowerCase()]]), 'double claim')
await rejects(send(bob, 'claim', ['9999999', proofs[bob.toLowerCase()]]), 'bob claims more than snapshot')
await rejects(send(mallory, 'claim', ['1234567', proofs[bob.toLowerCase()]]), "mallory uses bob's proof")
await send(bob, 'claim', ['1234567', proofs[bob.toLowerCase()]]); await send(carol, 'claim', ['999000000', proofs[carol.toLowerCase()]])
check((await read('balanceOf', [carol])) === 999000000n, 'carol claimed')
await send(alice, 'transfer', [mallory, 5n]); check((await read('balanceOf', [mallory])) === 5n, 'transfer')
await send(alice, 'approve', [bob, 10n]); await send(bob, 'transferFrom', [alice, carol, 10n]); check((await read('allowance', [alice, bob])) === 0n, 'transferFrom')
await rejects(send(bob, 'transferFrom', [alice, carol, 1n]), 'transferFrom over allowance')
// a bigger tree: 37 holders, odd layers
const many = Array.from({ length: 37 }, (_, i) => ({ account: '0x' + (i + 1).toString(16).padStart(40, '0'), amount: String(1000 + i) }))
const big = build(many)
check(Object.values(big.proofs).every((p) => p.length <= 6), 'proof depth')
console.log(`${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
