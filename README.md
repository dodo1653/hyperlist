# HYPERLIST

pump.fun creator fees, pointed at a Hyperliquid listing.

Every bonding-curve trade on pump.fun pays the coin's creator 0.30 %. A ticker on Hyperliquid costs one thing: the HIP-1 spot deploy auction (a 31-hour Dutch auction that falls to 500 HYPE). HYPERLIST reads both live and puts them on one meter, for any coin.

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
