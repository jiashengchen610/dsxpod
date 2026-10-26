"""匯出可攜套件（zip）：USD 孿生 + 結果 + 參數。前端「匯出」按鈕呼叫 /api/export 走這裡。

zip 內容（解壓後直接用 Composer 開 data/twin/pod.usda；超過 50 MW 開 data/twin/campus.usda）：
  data/twin/pod.usda            設計層（代表區塊或整個場址）＋ pod_results.usda（結果層）＋ pod_checks.usda（檢查層）
  data/twin/campus.usda         超過 50 MW 才有：區塊以 instanceable Reference 鋪滿
  data/assets/dsx_pod/*.usda    生成資產（貨櫃殼、散熱模組）
  data/simready_assets/...      Vertiv 規格層（以及本機 full 匯出才有的 GB300 低模）；機櫃規格在 assets/dsx_pod/rack_spec.usda（自寫）
  results.json / results_annual.csv / params.json / README.txt
結果：本機有氣象快取就跑 20 年逐時（與 engine 相同）；沒有（例如部署在 Vercel）就用預算結果表內插，README 會註明。
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
import csv, io, json, math, os, shutil, tempfile, time, zipfile
from pathlib import Path
from pxr import Usd, Sdf
from . import sizing, usd_out
from .stage_io import stage_to_params, set_variants, current_variants, fallback_notes, write_results
from .layout import analyze, write_checks
from .variants import COOLING, SUPPLY_TEMP, SUPPLY_LABEL, coerce_knobs
from .products import PRODUCTS, spec as product_spec
from .weather import SITES

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
GRID = next((d / "data" / "results_grid.json" for d in (ROOT / "web", ROOT / "public") if (d / "data" / "results_grid.json").exists()), ROOT / "web" / "data" / "results_grid.json")
VERTIV_ASSETS = ("XDU2300AA0S000F", "MCV430_6FAN", "APM2")


# 真實幾何：Vertiv（Hugging Face Vertiv/simready-assets，CC-BY-4.0，可再散布）與 GB300 低模（NVIDIA DSX 內容包，只在本機匯出）
VERTIV_FULL = ("XDU2300AA0S000F",)                     # CDU；UPS 在電力模組外殼內（看不到）、乾冷卻器疊放時外觀用生成的散熱模組，都不需要完整幾何
ON_VERCEL = bool(os.environ.get("VERCEL"))


def available_geometry():
    """這台機器能打包的最完整幾何等級。部署環境（Vercel）沒有大型資產，也不散布 NGC 內容 → box。"""
    if ON_VERCEL: return "box"
    vertiv = all((DATA / "simready_assets" / "vertiv" / a / "full").exists() for a in VERTIV_FULL)
    nvidia = (DATA / "simready_assets" / "nvidia" / "GB300" / "proxy" / "proxy_GB300.usd").exists()
    return "full" if vertiv and nvidia else "vertiv" if vertiv else "box"


def _copy_assets(dst_data, geometry="box"):
    (dst_data / "assets" / "dsx_pod").mkdir(parents=True, exist_ok=True)
    for f in (DATA / "assets" / "dsx_pod").glob("*.usda"): shutil.copy(f, dst_data / "assets" / "dsx_pod" / f.name)
    g = DATA / "simready_assets" / "nvidia" / "GB300"
    if geometry == "full" and (g / "proxy").exists(): shutil.copytree(g / "proxy", dst_data / "simready_assets" / "nvidia" / "GB300" / "proxy")
    for a in VERTIV_ASSETS:
        src = DATA / "simready_assets" / "vertiv" / a / "layers"
        if src.exists(): shutil.copytree(src, dst_data / "simready_assets" / "vertiv" / a / "layers")
    if geometry in ("vertiv", "full"):
        for a in VERTIV_FULL:
            src = DATA / "simready_assets" / "vertiv" / a / "full"
            if src.exists(): shutil.copytree(src, dst_data / "simready_assets" / "vertiv" / a / "full")


FETCH_SCRIPT = '''"""下載 Vertiv 真實幾何（Hugging Face Vertiv/simready-assets，CC-BY-4.0）到這個匯出包裡，之後在 Composer 把 /World/Plant 的 geometry 變體切成 vertiv。
用法：python fetch_real_geometry.py（只需要 Python 3 標準函式庫）。GB300 機櫃低模來自 NVIDIA DSX 內容包（NGC），需自行取得，不在這裡下載。"""
import json, urllib.request, urllib.parse
from pathlib import Path
HERE = Path(__file__).resolve().parent / "data" / "simready_assets" / "vertiv"
UA = {"User-Agent": "Mozilla/5.0"}
for asset in ("XDU2300AA0S000F",):
    lst = json.load(urllib.request.urlopen(urllib.request.Request(f"https://huggingface.co/api/datasets/Vertiv/simready-assets/tree/main/{asset}?recursive=true", headers=UA), timeout=60))
    for f in (x for x in lst if x["type"] == "file"):
        out = HERE / asset / "full" / f["path"][len(asset) + 1:]
        if out.exists() and out.stat().st_size == f.get("size"): continue
        out.parent.mkdir(parents=True, exist_ok=True)
        url = "https://huggingface.co/datasets/Vertiv/simready-assets/resolve/main/" + urllib.parse.quote(f["path"])
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r: out.write_bytes(r.read())
        print("ok", f["path"])
print("完成。Composer 開 pod.usda → 選 /World/Plant → Property 面板 Variants → geometry = vertiv")
'''


def grid_lookup(site, cooling, supply, mw, product="dsx_pod", sku=None):
    """預算結果表在 log(MW) 上線性內插（沒有氣象快取時用）。GADU 讀 results_grid_gadu.json，依 SKU 篩。"""
    path = GRID if product == "dsx_pod" else GRID.with_name("results_grid_gadu.json")
    if not path.exists(): raise ValueError(f"這台伺服器沒有 {product} 的結果表")
    g = json.loads(path.read_text(encoding="utf-8"))
    rows = sorted([r for r in g["rows"] if r["site"] == site and r["cooling"] == cooling and r["supply"] == supply
                   and r.get("product", "dsx_pod") == product and (product == "dsx_pod" or r.get("sku") == sku)], key=lambda r: r["mw"])
    if not rows: raise ValueError("結果表沒有這個組合")
    x = math.log(max(rows[0]["mw"], min(rows[-1]["mw"], mw)))
    for a, b in zip(rows, rows[1:]):
        if math.log(a["mw"]) <= x <= math.log(b["mw"]):
            t = (x - math.log(a["mw"])) / (math.log(b["mw"]) - math.log(a["mw"]))
            return {k: (a[k] + (b[k] - a[k]) * t if isinstance(a[k], (int, float)) and not isinstance(a[k], bool) else a[k]) for k in a}
    return rows[-1] if x >= math.log(rows[-1]["mw"]) else rows[0]


def export_package(site="johor", mw=None, site_l=None, site_w=None, cooling="dry_only", supply="t45", include_proxy=None, geometry=None, product="dsx_pod", sku=None):
    """geometry：box / vertiv / full；None = 這台機器能打包的最完整等級（本機 full、Vercel box）。include_proxy 是舊參數（True ≈ full）。
    product：dsx_pod / gadu；sku：GADU 的機櫃型號（products.py）。"""
    assert site in SITES and cooling in COOLING and supply in SUPPLY_TEMP and product in PRODUCTS
    cooling, supply = coerce_knobs(product, cooling, supply)
    pr, sk = product_spec(product, sku); sku = sku or next(iter(pr["skus"]))
    avail = available_geometry(); order = ["box", "vertiv", "full"]
    if geometry is None: geometry = "full" if include_proxy else avail
    geometry = order[min(order.index(geometry if geometry in order else "box"), order.index(avail))]
    layout = sizing.plan(mw=mw, site_l=site_l, site_w=site_w, product=product, sku=sku) if (mw is not None or (site_l and site_w)) else sizing.plan(mw=1, product=product, sku=sku)
    tmp = Path(tempfile.mkdtemp(prefix="dsxpod_export_")); pkg = tmp / "dsx_pod_export"; d = pkg / "data"
    t0 = time.time()
    try:
        _copy_assets(d, geometry)
        usd_out.configure(d, include_proxy=(geometry == "full"))
        st = usd_out.build(site_key=site, layout=layout, cooling=cooling, supply=supply)
        set_variants(st, session=False, site=site, cooling=cooling, supply_temp=supply)      # 選擇寫進根層：開檔就是匯出時的配置
        p = stage_to_params(st)
        checks = analyze(st)
        blk = len([q for q in layout["pods"] if q["block"] == 0]); scale = layout["n_pods"] / max(1, blk)
        weather_ok = (DATA / "weather" / f"{site}_2005_2024.csv").exists()
        if weather_ok:
            from .run import run_one, summarize
            from .engine import SCALE_KEYS
            rows, _ = run_one(site, p)
            if abs(scale - 1) > 1e-9: rows = [dict(r, **{k: round(r[k] * scale, 2) for k in SCALE_KEYS if k in r}) for r in rows]
            sm = summarize(rows); source = "20-year hourly simulation (ERA5 2005-2024)"
        else:
            g = grid_lookup(site, cooling, supply, layout["it_mw"], product=product, sku=sku)
            rows = [dict(year=int(y), pue=v) for y, v in g["pue_by_year"].items()]
            sm = dict(pue_mean=g["pue_mean"], pue_p90=g["pue_p90"], pue_min=g["pue_min"], pue_max=g["pue_max"], unmet_h_mean=g["unmet_h"],
                      unmet_h_max=g["unmet_h_max"], chiller_mwh_mean=g["chiller_mwh"], water_m3_mean=g["water_m3"], facility_mwh_mean=g["facility_mwh"],
                      it_mwh_mean=g["it_mwh"], pue_valid=g["pue_valid"]); source = "precomputed grid, interpolated in log(MW) (no weather cache on this server)"
        root = st.GetRootLayer()
        for name in ("pod_checks.usda", "pod_results.usda"):          # 先建檔，再掛 sublayer（不存在的路徑不會進 layer stack）
            Sdf.Layer.CreateNew(str(d / "twin" / name)).Save()
            if name not in root.subLayerPaths: root.subLayerPaths.append(name)
        cl = Sdf.Layer.FindOrOpen(str(d / "twin" / "pod_checks.usda")); write_checks(st, checks, {"cooling": cooling, "n_pods": layout["n_pods"]}, layer=cl); cl.Save()
        if weather_ok:
            rl = Sdf.Layer.FindOrOpen(str(d / "twin" / "pod_results.usda")); write_results(st, site, dict(current_variants(st), n_pods=layout["n_pods"]), rows, layer=rl, notes=[n for n in p.notes if "←" in n]); rl.Save()
        else:
            pass
        # 造價：係數與場址最高氣溫都從 Stage 讀回（USD 是真相來源），寫進結果層與 results.json
        from .capex import capex as _capex
        from .capex import opex as _opex
        from .stage_io import read_cost_coef, site_t_max, site_elec_price, write_capex
        coef, coef_missing = read_cost_coef(st)
        cx = _capex(layout, product, sku, cooling, rise_k=p.recirculation_k + p.island_dt(3.0), t_max_c=site_t_max(st), c=coef)
        price = site_elec_price(st)
        cx.update(_opex(sm["it_mwh_mean"], sm["facility_mwh_mean"], price, cx["total"], c=coef))
        rl = Sdf.Layer.FindOrOpen(str(d / "twin" / "pod_results.usda")); write_capex(st, cx, layer=rl, basis=str(st.GetPrimAtPath("/World/Plant").GetAttribute("cost:basis").Get())); rl.Save()
        st.SetEditTarget(Usd.EditTarget(root)); root.Save()
        inputs = dict(site=site, site_name=SITES[site]["name"], mw=mw, site_l=site_l, site_w=site_w, cooling=cooling, cooling_label=COOLING[cooling]["label"],
                      product=product, product_name=pr["name"], sku=sku, sku_name=sk["name"],
                      supply=supply, supply_label=SUPPLY_LABEL[supply])
        lay = {k: v for k, v in layout.items() if k != "pods"}
        result = dict(inputs=inputs, layout=lay, summary=sm, annual=rows, result_source=source,
                      design=dict(n_pods=layout["n_pods"], it_mw_nameplate=layout["it_mw"], site_m=layout["site_m"], area_ha=layout["area_ha"],
                                  recirculation_k=round(p.recirculation_k, 2), island_dt_k_at_3ms=round(p.island_dt(3.0), 2)),
                      checks=dict(summary=checks["summary"], violations=checks["violations"], capacity=checks["capacity"]), warnings=layout["warnings"],
                      capex=dict(total_usd=round(cx["total"]), it_usd=round(cx["it"]), facility_usd=round(cx["facility"]), items={k: round(v) for k, v in cx["items"].items()},
                                 basis="racks + equipment + materials; excludes land, construction labor, design fees, contingency; IT at ODM/hyperscale procurement basis",
                                 coef_from_usd=not coef_missing, electricity_usd_per_kwh=price,
                                 energy_usd_per_year=round(cx["energy_usd_per_year"]), tco_usd_per_year=round(cx["tco_usd_per_year"]),
                                 tco_basis=f"capex / {coef['depreciation_years']:g} years + electricity (IT + facility) at the site's regional industrial price"),
                      generated=time.strftime("%Y-%m-%d %H:%M"))
        (pkg / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        (pkg / "params.json").write_text(json.dumps(dict(values={k: v for k, v in p.to_dict().items() if k != "notes"}, sources=[n for n in p.notes if "←" in n],
                                                         fallbacks=fallback_notes(p)), ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        if rows and "it_mwh" in rows[0]:
            with open(pkg / "results_annual.csv", "w", newline="", encoding="utf-8-sig") as fh:
                w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
        main = "data/twin/campus.usda" if layout["mode"] == "campus" else "data/twin/pod.usda"
        (pkg / "README.txt").write_text(f"""DSX POD 場址模型匯出（{result['generated']}）

產品：{pr['name']}（{sk['name']}）
場址：{SITES[site]['name']}　規模：{layout['n_pods']} 個單位（{layout['it_mw']:g} MW IT 銘牌，{layout['n_blocks']} 區塊）　散熱：{COOLING[cooling]['label']}　供水：{SUPPLY_LABEL[supply]}
PUE 20 年均 {sm['pue_mean']:.3f}　每年排不掉熱 {sm['unmet_h_mean']:.0f} 小時　冰水機 {sm['chiller_mwh_mean']:,.0f} MWh/年　用水 {sm['water_m3_mean']:,.0f} m³/年
造價（粗估 ±30–50%）：US$ {cx['total'] / 1e6:,.1f}M（IT {cx['it'] / 1e6:,.1f}M、設施 {cx['facility'] / 1e6:,.1f}M）；含機櫃與地上物設備材料，不含土地、施工人力、設計費與預備金；係數在 /World/Plant cost:coef:*
營運：電費 US$ {cx['energy_usd_per_year'] / 1e6:,.1f}M／年（{price:g} USD/kWh，地區平均工業電價）；總持有成本 US$ {cx['tco_usd_per_year'] / 1e6:,.1f}M／年（造價 ÷ {coef['depreciation_years']:g} 年 + 電費）

開啟：用 USD Composer 開 {main}（upAxis Z、公尺）。/World/Plant 上有 VariantSet cooling、supply_temp、geometry；/World/Site 有 site。
幾何：目前 geometry = {geometry}（box = 方塊；vertiv = Vertiv CDU 真實模型；full = 再加 GB300 機櫃低模）。{'這份是輕量包：執行 python fetch_real_geometry.py 下載 Vertiv 模型後，把 geometry 切成 vertiv。' if geometry == 'box' else ''}
一次選取：Window > Collection，/World/Plant 下有 pods（完整單元）、shells、coolerModules、dryCoolers、racks、cdus、utility，右鍵 Select Contents。
出處：Vertiv 模型與規格層來自 Hugging Face Vertiv/simready-assets（CC-BY-4.0，© Vertiv）；機櫃規格為 GB300 NVL72 的規格數字（rack_spec.usda，自寫，不含 NVIDIA 原始檔案）；GB300 低模只在本機 full 匯出、來自 NVIDIA DSX Content Pack（僅供內部評估，勿轉發）。
結果來源：{source}
檔案：results.json（摘要、逐年、佈局、檢查）、results_annual.csv、params.json（每個模型參數的 USD 來源）。
假設：Vera Rubin NVL72 以 GB300 規格代理；貨櫃與散熱模組外殼為程式生成；再循環與園區熱島為篩選等級估算，關鍵場址需 CFD 驗證。
""", encoding="utf-8")
        if geometry != "full": (pkg / "fetch_real_geometry.py").write_text(FETCH_SCRIPT, encoding="utf-8")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for f in pkg.rglob("*"):
                if f.is_file(): z.write(f, f.relative_to(tmp).as_posix())
        meta = dict(bytes=buf.tell(), n_pods=layout["n_pods"], mode=layout["mode"], seconds=round(time.time() - t0, 1), result_source=source, geometry=geometry)
        return buf.getvalue(), meta
    finally:
        usd_out.configure(None)
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(); ap.add_argument("--site", default="johor"); ap.add_argument("--mw", type=float, default=10); ap.add_argument("--cooling", default="dry_only")
    ap.add_argument("--supply", default="t45"); ap.add_argument("--proxy", action="store_true"); ap.add_argument("--out", default=str(ROOT / "data" / "results" / "export_test.zip"))
    a = ap.parse_args()
    b, m = export_package(a.site, mw=a.mw, cooling=a.cooling, supply=a.supply, include_proxy=a.proxy or None)
    Path(a.out).write_bytes(b); print(m, "→", a.out)
