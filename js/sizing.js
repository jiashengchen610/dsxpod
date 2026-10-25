// 規模換算與區塊佈局（dsxpod/sizing.py 的 JS 版；tests/sizing_parity 檢查兩邊輸出一致，改一邊就要改另一邊）
export const POD_MW = 7 * 136 / 1000.0;
export const POD_L = 12.192, POD_W = 2.438;
export const GAP_Y = 3.0, GAP_X = 6.0;
export const PITCH_X = POD_L + GAP_X, PITCH_Y = POD_W + GAP_Y;
export const BLOCK_MW = 50.0, BLOCK_PODS = 53;
export const ROAD = 12.0, SUBSTATION_STRIP = 20.0, SETBACK = 10.0;
export const MAX_MW = 1000.0, MAX_SIDE_M = 1500.0, DETAIL_MAX_MW = 50.0;

function grid(n) {
  let best = null;
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows);
    const w = rows * PITCH_X, h = cols * PITCH_Y;
    const score = Math.max(w, h) / Math.min(w, h) + (rows * cols - n) * 0.05;
    if (best === null || score < best[0]) best = [score, rows, cols];
  }
  return [best[1], best[2]];
}

export function blockDims(n) {
  const [rows, cols] = grid(n);
  return [rows, cols, rows * PITCH_X - GAP_X, cols * PITCH_Y - GAP_Y];
}

export function plan({ mw = null, siteL = null, siteW = null } = {}) {
  const warnings = [];
  if (mw !== null && mw !== undefined) {
    mw = Number(mw);
    if (mw > MAX_MW) { warnings.push(`超過上限 ${MAX_MW} MW，已截到上限`); mw = MAX_MW; }
    const n = Math.max(1, Math.ceil(mw * 1000 / (POD_MW * 1000) - 1e-9));
    return layout(n, warnings, { mw });
  }
  let L = Number(siteL), W = Number(siteW);
  if (Math.max(L, W) > MAX_SIDE_M) { warnings.push(`基地邊長超過 ${MAX_SIDE_M} m，已截到上限`); L = Math.min(L, MAX_SIDE_M); W = Math.min(W, MAX_SIDE_M); }
  const uL = L - 2 * SETBACK, uW = W - 2 * SETBACK;
  const rows = Math.floor((uL + GAP_X) / PITCH_X), cols = Math.floor((uW + GAP_Y) / PITCH_Y);
  const nSingle = Math.max(0, rows * cols);
  let n;
  if (nSingle <= BLOCK_PODS) n = nSingle;
  else {
    const [, , bL, bW] = blockDims(BLOCK_PODS);
    const nbx = Math.floor((uL + ROAD) / (bL + ROAD)), nby = Math.floor((uW + ROAD) / (bW + SUBSTATION_STRIP + ROAD));
    n = Math.min(nbx * nby * BLOCK_PODS, Math.floor(MAX_MW / POD_MW));
  }
  if (n === 0) { warnings.push('基地太小，放不下一個 POD'); n = 1; }
  return layout(n, warnings, { site_l: L, site_w: W });
}

export function layout(n, warnings, requested) {
  const mw = n * POD_MW;
  let blocks = [], pods = [], site, mode;
  if (n <= BLOCK_PODS) {
    const [rows, cols, bL, bW] = blockDims(n);
    for (let i = 0; i < n; i++) pods.push({ block: 0, x: Math.floor(i / cols) * PITCH_X, y: (i % cols) * PITCH_Y });
    blocks = [{ index: 0, x: 0, y: 0, n_pods: n, rows, cols, length: bL, width: bW }];
    site = [bL + 2 * SETBACK, bW + 2 * SETBACK]; mode = 'detail';
  } else {
    const nBlocks = Math.ceil(n / BLOCK_PODS);
    const [rows, cols, bL, bW] = blockDims(BLOCK_PODS);
    const cellX = bL + ROAD, cellY = bW + SUBSTATION_STRIP + ROAD;
    const nbx = Math.ceil(Math.sqrt(nBlocks * cellY / cellX)), nby = Math.ceil(nBlocks / nbx);
    let left = n;
    for (let b = 0; b < nBlocks; b++) {
      const bx = b % nbx, by = Math.floor(b / nbx);
      const k = Math.min(BLOCK_PODS, left); left -= k;
      const [r, c, l_, w_] = k < BLOCK_PODS ? blockDims(k) : [rows, cols, bL, bW];
      const ox = bx * cellX, oy = by * cellY + SUBSTATION_STRIP;
      blocks.push({ index: b, x: ox, y: oy, n_pods: k, rows: r, cols: c, length: l_, width: w_, substation: { x: ox, y: by * cellY, l: l_, w: SUBSTATION_STRIP - 4 } });
      for (let i = 0; i < k; i++) pods.push({ block: b, x: ox + Math.floor(i / c) * PITCH_X, y: oy + (i % c) * PITCH_Y });
    }
    site = [nbx * cellX - ROAD + 2 * SETBACK, nby * cellY - ROAD + 2 * SETBACK]; mode = 'campus';
    warnings.push(`超過 ${DETAIL_MAX_MW} MW：切成 ${nBlocks} 個區塊（每塊 ≤ ${BLOCK_MW} MW）；園區熱島為篩選估算，關鍵場址需 CFD 驗證`);
  }
  const r1 = v => Math.round(v * 10) / 10;
  return { mode, n_pods: n, cross_width_m: r1(Math.sqrt(site[0] * site[1])), it_mw: Math.round(mw * 1000) / 1000, pod_mw: POD_MW, n_blocks: blocks.length, blocks, pods,
           site_m: [r1(site[0]), r1(site[1])], area_ha: Math.round(site[0] * site[1] / 1e4 * 100) / 100, pitch: { x: PITCH_X, y: PITCH_Y }, requested, warnings };
}
