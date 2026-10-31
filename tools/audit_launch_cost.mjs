// Every lamport a launch from our site moves: builds the same transaction as src/launch.js (pump.fun SDK create_v2
// + buy_v2, compute budget, lookup table), simulates it on mainnet for a funded payer, and prints each account's SOL change.
// node tools/audit_launch_cost.mjs [buySol=0.1] [payer]
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url), P = require('@pump-fun/pump-sdk'), BN = require('bn.js')
const W = createRequire(require.resolve('@coral-xyz/anchor'))('@solana/web3.js')
const { Connection, PublicKey, Keypair, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = W
const buy = +(process.argv[2] ?? 0.1), user = new PublicKey(process.argv[3] || '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9')
const c = new Connection('https://api.mainnet-beta.solana.com', 'confirmed'), mint = Keypair.generate().publicKey
const acct = async (k) => { const a = await c.getAccountInfo(k); if (a) a.data = Buffer.from(a.data); return a }
const global = P.PUMP_SDK.decodeGlobal(await acct(P.GLOBAL_PDA)), q = BigInt(Math.floor(buy * 1e9))
const base = { global, mint, name: 'Audit', symbol: 'AUDIT', uri: 'https://hyperedgechain.vercel.app/m/x.json', creator: user, user, mayhemMode: false }
let ixs
if (q > 0n) {
  const vTok = BigInt(global.initialVirtualTokenReserves.toString()), vQ = BigInt(global.initialVirtualSolReserves.toString()), out = vTok - (vTok * vQ) / (vQ + (q * 98n) / 100n)
  ixs = await P.PUMP_SDK.createV2AndBuyV2Instructions({ ...base, amount: new BN(out.toString()), quoteAmount: new BN(q.toString()), slippage: 2 })
} else ixs = [await P.PUMP_SDK.createV2Instruction(base)]
ixs.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 }))
const lut = (await c.getAddressLookupTable(new PublicKey('Hyif6eWb8x88RVrvjPfabsgRYnwkVnyByEXTVTXbUcyP'))).value
const msg = new TransactionMessage({ payerKey: user, recentBlockhash: (await c.getLatestBlockhash()).blockhash, instructions: ixs }).compileToV0Message([lut])
const keys = msg.getAccountKeys({ addressLookupTableAccounts: [lut] }), all = [...keys.staticAccountKeys, ...keys.accountKeysFromLookups.writable, ...keys.accountKeysFromLookups.readonly]
const pre = await c.getMultipleAccountsInfo(all)
const sim = await c.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, accounts: { encoding: 'base64', addresses: all.map(String) } })
console.log(`buy ${buy} SOL | err ${JSON.stringify(sim.value.err)} | units ${sim.value.unitsConsumed}`)
const progs = new Set(ixs.map((i) => i.programId.toBase58()))
let total = 0
all.forEach((k, i) => {
  const a = (pre[i]?.lamports || 0) / 1e9, b = (sim.value.accounts[i]?.lamports || 0) / 1e9, d = b - a; if (Math.abs(d) < 1e-9) return
  const who = k.equals(user) ? 'YOU (payer)' : k.equals(mint) ? 'the new mint (rent)' : progs.has(k.toBase58()) ? 'program' : ''
  console.log(`  ${k.toBase58().padEnd(44)} ${(d >= 0 ? '+' : '') + d.toFixed(6)} SOL  ${who}`)
  if (k.equals(user)) total = d
})
const priority = 400_000 * 250_000 / 1e6 / 1e9, base_fee = 5000 * msg.header.numRequiredSignatures / 1e9
console.log(`  network fee: ${base_fee} SOL base + up to ${priority} SOL priority (paid to validators, not in the list above)`)
console.log(`  payer total (sim, before network fee): ${total.toFixed(6)} SOL`)
