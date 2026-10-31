// The SOL->HYPE swap the launcher builds for a HYPE-pair buy paid in SOL (Jupiter, exact HYPE out), simulated on
// mainnet from a funded wallet with no HYPE (signature checks off, nothing sent). node tools/sim_sol_swap.mjs [hype]
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url), W = createRequire(require.resolve('@coral-xyz/anchor'))('@solana/web3.js')
const JUP = 'https://lite-api.jup.ag/swap/v1', HYPE = '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g', user = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9'
const raw = Math.ceil(+(process.argv[2] || 0.5) * 1.003 * 1e9)
const quote = await (await fetch(`${JUP}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${HYPE}&amount=${raw}&swapMode=ExactOut&slippageBps=100`)).json()
const r = await (await fetch(`${JUP}/swap`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteResponse: quote, userPublicKey: user, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 400000, priorityLevel: 'high' } } }) })).json()
const tx = W.VersionedTransaction.deserialize(Buffer.from(r.swapTransaction, 'base64'))
const c = new W.Connection('https://api.mainnet-beta.solana.com', 'confirmed')
const sim = await c.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, accounts: { encoding: 'jsonParsed', addresses: [] } })
console.log('swap', quote.inAmount / 1e9, 'SOL ->', quote.outAmount / 1e9, 'HYPE |', tx.serialize().length, 'bytes | err', JSON.stringify(sim.value.err), '| units', sim.value.unitsConsumed)
