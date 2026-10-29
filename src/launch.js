// HYPEDUAL launcher: one coin on pump.fun (Solana) and its twin on HyperEVM (Hyperliquid), linked by the creator's
// Solana signature. Bundled to assets/launch.js and loaded only when someone opens the launcher or a twin action.
import { Buffer } from 'buffer'
globalThis.Buffer = globalThis.Buffer || Buffer
import { Keypair, VersionedTransaction } from '@solana/web3.js'
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
export async function connectEvm() {
  const e = window.ethereum; if (!e) throw new Error('no EVM wallet found (Rabby, MetaMask…)')
  const [a] = await e.request({ method: 'eth_requestAccounts' })
  if ((await e.request({ method: 'eth_chainId' })) !== HYPEREVM.chainId) {
    try { await e.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: HYPEREVM.chainId }] }) }
    catch (x) { if (x.code === 4902 || /unrecognized|not added/i.test(x.message || '')) await e.request({ method: 'wallet_addEthereumChain', params: [HYPEREVM] }); else throw x }
  }
  return a.toLowerCase()
}
async function evmSend(from, tx, note) {
  const e = window.ethereum
  const hash = await e.request({ method: 'eth_sendTransaction', params: [{ from, ...tx }] })
  note?.('waiting for HyperEVM…')
  for (let i = 0; i < 90; i++) {
    const r = await e.request({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => null)
    if (r) { if (r.status !== '0x1') throw new Error('the HyperEVM transaction reverted'); return r }
    await sleep(1500)
  }
  throw new Error('HyperEVM did not confirm in time: ' + hash)
}

// ------------------------------------------------------------ step 1 + 2: the pump.fun coin
export async function launchPump({ name, symbol, description, twitter, image, buy, sol }, note) {
  note('uploading the coin\'s picture and details…')
  const up = await api('upload', '', { name, symbol, description, twitter, image, origin: location.origin }); if (up.error) throw new Error(up.error)
  const mint = Keypair.generate()
  note('building the pump.fun launch…')
  const r = await fetch('https://pumpportal.fun/api/trade-local', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey: sol, action: 'create', tokenMetadata: { name, symbol, uri: up.uri }, mint: mint.publicKey.toBase58(), denominatedInSol: 'true', amount: Math.max(0, +buy || 0), slippage: 15, priorityFee: 0.0005, pool: 'pump' }) })
  if (r.status !== 200) throw new Error('could not build the launch (' + r.status + ')')
  const tx = VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()))
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
window.HLX = { connectSol, connectEvm, launchPump, deployTwin, takeSnapshot, postRoot, claim }
