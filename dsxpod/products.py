"""產品與 SKU 的唯一來源（SSOT）：NVIDIA DSX POD 與技嘉 GADU。

- 單位（unit）= 一個 IT 貨櫃加上它的配套（DSX POD：疊放散熱模組 + 800 VDC 電力中心；GADU：power skid + 1–2 台氣冷冰水機）。
- 程式碼裡的 prim 名稱沿用 POD_nn（兩種產品都是），`aif:core:product` 與 `aif:spec:sku` 說明是哪一種。
- 這個檔案同時產生 web/js/products.js 給前端（sizing.js、scene.js、app.js 共用同一份數字）：
    .venv\\Scripts\\python.exe -m dsxpod.products
  tests/test_sizing_parity 會檢查 products.js 與這裡一致。

數字來源：
- DSX POD：NVIDIA 2026-10-21 發表（7 櫃 Vera Rubin NVL72、28,500 kg、約 1,000 萬零件）；每櫃 230 kW（Vera Rubin Max-P，與 GADU 一致）。
- GADU：技嘉官網 solutions/gadu 規格表（2026-10-26 抄錄，見 notes/reference-gadu.md；技嘉保留修改權）。
  NVL72 型號（Vera Rubin 230 kW、GB300 136 kW）運算櫃用公開每櫃功率，單元 IT 維持技嘉規格表（應是配置容量），差額歸網路 / 管理 / 儲存櫃；
  其他型號：每櫃功率 = (IT MW × 1000 − 網路 / 管理櫃 × 15 kW) / 運算櫃數（網路櫃 15 kW 是假設）。
  冷卻：列間 CDU（2 台，N+1）+ 列間冷卻器（6 台，N+1）+ 氣冷冰水機；DLC SKU 冰水 25 °C（TCS 28 °C），氣冷 SKU 冰水 15 °C。
- 算力（NVFP4 推論 PFLOPS / GPU）：Rubin 50（NVL72 3,600 / 72，effective）、GB300 15.3（1,100 / 72）、B300 18（HGX B300 144 / 8）、MI355X 20（AMD 公開值，稀疏）。
  各家口徑不同（effective / dense / sparse），只當量級對照。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NET_RACK_KW = 15.0                     # 網路 / 管理櫃功率（假設）
DLC_LIQUID_FRACTION = 0.85             # GB300 官方 116 / 136 = 0.853；其他 DLC SKU 比照

PRODUCTS = {
    "dsx_pod": dict(
        name="NVIDIA DSX POD", vendor="NVIDIA", short="DSX POD",
        url="https://www.nvidia.com/en-us/data-center/products/dsx/pod/",
        press_url="https://nvidianews.nvidia.com/news/nvidia-introduces-dsx-pod-ai-factories-to-accelerate-europes-infrastructure-deployment",
        cooling_mode="warm_water_dry",             # 45 °C 溫水 + 疊放乾冷卻器（可選輔助冰水機 / 蒸發式）
        power="800vdc_center", band_rgb=(0.46, 0.73, 0.00),
        pitch_extra_y_m=0.0,                       # 貨櫃北側不需要額外設備帶
        skus={
            "vera_rubin_nvl72": dict(name="Vera Rubin NVL72", gpus=504, cpus=252, racks_compute=7, racks_network=0, rack_u=48,
                                     it_mw=1.61, rack_kw=230.0, liquid=True, liquid_fraction=DLC_LIQUID_FRACTION,
                                     chillers=0, cdus=1, inrow_coolers=0, chws_c=None, tcs_supply_default="t45",
                                     pf_inf_per_gpu=50.0, note="每櫃 230 kW（Vera Rubin NVL72 Max-P；Max-Q 約 190 kW）"),
        }),
    "gadu": dict(
        name="GIGABYTE GADU", vendor="GIGABYTE", short="GADU",
        url="https://www.gigabyte.com/solutions/gadu", press_url=None,
        cooling_mode="chilled_water",              # 列間 CDU / 冷卻器 + 氣冷冰水機（固定，無乾冷卻器）
        power="ac_power_skid", band_rgb=(0.20, 0.42, 0.58),   # 藍灰色帶：只為了在畫面上區分產品，不是技嘉品牌色
        pitch_extra_y_m=3.4,                       # 北側冰水機帶：2.4 m 機身 + 1.0 m 間隔
        skus={
            "vera_rubin_nvl72": dict(name="NVIDIA Vera Rubin NVL72", gpus=288, cpus=144, racks_compute=4, racks_network=5, rack_u=48,
                                     it_mw=1.12, rack_kw=230.0, liquid=True, chillers=2, cdus=2, inrow_coolers=6, chws_c=25.0, tcs_supply_default="t28", pf_inf_per_gpu=50.0),
            "hgx_rubin_nvl8":   dict(name="NVIDIA HGX Rubin NVL8", gpus=288, cpus=72, racks_compute=4, racks_network=5, rack_u=48,
                                     it_mw=1.03, liquid=True, chillers=2, cdus=2, inrow_coolers=6, chws_c=25.0, tcs_supply_default="t28", pf_inf_per_gpu=50.0),
            "gb300_nvl72":      dict(name="NVIDIA GB300 NVL72", gpus=288, cpus=144, racks_compute=4, racks_network=5, rack_u=48,
                                     it_mw=0.70, rack_kw=136.0, liquid=True, chillers=2, cdus=2, inrow_coolers=6, chws_c=25.0, tcs_supply_default="t28", pf_inf_per_gpu=15.3),
            "hgx_b300":         dict(name="NVIDIA HGX B300", gpus=288, cpus=72, racks_compute=5, racks_network=2, rack_u=42,
                                     it_mw=0.56, liquid=False, chillers=1, cdus=2, inrow_coolers=6, chws_c=15.0, tcs_supply_default="t28", pf_inf_per_gpu=18.0),
            "mi355x":           dict(name="AMD Instinct MI355X", gpus=256, cpus=64, racks_compute=4, racks_network=3, rack_u=42,
                                     it_mw=0.57, liquid=True, chillers=1, cdus=2, inrow_coolers=6, chws_c=25.0, tcs_supply_default="t28", pf_inf_per_gpu=20.0),
        }),
}

# 官方規格頁（url）與整合商自家頁（vendor_url）：前端連結、USD aif:core:connectsToModelDocumentation。2026-10-26 確認可連。
SKU_URLS = {
    ('dsx_pod', 'vera_rubin_nvl72'): ('https://www.nvidia.com/en-us/data-center/vera-rubin-nvl72/', None),
    ('gadu', 'vera_rubin_nvl72'): ('https://www.nvidia.com/en-us/data-center/vera-rubin-nvl72/', 'https://www.gigabyte.com/Enterprise/GIGAPOD-Pod-Scale/AI-DLC-POD_NVIDIA-Vera-Rubin-NVL72'),
    ('gadu', 'hgx_rubin_nvl8'): ('https://www.nvidia.com/en-us/data-center/hgx/', None),
    ('gadu', 'gb300_nvl72'): ('https://www.nvidia.com/en-us/data-center/gb300-nvl72/', None),
    ('gadu', 'hgx_b300'): ('https://www.nvidia.com/en-us/data-center/hgx/', None),
    ('gadu', 'mi355x'): ('https://www.amd.com/en/products/accelerators/instinct/mi350/mi355x.html', None),
}

for _pk, _p in PRODUCTS.items():
    for _sk, _s in _p["skus"].items():
        _s["url"], _s["vendor_url"] = SKU_URLS[(_pk, _sk)]
        _s.setdefault("liquid_fraction", DLC_LIQUID_FRACTION if _s["liquid"] else 0.0)
        if "rack_kw" not in _s:
            _s["rack_kw"] = round((_s["it_mw"] * 1000.0 - _s["racks_network"] * NET_RACK_KW) / _s["racks_compute"], 1)
            _s["net_rack_kw"] = NET_RACK_KW if _s["racks_network"] else 0.0
        else:                                  # 運算櫃有公開每櫃功率：單元 IT 不變，差額歸網路 / 管理櫃
            _s["net_rack_kw"] = round((_s["it_mw"] * 1000.0 - _s["racks_compute"] * _s["rack_kw"]) / _s["racks_network"], 1) if _s["racks_network"] else 0.0
        _s["racks_total"] = _s["racks_compute"] + _s["racks_network"]
        _s["pf_inf_total"] = round(_s["gpus"] * _s["pf_inf_per_gpu"])


ROW_W = dict(rack=0.6, irc=0.3, cdu=1.2)          # 列寬：機櫃、列間冷卻器（in-row cooler）、CDU（Vertiv XDU2300）
ROW_X0, ROW_GAP = 0.35, 0.02


def gadu_row(sk):
    """GADU IT 貨櫃內一排（正面朝南）：CDU ｜ 運算櫃每 2 櫃夾一台列間冷卻器 ｜ 網路 / 管理櫃 ｜ CDU；回傳 [(kind, x, w), ...]。"""
    items = ["cdu"]
    irc_left = sk["inrow_coolers"]; k = 0
    for i in range(sk["racks_compute"]):
        items.append("rack"); k += 1
        if k == 2 and irc_left: items.append("irc"); irc_left -= 1; k = 0
    if irc_left: items.append("irc"); irc_left -= 1
    for i in range(sk["racks_network"]):
        items.append("net")
    while irc_left: items.append("irc"); irc_left -= 1
    items.append("cdu")
    out = []; x = ROW_X0
    for it in items:
        w = ROW_W["rack" if it == "net" else it]
        out.append((it, round(x, 3), w)); x += w + ROW_GAP
    return out


for _pk, _p in PRODUCTS.items():
    if _pk == "gadu":
        for _s in _p["skus"].values(): _s["row"] = gadu_row(_s)


def default_sku(product):
    return next(iter(PRODUCTS[product]["skus"]))


def spec(product="dsx_pod", sku=None):
    """回傳 (product dict, sku dict)；sku=None 取第一個。"""
    p = PRODUCTS[product]
    return p, p["skus"][sku or default_sku(product)]


def write_js(path=ROOT / "web" / "js" / "products.js"):
    """產生前端用的同一份資料（ES module）。"""
    data = {k: {kk: vv for kk, vv in v.items()} for k, v in PRODUCTS.items()}
    js = ("// 由 dsxpod/products.py 產生，不要手改：.venv\\Scripts\\python.exe -m dsxpod.products\n"
          "// 產品與 SKU 的唯一來源；sizing.js / scene.js / app.js 都從這裡讀。\n"
          "export const PRODUCTS = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n"
          "export const defaultSku = p => Object.keys(PRODUCTS[p].skus)[0];\n"
          "export const spec = (p = 'dsx_pod', s = null) => [PRODUCTS[p], PRODUCTS[p].skus[s || defaultSku(p)]];\n")
    path.write_text(js, encoding="utf-8")
    return path


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    out = write_js()
    for pk, p in PRODUCTS.items():
        for sk, s in p["skus"].items():
            print(f"{pk:8s} {sk:18s} {s['it_mw']:.2f} MW  {s['racks_compute']}+{s['racks_network']} 櫃  {s['rack_kw']:.0f} kW/櫃  {'DLC' if s['liquid'] else '氣冷'}  冰水機 {s['chillers']}  {s['pf_inf_total']:,} PF")
    print("→", out)
