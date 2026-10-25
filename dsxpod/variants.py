"""模型參數（Params）、使用者旋鈕的預設表、以及「參數 ↔ USD 屬性」契約（USD_CONTRACT）。

步驟 6（2026-10-25）收斂後，使用者只有四個旋鈕：場址、POD 數、散熱策略、供水溫度。步驟 8 起單位是 NVIDIA DSX POD 貨櫃（7 櫃）。
  cooling:     dry_only | dry_plus_chiller | evaporative      （USD VariantSet "cooling"）
  supply_temp: t45 | t32 | t20                                 （USD VariantSet "supply_temp"；20 °C 只當內部對照）
退役：canopy、ceiling_height、rack_layout、屋頂 / 遠端放置（都已證明對 PUE ≤ 0.7 ‰ 或改由幾何決定）。

SSOT 規則：Params 的預設值只是「後備」；真相在 Stage。USD_CONTRACT 列出每個係數住在哪個 prim 的哪個屬性，
usd_out.build() 用它把預設值寫進 USD，stage_io.stage_to_params() 用它讀回來，兩邊共用同一張表，
報告的 energy:param_sources 會逐條列「← prim 屬性」；只有 USD 沒有的才會出現「後備」。
"""
from dataclasses import dataclass, field, asdict

RACK_KW_NAMEPLATE = 136.0        # NVIDIA GB300 NVL72（DSX 內容包 aif:spec:maxPowerDcTdp）
RACK_KW_LIQUID = 116.0           # 液冷份額（aif:spec:liquidCooling）
RACK_KW_AIR = 19.3               # 氣冷份額（aif:spec:airCooling）
LIQUID_FRACTION = RACK_KW_LIQUID / RACK_KW_NAMEPLATE   # 0.853
AIR_FRACTION = RACK_KW_AIR / RACK_KW_NAMEPLATE         # 0.142（剩餘 0.5% 當配電內損）
RACKS_PER_POD = 7                                      # NVIDIA DSX POD：每個貨櫃 7 架 Vera Rubin NVL72
RACKS_PER_DU = RACKS_PER_POD                           # 舊名相容


@dataclass
class Params:
    # ---- IT ----
    racks: int = RACKS_PER_POD
    it_utilization: float = 0.90           # 平均負載率（AI 訓練叢集高且平）
    # ---- 液冷迴路（DSX：45 °C 溫水，水 75% / 丙二醇 25%）----
    tcs_supply_c: float = 45.0             # 技術冷卻系統供水（機櫃入口）
    tcs_delta_t_k: float = 10.0            # 機櫃進出水溫差（有 GB300 流量曲線時改由 q/ṁcp 算）
    cdu_approach_k: float = 3.0            # CDU 板換接近溫差 → FWS 供水 = 42 °C
    cdu_pump_frac: float = 0.012           # 後備：CDU 泵電 / 液冷熱（有 GB300 曲線時不用）
    fws_pump_frac: float = 0.010           # 設施側泵電 / 液冷熱
    dry_cooler_approach_k: float = 5.0     # 乾冷卻器接近溫差（冷端：需求 FWS 供水 − 進風）
    dry_cooler_fan_frac_design: float = 0.035   # 設計點風扇電 / 排熱（Vertiv 規格推得時覆寫）
    dry_cooler_fan_floor: float = 0.15     # 風扇電最低 = 設計值的 15%
    recirculation_k: float = 0.0           # 進風溫升（由幾何：進風到最近熱排風的距離）
    # ---- 輔助冰水機 / 蒸發式 ----
    has_chiller: bool = False
    chiller_cop_25c: float = 6.0
    chiller_cop_45c: float = 3.0
    evaporative: bool = False
    evap_approach_k: float = 4.0           # 蒸發式：需求 FWS 供水 − 濕球
    evap_switch_c: float = 30.0            # 外氣乾球高於此才噴水
    evap_water_l_per_kwh: float = 1.8      # 蒸發 + 排放補水
    # ---- 氣冷側（19.3 kW/櫃）----
    air_supply_c: float = 27.0
    air_fan_frac_full: float = 0.06
    air_economizer_full_c: float = 18.0
    air_economizer_off_c: float = 27.0
    air_dx_cop_25c: float = 4.5
    air_dx_cop_45c: float = 2.5
    # ---- 外殼（DSX POD 貨櫃殼，ISO 40 ft 高櫃）----
    pod_length_m: float = 12.192           # 由 POD_01/Shell 包圍盒覆寫
    pod_width_m: float = 2.438
    ceiling_m: float = 2.896
    envelope_count: int = 1                # 貨櫃殼數量（外殼熱 × 這個數）
    roof_u_w_m2k: float = 1.5              # 貨櫃鋼殼 + 50 mm 保溫（假設；DSX POD 未公開）
    roof_absorptivity: float = 0.4         # 白色塗裝
    wall_u_w_m2k: float = 1.5
    h_outside_w_m2k: float = 17.0
    indoor_c: float = 30.0
    wall_absorptivity: float = 0.4         # 貨櫃塗裝吸收率（白漆 0.3–0.4、深色 0.9）
    vertical_solar_fraction: float = 0.35  # 四面牆平均垂直面日照 / 水平 GHI（白天平均；篩選假設）
    roof_shaded: bool = False              # 散熱模組疊在上面 → 屋頂在陰影裡
    # ---- 園區熱島（整區排熱把進風加熱；邊界層箱型模型，篩選等級）----
    site_heat_mw: float = None             # 整區排熱（≈ 整區 IT MW）；None = 用本 Stage 的 IT
    site_width_m: float = None             # 垂直風向的基地寬度（取 √面積）；None = 用外殼長度
    mixing_height_m: float = 50.0          # 近地混合層高度（進風高度相關的那一層；假設）
    island_factor: float = 0.5             # 基地內平均 = 出口溫升 × 0.5
    island_max_k: float = 5.0              # 上限：微風時熱羽流上升、白天混合層遠大於 50 m，箱型模型會高估（篩選假設）
    # ---- 冰水機路線（GADU：列間 CDU / 冷卻器 + 氣冷冰水機；cooling_mode = "chilled_water"）----
    cooling_mode: str = "warm_water_dry"   # warm_water_dry（DSX POD）| chilled_water（GADU）← Plant aif:spec:coolingMode
    chws_supply_c: float = 25.0            # 冰水供水溫度（DLC SKU 25、氣冷 SKU 15）← Chiller aif:spec:chilledWaterSupplyC
    chiller_carnot_eff: float = 0.45       # COP = η × T_evap / (T_cond − T_evap)（氣冷螺旋 / 渦卷機組量級）
    condenser_approach_k: float = 10.0     # 冷凝溫度 − 外氣乾球
    evaporator_approach_k: float = 3.0     # 冰水供水 − 蒸發溫度
    chiller_capacity_margin: float = 1.2   # 額定（rating_ambient 時）容量 / 設計排熱
    chiller_rating_ambient_c: float = 35.0
    chiller_derate_per_k: float = 0.02     # 外氣每高 1 K 容量少 2%
    chw_pump_frac: float = 0.012           # 冰水一次 / 二次泵電 / 總排熱
    inrow_fan_frac: float = 0.03           # 列間冷卻器風扇電 / 氣側排熱
    product: str = "dsx_pod"
    sku: str = "vera_rubin_nvl72"
    # ---- 配電與雜項 ----
    ups_loss_frac: float = 0.03            # UPS 效率 + 配電損失（由 UPS aif:spec:doubleConversionEfficiency + distributionLossFraction 算）
    misc_frac: float = 0.01
    # ---- GB300 官方層給的曲線 ----
    rack_flow_curve: list = None
    rack_pq_kpa_coeffs: tuple = None
    tcs_loop_extra_kpa: float = 100.0
    pump_efficiency: float = 0.6
    pump_motor_vfd_eff: float = 0.9
    # ---- 從 USD 讀進來時的覆寫 ----
    rack_kw_override: float = None
    liquid_fraction_override: float = None
    site_key: str = None
    site_lat: float = None
    site_lon: float = None
    # ---- 標籤 ----
    cooling: str = "dry_only"
    n_pods: int = 1
    notes: list = field(default_factory=list)

    # ---- GB300 曲線 → 流量、壓降、泵電、ΔT ----
    def rack_flow_lpm(self, t_c=None):
        if not self.rack_flow_curve: return None
        t = self.tcs_supply_c if t_c is None else t_c
        pts = self.rack_flow_curve
        if t <= pts[0][0]: return pts[0][1]
        if t >= pts[-1][0]: return pts[-1][1]
        for (t0, f0), (t1, f1) in zip(pts, pts[1:]):
            if t0 <= t <= t1: return f0 + (f1 - f0) * (t - t0) / (t1 - t0)
        return pts[-1][1]

    def rack_dp_kpa(self):
        if not (self.rack_flow_curve and self.rack_pq_kpa_coeffs): return None
        a, b = self.rack_pq_kpa_coeffs; q = self.rack_flow_lpm()
        return a * q * q + b * q

    def tcs_pump_kw(self):
        dp = self.rack_dp_kpa()
        if dp is None: return None
        q_m3s = self.rack_flow_lpm() * self.racks / 60000.0
        return q_m3s * (dp + self.tcs_loop_extra_kpa) / self.pump_efficiency / self.pump_motor_vfd_eff

    def tcs_delta_t(self):
        q = self.rack_flow_lpm()
        if not q: return self.tcs_delta_t_k
        return self.rack_kw() * self.liquid_fraction() / ((q / 60.0) * 4.18)

    def island_dt(self, wind_ms):
        """整區排熱造成的進風溫升 K：ΔT = f · Q / (ρ·cp·u·h·W)。"""
        q_mw = self.site_heat_mw if self.site_heat_mw else self.it_kw() / 1000.0
        w = self.site_width_m if self.site_width_m else max(self.pod_length_m, 10.0)
        return min(self.island_max_k, self.island_factor * q_mw * 1e6 / (1.2 * 1005.0 * max(wind_ms, 1.0) * self.mixing_height_m * w))

    def roof_area_m2(self): return self.pod_length_m * self.pod_width_m * self.envelope_count
    def wall_area_m2(self): return 2 * (self.pod_length_m + self.pod_width_m) * self.ceiling_m * self.envelope_count
    def rack_kw(self): return self.rack_kw_override if self.rack_kw_override else RACK_KW_NAMEPLATE
    def liquid_fraction(self): return self.liquid_fraction_override if self.liquid_fraction_override is not None else LIQUID_FRACTION
    def air_fraction(self): return (1.0 - self.liquid_fraction() - 0.005) if self.liquid_fraction_override is not None else AIR_FRACTION   # 0（全氣冷）也是有效值
    def it_kw(self): return self.racks * self.rack_kw() * self.it_utilization
    def to_dict(self): return asdict(self)


# ---- 使用者旋鈕 ----
COOLING = {
    "dry_only":         dict(has_chiller=False, evaporative=False, label="純乾冷卻器",
                             doc="45 °C warm-water loop rejected by rooftop dry coolers only; hours the dry coolers cannot cover are counted as unmet (IT must derate)"),
    "dry_plus_chiller": dict(has_chiller=True,  evaporative=False, label="乾冷卻器＋輔助冰水機",
                             doc="dry coolers first, air-cooled trim chiller covers the deficit"),
    "evaporative":      dict(has_chiller=False, evaporative=True,  label="蒸發式（絕熱）",
                             doc="adiabatic pre-cooling when ambient > 30 C; heat rejection follows wet bulb; consumes water"),
    "chilled_water":    dict(has_chiller=True,  evaporative=False, label="列間冷卻＋氣冷冰水機",
                             doc="GADU: in-row CDUs / in-row coolers on a chilled-water loop; all heat rejected by packaged air-cooled chillers (no dry coolers)"),
}
SUPPLY_TEMP = {"t45": 45.0, "t32": 32.0, "t20": 20.0, "t28": 28.0}      # t20 只當內部對照；t28 = GADU（冰水 25 °C + CDU 接近 3 K）
SUPPLY_LABEL = {"t45": "45 °C（DSX 溫水）", "t32": "32 °C（ASHRAE W32）", "t20": "20 °C（傳統冰水，對照）", "t28": "28 °C（GADU：冰水 25 °C 經 CDU）"}
# 每種產品可用的散熱 / 供水選項（前端旋鈕、精簡 Kit 檢查、預算表都照這裡）
COOLING_BY_PRODUCT = {"dsx_pod": ["dry_only", "dry_plus_chiller", "evaporative"], "gadu": ["chilled_water"]}
SUPPLY_BY_PRODUCT = {"dsx_pod": ["t45", "t32"], "gadu": ["t28"]}


def coerce_knobs(product, cooling, supply):
    """產品不支援的散熱 / 供水選項換成該產品的預設（GADU 只有 chilled_water / t28）。"""
    if cooling not in COOLING_BY_PRODUCT.get(product, []): cooling = COOLING_BY_PRODUCT[product][0]
    if supply not in SUPPLY_BY_PRODUCT.get(product, []) and not (product == "dsx_pod" and supply == "t20"): supply = SUPPLY_BY_PRODUCT[product][0]
    return cooling, supply


def make_params(cooling="dry_only", supply_c=45.0, **overrides) -> Params:
    p = Params()
    cfg = dict(COOLING[cooling]); cfg.pop("label", None); cfg.pop("doc", None)
    for k, v in cfg.items(): setattr(p, k, v)
    p.cooling, p.tcs_supply_c = cooling, float(supply_c)
    for k, v in overrides.items():
        if not hasattr(p, k): raise KeyError(k)
        setattr(p, k, v)
    p.notes = [f"散熱策略 {cooling}：{COOLING[cooling]['label']}"]
    return p


# ---- 參數 ↔ USD 屬性契約（prim 路徑相對於 POD；數值型都用 float）----
# usd_out.build() 依此表把 Params 預設值寫進 USD；stage_io.stage_to_params() 依此表讀回。
# 不在表上的參數：racks（prim 數）、rack 功率 / 份額 / 曲線（GB300 層）、cdu_pump_frac 與 dry_cooler_fan_frac_design（Vertiv 規格推得）、
# recirculation_k（幾何）、has_chiller（Chiller active）、evaporative（coolingTypeOverride）、外殼尺寸（包圍盒）、ups_loss_frac（UPS 效率 + 配電損失）。
# 只適用某些產品的契約參數（其他產品讀不到時不算後備）
CONTRACT_PRODUCTS = {
    "dry_cooler_approach_k": {"dsx_pod"}, "dry_cooler_fan_floor": {"dsx_pod"}, "evap_approach_k": {"dsx_pod"}, "evap_switch_c": {"dsx_pod"},
    "evap_water_l_per_kwh": {"dsx_pod"}, "chiller_cop_25c": {"dsx_pod"}, "chiller_cop_45c": {"dsx_pod"},
    "air_fan_frac_full": {"dsx_pod"}, "air_economizer_full_c": {"dsx_pod"}, "air_economizer_off_c": {"dsx_pod"}, "air_dx_cop_25c": {"dsx_pod"}, "air_dx_cop_45c": {"dsx_pod"}, "air_supply_c": {"dsx_pod"},
    "chws_supply_c": {"gadu"}, "chiller_carnot_eff": {"gadu"}, "condenser_approach_k": {"gadu"}, "evaporator_approach_k": {"gadu"},
    "chiller_capacity_margin": {"gadu"}, "chiller_rating_ambient_c": {"gadu"}, "chiller_derate_per_k": {"gadu"}, "chw_pump_frac": {"gadu"}, "inrow_fan_frac": {"gadu"},
}
USD_CONTRACT = [
    # param,                   prim（相對 POD）,      attr,                                      doc
    ("it_utilization",          ".",                   "aif:spec:itUtilization",                  "mean IT utilisation (0-1)"),
    ("tcs_supply_c",            ".",                   "aif:spec:referenceFacilityCoolantTemperature", "TCS supply water temperature (C); set by supply_temp variant"),
    ("fws_pump_frac",           ".",                   "thermal:fwsPumpFraction",                 "facility water loop pump power / liquid heat"),
    ("air_supply_c",            ".",                   "thermal:airSupplyC",                      "air-side supply temperature (C)"),
    ("air_fan_frac_full",       ".",                   "thermal:airFanFractionFull",              "air-side fan power / air heat at full airflow"),
    ("air_economizer_full_c",   ".",                   "thermal:airEconomizerFullC",              "ambient below which air side is 100% economizer (C)"),
    ("air_economizer_off_c",    ".",                   "thermal:airEconomizerOffC",               "ambient above which air side is 100% mechanical (C)"),
    ("air_dx_cop_25c",          ".",                   "thermal:airDxCop25C",                     "air-side DX COP at 25 C ambient"),
    ("air_dx_cop_45c",          ".",                   "thermal:airDxCop45C",                     "air-side DX COP at 45 C ambient"),
    ("indoor_c",                ".",                   "thermal:indoorC",                         "hall air reference temperature (C); DSX CFD p50 = 30"),
    ("vertical_solar_fraction", ".",                   "thermal:verticalSolarFraction",           "mean vertical-wall irradiance / horizontal GHI (screening assumption)"),
    ("mixing_height_m",         ".",                   "thermal:mixingHeightM",                   "near-surface mixing height for the site heat-island box model (m)"),
    ("island_factor",           ".",                   "thermal:islandFactor",                    "site-average / exit temperature rise in the heat-island box model"),
    ("island_max_k",            ".",                   "thermal:islandMaxK",                      "cap on the site heat-island temperature rise (K)"),
    ("misc_frac",               ".",                   "thermal:miscFraction",                    "lighting / controls / security as fraction of IT"),
    ("cdu_approach_k",          "POD_01/Equipment/CDU_01",      "thermal:approachK",                       "CDU plate HX approach (K)"),
    ("tcs_loop_extra_kpa",      "POD_01/Equipment/CDU_01",      "thermal:loopExtraKpa",                    "TCS loop pressure drop outside the rack (kPa)"),
    ("pump_efficiency",         "POD_01/Equipment/CDU_01",      "thermal:pumpEfficiency",                  "pump hydraulic efficiency"),
    ("pump_motor_vfd_eff",      "POD_01/Equipment/CDU_01",      "thermal:motorVfdEfficiency",              "pump motor + VFD efficiency"),
    ("dry_cooler_approach_k",   "@DryCooler_01","thermal:approachK",                       "dry cooler approach: leaving fluid - entering air (K)"),
    ("dry_cooler_fan_floor",    "@DryCooler_01","thermal:fanFloorFraction",                "minimum fan power as fraction of design"),
    ("evap_approach_k",         "@DryCooler_01","thermal:evapApproachK",                   "adiabatic mode approach to wet bulb (K)"),
    ("evap_switch_c",           "@DryCooler_01","thermal:evapSwitchC",                     "ambient above which adiabatic spray runs (C)"),
    ("evap_water_l_per_kwh",    "@DryCooler_01","thermal:evapWaterLPerKwh",                "make-up water per kWh rejected in adiabatic mode"),
    ("chiller_cop_25c",         "Utility/Chiller_01",  "aif:spec:copAt25C",                       "trim chiller COP at 25 C ambient"),
    ("chiller_cop_45c",         "Utility/Chiller_01",  "aif:spec:copAt45C",                       "trim chiller COP at 45 C ambient"),
    ("h_outside_w_m2k",         "POD_01/Shell",            "thermal:hOutsideWm2K",                    "outside surface film coefficient for sol-air (W/m2K)"),
    # GADU（冰水機路線）
    ("chws_supply_c",           "POD_01/Chillers/Chiller_01", "aif:spec:chilledWaterSupplyC",         "chilled water supply temperature (C)"),
    ("chiller_carnot_eff",      "POD_01/Chillers/Chiller_01", "thermal:carnotEfficiency",             "COP = eff x T_evap / (T_cond - T_evap)"),
    ("condenser_approach_k",    "POD_01/Chillers/Chiller_01", "thermal:condenserApproachK",           "condensing temperature - ambient dry bulb (K)"),
    ("evaporator_approach_k",   "POD_01/Chillers/Chiller_01", "thermal:evaporatorApproachK",          "chilled water supply - evaporating temperature (K)"),
    ("chiller_capacity_margin", "POD_01/Chillers/Chiller_01", "thermal:capacityMargin",               "rated capacity at rating ambient / design heat"),
    ("chiller_rating_ambient_c","POD_01/Chillers/Chiller_01", "thermal:ratingAmbientC",               "ambient at which rated capacity applies (C)"),
    ("chiller_derate_per_k",    "POD_01/Chillers/Chiller_01", "thermal:derateFractionPerK",           "capacity loss per K above rating ambient"),
    ("chw_pump_frac",           ".",                          "thermal:chwPumpFraction",              "chilled water pump power / total heat"),
    ("inrow_fan_frac",          "@InRowCooler_01",            "thermal:fanFractionOfAirHeat",         "in-row cooler fan power / air-side heat"),
    ("roof_u_w_m2k",            "POD_01/Shell/Geometry/Roof",       "thermal:uValueWm2K",                      "roof U value (W/m2K)"),
    ("roof_absorptivity",       "POD_01/Shell/Geometry/Roof",       "thermal:solarAbsorptivity",               "roof solar absorptivity"),
    ("wall_absorptivity",       "POD_01/Shell/Geometry/Wall_N",     "thermal:solarAbsorptivity",               "wall solar absorptivity (coating)"),
    ("wall_u_w_m2k",            "POD_01/Shell/Geometry/Wall_N",     "thermal:uValueWm2K",                      "wall U value (W/m2K), same on all four walls"),
]
