// TapeScope indexer — snapshot builder (run from VM). Reads ONLY live X Layer
// mainnet RPC (eth_call/eth_getBalance). No log scans: public X Layer RPCs cap
// eth_getLogs at ~100 blocks, so sites are found by probing every circuit:
// isOpened -> accountOf -> pathCount -> pathsRange/fileInfo.
// Output: snapshot.json (timestamped). The web app re-verifies entries live.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const RPC = 'https://rpc.xlayer.tech';
const FACTORY  = '0x1f09daefa827f02cbb40967cc91b259763760761';
const OPENER   = '0x536add8f30f03b69f6fbf29d425a816a0dc50106';
const REGISTRY = '0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6';
const BINDING  = '0x68809fd2fb343aa57d0aeb7f33defe477c9666f9';
const pad = (n) => BigInt(n).toString(16).padStart(64, '0');
const addr = (a) => a.slice(2).padStart(64, '0');
let id = 0;
async function post(body) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
async function batchCalls(calls) {
  const out = [];
  for (let s = 0; s < calls.length; s += 8) {
    const chunk = calls.slice(s, s + 8);
    const body = chunk.map(c => ({ jsonrpc: '2.0', id: ++id, method: c.method || 'eth_call', params: c.params || [{ to: c.to, data: c.data }, 'latest'] }));
    const j = await post(body);
    if (!Array.isArray(j)) throw new Error('non-array batch: ' + JSON.stringify(j).slice(0, 200));
    out.push(...j);
  }
  return out;
}
async function singleCall(method, params) {
  const j = await post({ jsonrpc: '2.0', id: ++id, method, params });
  if (j.error) throw new Error(method + ' ' + JSON.stringify(j.error));
  return j.result;
}
function decodeString(hex) {
  const buf = Buffer.from(hex.slice(2), 'hex');
  const off = Number(BigInt('0x' + buf.subarray(0, 32).toString('hex')));
  const len = Number(BigInt('0x' + buf.subarray(off, off + 32).toString('hex')));
  return buf.subarray(off + 32, off + 32 + len).toString('utf8');
}
function decodeStringArray(hex) {
  const buf = Buffer.from(hex.slice(2), 'hex');
  const arrOff = Number(BigInt('0x' + buf.subarray(0, 32).toString('hex')));
  const n = Number(BigInt('0x' + buf.subarray(arrOff, arrOff + 32).toString('hex')));
  const out = [];
  for (let i = 0; i < n; i++) {
    const pOff = Number(BigInt('0x' + buf.subarray(arrOff + 32 + i * 32, arrOff + 64 + i * 32).toString('hex')));
    // NOTE: SiteRegistry's pathsRange encodes element offsets relative to the
    // offsets region (arrOff + 32), NOT to the array head (arrOff) as strict
    // ABI would. Verified live 2026-11-17 against #1@2.231.
    const base = arrOff + 32 + pOff;
    const len = Number(BigInt('0x' + buf.subarray(base, base + 32).toString('hex')));
    out.push(buf.subarray(base + 32, base + 32 + len).toString('utf8'));
  }
  return out;
}
function decodeFileInfo(hex) {
  const buf = Buffer.from(hex.slice(2), 'hex');
  const size = Number(BigInt('0x' + buf.subarray(0, 32).toString('hex')));
  const ctOff = Number(BigInt('0x' + buf.subarray(32, 64).toString('hex')));
  const sha = '0x' + buf.subarray(64, 96).toString('hex');
  const updatedAt = Number(BigInt('0x' + buf.subarray(96, 128).toString('hex')));
  const chunkCount = Number(BigInt('0x' + buf.subarray(128, 160).toString('hex')));
  const ctLen = Number(BigInt('0x' + buf.subarray(ctOff, ctOff + 32).toString('hex')));
  const contentType = buf.subarray(ctOff + 32, ctOff + 32 + ctLen).toString('utf8');
  return { size, sha, updatedAt, chunkCount, contentType };
}
async function mapPool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  const workers = Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } });
  await Promise.all(workers); return out;
}

const latest = parseInt(await singleCall('eth_blockNumber', []), 16);
console.log('latest block', latest);

// --- 1. Processors ---
const cpuCount = Number(BigInt(await singleCall('eth_call', [{ to: FACTORY, data: '0xa94da8a7' }, 'latest'])));
console.log('cpuCount:', cpuCount);
const idxs = Array.from({ length: cpuCount }, (_, i) => i);
const cpuRes = await batchCalls(idxs.map(i => ({ to: FACTORY, data: '0x4bc7cbbd' + pad(i) })));
const processors = cpuRes.map((r, i) => ({ index: i, address: '0x' + r.result.slice(26).toLowerCase() }));
const nameRes = await batchCalls(processors.map(p => ({ to: p.address, data: '0x06fdde03' })));
nameRes.forEach((r, i) => { try { processors[i].name = r.result ? decodeString(r.result) : ''; } catch { processors[i].name = ''; } });
console.log('processors resolved:', processors.length);

// --- 2. Circuit counts via ownerOf exponential + binary search ---
// Assumption: tokenIds are minted sequentially from 1 with no gaps (verified by
// spot-check below on 3 processors: every id 1..count exists).
async function ownerExists(cpu, tokenId) {
  try { await singleCall('eth_call', [{ to: cpu, data: '0x6352211e' + pad(tokenId) }, 'latest']); return true; }
  catch { return false; }
}
async function circuitCount(cpu) {
  if (!(await ownerExists(cpu, 1))) return 0;
  let lo = 1, hi = 2;
  while (await ownerExists(cpu, hi)) { lo = hi; hi *= 2; if (hi > 1_000_000) break; }
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (await ownerExists(cpu, mid)) lo = mid; else hi = mid; }
  return lo;
}
let cDone = 0;
const CHECKPOINT = new URL('./checkpoint-processors.json', import.meta.url);
let resumed = false;
if (existsSync(CHECKPOINT)) {
  try {
    const saved = JSON.parse(readFileSync(CHECKPOINT, 'utf8'));
    if (saved.cpuCount === cpuCount && saved.processors.length === cpuCount) {
      saved.processors.forEach((sp, i) => { processors[i].circuits = sp.circuits; });
      resumed = !saved.partial;
      console.log(resumed ? 'resumed circuit counts from checkpoint' : `resumed partial checkpoint (${saved.done || 0} counted)`);
    }
  } catch { /* fall through to fresh count */ }
}
{
  const todo = processors.filter((p) => p.circuits === undefined);
  await mapPool(todo, 8, async (p) => {
    p.circuits = await circuitCount(p.address);
    if (++cDone % 50 === 0) {
      console.log('circuit counts:', cDone, '/', processors.length);
      writeFileSync(CHECKPOINT, JSON.stringify({ cpuCount, processors, partial: true, done: cDone }));
    }
  });
  writeFileSync(CHECKPOINT, JSON.stringify({ cpuCount, processors }));
}
const totalCircuits = processors.reduce((s, p) => s + p.circuits, 0);
console.log('total circuits:', totalCircuits);

// spot-check sequential assumption on 3 non-empty processors
for (const p of processors.filter(p => p.circuits > 0).slice(0, 3)) {
  const checks = await batchCalls(Array.from({ length: Math.min(p.circuits, 50) }, (_, k) => ({ to: p.address, data: '0x6352211e' + pad(k + 1) })));
  const missing = checks.map((r, k) => (r.result ? null : k + 1)).filter(Boolean);
  console.log(`sequential check cpu ${p.index} (${p.circuits} circuits): missing in 1..${Math.min(p.circuits, 50)}:`, missing.length ? missing : 'none');
}

// --- 3. Opened circuits: isOpened for every circuit ---
const allCircuits = [];
for (const p of processors) for (let t = 1; t <= p.circuits; t++) allCircuits.push({ p, tokenId: t });
console.log('probing isOpened for', allCircuits.length, 'circuits');
const openedRes = await batchCalls(allCircuits.map(c => ({ to: OPENER, data: '0x8b508494' + addr(c.p.address) + pad(c.tokenId) })));
const opened = allCircuits.filter((_, i) => openedRes[i].result && openedRes[i].result.slice(-1) === '1');
console.log('opened containers:', opened.length);

// --- 4. For opened: accountOf -> pathCount -> (if files) balance/live/files ---
const sites = [];
{
  const accRes = await batchCalls(opened.map(c => ({ to: OPENER, data: '0x0c1905e5' + addr(c.p.address) + pad(c.tokenId) })));
  opened.forEach((c, i) => { c.container = '0x' + accRes[i].result.slice(26).toLowerCase(); });
  const pcRes = await batchCalls(opened.map(c => ({ to: REGISTRY, data: '0xb554782b' + addr(c.container) })));
  opened.forEach((c, i) => { c.pathCount = pcRes[i].result ? Number(BigInt(pcRes[i].result)) : 0; });
  const withFiles = opened.filter(c => c.pathCount > 0);
  console.log('containers with files (sites):', withFiles.length, 'of', opened.length, 'opened');
  const balRes = await batchCalls(withFiles.map(c => ({ method: 'eth_getBalance', params: [c.container, 'latest'] })));
  const liveRes = await batchCalls(withFiles.map(c => ({ to: BINDING, data: '0xdcca979e' + addr(c.container) })));
  const cpuRes2 = await batchCalls(withFiles.map(c => ({ to: BINDING, data: '0x9ebfd859' + addr(c.container) })));
  withFiles.forEach((c, i) => {
    c.balanceWei = balRes[i].result ? BigInt(balRes[i].result).toString() : '0';
    c.containerLive = liveRes[i].result ? liveRes[i].result.slice(-1) === '1' : false;
    c.containerPaidUntil = cpuRes2[i].result ? Number(BigInt(cpuRes2[i].result)) : 0;
  });
  // enumerate files for each site
  let fDone = 0;
  await mapPool(withFiles, 6, async (c) => {
    const paths = [];
    for (let off = 0; off < c.pathCount; off += 50) {
      const r = await singleCall('eth_call', [{ to: REGISTRY, data: '0xb056072c' + addr(c.container) + pad(off) + pad(Math.min(50, c.pathCount - off)) }, 'latest']);
      paths.push(...decodeStringArray(r));
    }
    const fiRes = await batchCalls(paths.map(pth => ({ to: REGISTRY, data: '0x6c609107' + addr(c.container) + encodeStringArg(pth) })));
    c.files = paths.map((pth, i) => { try { const fi = decodeFileInfo(fiRes[i].result); return { path: pth, ...fi }; } catch { return { path: pth, size: 0, sha: null, contentType: '', updatedAt: 0, chunkCount: 0 }; } });
    c.totalBytes = c.files.reduce((a, f) => a + f.size, 0);
    if (++fDone % 10 === 0) console.log('sites enumerated:', fDone, '/', withFiles.length);
  });
  sites.push(...withFiles.map(c => ({
    container: c.container,
    processorIndex: c.p.index,
    processor: c.p.address,
    processorName: c.p.name,
    tokenId: c.tokenId,
    canonicalName: `${c.tokenId}.2.${c.p.index}.tape`,
    pathCount: c.pathCount,
    files: c.files,
    totalBytes: c.totalBytes,
    balanceWei: c.balanceWei,
    containerLive: c.containerLive,
    containerPaidUntil: c.containerPaidUntil,
  })));
}
function encodeStringArg(s) {
  const b = Buffer.from(s, 'utf8');
  const head = Buffer.alloc(64);
  head.writeBigUInt64BE(64n, 24); // fileInfo(address,string): head is 64 bytes, offset = 64
  head.writeBigUInt64BE(BigInt(b.length), 56); // length
  const padded = Buffer.alloc(Math.ceil(b.length / 32) * 32);
  b.copy(padded);
  return Buffer.concat([head, padded]).toString('hex');
}
sites.sort((a, b) => b.totalBytes - a.totalBytes);

const snapshot = {
  generatedAt: new Date().toISOString(),
  generatedAtBlock: latest,
  chainId: 196,
  method: 'eth_call probing (no log scans: public X Layer RPCs cap eth_getLogs at ~100 blocks)',
  contracts: { factory: FACTORY, opener: OPENER, registry: REGISTRY, binding: BINDING },
  stats: {
    processors: cpuCount,
    totalCircuits,
    openedContainers: opened.length,
    sites: sites.length,
    totalFiles: sites.reduce((a, s) => a + s.files.length, 0),
    totalBytes: sites.reduce((a, s) => a + s.totalBytes, 0),
    liveNamedContainers: sites.filter(s => s.containerLive).length,
  },
  processors,
  sites,
};
writeFileSync(new URL('./snapshot.json', import.meta.url), JSON.stringify(snapshot, null, 1));
console.log('DONE. stats:', JSON.stringify(snapshot.stats));
