"""規模換算與區塊佈局：總電量（MW）或基地長寬 → POD 數、區塊數、每個 POD 的位置。

單位與假設：
  - 輸入電量 = IT 銘牌容量。1 個 POD = 7 櫃 × 136 kW = 0.952 MW（GB300 代理；Vera Rubin 數字公開後換）。
  - POD 間距：長邊並排 3 m（維修門淨空 1.2 m + 通道）；端牆之間 6 m。
  - 50 MW 以下是單一陣列；超過 50 MW 切成區塊：每塊 ≤ 50 MW（53 個 POD），區塊間 12 m 道路，每塊一側留 20 m 變電站 / 配電帶。
  - 上限：1 GW、基地 1,500 × 1,500 m（NVIDIA 稱 DSX POD 鎖定 1 GW 以下部署；再往上電網與熱島都不是篩選模型能處理的）。
  - 基地輸入時退縮 10 m。
回傳 dict 可直接給 usd_out.build(layout=...) 與前端。
"""
import math

POD_MW = 7 * 136 / 1000.0                  # 0.952 MW IT 銘牌
POD_L, POD_W = 12.192, 2.438
GAP_Y, GAP_X = 3.0, 6.0                    # 長邊並排間距、端牆間距
PITCH_X, PITCH_Y = POD_L + GAP_X, POD_W + GAP_Y
BLOCK_MW = 50.0
BLOCK_PODS = 53                            # ≈ 50.5 MW；detail 模式最多也是這麼多
ROAD = 12.0
SUBSTATION_STRIP = 20.0
SETBACK = 10.0
MAX_MW = 1000.0
MAX_SIDE_M = 1500.0
DETAIL_MAX_MW = 50.0                       # 超過就切區塊、前端換 LOD、園區層標示篩選等級


def _grid(n):
    """n 個 POD 排成接近正方形的 (列數 rows 沿 x, 每列 cols 沿 y)。"""
    best = None
    for rows in range(1, n + 1):
        cols = math.ceil(n / rows)
        w, h = rows * PITCH_X, cols * PITCH_Y
        score = max(w, h) / min(w, h) + (rows * cols - n) * 0.05
        if best is None or score < best[0]: best = (score, rows, cols)
    return best[1], best[2]


def block_dims(n_pods):
    rows, cols = _grid(n_pods)
    return rows, cols, rows * PITCH_X - GAP_X, cols * PITCH_Y - GAP_Y


def plan(mw=None, site_l=None, site_w=None):
    """擇一輸入：mw（IT 銘牌）或 site_l × site_w（m）。回傳佈局。"""
    warnings = []
    if mw is not None:
        mw = float(mw)
        if mw > MAX_MW: warnings.append(f"超過上限 {MAX_MW:g} MW，已截到上限"); mw = MAX_MW
        n_pods = max(1, math.ceil(mw * 1000 / (POD_MW * 1000)))
        return _layout(n_pods, warnings, requested=dict(mw=mw))
    L, W = float(site_l), float(site_w)
    if max(L, W) > MAX_SIDE_M: warnings.append(f"基地邊長超過 {MAX_SIDE_M:g} m，已截到上限"); L, W = min(L, MAX_SIDE_M), min(W, MAX_SIDE_M)
    uL, uW = L - 2 * SETBACK, W - 2 * SETBACK
    # 先試單一陣列，再試區塊
    rows, cols = int((uL + GAP_X) // PITCH_X), int((uW + GAP_Y) // PITCH_Y)
    n_single = max(0, rows * cols)
    if n_single <= BLOCK_PODS:
        n = n_single
    else:
        b_rows, b_cols, bL, bW = block_dims(BLOCK_PODS)
        nbx = int((uL + ROAD) // (bL + ROAD)); nby = int((uW + ROAD) // (bW + SUBSTATION_STRIP + ROAD))
        n = nbx * nby * BLOCK_PODS
        n = min(n, math.floor(MAX_MW / POD_MW))
    if n == 0: warnings.append("基地太小，放不下一個 POD"); n = 1
    return _layout(n, warnings, requested=dict(site_l=L, site_w=W))


def _layout(n_pods, warnings, requested):
    per_block = BLOCK_PODS
    mw = n_pods * POD_MW
    if n_pods <= BLOCK_PODS:
        rows, cols, bL, bW = block_dims(n_pods)
        pods = [dict(block=0, x=(i // cols) * PITCH_X, y=(i % cols) * PITCH_Y) for i in range(n_pods)]
        blocks = [dict(index=0, x=0.0, y=0.0, n_pods=n_pods, rows=rows, cols=cols, length=bL, width=bW)]
        site = (bL + 2 * SETBACK, bW + 2 * SETBACK)
        mode = "detail"
    else:
        n_blocks = math.ceil(n_pods / per_block)
        rows, cols, bL, bW = block_dims(per_block)
        cell_x, cell_y = bL + ROAD, bW + SUBSTATION_STRIP + ROAD
        nbx = math.ceil(math.sqrt(n_blocks * cell_y / cell_x))
        nby = math.ceil(n_blocks / nbx)
        blocks, pods = [], []
        left = n_pods
        for b in range(n_blocks):
            bx, by = b % nbx, b // nbx
            k = min(per_block, left); left -= k
            r, c, l_, w_ = block_dims(k) if k < per_block else (rows, cols, bL, bW)
            ox, oy = bx * cell_x, by * cell_y + SUBSTATION_STRIP
            blocks.append(dict(index=b, x=ox, y=oy, n_pods=k, rows=r, cols=c, length=l_, width=w_, substation=dict(x=ox, y=by * cell_y, l=l_, w=SUBSTATION_STRIP - 4)))
            pods += [dict(block=b, x=ox + (i // c) * PITCH_X, y=oy + (i % c) * PITCH_Y) for i in range(k)]
        site = (nbx * cell_x - ROAD + 2 * SETBACK, nby * cell_y - ROAD + 2 * SETBACK)
        mode = "campus"
        warnings.append(f"超過 {DETAIL_MAX_MW:g} MW：切成 {n_blocks} 個區塊（每塊 ≤ {BLOCK_MW:g} MW）；園區熱島為篩選估算，關鍵場址需 CFD 驗證")
    import math as _m
    cross = _m.sqrt(site[0] * site[1])
    return dict(mode=mode, n_pods=n_pods, cross_width_m=round(cross, 1), it_mw=round(mw, 3), pod_mw=POD_MW, n_blocks=len(blocks), blocks=blocks, pods=pods,
                site_m=[round(site[0], 1), round(site[1], 1)], area_ha=round(site[0] * site[1] / 1e4, 2),
                pitch=dict(x=PITCH_X, y=PITCH_Y), requested=requested, warnings=warnings)


if __name__ == "__main__":
    import sys, json
    sys.stdout.reconfigure(encoding="utf-8")
    for mw in (5, 20, 50, 51, 200, 1000):
        p = plan(mw=mw); print(f"{mw:5g} MW → {p['n_pods']:5d} POD、{p['n_blocks']:3d} 區塊、基地 {p['site_m']} m（{p['area_ha']} ha）{p['mode']}")
    for L, W in ((100, 60), (300, 300), (1500, 1500)):
        p = plan(site_l=L, site_w=W); print(f"基地 {L}×{W} → {p['n_pods']} POD、{p['it_mw']} MW、{p['n_blocks']} 區塊 {p['mode']}  {p['warnings']}")
