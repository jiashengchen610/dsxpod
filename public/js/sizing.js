// 規模換算與區塊佈局（dsxpod/sizing.py 的 JS 版；tests/test_sizing_parity 檢查兩邊輸出一致，改一邊就要改另一邊）
// 陣列一律補成完整矩形；標準區塊 4 × 14 = 56 POD ≈ 90 MW（DSX POD 每個 1.61 MW）。
export const POD_MW = 7 * 230 / 1000.0;
export const POD_L = 12.192, POD_W = 2.438;
export const GAP_Y = 3.0, GAP_X = 6.0;
export const SKID_L = 6.058, SKID_GAP = 1.5;                       // 每個 POD 東端的 20 ft 電力模組（與 sizing.py 一致）
export const PITCH_X = POD_L + SKID_GAP + SKID_L + GAP_X, PITCH_Y = POD_W + GAP_Y;
export const BLOCK_ROWS = 4, BLOCK_COLS = 14, BLOCK_PODS = BLOCK_ROWS * BLOCK_COLS, BLOCK_MW = BLOCK_PODS * POD_MW;
export const ROAD = 12.0, SUBSTATION_STRIP = 20.0, SETBACK = 10.0;
export const MAX_MW = 1000.0, MAX_SIDE_M = 1500.0, DETAIL_MAX_MW = BLOCK_MW;
import { PRODUCTS, defaultSku } from './products.js';            // 產品 / SKU 的唯一來源（由 dsxpod/products.py 產生）
export function unitSpec(product = 'dsx_pod', sku = null) {
  const pr = PRODUCTS[product], sk = sku || defaultSku(product), sp = pr.skus[sk];
  return { product, sku: sk, mw: Number(sp.it_mw), py: POD_W + GAP_Y + Number(pr.pitch_extra_y_m), chillers: Number(sp.chillers) };
}
const DSX = unitSpec('dsx_pod');
const WASTE_W = 0.05;
const fmtG = v => String(Number(v.toPrecision(6)));

function grid(n, U) {
  let best = null;
  for (let rows = 1; rows <= BLOCK_PODS; rows++) {
    const cols = Math.ceil(n / rows);
    if (rows * cols > BLOCK_PODS) continue;
    const w = rows * PITCH_X, h = cols * U.py;
    const score = Math.max(w, h) / Math.min(w, h) + (rows * cols - n) * WASTE_W;
    if (best === null || score < best[0] - 1e-12) best = [score, rows, cols];
  }
  return [best[1], best[2]];
}

export function blockDims(rows, cols, U = DSX) { return [rows * PITCH_X - GAP_X, cols * U.py - GAP_Y]; }

export function plan({ mw = null, siteL = null, siteW = null, product = 'dsx_pod', sku = null } = {}) {
  const warnings = [];
  const U = unitSpec(product, sku);
  if (mw !== null && mw !== undefined) {
    mw = Number(mw);
    if (mw > MAX_MW) { warnings.push(`超過上限 ${fmtG(MAX_MW)} MW，已截到上限`); mw = MAX_MW; }
    const need = Math.max(1, Math.ceil(mw / U.mw - 1e-9));
    return layout(need, warnings, { mw }, null, null, U);
  }
  let L = Number(siteL), W = Number(siteW);
  if (Math.max(L, W) > MAX_SIDE_M) { warnings.push(`基地邊長超過 ${fmtG(MAX_SIDE_M)} m，已截到上限`); L = Math.min(L, MAX_SIDE_M); W = Math.min(W, MAX_SIDE_M); }
  const uL = L - 2 * SETBACK, uW = W - 2 * SETBACK;
  let rows = Math.max(0, Math.floor((uL + GAP_X) / PITCH_X)), cols = Math.max(0, Math.floor((uW - SUBSTATION_STRIP + GAP_Y) / U.py));
  if (rows * cols > BLOCK_PODS) return packSite(uL, uW, warnings, { site_l: L, site_w: W }, U);   // 超過一個區塊：完整區塊 + 剩餘空間的部分區塊
  rows = Math.min(rows, BLOCK_PODS); cols = Math.min(cols, BLOCK_PODS);
  while (rows * cols > BLOCK_PODS) { if (rows * PITCH_X >= cols * U.py) rows--; else cols--; }
  if (rows * cols === 0) { warnings.push('基地太小，放不下一個 POD'); rows = cols = 1; }
  return layout(rows * cols, warnings, { site_l: L, site_w: W }, [rows, cols], null, U);
}

// 基地塞滿（sizing.py _pack_site 的 JS 版）：完整區塊 + 東 / 北側剩餘空間的部分區塊，每塊一座變電站，總量不超過 1 GW
const MIN_PARTIAL_COLS = 4;                                         // 部分區塊至少 4 個單元寬（與 sizing.py 一致）
function packSite(uL, uW, warnings, requested, U) {
  const bl = r => blockDims(r, BLOCK_COLS, U)[0], bw = c => blockDims(BLOCK_ROWS, c, U)[1];
  const nbx = Math.max(0, Math.floor((uL + ROAD) / (bl(BLOCK_ROWS) + ROAD))), remL = uL - nbx * (bl(BLOCK_ROWS) + ROAD);
  const rx = Math.min(BLOCK_ROWS - 1, Math.max(0, Math.floor((remL + GAP_X) / PITCH_X)));
  const nby = Math.max(0, Math.floor((uW + ROAD) / (bw(BLOCK_COLS) + SUBSTATION_STRIP + ROAD))), remW = uW - nby * (bw(BLOCK_COLS) + SUBSTATION_STRIP + ROAD);
  let cy = Math.min(BLOCK_COLS - 1, Math.max(0, Math.floor((remW - SUBSTATION_STRIP + GAP_Y) / U.py)));
  if (cy < MIN_PARTIAL_COLS) cy = 0;                                 // 北側剩餘太窄：不為幾個單元另設變電站
  const xs = Array(nbx).fill(BLOCK_ROWS).concat(rx ? [rx] : []), ys = Array(nby).fill(BLOCK_COLS).concat(cy ? [cy] : []);
  const cap = Math.floor(MAX_MW / U.mw + 1e-9), possible = xs.reduce((a, b) => a + b, 0) * ys.reduce((a, b) => a + b, 0);
  if (possible > cap) {                                               // 超過 1 GW：集中排列（接近正方形）
    warnings.push(`基地可放 ${possible} 個單元，超過 1 GW 上限，只放 ${cap} 個以內（集中排列）`);
    return layout(cap, warnings, requested, null, null, U);
  }
  const blocks = [], pods = []; let yo = 0;
  for (const c of ys) {
    let xo = 0;
    for (const r0 of xs) {
      const left = cap - pods.length, r = r0 * c <= left ? r0 : Math.floor(left / c);
      if (r <= 0) break;
      const b = blocks.length, k = r * c, oy = yo + SUBSTATION_STRIP;
      blocks.push({ index: b, x: xo, y: oy, n_pods: k, rows: r, cols: c, length: bl(r), width: bw(c),
                    substation: { x: xo, y: yo, l: bl(r), w: SUBSTATION_STRIP - 4, mw: Math.round(k * U.mw * 10) / 10 } });
      for (let q = 0; q < k; q++) pods.push({ block: b, x: xo + Math.floor(q / c) * PITCH_X, y: oy + (q % c) * U.py });
      xo += bl(r0) + ROAD;
    }
    yo += bw(c) + SUBSTATION_STRIP + ROAD;
  }
  const site = [Math.max(...blocks.map(b => b.x + b.length)) + 2 * SETBACK, Math.max(...blocks.map(b => b.y + b.width)) + 2 * SETBACK];
  const nFull = blocks.filter(b => b.rows === BLOCK_ROWS && b.cols === BLOCK_COLS).length, mode = blocks.length > 1 ? 'campus' : 'detail';
  if (mode === 'campus') warnings.push(`基地切成 ${blocks.length} 個區塊（${nFull} 個完整 ${BLOCK_ROWS} × ${BLOCK_COLS}、${blocks.length - nFull} 個部分區塊，各帶一座變電站）；園區熱島為篩選估算，關鍵場址需 CFD 驗證`);
  return result(pods, blocks, site, mode, pods.length, warnings, requested, U);
}

function result(pods, blocks, site, mode, need, warnings, requested, U) {
  const nPods = pods.length, mw = nPods * U.mw;
  if (nPods > need) warnings.push(`補齊成完整陣列：需要 ${need} 個 POD，配置 ${nPods} 個（${mw.toFixed(1)} MW）`);
  const r1 = v => Math.round(v * 10) / 10;
  return { mode, n_pods: nPods, need_pods: need, cross_width_m: r1(Math.sqrt(site[0] * site[1])), it_mw: Math.round(mw * 1000) / 1000, pod_mw: U.mw, n_blocks: blocks.length, blocks, pods,
           site_m: [r1(site[0]), r1(site[1])], area_ha: Math.round(site[0] * site[1] / 1e4 * 100) / 100, pitch: { x: PITCH_X, y: U.py }, requested, warnings,
           product: U.product, sku: U.sku, unit_mw: U.mw, chillers_per_unit: U.chillers };
}

export function layout(need, warnings, requested, gridRC = null, nbx = null, U = DSX) {
  let blocks = [], pods = [], site, mode, nPods;
  if (need <= BLOCK_PODS) {
    const [rows, cols] = gridRC || grid(need, U);
    nPods = Math.min(need, rows * cols);                              // 最後一列可以不滿：數量剛好等於要求
    const [bL, bW] = blockDims(rows, cols, U);
    const oy = SUBSTATION_STRIP;                                      // 再小也要一座變電站
    for (let i = 0; i < nPods; i++) pods.push({ block: 0, x: Math.floor(i / cols) * PITCH_X, y: oy + (i % cols) * U.py });
    blocks = [{ index: 0, x: 0, y: oy, n_pods: nPods, rows, cols, length: bL, width: bW,
                substation: { x: 0, y: 0, l: bL, w: SUBSTATION_STRIP - 4, mw: Math.round(nPods * U.mw * 10) / 10 } }];
    site = [bL + 2 * SETBACK, bW + SUBSTATION_STRIP + 2 * SETBACK]; mode = 'detail';
  } else {
    need = Math.min(need, Math.floor(MAX_MW / U.mw + 1e-9));          // 1 GW 上限
    const full = Math.floor(need / BLOCK_PODS), left = need % BLOCK_PODS;
    let lastRows = 0, lastCols = 0;                                  // 最後一塊：可行列數裡挑外框浪費最少的，最後一列可以不滿（與 sizing.py 一致）
    if (left) {
      for (let r = Math.ceil(left / BLOCK_COLS); r <= BLOCK_ROWS; r++) { const c = Math.ceil(left / r), w = r * c - left;
        if (!lastRows || w < lastRows * lastCols - left) { lastRows = r; lastCols = c; } }
      lastRows = Math.ceil(left / lastCols);
    }
    const sizes = Array(full).fill([BLOCK_ROWS, BLOCK_COLS, BLOCK_PODS]); if (left) sizes.push([lastRows, lastCols, left]);
    const nBlocks = sizes.length;
    const [bL, bW] = blockDims(BLOCK_ROWS, BLOCK_COLS, U);
    const cellX = bL + ROAD, cellY = bW + SUBSTATION_STRIP + ROAD;
    if (nbx === null) nbx = Math.ceil(Math.sqrt(nBlocks * cellY / cellX));
    const nby = Math.ceil(nBlocks / nbx);
    sizes.forEach(([r, c, k], b) => {
      const bx = b % nbx, by = Math.floor(b / nbx);
      const [l_, w_] = blockDims(r, c, U);
      const ox = bx * cellX, oy = by * cellY + SUBSTATION_STRIP;
      blocks.push({ index: b, x: ox, y: oy, n_pods: k, rows: r, cols: c, length: l_, width: w_,
                    substation: { x: ox, y: by * cellY, l: l_, w: SUBSTATION_STRIP - 4, mw: Math.round(k * U.mw * 10) / 10 } });
      for (let i = 0; i < k; i++) pods.push({ block: b, x: ox + Math.floor(i / c) * PITCH_X, y: oy + (i % c) * U.py });
    });
    nPods = pods.length;
    site = [Math.min(nbx, nBlocks) * cellX - ROAD + 2 * SETBACK, nby * cellY - ROAD + 2 * SETBACK]; mode = 'campus';
    warnings.push(`超過 ${(BLOCK_PODS * U.mw).toFixed(0)} MW：切成 ${nBlocks} 個區塊（每塊 ${BLOCK_ROWS} × ${BLOCK_COLS} = ${BLOCK_PODS} POD，約 ${(BLOCK_PODS * U.mw).toFixed(0)} MW，各帶一座變電站）；園區熱島為篩選估算，關鍵場址需 CFD 驗證`);
  }
  return result(pods, blocks, site, mode, need, warnings, requested, U);
}
