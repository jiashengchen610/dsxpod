"""造價（capex）模型：唯一來源。web/js/capex.js 由這裡產生（python -m dsxpod.capex），
dsxpod/tests/test_capex_parity 檢查兩邊算出來一樣。

範圍（使用者 2026-10-26 決定）：機櫃 + 所有地上物的「設備與材料」，美元；
不含土地取得、施工人力、設計費與預備金（政府取得土地、整包輸出施工，難以估計）。

公平性（使用者要求所有模組之間可比較）：
- IT 硬體一律用同一種價格基礎：ODM / 大客戶採購價。只有零售價的 SKU（MI355X）乘上零售→採購係數
  （以 HGX B300 推得：採購中位 $450k ÷ 完整配置零售 $647k ≈ 0.70）；查不到價格的 SKU（HGX Rubin NVL8）
  用同代 NVL72 的每 GPU 價格 × 8（上一代 HGX B300 與 GB300 NVL72 每 GPU 價格幾乎相同，$56k vs $55.6k）。
- 對外網路一律為運算硬體的 10%（所有 SKU 同比例）。
- 設施（貨櫃、CDU、散熱、電力、基地）全部用同一套數量規則；只有數量依產品與場址不同。

係數也寫進 USD（/World/Plant 的 cost:coef:*，usd_out.build 寫、stage_io.read_cost_coef 讀），匯出時從 Stage 讀回再算。
"""
import json, math
from pathlib import Path
from .products import PRODUCTS, DLC_LIQUID_FRACTION

ROOT = Path(__file__).resolve().parent.parent

# key: (數值, 單位, 說明, 來源, 可信度)
COEF = {
    # ---- IT（ODM / 大客戶採購價基礎）
    "rack_vr_nvl72":      (7.8e6,  "USD/rack",  "NVIDIA Vera Rubin NVL72 rack", "Morgan Stanley BOM analysis 2026-05 (ODM procurement; range $5-9M)", "medium"),
    "rack_gb300_nvl72":   (4.0e6,  "USD/rack",  "NVIDIA GB300 NVL72 rack", "Morgan Stanley 2026-05; Loop Capital (range $3.7-6.5M)", "medium"),
    "srv_hgx_b300":       (4.5e5,  "USD/server", "HGX B300 8-GPU server", "reseller/DGX quotes 2026 ($300-650k, mid)", "medium"),
    "srv_mi355x_retail":  (6.9e5,  "USD/server", "AMD MI355X 8-GPU server, EU retail ex-VAT", "Servermall listing (EUR 640k, GIGABYTE / Dell)", "medium"),
    "retail_to_odm":      (0.70,   "ratio",     "retail -> ODM procurement factor", "HGX B300: $450k mid / $647k configured retail", "low"),
    "gpus_per_server":    (8.0,    "GPU",       "GPUs per HGX / OAM server", "vendor specs", "high"),
    "network_frac":       (0.10,   "ratio",     "scale-out network as fraction of compute hardware", "assumption (same for all SKUs)", "low"),
    # ---- 單元
    "container":          (2.5e5,  "USD/unit",  "container shell + fire suppression + piping + panels", "estimate", "low"),
    "cdu":                (3.0e5,  "USD/CDU",   "2.3 MW class CDU", "CDU market $150-400/kW", "medium"),
    "inrow_cooler":       (3.0e4,  "USD/unit",  "in-row cooler", "estimate", "low"),
    # ---- 散熱
    "dry_cooler_per_kw":  (90.0,   "USD/kW",    "dry cooler, per kW heat rejection", "relative benchmarks only (2.6x open tower)", "low"),
    "dry_module_kw":      (430.0,  "kW",        "heat rejection per cooler module (Vertiv MCV430)", "Vertiv model rating", "medium"),
    "dry_modules_per_pod": (3.0,   "count",     "cooler modules per DSX POD (N+1)", "layout", "high"),
    "chiller_per_kw":     (250.0,  "USD/kW",    "air-cooled chiller, per kW cooling", "techno-economic literature (arXiv 2608.10999)", "medium"),
    "chiller_margin":     (1.2,    "ratio",     "chiller rated capacity / design deficit", "same as energy model", "high"),
    "trim_fws_supply_c":  (42.0,   "C",         "DSX facility water supply (45 C TCS - 3 K CDU)", "energy model", "high"),
    "trim_delta_t_k":     (10.4,   "K",         "facility water delta-T at 45 C (GB300 flow curve)", "energy model", "high"),
    "trim_approach_k":    (5.0,    "K",         "dry cooler approach", "energy model", "high"),
    "gadu_chiller_design": (1.03,  "ratio",     "GADU chiller design heat / IT (incl. envelope)", "usd_out.build_gadu_unit", "high"),
    # ---- 電力
    "power_center_per_mw": (6.0e5, "USD/MW",    "per-unit 800 VDC power center / AC power skid", "BofA via Eaton: UPS $0.8M + switchgear $0.5M per MW, discounted", "low"),
    "substation_per_mw":  (2.7e5,  "USD/MW",    "customer-owned campus substation", "DC Market Insights 2025", "medium"),
    # ---- 基地（材料）
    "pad_thick_m":        (0.2,    "m",         "concrete pad thickness", "assumption", "medium"),
    "concrete_m3":        (190.0,  "USD/m3",    "ready-mix concrete", "2026 US public bids (~$145/yd3)", "high"),
    "rebar_frac":         (0.40,   "ratio",     "reinforcement as fraction of concrete", "assumption", "low"),
    "gravel_thick_m":     (0.15,   "m",         "gravel surfacing thickness", "assumption", "medium"),
    "gravel_t_m3":        (1.6,    "t/m3",      "gravel density", "engineering handbook", "high"),
    "gravel_t":           (45.0,   "USD/t",     "crushed gravel", "supplier price guides", "medium"),
    "paved_frac":         (0.08,   "ratio",     "paved road fraction of site area", "assumption", "low"),
    "asphalt_thick_m":    (0.1,    "m",         "asphalt thickness", "assumption", "medium"),
    "asphalt_t_m3":       (2.4,    "t/m3",      "asphalt density", "engineering handbook", "high"),
    "asphalt_t":          (100.0,  "USD/t",     "hot-mix asphalt", "2026 US public bids ($70-130/t)", "high"),
    "fence_m":            (18.0,   "USD/m",     "chain-link fence material", "Fixr material-only ($5.3/ft)", "medium"),
    "building":           (3.0e5,  "USD/block", "control / substation building", "estimate", "low"),
}
C = {k: v[0] for k, v in COEF.items()}


def it_unit_price(product, sku, c=C):
    """一個單元的運算硬體價（不含網路）。"""
    sk = PRODUCTS[product]["skus"][sku]
    if sku == "vera_rubin_nvl72": return sk["racks_compute"] * c["rack_vr_nvl72"]
    if sku == "gb300_nvl72": return sk["racks_compute"] * c["rack_gb300_nvl72"]
    servers = sk["gpus"] / c["gpus_per_server"]
    if sku == "hgx_b300": return servers * c["srv_hgx_b300"]
    if sku == "hgx_rubin_nvl8": return servers * c["rack_vr_nvl72"] / 72 * c["gpus_per_server"]
    if sku == "mi355x": return servers * c["srv_mi355x_retail"] * c["retail_to_odm"]
    raise KeyError(sku)


def capex(layout, product, sku, cooling, rise_k=0.0, t_max_c=35.0, c=C):
    """回傳 {items: {key: USD}, it, facility, total}。layout 來自 sizing.plan；rise_k = 再循環 + 園區熱島；t_max_c = 場址 20 年最高氣溫。"""
    sk = PRODUCTS[product]["skus"][sku]; n = layout["n_pods"]; it_mw = layout["it_mw"]
    it = {"compute": n * it_unit_price(product, sku, c)}
    it["network"] = it["compute"] * c["network_frac"]
    f = {"container": n * c["container"], "cdu": n * sk["cdus"] * c["cdu"], "inrow": n * sk["inrow_coolers"] * c["inrow_cooler"]}
    if product == "dsx_pod":
        f["dry_cooler"] = n * c["dry_modules_per_pod"] * c["dry_module_kw"] * c["dry_cooler_per_kw"]
        chiller_kw = 0.0
        if cooling == "dry_plus_chiller":                # 輔助冰水機：最熱一小時乾冷卻器排不掉的份額 × 液冷熱 × 餘裕
            reachable = t_max_c + rise_k + c["trim_approach_k"]
            frac = min(1.0, max(0.0, (c["trim_fws_supply_c"] + c["trim_delta_t_k"] - reachable) / c["trim_delta_t_k"]))
            chiller_kw = (1.0 - frac) * it_mw * 1000.0 * DLC_LIQUID_FRACTION * c["chiller_margin"]
        f["chiller"] = chiller_kw * c["chiller_per_kw"]
    else:
        f["dry_cooler"] = 0.0
        f["chiller"] = n * sk["it_mw"] * 1000.0 * c["gadu_chiller_design"] * c["chiller_margin"] * c["chiller_per_kw"]
    f["power_center"] = it_mw * c["power_center_per_mw"]
    f["substation"] = it_mw * c["substation_per_mw"]
    sx, sy = layout["site_m"]; area = sx * sy
    pads = sum((b["length"] + 5.0) * (b["width"] + 5.0) for b in layout["blocks"])
    f["site_works"] = (pads * c["pad_thick_m"] * c["concrete_m3"] * (1.0 + c["rebar_frac"])
                       + area * c["gravel_thick_m"] * c["gravel_t_m3"] * c["gravel_t"]
                       + area * c["paved_frac"] * c["asphalt_thick_m"] * c["asphalt_t_m3"] * c["asphalt_t"]
                       + 2.0 * (sx + sy) * c["fence_m"])
    f["buildings"] = layout["n_blocks"] * c["building"]
    items = {**it, **f}
    tot_it, tot_f = sum(it.values()), sum(f.values())
    return dict(items=items, it=tot_it, facility=tot_f, total=tot_it + tot_f)


# ---------------------------------------------------------------- 前端（同一套規則的 JS 版）
JS_FN = r"""
const LIQ = %(liq)s;
export function itUnitPrice(product, sku, c = C) {
  const sk = PRODUCTS[product].skus[sku];
  if (sku === 'vera_rubin_nvl72') return sk.racks_compute * c.rack_vr_nvl72;
  if (sku === 'gb300_nvl72') return sk.racks_compute * c.rack_gb300_nvl72;
  const servers = sk.gpus / c.gpus_per_server;
  if (sku === 'hgx_b300') return servers * c.srv_hgx_b300;
  if (sku === 'hgx_rubin_nvl8') return servers * c.rack_vr_nvl72 / 72 * c.gpus_per_server;
  if (sku === 'mi355x') return servers * c.srv_mi355x_retail * c.retail_to_odm;
  throw new Error(sku);
}
export function capex(layout, product, sku, cooling, riseK = 0, tMaxC = 35, c = C) {
  const sk = PRODUCTS[product].skus[sku], n = layout.n_pods, itMW = layout.it_mw;
  const it = { compute: n * itUnitPrice(product, sku, c) }; it.network = it.compute * c.network_frac;
  const f = { container: n * c.container, cdu: n * sk.cdus * c.cdu, inrow: n * sk.inrow_coolers * c.inrow_cooler };
  if (product === 'dsx_pod') {
    f.dry_cooler = n * c.dry_modules_per_pod * c.dry_module_kw * c.dry_cooler_per_kw;
    let chillerKW = 0;
    if (cooling === 'dry_plus_chiller') {
      const reachable = tMaxC + riseK + c.trim_approach_k;
      const frac = Math.min(1, Math.max(0, (c.trim_fws_supply_c + c.trim_delta_t_k - reachable) / c.trim_delta_t_k));
      chillerKW = (1 - frac) * itMW * 1000 * LIQ * c.chiller_margin;
    }
    f.chiller = chillerKW * c.chiller_per_kw;
  } else {
    f.dry_cooler = 0;
    f.chiller = n * sk.it_mw * 1000 * c.gadu_chiller_design * c.chiller_margin * c.chiller_per_kw;
  }
  f.power_center = itMW * c.power_center_per_mw;
  f.substation = itMW * c.substation_per_mw;
  const [sx, sy] = layout.site_m, area = sx * sy;
  const pads = layout.blocks.reduce((s, b) => s + (b.length + 5) * (b.width + 5), 0);
  f.site_works = pads * c.pad_thick_m * c.concrete_m3 * (1 + c.rebar_frac) + area * c.gravel_thick_m * c.gravel_t_m3 * c.gravel_t
    + area * c.paved_frac * c.asphalt_thick_m * c.asphalt_t_m3 * c.asphalt_t + 2 * (sx + sy) * c.fence_m;
  f.buildings = layout.n_blocks * c.building;
  const items = { ...it, ...f }, sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  const tIt = sum(it), tF = sum(f);
  return { items, it: tIt, facility: tF, total: tIt + tF };
}
"""


def write_js(path=ROOT / "web" / "js" / "capex.js"):
    meta = {k: dict(unit=v[1], label=v[2], source=v[3], confidence=v[4]) for k, v in COEF.items()}
    js = ("// 由 dsxpod/capex.py 產生，不要手改：.venv\\Scripts\\python.exe -m dsxpod.capex\n"
          "// 造價：機櫃 + 地上物的設備與材料（不含土地、施工人力）；係數同時寫進 USD（/World/Plant cost:coef:*）。\n"
          "import { PRODUCTS } from './products.js';\n"
          "export const C = " + json.dumps(C, indent=1) + ";\n"
          "export const COEF_META = " + json.dumps(meta, ensure_ascii=False, indent=1) + ";\n"
          + JS_FN % dict(liq=json.dumps(DLC_LIQUID_FRACTION)))
    path.write_text(js, encoding="utf-8")
    return path


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    print(write_js())
    from . import sizing
    for prod, sku in [("dsx_pod", "vera_rubin_nvl72"), ("gadu", "vera_rubin_nvl72"), ("gadu", "hgx_rubin_nvl8"), ("gadu", "gb300_nvl72"), ("gadu", "hgx_b300"), ("gadu", "mi355x")]:
        lay = sizing.plan(mw=10, product=prod, sku=sku); sk = PRODUCTS[prod]["skus"][sku]
        r = capex(lay, prod, sku, "dry_plus_chiller" if prod == "dsx_pod" else "chilled_water", rise_k=2.0, t_max_c=42.9)
        ef = lay["n_pods"] * sk["pf_inf_total"] / 1000
        print(f"{prod:8} {sku:17} {lay['n_pods']:3} 單元 {lay['it_mw']:6.1f} MW {ef:7.0f} EF  總 ${r['total']/1e6:8.1f}M  IT {r['it']/r['total']*100:4.1f}%  設施 ${r['facility']/1e6:5.1f}M (${r['facility']/1e6/lay['it_mw']:.2f}M/MW)  每 EF ${r['total']/1e6/ef:.2f}M")
