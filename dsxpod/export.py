"""匯出可攜套件（zip）：USD 孿生 + 結果 + 參數。前端「匯出」按鈕呼叫 /api/export 走這裡。

zip 內容（解壓後直接用 Composer 開 data/twin/pod.usda；超過 50 MW 開 data/twin/campus.usda）：
  data/twin/pod.usda            設計層（代表區塊或整個場址）＋ pod_results.usda（結果層）＋ pod_checks.usda（檢查層）
  data/twin/campus.usda         超過 50 MW 才有：區塊以 instanceable Reference 鋪滿
  data/assets/dsx_pod/*.usda    生成資產（貨櫃殼、散熱模組）
  data/simready_assets/...      GB300 與 Vertiv 規格層（以及選擇性的 GB300 低模）
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
from .variants import COOLING, SUPPLY_TEMP, SUPPLY_LABEL
from .weather import SITES

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
GRID = next((d / "data" / "results_grid.json" for d in (ROOT / "web", ROOT / "public") if (d / "data" / "results_grid.json").exists()), ROOT / "web" / "data" / "results_grid.json")
VERTIV_ASSETS = ("XDU2300AA0S000F", "MCV430_6FAN", "APM2")


def _copy_assets(dst_data, include_proxy):
    (dst_data / "assets" / "dsx_pod").mkdir(parents=True, exist_ok=True)
    for f in (DATA / "assets" / "dsx_pod").glob("*.usda"): shutil.copy(f, dst_data / "assets" / "dsx_pod" / f.name)
    g = DATA / "simready_assets" / "nvidia" / "GB300"
    shutil.copytree(g / "layers", dst_data / "simready_assets" / "nvidia" / "GB300" / "layers")
    if include_proxy and (g / "proxy").exists(): shutil.copytree(g / "proxy", dst_data / "simready_assets" / "nvidia" / "GB300" / "proxy")
    for a in VERTIV_ASSETS:
        src = DATA / "simready_assets" / "vertiv" / a / "layers"
        if src.exists(): shutil.copytree(src, dst_data / "simready_assets" / "vertiv" / a / "layers")


def grid_lookup(site, cooling, supply, mw):
    """預算結果表在 log(MW) 上線性內插（沒有氣象快取時用）。"""
    g = json.loads(GRID.read_text(encoding="utf-8"))
    rows = sorted([r for r in g["rows"] if r["site"] == site and r["cooling"] == cooling and r["supply"] == supply], key=lambda r: r["mw"])
    if not rows: raise ValueError("結果表沒有這個組合")
    x = math.log(max(rows[0]["mw"], min(rows[-1]["mw"], mw)))
    for a, b in zip(rows, rows[1:]):
        if math.log(a["mw"]) <= x <= math.log(b["mw"]):
            t = (x - math.log(a["mw"])) / (math.log(b["mw"]) - math.log(a["mw"]))
            return {k: (a[k] + (b[k] - a[k]) * t if isinstance(a[k], (int, float)) and not isinstance(a[k], bool) else a[k]) for k in a}
    return rows[-1] if x >= math.log(rows[-1]["mw"]) else rows[0]


def export_package(site="johor", mw=None, site_l=None, site_w=None, cooling="dry_only", supply="t45", include_proxy=False):
    assert site in SITES and cooling in COOLING and supply in SUPPLY_TEMP
    layout = sizing.plan(mw=mw, site_l=site_l, site_w=site_w) if (mw is not None or (site_l and site_w)) else sizing.plan(mw=1)
    tmp = Path(tempfile.mkdtemp(prefix="dsxpod_export_")); pkg = tmp / "dsx_pod_export"; d = pkg / "data"
    t0 = time.time()
    try:
        _copy_assets(d, include_proxy)
        usd_out.configure(d, include_proxy=include_proxy)
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
            g = grid_lookup(site, cooling, supply, layout["it_mw"])
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
        st.SetEditTarget(Usd.EditTarget(root)); root.Save()
        inputs = dict(site=site, site_name=SITES[site]["name"], mw=mw, site_l=site_l, site_w=site_w, cooling=cooling, cooling_label=COOLING[cooling]["label"],
                      supply=supply, supply_label=SUPPLY_LABEL[supply])
        lay = {k: v for k, v in layout.items() if k != "pods"}
        result = dict(inputs=inputs, layout=lay, summary=sm, annual=rows, result_source=source,
                      design=dict(n_pods=layout["n_pods"], it_mw_nameplate=layout["it_mw"], site_m=layout["site_m"], area_ha=layout["area_ha"],
                                  recirculation_k=round(p.recirculation_k, 2), island_dt_k_at_3ms=round(p.island_dt(3.0), 2)),
                      checks=dict(summary=checks["summary"], violations=checks["violations"], capacity=checks["capacity"]), warnings=layout["warnings"],
                      generated=time.strftime("%Y-%m-%d %H:%M"))
        (pkg / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        (pkg / "params.json").write_text(json.dumps(dict(values={k: v for k, v in p.to_dict().items() if k != "notes"}, sources=[n for n in p.notes if "←" in n],
                                                         fallbacks=fallback_notes(p)), ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        if rows and "it_mwh" in rows[0]:
            with open(pkg / "results_annual.csv", "w", newline="", encoding="utf-8-sig") as fh:
                w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
        main = "data/twin/campus.usda" if layout["mode"] == "campus" else "data/twin/pod.usda"
        (pkg / "README.txt").write_text(f"""DSX POD 場址模型匯出（{result['generated']}）

場址：{SITES[site]['name']}　規模：{layout['n_pods']} 個 POD（{layout['it_mw']:g} MW IT 銘牌，{layout['n_blocks']} 區塊）　散熱：{COOLING[cooling]['label']}　供水：{SUPPLY_LABEL[supply]}
PUE 20 年均 {sm['pue_mean']:.3f}　每年排不掉熱 {sm['unmet_h_mean']:.0f} 小時　冰水機 {sm['chiller_mwh_mean']:,.0f} MWh/年　用水 {sm['water_m3_mean']:,.0f} m³/年

開啟：用 USD Composer 開 {main}（upAxis Z、公尺）。/World/Plant 上有 VariantSet cooling、supply_temp；/World/Site 有 site。
結果來源：{source}
檔案：results.json（摘要、逐年、佈局、檢查）、results_annual.csv、params.json（每個模型參數的 USD 來源）。
假設：Vera Rubin NVL72 以 GB300 規格代理；貨櫃與散熱模組外殼為程式生成；再循環與園區熱島為篩選等級估算，關鍵場址需 CFD 驗證。
{'GB300 低模未包含（payload 會顯示找不到檔案，不影響規格與能耗）。' if not include_proxy else ''}
""", encoding="utf-8")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for f in pkg.rglob("*"):
                if f.is_file(): z.write(f, f.relative_to(tmp).as_posix())
        meta = dict(bytes=buf.tell(), n_pods=layout["n_pods"], mode=layout["mode"], seconds=round(time.time() - t0, 1), result_source=source)
        return buf.getvalue(), meta
    finally:
        usd_out.configure(None)
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(); ap.add_argument("--site", default="johor"); ap.add_argument("--mw", type=float, default=10); ap.add_argument("--cooling", default="dry_only")
    ap.add_argument("--supply", default="t45"); ap.add_argument("--proxy", action="store_true"); ap.add_argument("--out", default=str(ROOT / "data" / "results" / "export_test.zip"))
    a = ap.parse_args()
    b, m = export_package(a.site, mw=a.mw, cooling=a.cooling, supply=a.supply, include_proxy=a.proxy)
    Path(a.out).write_bytes(b); print(m, "→", a.out)
