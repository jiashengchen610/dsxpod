// 規模換算與區塊佈局（dsxpod/sizing.py 的 JS 版；tests/test_sizing_parity 檢查兩邊輸出一致，改一邊就要改另一邊）
// 陣列一律補成完整矩形；標準區塊 4 × 14 = 56 POD ≈ 53.3 MW。
export const POD_MW = 7 * 136 / 1000.0;
export const POD_L = 12.192, POD_W = 2.438;
export const GAP_Y = 3.0, GAP_X = 6.0;
export const PITCH_X = POD_L + GAP_X, PITCH_Y = POD_W + GAP_Y;
export const BLOCK_ROWS = 4, BLOCK_COLS = 14, BLOCK_PODS = BLOCK_ROWS * BLOCK_COLS, BLOCK_MW = BLOCK_PODS * POD_MW;
export const ROAD = 12.0, SUBSTATION_STRIP = 20.0, SETBACK = 10.0;
export const MAX_MW = 1000.0, MAX_SIDE_M = 1500.0, DETAIL_MAX_MW = BLOCK_MW;
const WASTE_W = 0.05;
const fmtG = v => String(Number(v.toPrecision(6)));

function grid(n) {
  let best = null;
  for (let rows = 1; rows <= BLOCK_PODS; rows++) {
    const cols = Math.ceil(n / rows);
    if (rows * cols > BLOCK_PODS) continue;
    const w = rows * PITCH_X, h = cols * PITCH_Y;
    const score = Math.max(w, h) / Math.min(w, h) + (rows * cols - n) * WASTE_W;
    if (best === null || score < best[0] - 1e-12) best = [score, rows, cols];
  }
  return [best[1], best[2]];
}

export function blockDims(rows, cols) { return [rows * PITCH_X - GAP_X, cols * PITCH_Y - GAP_Y]; }

export function plan({ mw = null, siteL = null, siteW = null } = {}) {
  const warnings = [];
  if (mw !== null && mw !== undefined) {
    mw = Number(mw);
    if (mw > MAX_MW) { warnings.push(`超過上限 ${fmtG(MAX_MW)} MW，已截到上限`); mw = MAX_MW; }
    const need = Math.max(1, Math.ceil(mw / POD_MW - 1e-9));
    return layout(need, warnings, { mw });
  }
  let L = Number(siteL), W = Number(siteW);
  if (Math.max(L, W) > MAX_SIDE_M) { warnings.push(`基地邊長超過 ${fmtG(MAX_SIDE_M)} m，已截到上限`); L = Math.min(L, MAX_SIDE_M); W = Math.min(W, MAX_SIDE_M); }
  const uL = L - 2 * SETBACK, uW = W - 2 * SETBACK;
  let rows = Math.max(0, Math.floor((uL + GAP_X) / PITCH_X)), cols = Math.max(0, Math.floor((uW - SUBSTATION_STRIP + GAP_Y) / PITCH_Y));
  const [bL, bW] = blockDims(BLOCK_ROWS, BLOCK_COLS);
  const nbx = Math.max(0, Math.floor((uL + ROAD) / (bL + ROAD))), nby = Math.max(0, Math.floor((uW + ROAD) / (bW + SUBSTATION_STRIP + ROAD)));
  const maxBlocks = Math.floor(MAX_MW / BLOCK_MW);
  if (rows * cols > BLOCK_PODS && nbx * nby >= 2) {
    const capped = nbx * nby > maxBlocks;
    if (capped) warnings.push(`基地可放 ${nbx * nby} 個區塊，超過 1 GW 上限，只放 ${maxBlocks} 個（集中排列）`);
    const nBlocks = Math.min(nbx * nby, maxBlocks);
    return layout(nBlocks * BLOCK_PODS, warnings, { site_l: L, site_w: W }, null, capped ? null : nbx);
  }
  rows = Math.min(rows, BLOCK_PODS); cols = Math.min(cols, BLOCK_PODS);
  while (rows * cols > BLOCK_PODS) { if (rows * PITCH_X >= cols * PITCH_Y) rows--; else cols--; }
  if (rows * cols === 0) { warnings.push('基地太小，放不下一個 POD'); rows = cols = 1; }
  return layout(rows * cols, warnings, { site_l: L, site_w: W }, [rows, cols]);
}

export function layout(need, warnings, requested, gridRC = null, nbx = null) {
  let blocks = [], pods = [], site, mode, nPods;
  if (need <= BLOCK_PODS) {
    const [rows, cols] = gridRC || grid(need);
    nPods = rows * cols;
    const [bL, bW] = blockDims(rows, cols);
    const oy = SUBSTATION_STRIP;                                      // 再小也要一座變電站
    for (let i = 0; i < nPods; i++) pods.push({ block: 0, x: Math.floor(i / cols) * PITCH_X, y: oy + (i % cols) * PITCH_Y });
    blocks = [{ index: 0, x: 0, y: oy, n_pods: nPods, rows, cols, length: bL, width: bW,
                substation: { x: 0, y: 0, l: bL, w: SUBSTATION_STRIP - 4, mw: Math.round(nPods * POD_MW * 10) / 10 } }];
    site = [bL + 2 * SETBACK, bW + SUBSTATION_STRIP + 2 * SETBACK]; mode = 'detail';
  } else {
    const full = Math.floor(need / BLOCK_PODS), left = need % BLOCK_PODS;
    let lastRows = Math.ceil(left / BLOCK_COLS);
    if ((full * BLOCK_PODS + lastRows * BLOCK_COLS) * POD_MW > MAX_MW + 1e-9) lastRows = Math.floor(left / BLOCK_COLS);
    const sizes = Array(full).fill(BLOCK_ROWS); if (lastRows) sizes.push(lastRows);
    const nBlocks = sizes.length;
    const [bL, bW] = blockDims(BLOCK_ROWS, BLOCK_COLS);
    const cellX = bL + ROAD, cellY = bW + SUBSTATION_STRIP + ROAD;
    if (nbx === null) nbx = Math.ceil(Math.sqrt(nBlocks * cellY / cellX));
    const nby = Math.ceil(nBlocks / nbx);
    sizes.forEach((r, b) => {
      const bx = b % nbx, by = Math.floor(b / nbx);
      const [l_, w_] = blockDims(r, BLOCK_COLS);
      const ox = bx * cellX, oy = by * cellY + SUBSTATION_STRIP, k = r * BLOCK_COLS;
      blocks.push({ index: b, x: ox, y: oy, n_pods: k, rows: r, cols: BLOCK_COLS, length: l_, width: w_,
                    substation: { x: ox, y: by * cellY, l: l_, w: SUBSTATION_STRIP - 4, mw: Math.round(k * POD_MW * 10) / 10 } });
      for (let i = 0; i < k; i++) pods.push({ block: b, x: ox + Math.floor(i / BLOCK_COLS) * PITCH_X, y: oy + (i % BLOCK_COLS) * PITCH_Y });
    });
    nPods = pods.length;
    site = [Math.min(nbx, nBlocks) * cellX - ROAD + 2 * SETBACK, nby * cellY - ROAD + 2 * SETBACK]; mode = 'campus';
    warnings.push(`超過 ${BLOCK_MW.toFixed(0)} MW：切成 ${nBlocks} 個區塊（每塊 ${BLOCK_ROWS} × ${BLOCK_COLS} = ${BLOCK_PODS} POD，約 ${BLOCK_MW.toFixed(0)} MW，各帶一座變電站）；園區熱島為篩選估算，關鍵場址需 CFD 驗證`);
  }
  const mw = nPods * POD_MW;
  if (nPods > need) warnings.push(`補齊成完整陣列：需要 ${need} 個 POD，配置 ${nPods} 個（${mw.toFixed(1)} MW）`);
  const r1 = v => Math.round(v * 10) / 10;
  return { mode, n_pods: nPods, need_pods: need, cross_width_m: r1(Math.sqrt(site[0] * site[1])), it_mw: Math.round(mw * 1000) / 1000, pod_mw: POD_MW, n_blocks: blocks.length, blocks, pods,
           site_m: [r1(site[0]), r1(site[1])], area_ha: Math.round(site[0] * site[1] / 1e4 * 100) / 100, pitch: { x: PITCH_X, y: PITCH_Y }, requested, warnings };
}
