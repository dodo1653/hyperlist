// The vanity pool: grinds keys with a short suffix, reserves one, co-signs a v0 pump.fun-shaped transaction after the
// payer signed, and both signatures verify. node tools/test_vanity.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { createRequire } from 'node:module'
import { createVanity } from '../relay/vanity.js'
const require = createRequire(import.meta.url)
const W = createRequire(require.resolve('@coral-xyz/anchor'))('@solana/web3.js')
const { ed25519 } = await import('../relay/node_modules/@noble/curves/ed25519.js')
let ok = 0, bad = 0; const check = (c, m) => { c ? ok++ : bad++; console.log(c ? 'pass' : 'FAIL', m) }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanity-'))
const v = createVanity({ dir, suffix: 'hy', target: 2, threads: 2 })
const t0 = Date.now(); while (v.status().free < 2 && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 200))
check(v.status().free === 2 && !v.status().grinding, `ground 2 keys ending "hy" in ${((Date.now() - t0) / 1000).toFixed(1)} s, then stopped`)
const { mint } = v.reserve(); check(mint && mint.endsWith('hy'), 'reserved ' + mint)
check(v.status().free === 1, 'a reserved key is not handed out twice')
const payer = W.Keypair.generate(), mintPk = new W.PublicKey(mint)
const ix = new W.TransactionInstruction({ programId: new W.PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'), keys: [{ pubkey: mintPk, isSigner: true, isWritable: true }, { pubkey: payer.publicKey, isSigner: true, isWritable: true }], data: Buffer.from([1, 2, 3]) })
const tx = new W.VersionedTransaction(new W.TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: W.Keypair.generate().publicKey.toBase58(), instructions: [ix] }).compileToV0Message())
tx.sign([payer])
const out = W.VersionedTransaction.deserialize(Buffer.from(v.cosign(Buffer.from(tx.serialize()).toString('base64'), mint), 'base64'))
const msg = out.message.serialize(), keys = out.message.staticAccountKeys
check(keys.every((k, i) => i >= out.message.header.numRequiredSignatures || ed25519.verify(out.signatures[i], msg, k.toBytes())), 'payer and vanity mint signatures both verify')
let threw = false; try { v.cosign(Buffer.from(tx.serialize()).toString('base64'), payer.publicKey.toBase58()) } catch { threw = true }
check(threw, 'refuses to sign for an address that is not in the pool')
const other = new W.VersionedTransaction(new W.TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: W.Keypair.generate().publicKey.toBase58(), instructions: [W.SystemProgram.transfer({ fromPubkey: mintPk, toPubkey: payer.publicKey, lamports: 1 })] }).compileToV0Message())
threw = false; try { v.cosign(Buffer.from(other.serialize()).toString('base64'), mint) } catch { threw = true }
check(threw, 'refuses a transaction that is not a pump.fun one')
v.spent(mint, 'sig'); check(!v.isVanity(mint) && JSON.parse(fs.readFileSync(path.join(dir, 'vanity.json'), 'utf8')).used.length === 1, 'a sent key is retired')
v.stop(); fs.rmSync(dir, { recursive: true }); console.log(`${ok} pass, ${bad} fail`); process.exit(bad ? 1 : 0)
