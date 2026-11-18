# TapeScope — X Layer TapeOut Analytics Terminal

A **read-only analytics terminal** for the [TapeOut protocol](https://tapeout.net) on
**X Layer mainnet (chain 196)**. No wallet, no transactions, no backend — every
number is read straight from the chain through public X Layer RPC endpoints.

Built for the **X Layer TapeOut Accelerate** hackathon (Build X series).

**Live demo:** https://tiannuryadins.github.io/tapescope/ *(GitHub Pages — set after repo creation)*

## What it does

- **Live protocol health** — checks all five TapeOut contracts on X Layer
  (factory, container opener, SiteRegistry, DomainBinding, TapeSend hub) for
  deployed code, and compares each UUPS proxy's ERC-1967 implementation slot
  against the implementations pinned by the official TapeKit kernel.
- **Processor registry** — all processors from `factory.cpuCount()` /
  `cpuAt(i)` with names and per-processor circuit counts (ownerOf probing);
  any row can be re-counted live, and the factory can be re-read for new
  processors.
- **DeWEB site directory** — every on-chain website on X Layer TapeOut:
  canonical `<id>.2.<processor>.tape` name, file list with sizes, content
  types and on-chain SHA-256 hashes, container OKB balance, name status.
- **Live site verification** — re-reads `pathCount`, balance, name status and
  spot-checks file hashes live against the chain.
- **In-app site preview** — reads a site's entry file live from SiteRegistry
  (`read` / `readRange`), verifies its SHA-256 against the on-chain hash, and
  renders it in a sandboxed iframe. Plus a one-click link to the TapeKit
  gateway (`https://<id>-2-<processor>.tapekit.org/`).
- **Circuit lookup (live-only)** — resolve `1.2.231.tape`, `#1@2.231` or
  `0x…processor…#1` to owner, container, open status, balance, website and
  name status, all via fresh `eth_call`s.

## Data model: snapshot + live verification

Counting every circuit and site needs thousands of RPC calls, so the tables
start from a timestamped snapshot (`data/snapshot.json`, built by
`data/indexer.mjs` from live RPC reads only — no mocks, no third-party APIs).
Every snapshot value is labelled **SNAPSHOT** with its generation time and
block; every **LIVE** value is read in the browser on load or on demand, and
every snapshot row can be re-verified live.

Honest limitations are documented in the app's **Method & Sources** tab and in
[BUILD-TRANSCRIPT.md](BUILD-TRANSCRIPT.md): sequential token IDs are assumed
for counts (spot-checked), public X Layer RPCs cap `eth_getLogs` at ~100
blocks (so no log scans — sites are found by probing circuits), and custom
`.tape` names are checked at container level only.

## Run locally

```sh
# any static server; e.g.
python3 -m http.server 8000
# open http://localhost:8000/
```

No build step, no dependencies. The page calls public X Layer RPCs directly
from the browser (they allow CORS).

## Rebuild the snapshot

```sh
cd data
node indexer.mjs   # writes snapshot.json (+ checkpoint-processors.json)
```

Read-only; takes ~15–25 minutes (thousands of `eth_call`s against public
RPCs). Requires Node ≥ 18.

## Contracts (X Layer mainnet, chain 196)

Addresses from the official TapeKit kernel
([TapeOutProtocol/TapeKit](https://github.com/TapeOutProtocol/TapeKit),
`kernel/src/config.js`):

| Contract | Address |
|---|---|
| Processor factory | `0x1f09daefa827f02cbb40967cc91b259763760761` |
| Container opener | `0x536add8f30f03b69f6fbf29d425a816a0dc50106` |
| SiteRegistry | `0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6` |
| DomainBinding | `0x68809fd2fb343aa57d0aeb7f33defe477c9666f9` |
| TapeSend hub | `0xe61a9c7213a6aa616c246a2b569e555b417b25ee` |

## License

MIT. Not affiliated with OKX, X Layer, or TapeOut.
