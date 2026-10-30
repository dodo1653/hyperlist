// HYPEDUAL launcher: one coin on pump.fun (Solana) and its twin on HyperEVM (Hyperliquid), linked by the creator's
// Solana signature. Bundled to assets/launch.js and loaded only when someone opens the launcher or a twin action.
import { Buffer } from 'buffer'
globalThis.Buffer = globalThis.Buffer || Buffer
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js'
import * as P from '@pump-fun/pump-sdk'
import BN from 'bn.js'
import { encodeDeployData, encodeFunctionData } from 'viem'

const api = (path, q = '', body) => fetch(`/api/r?path=${path}${q}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' }).then((r) => r.json())
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58 = (u8) => { let x = 0n; for (const b of u8) x = x * 256n + BigInt(b); let s = ''; while (x > 0n) { s = B58[Number(x % 58n)] + s; x /= 58n } for (const b of u8) { if (b) break; s = '1' + s } return s }
let TWIN = null
const twinArt = async () => (TWIN ||= await fetch('assets/twin.json').then((r) => r.json()))

// ------------------------------------------------------------ wallets
export function solWallet() { return window.phantom?.solana || window.solflare || window.backpack || (window.solana?.signTransaction ? window.solana : null) }
export async function connectSol() {
  const w = solWallet(); if (!w) throw new Error('no Solana wallet found (Phantom, Solflare or Backpack)')
  const r = await w.connect(); return (r?.publicKey || w.publicKey).toString()
}
async function signText(text) { const w = solWallet(); const out = await w.signMessage(new TextEncoder().encode(text), 'utf8'); return b58(out.signature || out) }
const HYPEREVM = { chainId: '0x3e7', chainName: 'HyperEVM', nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 }, rpcUrls: ['https://rpc.hyperliquid.xyz/evm'], blockExplorerUrls: ['https://hyperevmscan.io'] }
// EVM wallets announce themselves (EIP-6963); several can be installed at once. Phantom's EVM side refuses accounts
// that are Solana-only, so a dedicated EVM wallet (Rabby, MetaMask, ...) is preferred when there is one.
const evmWallets = []
addEventListener('eip6963:announceProvider', (e) => { if (!evmWallets.some((w) => w.info.uuid === e.detail.info.uuid)) evmWallets.push(e.detail) })
dispatchEvent(new Event('eip6963:requestProvider'))
let EVM = null, EVM_NAME = ''
export const evmChoices = () => evmWallets.map((w) => ({ name: w.info.name, rdns: w.info.rdns, icon: w.info.icon }))
function pickEvm(rdns) {
  if (rdns) { const w = evmWallets.find((x) => x.info.rdns === rdns); if (w) return w }
  return evmWallets.find((w) => !/phantom/i.test(w.info.rdns + w.info.name)) || evmWallets[0] || (window.ethereum ? { provider: window.ethereum, info: { name: 'browser wallet', rdns: '' } } : null)
}
export async function connectEvm(rdns) {
  const w = pickEvm(rdns); if (!w) throw new Error('no EVM wallet found: install Rabby or MetaMask to deploy the twin on HyperEVM')
  const e = w.provider
  let a
  try { [a] = await e.request({ method: 'eth_requestAccounts' }) }
  catch (x) {
    if (/phantom/i.test(w.info.rdns + w.info.name)) throw new Error('Phantom refused: this Phantom account is Solana-only. Use Rabby or MetaMask for the HyperEVM step, or a Phantom account made from a recovery phrase')
    throw new Error((x && x.message) || 'the EVM wallet refused')
  }
  if ((await e.request({ method: 'eth_chainId' })) !== HYPEREVM.chainId) {
    try { await e.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: HYPEREVM.chainId }] }) }
    catch (x) { if (x.code === 4902 || /unrecognized|not added/i.test(x.message || '')) await e.request({ method: 'wallet_addEthereumChain', params: [HYPEREVM] }); else throw x }
  }
  EVM = e; EVM_NAME = w.info.name
  return a.toLowerCase()
}
export const evmName = () => EVM_NAME
async function evmSend(from, tx, note) {
  const e = EVM || window.ethereum
  const hash = await e.request({ method: 'eth_sendTransaction', params: [{ from, ...tx }] })
  note?.('waiting for HyperEVM…')
  for (let i = 0; i < 90; i++) {
    const r = await e.request({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => null)
    if (r) { if (r.status !== '0x1') throw new Error('the HyperEVM transaction reverted'); return r }
    await sleep(1500)
  }
  throw new Error('HyperEVM did not confirm in time: ' + hash)
}

// ------------------------------------------------------------ step 1 + 2: the pump.fun coin, paired with HYPE (or SOL)
// Built with pump.fun's own SDK (create_v2 with a listed quote mint, then buy_v2), simulated before the wallet signs.
const RPC = 'https://solana-rpc.publicnode.com'
export const HYPE = new PublicKey('98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g')        // HYPE on Solana, a pump.fun listed quote mint
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const LUT = new PublicKey('Hyif6eWb8x88RVrvjPfabsgRYnwkVnyByEXTVTXbUcyP')           // public lookup table with pump.fun's accounts (create + buy fit one tx)
const conn = () => new Connection(RPC, 'confirmed')
const acct = async (c, k) => { const a = await c.getAccountInfo(k); if (a) a.data = Buffer.from(a.data); return a }
// the wallet's HYPE: its associated token account (public RPCs refuse owner-wide token scans)
export async function hypeBalance(owner) {
  const ata = PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), TOKEN.toBuffer(), HYPE.toBuffer()], new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))[0]
  const a = await conn().getAccountInfo(ata)                                       // token account: amount is a u64 at byte 64
  return a ? Number(Buffer.from(a.data).readBigUInt64LE(64)) / 1e9 : 0
}
async function buildLaunch({ user, mint, name, symbol, uri, buy, pair }) {
  const c = conn(), global = P.PUMP_SDK.decodeGlobal(await acct(c, P.GLOBAL_PDA)), q = BigInt(Math.floor(Math.max(0, +buy || 0) * 1e9))
  const base = { global, mint, name, symbol, uri, creator: user, user, mayhemMode: false }
  let vQ = BigInt(global.initialVirtualSolReserves.toString()), quote = {}
  if (pair === 'HYPE') {
    const qc = P.PUMP_SDK.decodeQuoteControl(await acct(c, P.QUOTE_CONTROL_PDA)), listed = qc.mints.find((m) => m.mint.toBase58() === HYPE.toBase58())
    if (!listed) throw new Error('pump.fun does not list HYPE as a pair right now')
    vQ = BigInt(listed.initialVirtualQuoteReserves.toString()); quote = { quoteMint: HYPE, quoteTokenProgram: TOKEN }
  }
  let ixs
  if (q > 0n) {
    const vTok = BigInt(global.initialVirtualTokenReserves.toString()), out = vTok - (vTok * vQ) / (vQ + (q * 98n) / 100n)   // ~1.25 % fees, 2 % kept back
    ixs = await P.PUMP_SDK.createV2AndBuyV2Instructions({ ...base, ...quote, amount: new BN(out.toString()), quoteAmount: new BN(q.toString()), slippage: 2 })
  } else ixs = [await P.PUMP_SDK.createV2Instruction({ ...base, ...quote })]
  ixs.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 }))
  const lut = (await c.getAddressLookupTable(LUT)).value, { blockhash } = await c.getLatestBlockhash()
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(lut ? [lut] : []))
  const sim = await c.simulateTransaction(tx, { sigVerify: false })
  if (sim.value.err) { const code = JSON.stringify(sim.value.err).match(/Custom":(\d+)/)?.[1]; throw new Error(code === '6010' ? 'not enough ' + (pair === 'HYPE' ? 'HYPE' : 'SOL') + ' for that buy' : 'the launch would fail on chain: ' + JSON.stringify(sim.value.err).slice(0, 120)) }
  return tx
}
export async function launchPump({ name, symbol, description, twitter, image, buy, sol, pair = 'HYPE' }, note) {
  if (pair === 'HYPE' && +buy > 0) { const have = await hypeBalance(sol); if (have < +buy) throw new Error(`your wallet holds ${have.toFixed(3)} HYPE on Solana; lower the buy or add HYPE`) }
  note('uploading the coin\'s picture and details…')
  const up = await api('upload', '', { name, symbol, description, twitter, image, origin: location.origin }); if (up.error) throw new Error(up.error)
  const mint = Keypair.generate()
  note(`building the pump.fun launch (${pair} pair) and checking it on chain…`)
  const tx = await buildLaunch({ user: new PublicKey(sol), mint: mint.publicKey, name, symbol, uri: up.uri, buy, pair })
  tx.sign([mint])
  note('sign the launch in your Solana wallet')
  const signed = await solWallet().signTransaction(tx)
  note('sending to Solana…')
  const s = await api('send', '', { tx: Buffer.from(signed.serialize()).toString('base64') }); if (s.error) throw new Error(s.error)
  const m = mint.publicKey.toBase58()
  for (let i = 0; i < 40; i++) { const c = await api('coin', '&mint=' + m); if (!c.error) return { mint: m, sig: s.signature, image: up.image }; await sleep(1500) }
  throw new Error('the launch was sent (' + s.signature + ') but has not shown up on chain yet')
}

// ------------------------------------------------------------ step 3 + 4: the HyperEVM twin, linked by the Solana creator
export async function deployTwin({ mint, name, symbol, image, evm }, note) {
  const { abi, bytecode } = await twinArt()
  note('deploy the twin in your EVM wallet (HyperEVM, a few cents of HYPE)')
  const rc = await evmSend(evm, { data: encodeDeployData({ abi, bytecode, args: [name, symbol, mint] }) }, note)
  const twin = rc.contractAddress
  note('sign the link with the coin\'s Solana wallet')
  const { msg } = await api('twinmsg', `&mint=${mint}&twin=${twin}`)
  const sig = await signText(msg)
  note('checking the twin on HyperEVM…')
  const r = await api('twin', '', { mint, twin, sig, meta: { image } }); if (r.error) throw new Error(r.error)
  return twin
}

// ------------------------------------------------------------ after launch: snapshot, root, claims
export async function takeSnapshot(mint) { const { msg } = await api('snapmsg', '&mint=' + mint); const r = await api('snapshot', '', { mint, sig: await signText(msg) }); if (r.error) throw new Error(r.error); return r }
export async function postRoot({ twin, root, evm }, note) { const { abi } = await twinArt(); return evmSend(evm, { to: twin, data: encodeFunctionData({ abi, functionName: 'setRoot', args: [root] }) }, note) }
export async function claim({ mint, twin, evm }, note) {
  const p = await api('proof', `&mint=${mint}&account=${evm}`); if (p.error) throw new Error(p.error)
  const { abi } = await twinArt()
  return evmSend(evm, { to: twin, data: encodeFunctionData({ abi, functionName: 'claim', args: [BigInt(p.amount), p.proof] }) }, note)
}
// dry run: build + simulate a launch for any wallet address, nothing uploaded, nothing signed
export const dryRun = async (sol, buy, pair = 'HYPE') => { await buildLaunch({ user: new PublicKey(sol), mint: Keypair.generate().publicKey, name: 'Dry Run', symbol: 'DRY', uri: 'https://example.com/m.json', buy, pair }); return 'ok' }
window.HLX = { connectSol, connectEvm, evmChoices, evmName, hypeBalance, dryRun, launchPump, deployTwin, takeSnapshot, postRoot, claim }
