// A real pump.fun create built around a pool vanity mint, signed by a throwaway payer, co-signed by the pool, then
// simulated on mainnet WITH signature checks: it must fail only for the payer's missing SOL, never on signatures.
// node tools/sim_vanity.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { createRequire } from 'node:module'
import { createVanity } from '../relay/vanity.js'
import { hypeLaunchIxs } from './sim_hype_create.mjs'
const require = createRequire(import.meta.url), W = createRequire(require.resolve('@coral-xyz/anchor'))('@solana/web3.js')
const conn = new W.Connection('https://api.mainnet-beta.solana.com', 'confirmed')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanity-')), v = createVanity({ dir, suffix: 'hy', target: 1, threads: 2 })
while (!v.status().free) await new Promise((r) => setTimeout(r, 100))
const { mint } = v.reserve(), payer = W.Keypair.generate()
const ixs = [W.ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...(await hypeLaunchIxs({ user: payer.publicKey, mint: new W.PublicKey(mint), name: 'Sim', symbol: 'SIM', uri: 'https://example.com/m.json' }))]
const { blockhash } = await conn.getLatestBlockhash()
const tx = new W.VersionedTransaction(new W.TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message())
tx.sign([payer])
const signed = W.VersionedTransaction.deserialize(Buffer.from(v.cosign(Buffer.from(tx.serialize()).toString('base64'), mint), 'base64'))
const sim = await conn.simulateTransaction(signed, { sigVerify: true })
console.log('mint', mint, '| simulate err:', JSON.stringify(sim.value.err))
v.stop(); fs.rmSync(dir, { recursive: true })
const ok = sim.value.err && !/Signature/i.test(JSON.stringify(sim.value.err))
console.log(ok ? 'pass: signatures accepted, fails only on the empty payer' : 'FAIL'); process.exit(ok ? 0 : 1)
