"""USD 是真相來源：從 Stage 讀出能耗模型要的參數（stage_to_params），以及把結果寫回 Stage（write_results）。

讀取順序：
  1. 變體選擇（site / cooling / supply_temp）→ make_params 給策略旗標與後備值
  2. 機櫃：數量 = POD 底下所有 Rack_* prim；功率、份額、流量 / 壓降曲線 ← GB300 官方層
  3. variants.USD_CONTRACT 上的係數 ← 各 prim 的 thermal:* / aif:spec:*（沒有才留後備，並記「後備」）
  4. 推得的：CDU 泵比例與乾冷卻器風扇比例 ← Vertiv 規格；再循環 ← 幾何（layout.analyze）；UPS 損失 ← 效率；外殼 ← 包圍盒
每一條來源都記進 Params.notes，報告寫成 energy:param_sources。
"""
import re
from pxr import Usd, UsdGeom, Sdf, Gf
from .variants import Params, make_params, USD_CONTRACT, SUPPLY_TEMP

PLANT_PATH = "/World/Plant"            # 步驟 8：廠區 assembly（VariantSets、契約屬性），底下 POD_01..n 是貨櫃
POD_PATH = PLANT_PATH                  # 舊名相容
SITE_PATH = "/World/Site"
RESULTS_PATH = "/World/Results"


def _attr(prim, name, default=None):
    a = prim.GetAttribute(name) if prim and prim.IsValid() else None
    v = a.Get() if a and a.HasAuthoredValue() else None
    return default if v in (None, "") else v


def _sum_attr(prims, name):
    vals = [_attr(p, name) for p in prims]
    vals = [float(v) for v in vals if v is not None]
    return (sum(vals), len(vals)) if vals else (None, 0)


VISUAL_VARIANT_SETS = {"geometry"}


def current_variants(stage, pod_path=POD_PATH):
    """POD 的 VariantSet 選擇 + 場址（/World/Site 的 site 變體）。"""
    out = {}
    pod = stage.GetPrimAtPath(pod_path); vs = pod.GetVariantSets()
    for n in vs.GetNames():
        if n in VISUAL_VARIANT_SETS: continue                # 只影響顯示（真實幾何 / 方塊），不進結果命名與模型
        out[n] = vs.GetVariantSet(n).GetVariantSelection()
    site = stage.GetPrimAtPath(SITE_PATH)
    if site and site.IsValid() and site.GetVariantSets().HasVariantSet("site"):
        out["site"] = site.GetVariantSets().GetVariantSet("site").GetVariantSelection()
    return out


def set_variants(stage, session=True, **sel):
    """切變體（預設寫 session layer，不弄髒設計檔）。鍵：site / cooling / supply_temp。"""
    if session: stage.SetEditTarget(Usd.EditTarget(stage.GetSessionLayer()))
    pod = stage.GetPrimAtPath(POD_PATH); site = stage.GetPrimAtPath(SITE_PATH)
    for k, v in sel.items():
        if v is None: continue
        if k == "site": site.GetVariantSets().GetVariantSet("site").SetVariantSelection(v)
        else: pod.GetVariantSets().GetVariantSet(k).SetVariantSelection(v)


EQUIP_PARENTS = ("Racks", "Cooling", "Equipment", "CoolerModule", "CoolerYard", "Utility", "PowerSkid", "Chillers")


def _children_named(stage, root_path, prefix):
    root = stage.GetPrimAtPath(root_path)
    return [p for p in Usd.PrimRange(root) if p.GetName().startswith(prefix) and p.GetParent().GetName() in EQUIP_PARENTS] if root and root.IsValid() else []


def contract_prim(stage, plant_path, prim_rel):
    """USD_CONTRACT 的 prim 路徑："." = 廠區；"@名稱" = 廠區底下第一個叫這個名字的設備；其他 = 相對路徑。"""
    if prim_rel == ".": return stage.GetPrimAtPath(plant_path)
    if prim_rel.startswith("@"):
        hits = _children_named(stage, plant_path, prim_rel[1:])
        return hits[0] if hits else Usd.Prim()
    return stage.GetPrimAtPath(f"{plant_path}/{prim_rel}")


def stage_to_params(stage, pod_path=POD_PATH) -> Params:
    pod = stage.GetPrimAtPath(pod_path)
    if not pod.IsValid(): raise ValueError(f"{pod_path} 不存在")
    sel = current_variants(stage, pod_path)
    supply_c = float(_attr(pod, "aif:spec:referenceFacilityCoolantTemperature", SUPPLY_TEMP.get(sel.get("supply_temp", "t45"), 45.0)))
    p = make_params(sel.get("cooling", "dry_only"), supply_c)
    p.n_pods = int(_attr(pod, "aif:spec:podCount", _attr(pod, "aif:spec:duCount", 1)))
    src = p.notes
    # ---- 產品 / SKU / 冷卻路線 ----
    p.product = str(_attr(pod, "aif:core:product", "dsx_pod")); p.sku = str(_attr(pod, "aif:spec:sku", p.sku))
    p.cooling_mode = str(_attr(pod, "aif:spec:coolingMode", "warm_water_dry"))
    src.append(f"product={p.product} sku={p.sku} cooling_mode={p.cooling_mode} ← Plant aif:core:product / aif:spec:sku / aif:spec:coolingMode")

    # ---- 機櫃 ----
    racks = _children_named(stage, pod_path, "Rack_")
    if racks:
        p.racks = len(racks); src.append(f"racks={len(racks)} ← 廠區底下 Rack_* prim 數（{p.n_pods} 個 POD）")
        total_kw, n = _sum_attr(racks, "aif:spec:maxPowerDcTdp"); src_name = "aif:spec:maxPowerDcTdp"
        if not n: total_kw, n = _sum_attr(racks, "aif:spec:powerRating"); src_name = "aif:spec:powerRating"
        if n:
            per = total_kw / n; p.rack_kw_override = per
            liq, nl = _sum_attr(racks, "aif:spec:liquidCooling"); air, na = _sum_attr(racks, "aif:spec:airCooling")
            src.append(f"機櫃功率 {per:.1f} kW/櫃 ← {src_name}（{n} 櫃有值）")
            if nl and na:
                p.liquid_fraction_override = (liq / nl) / per
                src.append(f"液冷份額 {p.liquid_fraction_override:.3f} ← aif:spec:liquidCooling / airCooling")
            fc = _attr(racks[0], "aif:spec:requiredLiquidFlowRate"); pq = _attr(racks[0], "aif:spec:liquidSidePqCurve")
            if fc is not None and len(fc):
                p.rack_flow_curve = sorted((float(v[0]), float(v[2])) for v in fc)
                src.append(f"機櫃流量曲線 {len(fc)} 點（{p.rack_flow_curve[0][0]:g} °C {p.rack_flow_curve[0][1]:g} LPM → {p.rack_flow_curve[-1][0]:g} °C {p.rack_flow_curve[-1][1]:g} LPM）← aif:spec:requiredLiquidFlowRate")
            if pq:
                m = re.search(r"([0-9.]+)\s*x2\s*\+\s*([0-9.]+)\s*x", str(pq))
                if m:
                    p.rack_pq_kpa_coeffs = (float(m.group(1)), float(m.group(2)))
                    src.append(f"機櫃壓降 Δp = {m.group(1)}·LPM² + {m.group(2)}·LPM kPa ← aif:spec:liquidSidePqCurve")
        else:
            src.append("機櫃功率 ← 後備 136 kW（機櫃沒有 aif:spec:maxPowerDcTdp）")
    else:
        src.append(f"racks ← 後備 {p.racks}（POD 底下沒有 Rack_* prim）")

    # ---- 契約上的係數 ----
    from .variants import CONTRACT_PRODUCTS
    for param, prim_rel, name, doc in USD_CONTRACT:
        if param in CONTRACT_PRODUCTS and p.product not in CONTRACT_PRODUCTS[param]: continue   # 別的產品的係數
        prim = contract_prim(stage, pod_path, prim_rel)
        v = _attr(prim, name)
        if v is not None:
            setattr(p, param, float(v)); src.append(f"{param}={float(v):g} ← {prim_rel.lstrip('@') if prim_rel != '.' else 'Plant'} {name}")
        else:
            src.append(f"{param} ← 後備 {getattr(p, param)}（{prim_rel} 沒有 {name}）")

    # ---- CDU：泵比例（後備用；有 GB300 曲線時用曲線）----
    cdus = _children_named(stage, pod_path, "CDU_")
    if cdus:
        cap = _attr(cdus[0], "aif:spec:nominalCoolingCapacity"); pw = _attr(cdus[0], "aif:spec:powerRating")
        if cap and pw and 0.005 <= float(pw) / float(cap) <= 0.05:
            p.cdu_pump_frac = float(pw) / float(cap) * 0.6
            src.append(f"cdu_pump_frac={p.cdu_pump_frac:.4f} ← CDU powerRating {float(pw):g} / nominalCoolingCapacity {float(cap):g} × 0.6（{len(cdus)} 台；有 GB300 曲線時不用此值）")
        elif cap and pw:
            src.append(f"cdu_pump_frac ← 後備 {p.cdu_pump_frac}（CDU powerRating/nominalCoolingCapacity = {float(pw)/float(cap):.3f} 不在 0.005–0.05，疑似填成冷卻容量）")

    # ---- 乾冷卻器：風扇比例 ← Vertiv 規格；蒸發式 ← coolingTypeOverride；再循環 ← 幾何 ----
    dcs = [d for d in _children_named(stage, pod_path, "DryCooler_") if d.IsActive()]
    if dcs:
        dc = dcs[0]
        cap_kw = _attr(dc, "aif:spec:maximumCoolingCapacity") or _attr(dc, "aif:spec:nominalCoolingCapacity")
        fan_kw = _attr(dc, "aif:spec:fanPowerKw")
        if fan_kw is None:
            fla = _attr(dc, "aif:spec:fullLoadAmpereOfCondenser"); volt = _attr(dc, "aif:spec:electricalNominalVoltage")
            if fla and volt:
                fan_kw = 3 ** 0.5 * float(volt) * float(fla) * 0.9 / 1000.0
                src.append(f"乾冷卻器風扇 {fan_kw:.1f} kW/台 ← √3 × {float(volt):g} V × {float(fla):g} A × 0.9（{len(dcs)} 台）")
        if fan_kw and cap_kw:
            p.dry_cooler_fan_frac_design = float(fan_kw) / float(cap_kw)
            src.append(f"dry_cooler_fan_frac_design={p.dry_cooler_fan_frac_design:.4f} ← 風扇 kW / 容量 {float(cap_kw):g} kW")
        else:
            src.append(f"dry_cooler_fan_frac_design ← 後備 {p.dry_cooler_fan_frac_design}")
        if str(_attr(dc, "aif:spec:coolingTypeOverride", "")).startswith("Evaporative"):
            p.evaporative = True; src.append("evaporative=True ← DryCooler aif:spec:coolingTypeOverride")
        else:
            p.evaporative = False
        geo = None
        try:
            from .layout import analyze
            rec = analyze(stage, pod_path)["recirculation"]
            ks = [(r["k"], r["distance_m"], r["source"]) for r in rec.values() if r.get("distance_m") is not None]
            if ks:
                p.recirculation_k = sum(k for k, _, _ in ks) / len(ks)
                worst = max(ks, key=lambda t: t[0])
                src.append(f"recirculation_k={p.recirculation_k:g} ← {len(ks)} 台乾冷卻器進風到最近熱排風距離的平均查表（最近 {min(d for _, d, _ in ks)} m，最熱 +{worst[0]:g} K，{Sdf.Path(worst[2]).name}）")
                geo = True
        except Exception as e:
            src.append(f"layout.analyze 失敗（{e}）")
        if not geo:
            p.recirculation_k = 2.0 if _attr(dc, "aif:spec:placement") == "rooftop" else 0.0
            src.append(f"recirculation_k={p.recirculation_k:g} ← 後備（placement 字串）")
    chillers = _children_named(stage, pod_path, "Chiller_")
    p.has_chiller = any(c.IsActive() for c in chillers)
    src.append(f"has_chiller={p.has_chiller} ← {'Chillers/Chiller_* active（' + str(len(chillers)) + ' 台）' if p.cooling_mode == 'chilled_water' else 'Utility/Chiller_01 active'}")

    # ---- UPS：損失 = (1 − 雙轉換效率) + 配電損失 ----
    upss = _children_named(stage, pod_path, "UPS_"); ups = upss[0] if upss else Usd.Prim()
    eff = _attr(ups, "aif:spec:doubleConversionEfficiency"); dist = _attr(pod, "thermal:distributionLossFraction")
    if eff is not None:
        p.ups_loss_frac = (1.0 - float(eff) / 100.0) + float(dist or 0.0)
        src.append(f"ups_loss_frac={p.ups_loss_frac:.4f} ← UPS aif:spec:doubleConversionEfficiency {float(eff):g}% + Plant thermal:distributionLossFraction {float(dist or 0):g}")
    else:
        src.append(f"ups_loss_frac ← 後備 {p.ups_loss_frac}")

    # ---- 外殼：包圍盒 ----
    shells = [q for q in Usd.PrimRange(pod) if q.GetName() == "Shell"]
    if shells:
        size = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_]).ComputeWorldBound(shells[0]).ComputeAlignedRange().GetSize()
        if size[0] > 0:
            p.pod_length_m, p.pod_width_m, p.ceiling_m = float(max(size[0], size[1])), float(min(size[0], size[1])), float(size[2])
            p.envelope_count = len(shells)
            src.append(f"外殼 {p.pod_length_m:.2f} × {p.pod_width_m:.2f} × {p.ceiling_m:.2f} m × {len(shells)} 個貨櫃殼 ← POD_xx/Shell 包圍盒")

    if p.rack_flow_curve and p.rack_pq_kpa_coeffs:
        src.append(f"tcs_pump_kw={p.tcs_pump_kw():.2f} kW ← {p.racks} 櫃 @ {p.tcs_supply_c:g} °C：{p.rack_flow_lpm():.0f} LPM/櫃，Δp {p.rack_dp_kpa():.0f} + 迴路 {p.tcs_loop_extra_kpa:g} kPa，η {p.pump_efficiency:g}×{p.pump_motor_vfd_eff:g}；ΔT {p.tcs_delta_t():.1f} K")

    # ---- 疊放 → 屋頂遮蔭；園區排熱與寬度（usd_out 依 sizing 佈局寫在 Plant 上）----
    p.roof_shaded = str(_attr(pod, "aif:spec:heatRejectionPlacement", "")) == "stacked"
    src.append(f"roof_shaded={p.roof_shaded} ← Plant aif:spec:heatRejectionPlacement")
    q = _attr(pod, "aif:spec:siteItMW"); w = _attr(pod, "layout:siteCrossWidthM")
    if q is not None and w is not None:
        p.site_heat_mw, p.site_width_m = float(q), float(w)
        src.append(f"園區熱島 Q={p.site_heat_mw:g} MW、W={p.site_width_m:g} m ← Plant aif:spec:siteItMW / layout:siteCrossWidthM（風速 3 m/s 時 +{p.island_dt(3.0):.2f} K）")
    else:
        src.append("園區熱島 ← 後備（Plant 沒有 aif:spec:siteItMW / layout:siteCrossWidthM）")

    # ---- 場址 ----
    site = stage.GetPrimAtPath(SITE_PATH)
    p.site_key = _attr(site, "aif:site:key", None); p.site_lat = _attr(site, "aif:site:latitude", None); p.site_lon = _attr(site, "aif:site:longitude", None)
    src.append(f"site={p.site_key} ← /World/Site 變體 site" if p.site_key else "site ← 後備（/World/Site 沒有 aif:site:key）")
    return p


def fallback_notes(p: Params):
    return [n for n in p.notes if "後備" in n]


def read_cost_coef(stage):
    """造價係數從 /World/Plant 的 cost:coef:* 讀回（usd_out.build 寫）。回傳 (dict, 缺少的鍵)；缺的用 capex.C 補。"""
    from .capex import C
    plant = stage.GetPrimAtPath(PLANT_PATH)
    got, missing = {}, []
    for k, v in C.items():
        a = plant.GetAttribute(f"cost:coef:{k}") if plant else None
        if a and a.HasValue(): got[k] = float(a.Get())
        else: got[k] = v; missing.append(k)
    return got, missing


def site_t_max(stage, default=35.0):
    a = stage.GetPrimAtPath("/World/Site").GetAttribute("aif:site:tMax20yC")
    return float(a.Get()) if a and a.HasValue() else default


def write_capex(stage, cx: dict, layer=None, basis=""):
    """造價結果寫到 /World/Results/Capex（cost:total_usd、cost:it_usd、cost:facility_usd、cost:item:*）。"""
    if layer is not None: stage.SetEditTarget(Usd.EditTarget(layer))
    UsdGeom.Scope.Define(stage, RESULTS_PATH)
    prim = stage.DefinePrim(f"{RESULTS_PATH}/Capex", "Scope")
    def setd(n, v): prim.CreateAttribute(n, Sdf.ValueTypeNames.Double, custom=True).Set(float(v))
    setd("cost:total_usd", cx["total"]); setd("cost:it_usd", cx["it"]); setd("cost:facility_usd", cx["facility"])
    for k, v in cx["items"].items(): setd(f"cost:item:{k}", v)
    if basis: prim.CreateAttribute("cost:basis", Sdf.ValueTypeNames.String, custom=True).Set(basis)
    return prim


def write_results(stage, site, variants: dict, annual_rows: list, hourly=None, layer=None, notes=None):
    """寫到 /World/Results/<site>/<variant 組合>。"""
    name = "__".join(f"{k}_{v}" for k, v in sorted(variants.items()) if k != "site").replace(".", "p").replace("-", "_")
    path = Sdf.Path(f"{RESULTS_PATH}/{site}/{name}")
    if layer is not None: stage.SetEditTarget(Usd.EditTarget(layer))
    UsdGeom.Scope.Define(stage, RESULTS_PATH); UsdGeom.Scope.Define(stage, f"{RESULTS_PATH}/{site}")
    prim = stage.DefinePrim(path, "Scope")
    for k, v in variants.items():
        prim.CreateAttribute(f"energy:variant:{k}", Sdf.ValueTypeNames.String, custom=True).Set(str(v))
    years = [r["year"] for r in annual_rows]; pues = [r["pue"] for r in annual_rows]
    def setf(n, v, t=Sdf.ValueTypeNames.Float): prim.CreateAttribute(f"energy:{n}", t, custom=True).Set(v)
    setf("years", f"{min(years)}-{max(years)}", Sdf.ValueTypeNames.String)
    setf("pue_mean", sum(pues) / len(pues)); setf("pue_min", min(pues)); setf("pue_max", max(pues))
    srt = sorted(pues); setf("pue_p50", srt[len(srt) // 2]); setf("pue_p90", srt[min(len(srt) - 1, int(0.9 * (len(srt) - 1)))])
    setf("unmet_hours_mean", sum(r["unmet_hours"] for r in annual_rows) / len(annual_rows))
    setf("unmet_hours_max", max(r["unmet_hours"] for r in annual_rows))
    setf("water_m3_mean", sum(r["water_m3"] for r in annual_rows) / len(annual_rows))
    setf("facility_mwh_mean", sum(r["facility_mwh"] for r in annual_rows) / len(annual_rows))
    setf("it_mwh_mean", sum(r["it_mwh"] for r in annual_rows) / len(annual_rows))
    setf("pue_valid", all(r["unmet_hours"] == 0 for r in annual_rows), Sdf.ValueTypeNames.Bool)
    setf("chiller_mwh_mean", sum(r["chiller_mwh"] for r in annual_rows) / len(annual_rows))
    setf("envelope_mwh_mean", sum(r["envelope_mwh"] for r in annual_rows) / len(annual_rows))
    setf("h_liq_free_mean", sum(r["h_liq_free"] for r in annual_rows) / len(annual_rows))
    setf("h_air_econ_mean", sum(r["h_air_econ"] for r in annual_rows) / len(annual_rows))
    if notes:
        prim.CreateAttribute("energy:param_sources", Sdf.ValueTypeNames.StringArray, custom=True).Set([str(n) for n in notes])
    e = prim.CreateAttribute("energy:enso_by_year", Sdf.ValueTypeNames.String, custom=True)
    for r in annual_rows: e.Set(str(r.get("enso", "")), Usd.TimeCode(float(r["year"])))
    a = prim.CreateAttribute("energy:pue_by_year", Sdf.ValueTypeNames.Float, custom=True)
    for r in annual_rows: a.Set(float(r["pue"]), Usd.TimeCode(float(r["year"])))
    if hourly:
        h = prim.CreateAttribute("energy:facility_kw_hourly", Sdf.ValueTypeNames.Float, custom=True)
        for i, row in enumerate(hourly): h.Set(float(row[3]), Usd.TimeCode(float(i)))
    return prim
