// The pad's keeper. Every 10 minutes, for each coin on the pad (quoted in $HypeEdge, fee split 90 % creator / 10 %
// buyback): pays out its creator fees with pump.fun's own distribute instruction (permissionless; the creator's 90 % lands
// in their wallet, the 10 % in the buyback wallet, both in $HypeEdge), then burns every $HypeEdge the buyback wallet
// holds. Each burn is logged to relay/.data/burns.json, which the site shows with its Solscan link.
// The buyback wallet pays the network fees: keep ~0.02 SOL in it. Its key is relay/.data/buyback.json (never commit).
// node tools/keeper.mjs [--once] [--dry]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url), P = require('@pump-fun/pump-sdk')
const W = createRequire(require.resolve('@coral-xyz/anchor'))('@solana/web3.js')
const { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, TransactionInstruction } = W

const DATA = path.resolve('relay/.data'), HE = new PublicKey('6n3kqX8zh36J7uFvPnjj9FtXyaS9uEp74VeFa1tAhype'), TOK22 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
const ONCE = process.argv.includes('--once'), DRY = process.argv.includes('--dry'), RELAY = process.env.RELAY || 'http://127.0.0.1:8798'
const c = new Connection(process.env.RPC || 'https://api.mainnet-beta.solana.com', 'confirmed'), online = new P.OnlinePumpSdk(c)
const k = JSON.parse(fs.readFileSync(path.join(DATA, 'buyback.json'), 'utf8')), buyback = Keypair.fromSeed(Buffer.from(k.seed, 'hex'))
const ata = PublicKey.findProgramAddressSync([buyback.publicKey.toBuffer(), TOK22.toBuffer(), HE.toBuffer()], new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))[0]
const burnsFile = path.join(DATA, 'burns.json'), burns = (() => { try { return JSON.parse(fs.readFileSync(burnsFile, 'utf8')) } catch { return { total: 0, list: [] } } })()
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function send(ixs, label) {
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: buyback.publicKey, recentBlockhash: (await c.getLatestBlockhash()).blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }), ...ixs] }).compileToV0Message())
  tx.sign([buyback])
  const sim = await c.simulateTransaction(tx, { sigVerify: true }); if (sim.value.err) { log(label, 'skipped:', JSON.stringify(sim.value.err)); return null }
  if (DRY) { log(label, 'ok (dry run, not sent)'); return null }
  const sig = await c.sendRawTransaction(tx.serialize(), { maxRetries: 5 })
  for (let i = 0; i < 60; i++) { const st = (await c.getSignatureStatuses([sig])).value[0]; if (st?.err) { log(label, 'failed', sig); return null } if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') { log(label, sig); return sig } await new Promise((r) => setTimeout(r, 1000)) }
  log(label, 'unconfirmed', sig); return null
}
async function round() {
  const pad = await (await fetch(`${RELAY}/v1/pad`)).json().catch(() => null); if (!pad?.coins) { log('relay unreachable'); return }
  for (const coin of pad.coins.filter((x) => !x.graduated)) {
    try {
      const r = await online.buildDistributeCreatorFeesInstructions(new PublicKey(coin.mint), { quoteMint: HE, quoteTokenProgram: TOK22, payer: buyback.publicKey })
      if (r?.instructions?.length) await send(r.instructions, `distribute ${coin.symbol || coin.mint.slice(0, 6)}`)
    } catch (e) { log('distribute', coin.mint.slice(0, 6), e.message) }
  }
  const a = await c.getAccountInfo(ata); const raw = a ? Buffer.from(a.data).readBigUInt64LE(64) : 0n
  if (raw > 0n) {
    const data = Buffer.alloc(10); data[0] = 15; data.writeBigUInt64LE(raw, 1); data[9] = 6          // Token-2022 BurnChecked, 6 decimals
    const sig = await send([new TransactionInstruction({ programId: TOK22, keys: [{ pubkey: ata, isSigner: false, isWritable: true }, { pubkey: HE, isSigner: false, isWritable: true }, { pubkey: buyback.publicKey, isSigner: true, isWritable: false }], data })], `burn ${Number(raw) / 1e6} $HypeEdge`)
    if (sig) { burns.total += Number(raw) / 1e6; burns.list.unshift({ at: Date.now(), amount: Number(raw) / 1e6, sig }); burns.list.splice(200); fs.writeFileSync(burnsFile, JSON.stringify(burns)) }
  } else log('nothing to burn yet')
}
log('keeper for', buyback.publicKey.toBase58(), DRY ? '(dry run)' : '')
await round()
if (!ONCE) setInterval(() => round().catch((e) => log('round', e.message)), 10 * 60_000)
