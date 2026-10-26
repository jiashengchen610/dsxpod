"""規模換算與區塊佈局：總電量（MW）或基地長寬 → POD 數、區塊數、每個 POD 的位置。

單位與假設：
  - 輸入電量 = IT 銘牌容量。1 個 POD = 7 櫃 × 230 kW = 1.61 MW（Vera Rubin NVL72 Max-P；GADU 的單元 MW 依 SKU，見 products.py）。
  - POD 間距：長邊並排 3 m（維修門淨空 1.2 m + 通道）；每個 POD 東端隔 1.5 m 接一個 20 ft 電力模組，模組端牆到下一個 POD 6 m。
  - 一個標準區塊 = 4 × 14 = 56 個單元（DSX POD 約 90 MW；GADU 依 SKU）。以內是單一陣列；超過就切區塊，區塊間 12 m 道路。每塊（含單一陣列）一側留 20 m 變電站 / 配電帶。
  - 陣列一律補成完整矩形（不留缺角），所以配置容量 ≥ 要求容量；1 GW 上限時改成往下取整列。
  - 上限：1 GW、基地 1,500 × 1,500 m（NVIDIA 稱 DSX POD 鎖定 1 GW 以下部署；再往上電網與熱島都不是篩選模型能處理的）。
  - 基地輸入時退縮 10 m。
回傳 dict 可直接給 usd_out.build(layout=...) 與前端。
"""
import math

POD_MW = 7 * 230 / 1000.0                  # 1.61 MW IT 銘牌（與 products.py 的 DSX POD it_mw 一致）
POD_L, POD_W = 12.192, 2.438
GAP_Y, GAP_X = 3.0, 6.0                    # 長邊並排間距、端牆間距（電力模組東端到下一個 POD）
SKID_L, SKID_GAP = 6.058, 1.5              # 每個 POD 東端接一個 20 ft 電力模組（power skid），間隔 1.5 m（電纜）
PITCH_X, PITCH_Y = POD_L + SKID_GAP + SKID_L + GAP_X, POD_W + GAP_Y
BLOCK_ROWS, BLOCK_COLS = 4, 14            # 標準區塊 4 列（沿 x）× 14 個（沿 y）= 56 POD ≈ 90 MW（DSX POD），約 73 × 76 m
BLOCK_PODS = BLOCK_ROWS * BLOCK_COLS
BLOCK_MW = BLOCK_PODS * POD_MW
ROAD = 12.0
SUBSTATION_STRIP = 20.0
SETBACK = 10.0
MAX_MW = 1000.0
MAX_SIDE_M = 1500.0
DETAIL_MAX_MW = BLOCK_MW                   # 一個區塊以內 = detail；超過就切區塊、前端換 LOD
from .products import PRODUCTS, default_sku   # noqa: E402  產品 / SKU 的唯一來源


def unit_spec(product="dsx_pod", sku=None):
    """規模換算需要的單位規格：mw（每單位 IT 銘牌）、py（長邊並排的間距）、product / sku。
    GADU 單位北側多一條冰水機帶（pitch_extra_y_m），所以 y 向間距比 DSX POD 大。"""
    pr = PRODUCTS[product]; sk = sku or default_sku(product); sp = pr["skus"][sk]
    return dict(product=product, sku=sk, mw=float(sp["it_mw"]), py=POD_W + GAP_Y + float(pr["pitch_extra_y_m"]), chillers=int(sp["chillers"]))


DSX = None   # 延後建立（products 載入後）
WASTE_W = 0.05                             # 補齊陣列時每多一個 POD 的懲罰（相對於長寬比）


def _grid(n, U):
    """至少放 n 個 POD 的完整矩形陣列 (rows 沿 x, cols 沿 y)，rows*cols ≤ BLOCK_PODS；接近正方形、補的 POD 少者優先。"""
    best = None
    for rows in range(1, BLOCK_PODS + 1):
        cols = math.ceil(n / rows)
        if rows * cols > BLOCK_PODS: continue
        w, h = rows * PITCH_X, cols * U['py']
        score = max(w, h) / min(w, h) + (rows * cols - n) * WASTE_W
        if best is None or score < best[0] - 1e-12: best = (score, rows, cols)
    return best[1], best[2]


def block_dims(rows, cols, U=None):
    U = U or DSX
    return rows * PITCH_X - GAP_X, cols * U['py'] - GAP_Y


def plan(mw=None, site_l=None, site_w=None, product="dsx_pod", sku=None):
    """擇一輸入：mw（IT 銘牌）或 site_l × site_w（m）。回傳佈局。
    陣列一律補成完整矩形（不留缺角）：所以配置的 POD 數 ≥ 需求，前端顯示「要求 X MW → 配置 Y MW」。"""
    warnings = []
    U = unit_spec(product, sku)
    if mw is not None:
        mw = float(mw)
        if mw > MAX_MW: warnings.append(f"超過上限 {MAX_MW:g} MW，已截到上限"); mw = MAX_MW
        need = max(1, math.ceil(mw / U['mw'] - 1e-9))
        return _layout(need, warnings, requested=dict(mw=mw), U=U)
    L, W = float(site_l), float(site_w)
    if max(L, W) > MAX_SIDE_M: warnings.append(f"基地邊長超過 {MAX_SIDE_M:g} m，已截到上限"); L, W = min(L, MAX_SIDE_M), min(W, MAX_SIDE_M)
    uL, uW = L - 2 * SETBACK, W - 2 * SETBACK
    rows, cols = max(0, int((uL + GAP_X) // PITCH_X)), max(0, int((uW - SUBSTATION_STRIP + GAP_Y) // U['py']))   # 單一陣列也留變電帶
    if rows * cols > BLOCK_PODS:                 # 超過一個區塊：完整區塊 + 剩餘空間的部分區塊，把基地塞滿
        return _pack_site(uL, uW, warnings, dict(site_l=L, site_w=W), U)
    # 單一陣列：照基地切出的列數 × 個數，但不超過一個區塊
    rows, cols = min(rows, BLOCK_PODS), min(cols, BLOCK_PODS)
    while rows * cols > BLOCK_PODS:
        if rows * PITCH_X >= cols * U['py']: rows -= 1
        else: cols -= 1
    if rows * cols == 0: warnings.append("基地太小，放不下一個 POD"); rows = cols = 1
    return _layout(rows * cols, warnings, requested=dict(site_l=L, site_w=W), grid=(rows, cols), U=U)


MIN_PARTIAL_COLS = 4                       # 部分區塊（北側剩餘）至少 4 個單元寬才值得配一座變電站


def _pack_site(uL, uW, warnings, requested, U):
    """基地塞滿：東西向放 nbx 個完整區塊（4 列），剩下的長度做一個「少幾列」的區塊；南北向放 nby 個完整區塊（14 個），
    剩下的寬度做一個「少幾個」的區塊。每塊各帶一座變電站（大小依容量）。總量不超過 1 GW（最後一塊減列）。"""
    bl = lambda r: block_dims(r, BLOCK_COLS, U)[0]
    bw = lambda c: block_dims(BLOCK_ROWS, c, U)[1]
    nbx = max(0, int((uL + ROAD) // (bl(BLOCK_ROWS) + ROAD))); rem_l = uL - nbx * (bl(BLOCK_ROWS) + ROAD)
    rx = min(BLOCK_ROWS - 1, max(0, int((rem_l + GAP_X) // PITCH_X)))
    nby = max(0, int((uW + ROAD) // (bw(BLOCK_COLS) + SUBSTATION_STRIP + ROAD))); rem_w = uW - nby * (bw(BLOCK_COLS) + SUBSTATION_STRIP + ROAD)
    cy = min(BLOCK_COLS - 1, max(0, int((rem_w - SUBSTATION_STRIP + GAP_Y) // U['py'])))
    if cy < MIN_PARTIAL_COLS: cy = 0                         # 北側剩餘太窄（少於 4 個）：不為幾個單元另設一座變電站
    xs = [BLOCK_ROWS] * nbx + ([rx] if rx else []); ys = [BLOCK_COLS] * nby + ([cy] if cy else [])
    cap = int(MAX_MW / U['mw'] + 1e-9); possible = sum(xs) * sum(ys)
    if possible > cap:                                        # 超過 1 GW：沿用電量模式的集中排列（接近正方形），不要排成一條長帶
        warnings.append(f"基地可放 {possible} 個單元，超過 1 GW 上限，只放 {cap} 個以內（集中排列）")
        return _layout(cap, warnings, requested, U=U)
    blocks, pods, yo = [], [], 0.0
    for c in ys:
        xo = 0.0
        for r0 in xs:
            left = cap - len(pods); r = r0 if r0 * c <= left else left // c
            if r <= 0: break
            b, k, oy = len(blocks), r * c, yo + SUBSTATION_STRIP
            blocks.append(dict(index=b, x=xo, y=oy, n_pods=k, rows=r, cols=c, length=bl(r), width=bw(c),
                               substation=dict(x=xo, y=yo, l=bl(r), w=SUBSTATION_STRIP - 4, mw=round(k * U['mw'], 1))))
            pods += [dict(block=b, x=xo + (q // c) * PITCH_X, y=oy + (q % c) * U['py']) for q in range(k)]
            xo += bl(r0) + ROAD
        yo += bw(c) + SUBSTATION_STRIP + ROAD
    site = (max(b["x"] + b["length"] for b in blocks) + 2 * SETBACK, max(b["y"] + b["width"] for b in blocks) + 2 * SETBACK)
    n_full = sum(1 for b in blocks if b["rows"] == BLOCK_ROWS and b["cols"] == BLOCK_COLS)
    mode = "campus" if len(blocks) > 1 else "detail"
    if mode == "campus":
        warnings.append(f"基地切成 {len(blocks)} 個區塊（{n_full} 個完整 {BLOCK_ROWS} × {BLOCK_COLS}、{len(blocks) - n_full} 個部分區塊，各帶一座變電站）；園區熱島為篩選估算，關鍵場址需 CFD 驗證")
    return _result(pods, blocks, site, mode, len(pods), warnings, requested, U)


def _result(pods, blocks, site, mode, need, warnings, requested, U):
    n_pods = len(pods); mw = n_pods * U['mw']
    if n_pods > need: warnings.append(f"補齊成完整陣列：需要 {need} 個 POD，配置 {n_pods} 個（{mw:.1f} MW）")
    cross = math.sqrt(site[0] * site[1])
    r1 = lambda v: math.floor(v * 10 + 0.5) / 10            # 四捨五入（與 JS Math.round 一致；Python round 是銀行家捨入，.5 會不同）
    return dict(mode=mode, n_pods=n_pods, need_pods=need, cross_width_m=r1(cross), it_mw=math.floor(mw * 1000 + 0.5) / 1000, pod_mw=U['mw'], n_blocks=len(blocks), blocks=blocks, pods=pods,
                site_m=[r1(site[0]), r1(site[1])], area_ha=math.floor(site[0] * site[1] / 1e4 * 100 + 0.5) / 100,
                pitch=dict(x=PITCH_X, y=U['py']), requested=requested, warnings=warnings,
                product=U["product"], sku=U["sku"], unit_mw=U['mw'], chillers_per_unit=U["chillers"])


def _layout(need, warnings, requested, grid=None, nbx=None, U=None):
    """need = 至少要幾個單位。grid 指定單一陣列的 (rows, cols)；nbx 指定區塊每排幾塊；U = unit_spec()（None = DSX POD）。"""
    U = U or DSX
    if need <= BLOCK_PODS:
        rows, cols = grid or _grid(need, U)
        n_pods = rows * cols
        bL, bW = block_dims(rows, cols, U)
        oy = SUBSTATION_STRIP                                              # 再小也要一座變電站（小場址前端縮成箱式變電站尺寸）
        pods = [dict(block=0, x=(i // cols) * PITCH_X, y=oy + (i % cols) * U['py']) for i in range(n_pods)]
        blocks = [dict(index=0, x=0.0, y=oy, n_pods=n_pods, rows=rows, cols=cols, length=bL, width=bW,
                       substation=dict(x=0.0, y=0.0, l=bL, w=SUBSTATION_STRIP - 4, mw=round(n_pods * U['mw'], 1)))]
        site = (bL + 2 * SETBACK, bW + SUBSTATION_STRIP + 2 * SETBACK)
        mode = "detail"
    else:
        full, left = divmod(need, BLOCK_PODS)
        last_rows = last_cols = 0                                          # 最後一塊：在可行的列數裡挑浪費最少的（如 40 = 4 × 10，不是 3 × 14）
        if left:
            last_rows, last_cols = min(((r, math.ceil(left / r)) for r in range(math.ceil(left / BLOCK_COLS), BLOCK_ROWS + 1)), key=lambda rc: (rc[0] * rc[1] - left, rc[0]))
        cap_pods = int(MAX_MW / U['mw'] + 1e-9)
        if full * BLOCK_PODS + last_rows * last_cols > cap_pods:
            last_cols = (cap_pods - full * BLOCK_PODS) // last_rows if last_rows else 0
            if last_cols <= 0: last_rows = last_cols = 0
        sizes = [(BLOCK_ROWS, BLOCK_COLS)] * full + ([(last_rows, last_cols)] if last_rows else [])
        n_blocks = len(sizes)
        bL, bW = block_dims(BLOCK_ROWS, BLOCK_COLS, U)
        cell_x, cell_y = bL + ROAD, bW + SUBSTATION_STRIP + ROAD
        if nbx is None: nbx = math.ceil(math.sqrt(n_blocks * cell_y / cell_x))
        nby = math.ceil(n_blocks / nbx)
        blocks, pods = [], []
        for b, (r, c) in enumerate(sizes):
            bx, by = b % nbx, b // nbx
            l_, w_ = block_dims(r, c, U)
            ox, oy = bx * cell_x, by * cell_y + SUBSTATION_STRIP
            k = r * c
            blocks.append(dict(index=b, x=ox, y=oy, n_pods=k, rows=r, cols=c, length=l_, width=w_,
                               substation=dict(x=ox, y=by * cell_y, l=l_, w=SUBSTATION_STRIP - 4, mw=round(k * U['mw'], 1))))
            pods += [dict(block=b, x=ox + (i // c) * PITCH_X, y=oy + (i % c) * U['py']) for i in range(k)]
        n_pods = len(pods)
        site = (min(nbx, n_blocks) * cell_x - ROAD + 2 * SETBACK, nby * cell_y - ROAD + 2 * SETBACK)
        mode = "campus"
        warnings.append(f"超過 {(BLOCK_PODS * U['mw']):.0f} MW：切成 {n_blocks} 個區塊（每塊 {BLOCK_ROWS} × {BLOCK_COLS} = {BLOCK_PODS} POD，約 {(BLOCK_PODS * U['mw']):.0f} MW，各帶一座變電站）；園區熱島為篩選估算，關鍵場址需 CFD 驗證")
    return _result(pods, blocks, site, mode, need, warnings, requested, U)


if __name__ == "__main__":
    import sys, json
    sys.stdout.reconfigure(encoding="utf-8")
    for mw in (5, 20, 50, 51, 200, 1000):
        p = plan(mw=mw); print(f"{mw:5g} MW → {p['n_pods']:5d} POD、{p['n_blocks']:3d} 區塊、基地 {p['site_m']} m（{p['area_ha']} ha）{p['mode']}")
    for L, W in ((100, 60), (300, 300), (1500, 1500)):
        p = plan(site_l=L, site_w=W); print(f"基地 {L}×{W} → {p['n_pods']} POD、{p['it_mw']} MW、{p['n_blocks']} 區塊 {p['mode']}  {p['warnings']}")


DSX = unit_spec("dsx_pod")
