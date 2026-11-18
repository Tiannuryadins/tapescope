/* TapeScope — read-only analytics terminal for TapeOut on X Layer mainnet.
   Zero dependencies. Every "LIVE" value is an eth_call/eth_getCode/eth_getBalance
   to a public X Layer RPC, made in the browser. Snapshot tables come from
   data/snapshot.json (timestamped, built by data/indexer.mjs from live RPC
   reads only) and every row can be re-verified live. */
'use strict';

/* ---------- constants: TapeOut on X Layer mainnet (chain 196) ---------- */
/* Addresses from the official TapeKit kernel (TapeOutProtocol/TapeKit,
   kernel/src/config.js), verified on-chain 2026-09-19, re-checked live here. */
const CONTRACTS = {
  factory:  '0x1f09daefa827f02cbb40967cc91b259763760761',
  opener:   '0x536add8f30f03b69f6fbf29d425a816a0dc50106',
  registry: '0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6',
  binding:  '0x68809fd2fb343aa57d0aeb7f33defe477c9666f9',
  hub:      '0xe61a9c7213a6aa616c246a2b569e555b417b25ee',
};
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
/* Pinned implementations from TapeKit (config.js factorySeal/expectedImpl,
   send/module/src/chain.js HUB_IMPLEMENTATIONS_BY_CHAIN). */
const PINNED_IMPL = {
  factory:  ['0xb41c1e7602eb5734be2430b72178ccb814a5293d'],
  registry: ['0xa85c4143d1d4a77f54b8e4ecc9e6d1418afea45f'],
  binding:  ['0x5ebf29b80789e548907c707530c3c7607c4347df'],
  hub:      ['0xdcc57797089ebd9f26e686379a4323f353a3f9c6'],
};
const RPCS = [
  'https://rpc.xlayer.tech',
  'https://xlayerrpc.okx.com',
  'https://xlayer.drpc.org',
];
const SEL = {
  cpuCount: '0xa94da8a7', cpuAt: '0x4bc7cbbd', isCPU: '0x5f5a364f',
  accountOf: '0x0c1905e5', isOpened: '0x8b508494', token: '0xfc0c546a',
  ownerOf: '0x6352211e', name: '0x06fdde03',
  fileInfo: '0x6c609107', read: '0xccaa7afb', readRange: '0x15a4cae2',
  pathCount: '0xb554782b', pathsRange: '0xb056072c', fallbackPath: '0xa76c7713',
  monthlyFee: '0x8cfd3e40', isContainerLive: '0xdcca979e', containerPaidUntil: '0x9ebfd859',
};
const ZERO_SHA = '0x' + '00'.repeat(32);

/* ---------- tiny ABI helpers ---------- */
const padU = (n) => BigInt(n).toString(16).padStart(64, '0');
const padA = (a) => a.slice(2).toLowerCase().padStart(64, '0');
const hexToBytes = (hex) => {
  const b = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return b;
};
const bytesToHex = (b) => '0x' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
/* Encode a string argument: [offset word][length][padded data]. headBytes is
   the offset value = size of the head (64 for (address,string), 128 for
   (address,string,uint,uint) — but for the latter use encStringTail, since
   the uint args sit between the offset word and the string data). */
function encString(s, headBytes) {
  const utf = new TextEncoder().encode(s);
  const words = Math.ceil(utf.length / 32);
  const out = new Uint8Array(64 + words * 32);
  const dv = new DataView(out.buffer);
  dv.setBigUint64(24, BigInt(headBytes));
  dv.setBigUint64(56, BigInt(utf.length));
  out.set(utf, 64);
  return bytesToHex(out).slice(2);
}
/* String data without the offset word: [length][padded data]. */
function encStringTail(s) {
  const utf = new TextEncoder().encode(s);
  const words = Math.ceil(utf.length / 32);
  const out = new Uint8Array(32 + words * 32);
  new DataView(out.buffer).setBigUint64(24, BigInt(utf.length));
  out.set(utf, 32);
  return bytesToHex(out).slice(2);
}
function decString(hex, base = 0) {
  const b = hexToBytes(hex);
  const dv = new DataView(b.buffer);
  const off = Number(dv.getBigUint64(base + 24));
  const len = Number(dv.getBigUint64(base + off + 24));
  return new TextDecoder().decode(b.slice(base + off + 32, base + off + 32 + len));
}
function decStringArray(hex) {
  const b = hexToBytes(hex);
  const dv = new DataView(b.buffer);
  const arrOff = Number(dv.getBigUint64(24));
  const n = Number(dv.getBigUint64(arrOff + 24));
  const out = [];
  for (let i = 0; i < n; i++) {
    const pOff = Number(dv.getBigUint64(arrOff + 32 + i * 32 + 24));
    // NOTE: SiteRegistry's pathsRange encodes element offsets relative to the
    // offsets region (arrOff + 32), NOT to the array head (arrOff) as strict
    // ABI would. Verified live 2026-11-17 against #1@2.231 (off[0]=96 with
    // 3 elements: data starts at 160 = 64 + 96).
    const base = arrOff + 32 + pOff;
    const len = Number(dv.getBigUint64(base + 24));
    out.push(new TextDecoder().decode(b.slice(base + 32, base + 32 + len)));
  }
  return out;
}
function decFileInfo(hex) {
  const b = hexToBytes(hex);
  const dv = new DataView(b.buffer);
  const size = Number(dv.getBigUint64(24));
  const ctOff = Number(dv.getBigUint64(32 + 24));
  const sha = bytesToHex(b.slice(64, 96));
  const updatedAt = Number(dv.getBigUint64(96 + 24));
  const chunkCount = Number(dv.getBigUint64(128 + 24));
  const ctLen = Number(dv.getBigUint64(ctOff + 24));
  const contentType = new TextDecoder().decode(b.slice(ctOff + 32, ctOff + 32 + ctLen));
  return { size, sha, updatedAt, chunkCount, contentType };
}
function decBytes(hex) {
  const b = hexToBytes(hex);
  const dv = new DataView(b.buffer);
  const off = Number(dv.getBigUint64(24));
  const len = Number(dv.getBigUint64(off + 24));
  return b.slice(off + 32, off + 32 + len);
}
const decUint = (hex) => BigInt(hex);
const decAddr = (hex) => '0x' + hex.slice(26).toLowerCase();
const fmtInt = (n) => Number(n).toLocaleString('en-US');
const fmtBytes = (n) => {
  n = Number(n);
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
};
const fmtOKB = (wei) => {
  const w = BigInt(wei);
  const whole = w / 10n ** 18n;
  const frac = (w % 10n ** 18n).toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
  return whole.toString() + (frac ? '.' + frac : '') + ' OKB';
};
const shortAddr = (a) => a ? a.slice(0, 8) + '…' + a.slice(-6) : '—';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- RPC client: batched eth_call with endpoint failover ---------- */
let rpcIdx = 0;
async function rpcRaw(rpc, body, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function rpcCall(method, params) {
  let lastErr;
  for (let k = 0; k < RPCS.length; k++) {
    const rpc = RPCS[(rpcIdx + k) % RPCS.length];
    try {
      const j = await rpcRaw(rpc, { jsonrpc: '2.0', id: 1, method, params });
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      rpcIdx = RPCS.indexOf(rpc);
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
/* Batched eth_call; each item: {to, data} or {method, params}. Returns array of
   {result} / {error} in order — per-call errors (e.g. ownerOf revert) are data. */
async function rpcBatch(calls) {
  const out = [];
  for (let s = 0; s < calls.length; s += 8) {
    const chunk = calls.slice(s, s + 8);
    const body = chunk.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: c.method || 'eth_call', params: c.params || [{ to: c.to, data: c.data }, 'latest'] }));
    let j, lastErr;
    for (let k = 0; k < RPCS.length; k++) {
      const rpc = RPCS[(rpcIdx + k) % RPCS.length];
      try { j = await rpcRaw(rpc, body); if (!Array.isArray(j)) throw new Error('bad batch response'); rpcIdx = RPCS.indexOf(rpc); break; }
      catch (e) { lastErr = e; j = null; }
    }
    if (!j) throw lastErr;
    j.sort((a, b) => a.id - b.id);
    out.push(...j);
  }
  return out;
}
const call = (to, data) => rpcCall('eth_call', [{ to, data }, 'latest']);

/* ---------- state ---------- */
let snapshot = null;
let processors = [];       // live-merged processor list
let liveCpuCount = null;

/* ---------- tabs ---------- */
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + b.dataset.tab));
}));

/* ---------- live network status ---------- */
async function refreshNet() {
  const dot = document.getElementById('netdot');
  const txt = document.getElementById('nettext');
  try {
    const t0 = performance.now();
    const [chainId, block] = await Promise.all([
      rpcCall('eth_chainId', []),
      rpcCall('eth_blockNumber', []),
    ]);
    const ms = Math.round(performance.now() - t0);
    dot.className = 'dot ok';
    txt.textContent = `X Layer mainnet · chain ${parseInt(chainId, 16)} · block ${fmtInt(parseInt(block, 16))} · ${RPCS[rpcIdx].replace('https://', '')} · ${ms}ms`;
  } catch (e) {
    dot.className = 'dot err';
    txt.textContent = 'RPC unreachable — ' + e.message;
  }
}

/* ---------- protocol health (live) ---------- */
async function loadHealth() {
  const tbody = document.querySelector('#healthTable tbody');
  const rows = [
    { key: 'factory', label: 'Processor factory' },
    { key: 'opener', label: 'Container opener' },
    { key: 'registry', label: 'SiteRegistry (DeWEB)' },
    { key: 'binding', label: 'DomainBinding (.tape names)' },
    { key: 'hub', label: 'TapeSend hub (TAP-10)' },
  ];
  try {
    const codeRes = await rpcBatch(rows.map((r) => ({ method: 'eth_getCode', params: [CONTRACTS[r.key], 'latest'] })));
    const implRes = await rpcBatch(rows.filter((r) => PINNED_IMPL[r.key]).map((r) => ({ method: 'eth_getStorageAt', params: [CONTRACTS[r.key], IMPL_SLOT, 'latest'] })));
    const implByKey = {};
    rows.filter((r) => PINNED_IMPL[r.key]).forEach((r, i) => { implByKey[r.key] = implRes[i].result ? decAddr(implRes[i].result) : null; });
    tbody.innerHTML = rows.map((r, i) => {
      const code = codeRes[i].result || '0x';
      const hasCode = code.length > 4;
      const impl = implByKey[r.key];
      let pinCell = '<span class="muted">n/a (not a proxy)</span>';
      if (impl) {
        const ok = PINNED_IMPL[r.key].includes(impl);
        pinCell = ok ? '<span class="ok">✓ matches TapeKit pin</span>' : '<span class="warn">⚠ differs from TapeKit pin — client would refuse</span>';
      }
      return `<tr><td>${r.label}</td><td class="mono">${CONTRACTS[r.key]}</td>` +
        `<td>${hasCode ? `<span class="ok">✓ ${fmtInt((code.length - 2) / 2)} bytes</span>` : '<span class="err">✗ no code</span>'}</td>` +
        `<td class="mono">${impl || '—'}</td><td>${pinCell}</td></tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="err">Live check failed: ${esc(e.message)}</td></tr>`;
  }
}

/* ---------- snapshot ---------- */
async function loadSnapshot() {
  try {
    const r = await fetch('data/snapshot.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    snapshot = await r.json();
  } catch (e) {
    snapshot = null;
    document.getElementById('snapNote').textContent = 'Snapshot unavailable (' + e.message + '). Live features (health check, lookup, factory re-read) still work.';
    return;
  }
  processors = snapshot.processors.map((p) => ({ ...p, circuitsLive: null }));
  const when = new Date(snapshot.generatedAt);
  document.getElementById('snapNote').innerHTML =
    `Snapshot: <b>${esc(when.toUTCString())}</b> at block <b>${fmtInt(snapshot.generatedAtBlock)}</b> · ` +
    `built by <code>data/indexer.mjs</code> from live RPC reads only · ` +
    `every number below is re-verifiable live (processor “Recount”, site “Verify live”, Lookup tab).`;
  document.getElementById('statCircuits').textContent = fmtInt(snapshot.stats.totalCircuits);
  document.getElementById('statOpened').textContent = fmtInt(snapshot.stats.openedContainers);
  document.getElementById('statSites').textContent = fmtInt(snapshot.stats.sites);
  document.getElementById('statFiles').textContent = fmtInt(snapshot.stats.totalFiles);
  document.getElementById('statBytes').textContent = fmtBytes(snapshot.stats.totalBytes);
  document.getElementById('tabProcCount').textContent = fmtInt(snapshot.stats.processors);
  document.getElementById('tabSiteCount').textContent = fmtInt(snapshot.stats.sites);
  renderTopSites();
  renderProcessors();
  renderSites();
}

/* ---------- overview: top sites ---------- */
function renderTopSites() {
  const tbody = document.querySelector('#topSitesTable tbody');
  const top = snapshot.sites.slice(0, 10);
  if (!top.length) { tbody.innerHTML = '<tr><td colspan="6" class="muted">No DeWEB sites found on X Layer at snapshot time.</td></tr>'; return; }
  tbody.innerHTML = top.map((s) => `<tr>
    <td class="mono">${esc(s.canonicalName)}</td>
    <td>#${s.processorIndex} ${esc(s.processorName || '')}</td>
    <td>${fmtInt(s.files.length)}</td><td>${fmtBytes(s.totalBytes)}</td>
    <td>${fmtOKB(s.balanceWei)}</td>
    <td><button class="btn small" data-goto-site="${esc(s.container)}">Details →</button></td></tr>`).join('');
  tbody.querySelectorAll('[data-goto-site]').forEach((b) => b.addEventListener('click', () => {
    document.querySelector('[data-tab="sites"]').click();
    openSiteDetail(b.dataset.gotoSite);
    document.getElementById('siteDetail').scrollIntoView({ behavior: 'smooth' });
  }));
}

/* ---------- processors ---------- */
function procSitesCount(idx) {
  return snapshot ? snapshot.sites.filter((s) => s.processorIndex === idx).length : 0;
}
function getProcList() {
  const q = document.getElementById('procSearch').value.trim().toLowerCase();
  const sort = document.getElementById('procSort').value;
  let list = processors.filter((p) =>
    !q || p.name.toLowerCase().includes(q) || String(p.index).includes(q) || p.address.toLowerCase().includes(q));
  const circuitsOf = (p) => (p.circuitsLive !== null && p.circuitsLive !== undefined ? p.circuitsLive : p.circuits);
  list = [...list].sort((a, b) =>
    sort === 'circuits-desc' ? circuitsOf(b) - circuitsOf(a) :
    sort === 'index-desc' ? b.index - a.index :
    sort === 'name-asc' ? a.name.localeCompare(b.name) : a.index - b.index);
  return list;
}
function renderProcessors() {
  const tbody = document.querySelector('#procTable tbody');
  if (!snapshot) { tbody.innerHTML = '<tr><td colspan="6" class="muted">Snapshot unavailable — use “Re-read live from factory” to load processors live.</td></tr>'; return; }
  const list = getProcList();
  document.getElementById('procHint').textContent =
    `Showing ${fmtInt(list.length)} of ${fmtInt(processors.length)} processors · ` +
    (liveCpuCount !== null ? `live factory cpuCount() = ${fmtInt(liveCpuCount)}` + (liveCpuCount > snapshot.stats.processors ? ` — ${fmtInt(liveCpuCount - snapshot.stats.processors)} new since snapshot (re-read to fetch them)` : ' — matches snapshot') : '');
  tbody.innerHTML = list.map((p) => {
    const live = p.circuitsLive !== null && p.circuitsLive !== undefined;
    return `<tr>
      <td class="mono">#${p.index}</td>
      <td>${esc(p.name || '(unnamed)')}</td>
      <td class="mono">${shortAddr(p.address)} <a href="https://www.oklink.com/xlayer/address/${p.address}" target="_blank" rel="noopener" title="OKLink explorer">↗</a></td>
      <td><b>${fmtInt(live ? p.circuitsLive : p.circuits)}</b> ${live ? '<span class="live-badge">LIVE</span>' : '<span class="snap-badge">SNAPSHOT</span>'}</td>
      <td>${fmtInt(procSitesCount(p.index))}</td>
      <td><button class="btn small" data-recount="${p.index}">Recount live</button></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">No processors match the search.</td></tr>';
  tbody.querySelectorAll('[data-recount]').forEach((b) => b.addEventListener('click', () => recountProcessor(Number(b.dataset.recount), b)));
}
async function ownerExists(cpu, tokenId) {
  const r = await rpcBatch([{ to: cpu, data: SEL.ownerOf + padU(tokenId) }]);
  return !!r[0].result;
}
async function countCircuitsLive(cpu) {
  if (!(await ownerExists(cpu, 1))) return 0;
  let lo = 1, hi = 2;
  while (await ownerExists(cpu, hi)) { lo = hi; hi *= 2; if (hi > 1000000) break; }
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (await ownerExists(cpu, mid)) lo = mid; else hi = mid; }
  return lo;
}
async function recountProcessor(idx, btn) {
  const p = processors.find((x) => x.index === idx);
  btn.disabled = true; btn.textContent = 'Counting…';
  try {
    p.circuitsLive = await countCircuitsLive(p.address);
    renderProcessors();
  } catch (e) { btn.disabled = false; btn.textContent = 'Recount live'; alert('Live recount failed: ' + e.message); }
}
async function refreshProcessorsLive() {
  const btn = document.getElementById('procRefresh');
  btn.disabled = true; btn.textContent = 'Reading factory…';
  try {
    const countHex = await call(CONTRACTS.factory, SEL.cpuCount);
    liveCpuCount = Number(decUint(countHex));
    document.getElementById('statProcessors').textContent = fmtInt(liveCpuCount);
    const known = new Set(processors.map((p) => p.index));
    const missing = [];
    for (let i = 0; i < liveCpuCount; i++) if (!known.has(i)) missing.push(i);
    if (missing.length) {
      const addrRes = await rpcBatch(missing.map((i) => ({ to: CONTRACTS.factory, data: SEL.cpuAt + padU(i) })));
      const addrs = addrRes.map((r) => decAddr(r.result));
      const nameRes = await rpcBatch(addrs.map((a) => ({ to: a, data: SEL.name })));
      missing.forEach((idx, k) => {
        let name = '';
        try { if (nameRes[k].result) name = decString(nameRes[k].result); } catch { /* keep empty */ }
        processors.push({ index: idx, address: addrs[k], name, circuits: null, circuitsLive: null });
      });
      processors.sort((a, b) => a.index - b.index);
    }
    renderProcessors();
  } catch (e) { alert('Factory re-read failed: ' + e.message); }
  btn.disabled = false; btn.textContent = '↻ Re-read live from factory';
}
document.getElementById('procSearch').addEventListener('input', renderProcessors);
document.getElementById('procSort').addEventListener('change', renderProcessors);
document.getElementById('procRefresh').addEventListener('click', refreshProcessorsLive);

/* ---------- sites ---------- */
let currentSite = null;
function getSiteList() {
  const q = document.getElementById('siteSearch').value.trim().toLowerCase();
  const sort = document.getElementById('siteSort').value;
  let list = snapshot.sites.filter((s) =>
    !q || s.canonicalName.toLowerCase().includes(q) || (s.processorName || '').toLowerCase().includes(q) || s.container.toLowerCase().includes(q));
  list = [...list].sort((a, b) =>
    sort === 'files-desc' ? b.files.length - a.files.length :
    sort === 'name-asc' ? a.canonicalName.localeCompare(b.canonicalName) : b.totalBytes - a.totalBytes);
  return list;
}
function renderSites() {
  const wrap = document.getElementById('siteList');
  if (!snapshot) { wrap.innerHTML = '<p class="muted">Snapshot unavailable.</p>'; return; }
  const list = getSiteList();
  document.getElementById('siteHint').textContent =
    `Showing ${fmtInt(list.length)} of ${fmtInt(snapshot.sites.length)} DeWEB sites · ${fmtInt(snapshot.stats.totalFiles)} files · ${fmtBytes(snapshot.stats.totalBytes)} stored on-chain · click a site for its file list, live verification and chain preview.`;
  wrap.innerHTML = list.map((s) => `<div class="site-row" data-site="${s.container}">
    <div><div class="site-name">${esc(s.canonicalName)}</div>
    <div class="site-sub">${esc(s.processorName || '')} · processor #${s.processorIndex} · circuit #${s.tokenId} · container ${s.container}</div></div>
    <div class="site-stats"><b>${fmtInt(s.files.length)}</b> files · <b>${fmtBytes(s.totalBytes)}</b><br>${fmtOKB(s.balanceWei)} · ${s.containerLive ? '<span class="ok">name live</span>' : '<span class="muted">name not paid</span>'}</div>
  </div>`).join('') || '<p class="muted">No sites match the search.</p>';
  wrap.querySelectorAll('[data-site]').forEach((el) => el.addEventListener('click', () => openSiteDetail(el.dataset.site)));
}
document.getElementById('siteSearch').addEventListener('input', renderSites);
document.getElementById('siteSort').addEventListener('change', renderSites);

function openSiteDetail(container) {
  currentSite = snapshot.sites.find((s) => s.container === container);
  if (!currentSite) return;
  const s = currentSite;
  const d = document.getElementById('siteDetail');
  d.hidden = false;
  document.getElementById('detailTitle').textContent = s.canonicalName;
  document.getElementById('detailMeta').innerHTML = `<dl class="kv">
    <dt>Processor</dt><dd>#${s.processorIndex} — ${esc(s.processorName || '(unnamed)')} — <span class="mono">${s.processor}</span></dd>
    <dt>Circuit</dt><dd>#${s.tokenId} on processor #${s.processorIndex}</dd>
    <dt>Container</dt><dd>${s.container}</dd>
    <dt>Files (snapshot)</dt><dd>${fmtInt(s.files.length)} files · ${fmtBytes(s.totalBytes)}</dd>
    <dt>Container balance</dt><dd>${fmtOKB(s.balanceWei)} <span class="snap-badge">SNAPSHOT</span></dd>
    <dt>Name status</dt><dd>${s.containerLive ? '<span class="ok">● live</span>' : '<span class="muted">○ not paid / expired</span>'}${s.containerPaidUntil ? ` · paid until ${new Date(s.containerPaidUntil * 1000).toUTCString()}` : ''} <span class="snap-badge">SNAPSHOT</span></dd>
  </dl>`;
  document.getElementById('btnGateway').href = `https://${s.tokenId}-2-${s.processorIndex}.tapekit.org/`;
  document.getElementById('verifyOut').className = 'verify-out';
  document.getElementById('verifyOut').textContent = '';
  document.getElementById('previewWrap').hidden = true;
  const ftbody = document.querySelector('#fileTable tbody');
  ftbody.innerHTML = s.files.map((f) => `<tr>
    <td class="mono">${esc(f.path)}</td><td>${esc(f.contentType || '')}</td>
    <td>${fmtInt(f.size)}</td><td class="mono">${f.sha === ZERO_SHA ? '<span class="muted">(no hash declared)</span>' : shortAddr(f.sha)}</td>
    <td>${f.updatedAt ? new Date(f.updatedAt * 1000).toISOString().slice(0, 10) : '—'}</td></tr>`).join('');
  document.getElementById('fileCountNote').textContent = `(${fmtInt(s.files.length)} files)`;
}
document.getElementById('detailClose').addEventListener('click', () => { document.getElementById('siteDetail').hidden = true; });

document.getElementById('btnVerifyLive').addEventListener('click', async () => {
  if (!currentSite) return;
  const s = currentSite;
  const out = document.getElementById('verifyOut');
  out.className = 'verify-out show';
  out.textContent = 'Verifying live against X Layer mainnet…';
  const lines = [];
  try {
    const [pc, bal, live, owner] = await rpcBatch([
      { to: CONTRACTS.registry, data: SEL.pathCount + padA(s.container) },
      { method: 'eth_getBalance', params: [s.container, 'latest'] },
      { to: CONTRACTS.binding, data: SEL.isContainerLive + padA(s.container) },
      { to: s.processor, data: SEL.ownerOf + padU(s.tokenId) },
    ]);
    const livePaths = pc.result ? Number(decUint(pc.result)) : null;
    lines.push(`pathCount(container) live: ${livePaths === null ? 'CALL FAILED' : fmtInt(livePaths)}  | snapshot: ${fmtInt(s.files.length)}  ${livePaths === s.files.length ? '✓ MATCH' : '⚠ DIFFERS — site changed since snapshot'}`);
    const liveBal = bal.result ? BigInt(bal.result) : null;
    lines.push(`container balance live: ${liveBal === null ? 'CALL FAILED' : fmtOKB(liveBal)}  | snapshot: ${fmtOKB(s.balanceWei)}`);
    lines.push(`isContainerLive live: ${live.result ? (live.result.slice(-1) === '1' ? 'true (name paid)' : 'false') : 'CALL FAILED'}  | snapshot: ${s.containerLive}`);
    lines.push(`circuit owner live: ${owner.result ? decAddr(owner.result) : 'CALL FAILED (circuit may not exist)'}`);
    // spot-check up to 5 files live via fileInfo
    const sample = s.files.slice(0, 5);
    if (sample.length) {
      const fi = await rpcBatch(sample.map((f) => ({ to: CONTRACTS.registry, data: SEL.fileInfo + padA(s.container) + encString(f.path, 64) })));
      let ok = 0;
      sample.forEach((f, i) => {
        if (!fi[i].result) { lines.push(`  fileInfo ${f.path}: CALL FAILED`); return; }
        const info = decFileInfo(fi[i].result);
        const match = info.size === f.size && info.sha.toLowerCase() === f.sha.toLowerCase();
        if (match) ok++;
        lines.push(`  fileInfo ${f.path}: size ${fmtInt(info.size)} ${info.size === f.size ? '✓' : '⚠ differs'} · sha ${info.sha === f.sha ? '✓ MATCH' : '⚠ differs'}`);
      });
      lines.push(`file spot-check: ${ok}/${sample.length} match snapshot exactly`);
    }
    lines.push('— verified live just now from public X Layer RPC; no cache involved.');
  } catch (e) { lines.push('ERROR: ' + e.message); }
  out.textContent = lines.join('\n');
});

/* Site preview: read index file live from SiteRegistry, SHA-256-verify, render sandboxed */
async function readFileLive(container, path, expectedSize, expectedSha) {
  const CHUNK = 96 * 1024;
  const chunks = [];
  if (expectedSize <= CHUNK) {
    const hex = await call(CONTRACTS.registry, SEL.read + padA(container) + encString(path, 64));
    chunks.push(decBytes(hex));
  } else {
    for (let off = 0; off < expectedSize; off += CHUNK) {
      const hex = await call(CONTRACTS.registry, SEL.readRange + padA(container) + padU(128) + padU(off) + padU(Math.min(CHUNK, expectedSize - off)) + encStringTail(path));
      chunks.push(decBytes(hex));
    }
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const bytes = new Uint8Array(total);
  let o = 0; for (const c of chunks) { bytes.set(c, o); o += c.length; }
  let shaOk = null;
  if (expectedSha && expectedSha !== ZERO_SHA) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    shaOk = bytesToHex(new Uint8Array(digest)).toLowerCase() === expectedSha.toLowerCase();
  }
  return { bytes, shaOk };
}
document.getElementById('btnPreview').addEventListener('click', async () => {
  if (!currentSite) return;
  const s = currentSite;
  const wrap = document.getElementById('previewWrap');
  const status = document.getElementById('previewStatus');
  const frame = document.getElementById('previewFrame');
  wrap.hidden = false;
  frame.removeAttribute('srcdoc');
  const entry = s.files.find((f) => f.path === 'index.html' || f.path === '/index.html' || f.path === '/' || f.path === '') || s.files[0];
  if (!entry) { status.textContent = 'No files to preview.'; return; }
  if (!/^(text\/|application\/(xhtml\+xml|javascript|json))/.test(entry.contentType || '') && !/\.(html?|txt|md|json|js|css)$/i.test(entry.path)) {
    status.textContent = `Entry file ${entry.path} is ${entry.contentType || 'binary'} — preview supports text/HTML only. Open via the TapeKit gateway instead.`;
    return;
  }
  status.textContent = `Reading ${entry.path} (${fmtBytes(entry.size)}) live from SiteRegistry…`;
  try {
    const { bytes, shaOk } = await readFileLive(s.container, entry.path, entry.size, entry.sha);
    const text = new TextDecoder().decode(bytes);
    const hashNote = shaOk === null ? 'no on-chain hash declared' : (shaOk ? '✓ SHA-256 matches on-chain hash' : '✗ SHA-256 MISMATCH — bytes rejected');
    status.textContent = `${entry.path} · ${fmtBytes(bytes.length)} read live · ${hashNote}`;
    if (shaOk === false) return;
    if (/\.html?$/i.test(entry.path) || (entry.contentType || '').includes('html')) {
      frame.srcdoc = text;
    } else {
      frame.srcdoc = '<!DOCTYPE html><pre style="white-space:pre-wrap;word-break:break-word;font:13px monospace;padding:12px">' + esc(text).slice(0, 200000) + '</pre>';
    }
  } catch (e) { status.textContent = 'Preview failed: ' + e.message; }
});
document.getElementById('btnPreviewClose').addEventListener('click', () => {
  document.getElementById('previewWrap').hidden = true;
  document.getElementById('previewFrame').removeAttribute('srcdoc');
});

/* ---------- lookup (live only) ---------- */
function parseLookup(input) {
  const t = input.trim();
  let m = t.match(/^#?(\d+)\.2\.(\d+)\.tape$/i);
  if (m) return { tokenId: Number(m[1]), cpu: Number(m[2]) };
  m = t.match(/^#?(\d+)@2\.(\d+)$/i);
  if (m) return { tokenId: Number(m[1]), cpu: Number(m[2]) };
  m = t.match(/^(0x[0-9a-fA-F]{40})#(\d+)$/);
  if (m) return { tokenId: Number(m[2]), processor: m[1].toLowerCase() };
  m = t.match(/^(\d+)\s+(\d+)$/);
  if (m) return { tokenId: Number(m[1]), cpu: Number(m[2]) };
  return null;
}
document.getElementById('lookupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = document.getElementById('lookupOut');
  const q = parseLookup(document.getElementById('lookupInput').value);
  if (!q) {
    out.innerHTML = '<div class="result-card err">Could not parse that input. Use <code>1.2.231.tape</code>, <code>#1@2.231</code> or <code>0x…processor…#1</code>.</div>';
    return;
  }
  out.innerHTML = '<div class="result-card muted">Resolving live from X Layer mainnet…</div>';
  try {
    let processor = q.processor, cpuIndex = q.cpu, procName = '';
    if (!processor) {
      const countHex = await call(CONTRACTS.factory, SEL.cpuCount);
      const count = Number(decUint(countHex));
      if (cpuIndex >= count) {
        out.innerHTML = `<div class="result-card err">No such processor: factory cpuCount() is ${fmtInt(count)}, so processor #${cpuIndex} does not exist.</div>`;
        return;
      }
      processor = decAddr(await call(CONTRACTS.factory, SEL.cpuAt + padU(cpuIndex)));
    } else {
      const isCpu = await call(CONTRACTS.factory, SEL.isCPU + padA(processor));
      if (isCpu.slice(-1) !== '1') {
        out.innerHTML = `<div class="result-card err">${processor} is not a TapeOut processor on X Layer (factory isCPU() = false).</div>`;
        return;
      }
      cpuIndex = processors.find((p) => p.address === processor)?.index ?? null;
    }
    const [nameR, ownerR, accR, openR] = await rpcBatch([
      { to: processor, data: SEL.name },
      { to: processor, data: SEL.ownerOf + padU(q.tokenId) },
      { to: CONTRACTS.opener, data: SEL.accountOf + padA(processor) + padU(q.tokenId) },
      { to: CONTRACTS.opener, data: SEL.isOpened + padA(processor) + padU(q.tokenId) },
    ]);
    try { if (nameR.result) procName = decString(nameR.result); } catch { /* ignore */ }
    if (!ownerR.result) {
      out.innerHTML = `<div class="result-card err">Circuit #${q.tokenId} does not exist on processor ${cpuIndex !== null ? '#' + cpuIndex : processor} (${esc(procName || '')}) — ownerOf() reverts.</div>`;
      return;
    }
    const owner = decAddr(ownerR.result);
    const container = decAddr(accR.result);
    const opened = openR.result && openR.result.slice(-1) === '1';
    const [pcR, balR, liveR, paidR, fbR] = await rpcBatch([
      { to: CONTRACTS.registry, data: SEL.pathCount + padA(container) },
      { method: 'eth_getBalance', params: [container, 'latest'] },
      { to: CONTRACTS.binding, data: SEL.isContainerLive + padA(container) },
      { to: CONTRACTS.binding, data: SEL.containerPaidUntil + padA(container) },
      { to: CONTRACTS.registry, data: SEL.fallbackPath + padA(container) },
    ]);
    const pathCount = pcR.result ? Number(decUint(pcR.result)) : 0;
    let paths = [];
    if (pathCount > 0) {
      const pr = await rpcBatch([{ to: CONTRACTS.registry, data: SEL.pathsRange + padA(container) + padU(0) + padU(Math.min(pathCount, 50)) }]);
      if (pr[0].result) paths = decStringArray(pr[0].result);
    }
    let fallback = '';
    try { if (fbR.result) fallback = decString(fbR.result); } catch { /* ignore */ }
    const paidUntil = paidR.result ? Number(decUint(paidR.result)) : 0;
    const canonical = cpuIndex !== null ? `${q.tokenId}.2.${cpuIndex}.tape` : null;
    out.innerHTML = `<div class="result-card">
      <h3>${canonical ? esc(canonical) : `Circuit #${q.tokenId}`}</h3>
      <dl class="kv">
        <dt>Processor</dt><dd>${cpuIndex !== null ? '#' + cpuIndex + ' — ' : ''}${esc(procName || '(unnamed)')} — <span class="mono">${processor}</span></dd>
        <dt>Circuit owner</dt><dd>${owner}</dd>
        <dt>Container</dt><dd>${container} ${opened ? '<span class="ok">● opened</span>' : '<span class="warn">○ not opened</span>'}</dd>
        <dt>Container balance</dt><dd>${balR.result ? fmtOKB(BigInt(balR.result)) : '—'}</dd>
        <dt>Name status</dt><dd>${liveR.result && liveR.result.slice(-1) === '1' ? '<span class="ok">● live (paid)</span>' : '<span class="muted">○ not paid / expired</span>'}${paidUntil ? ` · paid until ${new Date(paidUntil * 1000).toUTCString()}` : ''}</dd>
        <dt>DeWEB site</dt><dd>${pathCount ? `<b>${fmtInt(pathCount)}</b> file(s) in SiteRegistry${fallback ? ` · SPA fallback: ${esc(fallback)}` : ''}` : 'no files — no on-chain website yet'}</dd>
        ${paths.length ? `<dt>Files (first ${paths.length})</dt><dd>${paths.map(esc).join('<br>')}</dd>` : ''}
      </dl>
      ${canonical ? `<p><a class="btn" target="_blank" rel="noopener" href="https://${q.tokenId}-2-${cpuIndex}.tapekit.org/">↗ Open ${esc(canonical)} via TapeKit gateway</a></p>` : ''}
      <p class="hint">All fields above were read live just now (factory → processor → opener → SiteRegistry → DomainBinding). Nothing cached.</p>
    </div>`;
  } catch (e) {
    out.innerHTML = `<div class="result-card err">Lookup failed: ${esc(e.message)}</div>`;
  }
});
document.querySelectorAll('[data-try]').forEach((b) => b.addEventListener('click', () => {
  document.getElementById('lookupInput').value = b.dataset.try;
  document.getElementById('lookupForm').dispatchEvent(new Event('submit', { cancelable: true }));
}));

/* ---------- boot ---------- */
(async function init() {
  await refreshNet();
  setInterval(refreshNet, 12000);
  loadHealth();
  await loadSnapshot();
  try {
    const countHex = await call(CONTRACTS.factory, SEL.cpuCount);
    liveCpuCount = Number(decUint(countHex));
    document.getElementById('statProcessors').textContent = fmtInt(liveCpuCount);
    if (snapshot) renderProcessors();
  } catch { document.getElementById('statProcessors').textContent = '—'; }
})();
