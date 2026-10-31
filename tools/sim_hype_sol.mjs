// A HYPE-paired create + first buy paid in SOL: a Jupiter SOL->HYPE swap (exact HYPE out) in front of pump.fun's
// create_v2 + buy_v2, in ONE v0 transaction with all lookup tables, simulated on mainnet from a funded wallet.
// node tools/sim_hype_sol.mjs [hype] [payer]
import { createRequire } from 'node:module'
import { hypeLaunchIxs, HYPE } from './sim_hype_create.mjs'
const require = createRequire(import.meta.url)
const W = createRequire(require.resolve('@coral-xyz/anchor'))('@solana/web3.js')
const { Connection, PublicKey, Keypair, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, TransactionInstruction } = W
const hype = +(process.argv[2] || 0.5), user = new PublicKey(process.argv[3] || '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9')
const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed'), JUP = 'https://lite-api.jup.ag/swap/v1'
const raw = Math.ceil(hype * 1e9)
const quote = await (await fetch(`${JUP}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${HYPE.toBase58()}&amount=${raw}&swapMode=ExactOut&slippageBps=100&maxAccounts=20`)).json()
if (quote.error) { console.log('quote error', quote); process.exit(1) }
console.log('quote: in', quote.inAmount / 1e9, 'SOL for', quote.outAmount / 1e9, 'HYPE via', quote.routePlan.map((r) => r.swapInfo.label).join(' > '))
const si = await (await fetch(`${JUP}/swap-instructions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteResponse: quote, userPublicKey: user.toBase58(), wrapAndUnwrapSol: true }) })).json()
if (si.error) { console.log('swap-instructions error', si); process.exit(1) }
const ix = (x) => new TransactionInstruction({ programId: new PublicKey(x.programId), keys: x.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })), data: Buffer.from(x.data, 'base64') })
const mint = Keypair.generate()
const launch = await hypeLaunchIxs({ user, mint: mint.publicKey, name: 'Sim', symbol: 'Sim', uri: 'https://hype-edge.vercel.app/m/x.json', hypeIn: hype })
const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 700_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }),
  ...(si.setupInstructions || []).map(ix), ix(si.swapInstruction), ...(si.cleanupInstruction ? [ix(si.cleanupInstruction)] : []), ...launch]
const luts = (await Promise.all([new PublicKey('Hyif6eWb8x88RVrvjPfabsgRYnwkVnyByEXTVTXbUcyP'), ...(si.addressLookupTableAddresses || []).map((a) => new PublicKey(a))].map((k) => conn.getAddressLookupTable(k)))).map((r) => r.value).filter(Boolean)
const tx = new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: (await conn.getLatestBlockhash()).blockhash, instructions: ixs }).compileToV0Message(luts))
let size; try { size = tx.serialize().length } catch (e) { size = 'TOO LARGE: ' + e.message }
console.log('instructions', ixs.length, 'lookup tables', luts.length, 'tx bytes', size)
const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true })
console.log('err', JSON.stringify(sim.value.err), 'units', sim.value.unitsConsumed)
console.log((sim.value.logs || []).filter((l) => /Instruction: (Create|Buy|Route|Shared|Exact)|error|failed/i.test(l)).slice(0, 14).join('\n'))
