# X Layer TapeOut Accelerate — Submission Draft (TapeScope)

**Status:** DRAFT — fill in the Google Form after the demo link + repo are live.
**Program deadline:** Mon 7 Dec 2026, 23:59 UTC (= Tue 8 Dec 06:59 WIB).
⚠️ Deadline is PROVISIONAL per the official page — re-check
https://web3.okx.com/xlayer/build-x-series before submitting.
**Submit via:** Google Form linked from the official Build X page
(human step — needs a Google account).

---

## 1. Product / service description

**TapeScope — X Layer TapeOut Analytics Terminal.**

TapeOut turns logic gates into on-chain circuits and whole websites into
on-chain data, but on X Layer there is no public window into any of it:
no explorer for the 425+ processors, no directory of DeWEB sites, no way to
check whether a circuit's container is open, what a site contains, or
whether the protocol contracts still run the audited code. Builders and
users fly blind.

TapeScope is a read-only analytics terminal that fixes that. It reads the
TapeOut protocol contracts on X Layer mainnet (chain 196) directly through
public RPC — no wallet, no transactions, no backend, no account:

- **Live protocol health:** all five TapeOut contracts (processor factory,
  container opener, SiteRegistry, DomainBinding, TapeSend hub) checked for
  deployed code, with each UUPS proxy's ERC-1967 implementation slot
  compared against the implementations pinned by the official TapeKit
  kernel — an upgrade or implementation swap is visible immediately.
  (During development TapeScope already caught one real drift: the X Layer
  factory implementation changed after the 2026-10-22 freeze while
  TapeKit's pins still list the old address.)
- **Processor registry:** every processor from `factory.cpuCount()` /
  `cpuAt(i)` with names and circuit counts; any row re-countable live.
- **DeWEB site directory:** every on-chain website on X Layer TapeOut —
  canonical `<id>.2.<processor>.tape` name, full file list with sizes,
  content types and on-chain SHA-256 hashes, container OKB balance, name
  status — with one-click open via the TapeKit gateway.
- **Live verification:** any snapshot row can be re-read live
  (`pathCount`, balance, name status, file-hash spot checks).
- **SHA-256-verified site preview:** reads a site's entry file live from
  SiteRegistry, verifies its hash against the on-chain record, and renders
  it in a sandboxed iframe.
- **Circuit lookup (live-only):** resolve `1.2.231.tape`, `#1@2.231` or a
  processor contract + ID to owner, container, open status, balance,
  website and name status via fresh `eth_call`s.

Snapshot figures at build time (17 Nov 2026 07:42 WIB, block 76,106,483):
425 processors, 11,880 circuits, 130 opened containers, 81 DeWEB sites,
2,086 files, 131,296,013 bytes (~125 MB) stored on-chain, 59 containers
with a live paid name. Full provenance in BUILD-TRANSCRIPT.md.

**What TapeOut features it uses:** processor factory (`cpuCount`/`cpuAt`),
circuit NFTs (`ownerOf`/`name`), ERC-6551 circuit containers
(`accountOf`/`isOpened`), DeWEB SiteRegistry (`pathCount`/`pathsRange`/
`fileInfo`/`read`/`readRange`), DomainBinding (`.tape` name liveness),
TapeSend hub (health check). Everything is read-only: TapeScope deploys
nothing and spends no gas.

## 2. Target users & how to reach them

- **TapeOut builders on X Layer** (circuit designers, DeWEB site owners):
  they need to see their processors, circuits and sites, verify deployments
  and debug name/container status. Reach: TapeOut Discord/Telegram, X
  Layer builder channels, TapeKit repo community, demo at the hackathon
  Demo Day.
- **DeWEB users & collectors:** people browsing on-chain sites or buying
  circuit NFTs want provenance (who owns it, what files it holds, is the
  name live). Reach: link from tapeout.net-adjacent community hubs,
  TapeOut Daily, X posts.
- **X Layer ecosystem analysts & the TapeOut/X Layer teams:** a public
  dashboard for ecosystem growth (processors, circuits, sites, bytes).
  Reach: direct share with X Layer + TapeOut teams during/after the
  hackathon; the repo is open so they can reuse the indexer.

## 3. Revenue model

Free public terminal (the product as submitted — free forever for lookup,
registry and site directory). Paid tiers planned after the hackathon:

1. **TapeScope API** — hosted indexed API over TapeOut X Layer data
   (processors, circuits, sites, file history) for wallets, explorers and
   marketplaces; free tier + usage-based paid plans.
2. **Builder Pro** — alerts (new processor, site update, implementation
   change), historical snapshots and export for DeWEB site owners and
   circuit projects; monthly subscription.
3. **Featured listings / verified badges** — optional paid promotion for
   DeWEB sites and circuit projects inside the directory (clearly marked,
   never affecting rankings).

Why users would pay and keep using it: TapeOut has no official analytics;
whoever runs the index owns the discovery layer. Builders need alerts and
history the moment they ship; marketplaces need the API the moment they
list circuits. The free terminal builds the audience that converts.

## 4. Links & addresses

- **Live demo (GitHub Pages):** https://tiannuryadins.github.io/tapescope/
  ← CONFIRM after Pages deploy
- **Source repo (public):** https://github.com/Tiannuryadins/tapescope
  ← CONFIRM after repo creation
- **TapeOut contracts used (X Layer mainnet, chain 196):**
  - Factory `0x1f09daefa827f02cbb40967cc91b259763760761`
  - Opener `0x536add8f30f03b69f6fbf29d425a816a0dc50106`
  - SiteRegistry `0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6`
  - DomainBinding `0x68809fd2fb343aa57d0aeb7f33defe477c9666f9`
  - TapeSend hub `0xe61a9c7213a6aa616c246a2b569e555b417b25ee`
- **Demo video (≤3 min):** NOT YET RECORDED — see §5. Video is
  recommended, not mandatory; submit without it if the deadline presses,
  but a video materially helps the Product Readiness score.

## 5. Demo video script (≤3 min) — TO RECORD

**Status: script ready, video NOT recorded.** Recording needs a screen
capture of the live demo + voiceover (or captions). Total target 2:30–3:00.

| # | Time | Scene (screen) | Narration |
|---|------|----------------|-----------|
| 1 | 0:00–0:20 | TapeScope overview tab; stats cards + live block ticking | "TapeOut puts circuits and whole websites on-chain — but on X Layer, nobody can see any of it. TapeScope is a read-only analytics terminal for TapeOut on X Layer: no wallet, no transactions, every number read live from the chain." |
| 2 | 0:20–0:50 | Protocol health table; point at implementation pins | "First, protocol health. All five TapeOut contracts, checked live — including the implementation behind each proxy, compared against the pins in the official TapeKit kernel. If an upgrade ever ships, you see it here first." |
| 3 | 0:50–1:20 | Processors tab; search "Nandverse"; click Recount live | "The processor registry: 425 processors, 11,880 circuits. Search by name or address — and recount any processor live, straight from ownerOf calls." |
| 4 | 1:20–1:55 | Sites tab; open 1.2.231.tape (Neon Reliquary); file list; Verify live; Preview (SHA-256 ✓) | "The DeWEB directory: 81 on-chain websites, 2,086 files, 125 megabytes stored on-chain. Here's a live game stored entirely on-chain — 121 files. Verify it live, or preview it: TapeScope reads the bytes from SiteRegistry and checks the SHA-256 against the on-chain hash before rendering." |
| 5 | 1:55–2:25 | Lookup tab; type 1.2.231.tape; results | "And lookup: any circuit by its .tape name — owner, container, balance, website, name status — all fresh eth_calls, nothing cached." |
| 6 | 2:25–2:50 | Method tab; repo on GitHub | "Everything is open source: the terminal and the indexer that built the snapshot. TapeScope is free for everyone — paid API and alerts for builders later. Built for the X Layer TapeOut Accelerate." |

**Recording notes:** record at 1080p, browser zoom 100%, dark UI as-is;
capture the live demo at the GitHub Pages URL (not localhost) so the video
shows the real deployment; keep each scene to one continuous take; no
wallet popups will appear (the app never requests one).

## 6. Pre-submit checklist

- [ ] Repo public on GitHub + Pages live (confirm URLs above)
- [ ] Demo loads with no console errors; snapshot stats match BUILD-TRANSCRIPT.md
- [ ] Re-check official page for deadline changes (provisional!)
- [ ] Record + upload demo video (≤3 min), add link here
- [ ] Human: fill Google Form (needs Google account) — paste §1–§4
- [ ] Human: identity check only if we win; offline Demo Day only if shortlisted
