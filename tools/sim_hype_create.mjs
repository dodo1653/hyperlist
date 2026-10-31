// Builds a HYPE-paired pump.fun create (+ optional first buy) with pump.fun's own SDK and SIMULATES it on mainnet.
// Nothing is signed by a real wallet or sent: simulateTransaction with sigVerify off.
// node tools/sim_hype_create.mjs <simulated-user-pubkey> [hypeToBuy]
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const S = require('@pump-fun/pump-sdk')
// the web3.js copy Anchor (inside the SDK) uses, so keys compare and encode as one type
const W = createRequire(require.resolve('@coral-xyz/anchor'))('@solana/web3.js')
const { Connection, PublicKey, Keypair, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = W
const BN = require('bn.js')

export const HYPE = new PublicKey('98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g')
export const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const conn = new Connection(process.env.RPC || 'https://api.mainnet-beta.solana.com', 'confirmed')
const acct = async (k) => { const a = await conn.getAccountInfo(k); if (a) a.data = Buffer.from(a.data); return a }

export async function hypeLaunchIxs({ user, mint, name, symbol, uri, hypeIn = 0, feeBps = +(process.env.FEE_BPS || 0) }) {
  const global = S.PUMP_SDK.decodeGlobal(await acct(S.GLOBAL_PDA))
  const qc = S.PUMP_SDK.decodeQuoteControl(await acct(S.QUOTE_CONTROL_PDA))
  const listed = qc.mints.find((m) => m.mint.toBase58() === HYPE.toBase58()); if (!listed) throw new Error('HYPE is not a listed quote mint')
  const fee = feeBps > 0 ? { creatorFeeBps: new BN(feeBps) } : {}                    // the creator's rate, fixed at creation
  if (!(hypeIn > 0)) return [await S.PUMP_SDK.createV2Instruction({ mint, name, symbol, uri, creator: user, user, mayhemMode: false, quoteMint: HYPE, quoteTokenProgram: TOKEN, ...fee })]
  // tokens out on a fresh curve: k = vTok * vQuote, ~1.25 % fee taken from the quote first (2 % to stay safe)
  const vTok = BigInt(global.initialVirtualTokenReserves.toString()), vQ = BigInt(listed.initialVirtualQuoteReserves.toString())
  const q = BigInt(Math.floor(hypeIn * 1e9)), net = (q * (10000n - 200n - BigInt(feeBps))) / 10000n, out = vTok - (vTok * vQ) / (vQ + net)
  return S.PUMP_SDK.createV2AndBuyV2Instructions({ global, mint, name, symbol, uri, creator: user, user, amount: new BN(out.toString()), quoteAmount: new BN(q.toString()), mayhemMode: false, quoteMint: HYPE, quoteTokenProgram: TOKEN, slippage: 2, ...fee })
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const user = new PublicKey(process.argv[2]), hypeIn = +(process.argv[3] || 0), mint = Keypair.generate()
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...(await hypeLaunchIxs({ user, mint: mint.publicKey, name: 'Sim Test', symbol: 'SIMT', uri: 'https://example.com/m.json', hypeIn }))]
  const { blockhash } = await conn.getLatestBlockhash()
  // a public lookup table with pump.fun's accounts keeps create + buy inside one transaction
  const lut = (await conn.getAddressLookupTable(new PublicKey(process.env.LUT || 'Hyif6eWb8x88RVrvjPfabsgRYnwkVnyByEXTVTXbUcyP'))).value
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(lut ? [lut] : []))
  console.log('instructions', ixs.length, 'tx bytes', tx.serialize().length)
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true })
  console.log('err', JSON.stringify(sim.value.err), 'units', sim.value.unitsConsumed)
  console.log((sim.value.logs || []).filter((l) => /Instruction:|error|Error|failed|success/i.test(l)).slice(0, 30).join('\n'))
}
