# HYPEDUAL

Launch on pump.fun. Land on Hyperliquid.

One flow puts a coin on pump.fun and deploys its twin on HyperEVM (Hyperliquid's EVM), linked by the creator's Solana signature:

1. **pump.fun**: the coin is created from the creator's wallet (PumpPortal builds the transaction, the wallet signs it). Its metadata lives on this site's domain (`/m/<id>.json`, `/i/<id>`).
2. **HyperEVM twin**: the creator's EVM wallet deploys `contracts/HyperTwin.sol`: same name and ticker, 1B supply, 6 decimals, the pump.fun mint written into the contract, no mint, pause, fee or admin keys.
3. **The link**: the coin's Solana creator signs `twin of <mint> is <0x…>`; the relay checks the signature against the bonding curve's creator and reads the contract on HyperEVM before listing it.
4. **Holders claim**: holders bind an address with their Solana wallet; the creator takes ONE snapshot (signed), posts its root ONCE, and every holder claims their exact balance. The snapshot is public and the page compares it with the root on chain.
5. **HyperCore ticker**: the twin is what a HIP-1 deployment links to a Hyperliquid order book ticker. The live meter below tracks the creator's fees against that auction.

`node tools/build.mjs` compiles the contract into `assets/twin.json`; `node tools/test_twin.mjs` (17 checks) and `node tools/test_flow.mjs` (18 checks, the relay's launch flow against a local chain) run the tests. `src/launch.js` is bundled to `assets/launch.js` with esbuild.

## The meter

Every bonding-curve trade on pump.fun pays the coin's creator 0.30 %. A ticker on Hyperliquid costs one thing: the HIP-1 spot deploy auction (a 31-hour Dutch auction that falls to 500 HYPE). HYPEDUAL reads both live and puts them on one meter, for any coin.

## What is live
- **The auction**: `spotDeployState` from `api.hyperliquid.xyz/info`, HYPE / SOL from `allMids`, the newest HIP-1 tokens from `spotMeta`.
- **The fees**: every pump.fun trade from the program logs; each trade event carries the creator and the creator's fee.
- **The vaults**: each creator's unclaimed fees on chain (the pump.fun `creator-vault` PDA + the PumpSwap `creator_vault` WSOL account).
- **Binding**: holders sign one message with their Solana wallet linking a Hyperliquid (0x…) address, for the HyperCore twin's genesis balances. The relay verifies the ed25519 signature. Nothing moves.

## Run it
```
cd relay && npm i && node server.mjs      # http://127.0.0.1:8798/v1/state
node devserver.mjs                         # http://127.0.0.1:8805
```
On Vercel the page talks to the relay through `api/r.js`; the relay's address is in `api/_relay.js`.

Independent; not affiliated with pump.fun or Hyperliquid. Memecoins are extremely risky.
