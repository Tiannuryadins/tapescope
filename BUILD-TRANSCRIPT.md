# TapeScope — Build Transcript

**Built:** 17 Nov 2026, ~07:25–08:50 WIB (UTC+7)
**Builder:** agent (single session, no subagents)
**Entry for:** X Layer TapeOut Accelerate (Build X series), deadline
7 Dec 2026 23:59 UTC (PROVISIONAL — re-check official page).
**Cost:** $0. No mainnet deploy, no OKB spent, no subscriptions, no paid
APIs. Only free public RPC reads.

## What was built

**TapeScope** — a read-only analytics terminal for the TapeOut protocol on
X Layer mainnet (chain 196). Static HTML/JS/CSS, zero dependencies, no
build step, no backend, no wallet.

Files (all under `~/workspace/x-layer-tapeout/`):

| File | What it is |
|---|---|
| `index.html` | App shell: 5 tabs (Overview / Processors / DeWEB Sites / Circuit Lookup / Method & Sources) |
| `app.js` | RPC client (batched `eth_call`, 3-endpoint failover), hand-rolled ABI encode/decode, all UI logic |
| `styles.css` | Dark terminal theme |
| `data/snapshot.json` (628 KB) | Timestamped snapshot: 425 processors + 81 sites with full file lists |
| `data/indexer.mjs` | Snapshot builder (read-only; re-runnable, checkpointed) |
| `README.md`, `LICENSE` (MIT), `.gitignore` | Repo docs |
| `SUBMISSION.md` | Draft Google Form content + demo video script |
| `BUILD-TRANSCRIPT.md` | This file |
| `research/TapeKit/` | Cloned TapeOutProtocol/TapeKit (reference only, git-ignored) |

## What was verified live (not assumed)

All checks below were run against X Layer mainnet public RPC
(`rpc.xlayer.tech`, `xlayerrpc.okx.com`, `xlayer.drpc.org`) on 17 Nov 2026.

1. **Chain + contracts.** `eth_chainId` = 196; latest block ~76.1M.
   All five TapeOut contracts have deployed code: factory
   `0x1f09…0761`, opener `0x536a…0106`, SiteRegistry `0xd6ef…adb6`,
   DomainBinding `0x6880…66f9`, TapeSend hub `0xe61a…25ee`.
   Addresses from the official TapeKit kernel (`kernel/src/config.js`).
2. **Processors.** `factory.cpuCount()` = **425**. `cpuAt(i)` + `name()`
   resolved for all 425 (e.g. #0 "OnlyTestXLayer", #231 "Nandverse
   Foundry", #323 "FAB-Genisis"). `totalSupply()` reverts on processor
   contracts (not Enumerable) — counts use `ownerOf` probing instead.
3. **Circuits.** Exponential + binary search over `ownerOf(id)`:
   **11,880 circuits** total. Sequential-ID assumption spot-checked on
   processors #0 (104), #1 (100), #2 (25): no gaps in 1..50.
4. **Containers & sites.** `isOpened` probed for all 11,880 circuits:
   **130 opened** containers; `pathCount` > 0 for **81 sites** holding
   **2,086 files / 131,296,013 bytes (~125 MB)**. Every site's
   `files.length` equals its live `pathCount` (0 mismatches).
   Largest site: `2.2.300.tape` (342 files, 18.2 MB). Reference site
   `1.2.231.tape` ("Neon Reliquary" game): 121 files, 9.6 MB — matches
   the guide's claim and the live `pathCount` probe.
5. **File reads + hashes.** `fileInfo`/`read`/`readRange` decoders
   validated against live data: `index.html` of 1.2.231.tape reads 602
   bytes whose SHA-256 matches the on-chain hash exactly; `readRange`
   verified on a 1.46 MB file (three.core.js, 61 chunks).
6. **Names.** `monthlyFee()` = 0 OKB; 59/81 site containers report
   `isContainerLive` = true.
7. **Implementation pins.** ERC-1967 slots read live: SiteRegistry,
   DomainBinding and TapeSend hub match TapeKit's pinned implementations.
   **Finding: the factory implementation drifted** — live
   `0x336e9f0f4c3fee7c8c803377e4dea00293f4ae2a` vs TapeKit's Oct-22
   pinned `0xb41c1e7602eb5734be2430b72178ccb814a5293d`. TapeKit's repo
   has had no commit since 2026-10-22, so either the factory was
   upgraded after the freeze or the pins are stale. The app surfaces
   this as a warning — the health check doing its job. (The new
   implementation has real code including `cpuAt`/`isCPU`; the factory
   still answers normally.)
8. **Gateway links.** `https://1-2-231.tapekit.org/` serves the TapeKit
   boot page (subdomain format `#ID-2-#processor` per TapeKit
   `sw-gateway/boot.js`).
9. **CORS.** All three RPCs return `Access-Control-Allow-Origin: *`
   (dRPC echoes origin) on preflight — the browser app can call them
   directly.

## Test results (headless DOM, jsdom + live RPC)

`test.mjs` (in `/tmp/tapetest/`, not shipped) drove the real page through
the UI against live mainnet: **23/23 checks PASS, 0 console errors.**
Covered: live net status, live cpuCount, all snapshot stats, health table
(5 contracts with code, 3 pins match, factory drift flagged), top sites,
425-row processor table, search filter, live recount (LIVE badge),
81-row site list, site detail (121 files), live verify (pathCount MATCH,
file spot-check 5/5), SHA-256-verified preview with sandboxed iframe,
live lookup (resolve + missing-circuit error path).

## Bugs found & fixed during the build

1. **TapeKit `pathsRange` string-array offsets are relative to the
   offsets region, not the array head** (non-standard ABI; verified
   live: off[0]=96 with 3 elements → data at 160). Fixed in both
   `app.js` and `data/indexer.mjs`.
2. **String-arg head offsets**: `fileInfo`/`read` need offset 64, and
   `readRange` needs the uint args between the offset word and the
   string data (offset 128). Initial offset-32 encoding returned
   zero structs / reverted.
3. **`eth_getLogs` unusable for indexing**: OKX RPCs cap ranges at 100
   blocks; dRPC's "10,000 blocks" message is misleading (200+ blocks
   rejected). Indexer switched to pure `eth_call` probing
   (isOpened → accountOf → pathCount → pathsRange/fileInfo).

## Honest limitations (also stated in-app)

- Circuit counts assume sequential token IDs from 1 with no gaps
  (spot-checked, not proven for all 425 processors).
- Snapshot is a point in time (17 Nov 2026 07:42 WIB, block 76,106,483);
  anything created after is missing until re-index or live re-read.
- Custom `.tape` names are checked at container level only
  (`isContainerLive`), not enumerated individually.
- No log/event history (see bug 3 above).

## Still pending (needs human / parent)

- **GitHub repo + Pages NOT created.** `create_repository` via the
  GitHub connector requested an approval card that timed out after
  30 min (`approval_expired`, approval
  `connector-attempt-36e5118985c5c9eaf7a3d0d9a668a0b2bf2fee06f880a49cc752d4eb1f13c560`;
  action not performed; repo confirmed absent). Retry when the user can
  approve, or create `Tiannuryadins/tapescope` manually, then snapshot-push
  this directory (minus `research/`, checkpoint, log) and enable Pages
  (root, `main` branch). Demo URL will then be
  `https://tiannuryadins.github.io/tapescope/`.
- **Demo video NOT recorded.** Script + scene table ready in
  `SUBMISSION.md` §5 (2:30–3:00). Needs screen capture of the live demo
  + narration; recommended, not mandatory.
- **Google Form NOT filled.** Draft content complete in `SUBMISSION.md`
  §1–§4; submission is a human step (Google account).
