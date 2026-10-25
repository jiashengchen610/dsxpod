"""建立 DSX POD 廠區的數位孿生 pod.usda（步驟 8：改回 NVIDIA DSX POD 的貨櫃形式）。

DSX POD（NVIDIA 2026-10-21 GTC Berlin 發表）：一個貨櫃 = 7 架 Vera Rubin NVL72、約 28 t、工廠整合，
接上場地的電力 / 冷卻即可，不需要建築；乾冷卻器閉迴路、45 °C。乾冷卻器可疊在貨櫃上方或分開放。

使用者旋鈕四個：場址（/World/Site 的 VariantSet "site"）、POD 數（build 參數）、
散熱策略（/World/Plant 的 VariantSet "cooling"）、供水溫度（/World/Plant 的 VariantSet "supply_temp"）。
佈局決定（build 參數，不是旋鈕）：heat_rejection = "stacked"（乾冷卻器疊在每個貨櫃頂）| "remote"（集中在北側設備場）。

幾何來源：
  - 貨櫃殼與散熱模組外殼：dsxpod/assetgen.py 程式生成的通用資產（data/assets/dsx_pod/*.usda，同源 GLB 給 three.js），
    以 Reference 疊進來。沒有公開的 DSX POD 或貨櫃 USD 資產，這是尺寸正確的替代品（ISO 40 ft 高櫃 12.192 × 2.438 × 2.896 m）。
  - 機櫃：Reference DSX 內容包 GB300_Properties.usda + 低模 proxy_GB300.usd（Vera Rubin 尚無 SimReady 資產，GB300 當代理）。
  - 乾冷卻器：Vertiv MCV430（Hugging Face Vertiv/simready-assets）。本機有完整幾何（.../MCV430_6FAN/full/）就 Reference 進來；
    沒有就用同尺寸方塊。MCV430 寬 2.572 m、比貨櫃寬 13 cm；NVIDIA 實際用專門設計的模組，這裡以 layout:overhangToleranceM 容許。
  - CDU：Vertiv XDU2300 規格層 + 方塊；UPS：Vertiv APM2 規格層 + 方塊（廠區共用）。
佔位方塊一律放在子 prim "Geom"；有真實幾何時 Geom 的 purpose 設為 proxy（Composer 預設不顯示，瀏覽器檢視與幾何檢查仍讀它）。

USD 組合規則（踩過的坑，保留）：
  1. LIVRPS：根層本地意見 > variant。會被變體改的屬性只在 variant 裡寫。
  2. xformOpOrder 照加入順序：先 translate 再 scale。
  3. 重建時 Clear() 重用根層並保留既有 subLayers（結果層、檢查層）。
  4. 第三方資產自帶 kind=component 疊在 component 下要用本地意見蓋成 subcomponent。

用法：.venv\Scripts\python.exe -m dsxpod.usd_out [--site phoenix] [--n-pods 4] [--heat-rejection stacked]
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
import argparse, math, os
from pathlib import Path
from pxr import Usd, UsdGeom, UsdShade, Sdf, Gf, Kind, Vt
from .variants import (Params, USD_CONTRACT, COOLING, SUPPLY_TEMP, RACKS_PER_POD,
                       RACK_KW_NAMEPLATE, RACK_KW_LIQUID, RACK_KW_AIR)
from .weather import SITES
from . import sizing

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "twin"
try: OUT_DIR.mkdir(parents=True, exist_ok=True)
except OSError: pass                       # 唯讀檔案系統（Vercel 函式）：只用 configure() 指到 /tmp
OUT = OUT_DIR / "pod.usda"
VERTIV = ROOT / "data" / "simready_assets" / "vertiv"
GB300 = ROOT / "data" / "simready_assets" / "nvidia" / "GB300"
def rel(p): return os.path.relpath(p, OUT_DIR).replace(os.sep, "/")
INCLUDE_PROXY = True                       # 機櫃低模 payload（匯出輕量套件時關掉）


def configure(data_root=None, include_proxy=True):
    """把建模器的輸出與資產根目錄指到 data_root（其下要有 twin/、assets/dsx_pod/、simready_assets/ 的相同結構）。
    匯出可攜套件用：在暫存資料夾複製資產後呼叫，USD 內的相對路徑在 zip 裡也能解析。data_root=None 還原成 repo 的 data/。"""
    global OUT_DIR, OUT, VERTIV, GB300, ASSETS, CONTAINER_ASSET, COOLER_ASSET, CAMPUS, INCLUDE_PROXY
    d = Path(data_root) if data_root else ROOT / "data"
    OUT_DIR = d / "twin"; OUT = OUT_DIR / "pod.usda"; CAMPUS = OUT_DIR / "campus.usda"
    try: OUT_DIR.mkdir(parents=True, exist_ok=True)   # 還原到 repo data/ 時，部署環境唯讀 → 略過（匯出只寫暫存資料夾）
    except OSError: pass
    VERTIV = d / "simready_assets" / "vertiv"; GB300 = d / "simready_assets" / "nvidia" / "GB300"
    ASSETS = d / "assets" / "dsx_pod"; CONTAINER_ASSET = ASSETS / "container.usda"; COOLER_ASSET = ASSETS / "cooler_module.usda"
    INCLUDE_PROXY = include_proxy

PLANT = "/World/Plant"
ASSETS = ROOT / "data" / "assets" / "dsx_pod"                 # dsxpod/assetgen.py 生成（USD + GLB 同源）
CONTAINER_ASSET = ASSETS / "container.usda"
COOLER_ASSET = ASSETS / "cooler_module.usda"
CONTAINER = (12.192, 2.438, 2.896)          # ISO 40 ft high cube 外尺寸（m）
WALL_T = 0.04
RACK_SIZE = (0.6, 1.2, 2.3)
EQUIP = {
    "CDU":       dict(asset="XDU2300AA0S000F", size=(1.2, 1.2, 2.4), capacity_kw=2300.0),
    "DryCooler": dict(asset="MCV430_6FAN",     size=(3.353, 2.572, 3.138), capacity_kw=430.0),
    "UPS":       dict(asset="APM2",            size=(1.2, 1.03, 2.0)),
}
POD_GAP = 3.0                 # 相鄰貨櫃長邊間距：南側維修門正面淨空 1.2 m + 通道
PODS_PER_ROW = 6
ROW_GAP = 6.0                 # 兩列貨櫃端牆間距
COOLER_GAP_X = 0.6            # 貨櫃頂乾冷卻器之間
YARD_SETBACK, YARD_GAP_X, YARD_GAP_Y = 8.0, 3.0, 8.0     # remote 設備場
DRYCOOLER_SPARE = 1           # 每個 POD 多放 1 台備援（N+1）
LOOKS = {
    "Rack":           dict(color=(0.10, 0.10, 0.12), roughness=0.55, metallic=0.6),
    "CDU":            dict(color=(0.20, 0.40, 0.80), roughness=0.45, metallic=0.3),
    "DryCooler":      dict(color=(0.62, 0.62, 0.66), roughness=0.4,  metallic=0.7),
    "UPS":            dict(color=(0.25, 0.25, 0.27), roughness=0.5,  metallic=0.4),
    "Chiller":        dict(color=(0.20, 0.70, 0.90), roughness=0.45, metallic=0.4),
    "ContainerWhite": dict(color=(0.86, 0.87, 0.86), roughness=0.55, metallic=0.25),
    "ContainerBand":  dict(color=(0.46, 0.73, 0.00), roughness=0.5,  metallic=0.2),
    "ContainerSteel": dict(color=(0.55, 0.56, 0.58), roughness=0.45, metallic=0.7),
    "Door":           dict(color=(0.80, 0.81, 0.80), roughness=0.5,  metallic=0.25),
    "Deck":           dict(color=(0.35, 0.36, 0.38), roughness=0.7,  metallic=0.6),
    "Louver":         dict(color=(0.85, 0.25, 0.15), roughness=0.6,  metallic=0.5),
    "Pad":            dict(color=(0.55, 0.55, 0.52), roughness=0.95, metallic=0.0),
}


# ---------------------------------------------------------------- 工具
LOOKS_PATH = "/World/Plant/Looks"        # 放在 Plant 底下：園區檔 Reference </World/Plant> 時材質跟著進來


def make_looks(stage):
    UsdGeom.Scope.Define(stage, LOOKS_PATH)
    mats = {}
    for name, L in LOOKS.items():
        m = UsdShade.Material.Define(stage, f"{LOOKS_PATH}/{name}")
        sh = UsdShade.Shader.Define(stage, f"{LOOKS_PATH}/{name}/Surface"); sh.CreateIdAttr("UsdPreviewSurface")
        sh.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*L["color"]))
        sh.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(float(L["roughness"]))
        sh.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(float(L["metallic"]))
        if "opacity" in L: sh.CreateInput("opacity", Sdf.ValueTypeNames.Float).Set(float(L["opacity"]))
        m.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), "surface")
        mats[name] = m
    return mats


def bind(prim, mat):
    UsdShade.MaterialBindingAPI.Apply(prim).Bind(mat)


def attr(prim, name, typ, value, doc=None):
    a = prim.CreateAttribute(name, typ, custom=True); a.Set(value)
    if doc: a.SetDocumentation(doc)
    return a


def box(stage, path, size, pos=None, look=None, kind=None, color=None):
    """Xform（左下角原點）+ 子 Cube "Geom"。"""
    x = UsdGeom.Xform.Define(stage, path)
    if pos is not None: x.AddTranslateOp().Set(Gf.Vec3d(*pos))
    c = UsdGeom.Cube.Define(stage, f"{path}/Geom"); c.GetSizeAttr().Set(1.0)
    c.AddTranslateOp().Set(Gf.Vec3d(size[0] / 2, size[1] / 2, size[2] / 2)); c.AddScaleOp().Set(Gf.Vec3f(*size))
    if color: c.GetDisplayColorAttr().Set([Gf.Vec3f(*color)])
    elif look is not None: c.GetDisplayColorAttr().Set([Gf.Vec3f(*LOOKS[look[0]]["color"])])
    if look is not None: bind(c.GetPrim(), look[1])
    if kind: Usd.ModelAPI(x.GetPrim()).SetKind(kind)
    return x.GetPrim()


def corrugated(stage, path, length, height, z0, axis, look, depth=0.036, pitch=0.278, outward=-1):
    """瓦楞板 Mesh：沿 axis（'x' 或 'y'）展開長 length，高 height，從 z0 起；outward=±1 是凸出方向（另一軸）。"""
    xs = []
    n = max(1, int(length // pitch))
    seg = [0.0, 0.25, 0.5, 0.75]
    for i in range(n):
        for s in seg: xs.append(i * pitch + s * pitch)
    xs.append(n * pitch); xs.append(length)
    xs = sorted(set(min(v, length) for v in xs))
    def off(v):
        t = (v % pitch) / pitch
        return depth * outward if 0.25 < t <= 0.5 or (0.5 < t < 0.75) else 0.0
    pts = []
    for v in xs:
        o = off(v)
        p0 = (v, o, z0) if axis == "x" else (o, v, z0)
        p1 = (v, o, z0 + height) if axis == "x" else (o, v, z0 + height)
        pts += [Gf.Vec3f(*p0), Gf.Vec3f(*p1)]
    counts, idx = [], []
    for i in range(len(xs) - 1):
        a, b = 2 * i, 2 * i + 2
        counts.append(4); idx += [a, b, b + 1, a + 1]
    m = UsdGeom.Mesh.Define(stage, path)
    m.CreatePointsAttr(Vt.Vec3fArray(pts)); m.CreateFaceVertexCountsAttr(counts); m.CreateFaceVertexIndicesAttr(idx)
    m.CreateDoubleSidedAttr(True); m.CreateSubdivisionSchemeAttr("none")
    lo = Gf.Vec3f(*(min(p[k] for p in pts) for k in range(3))); hi = Gf.Vec3f(*(max(p[k] for p in pts) for k in range(3)))
    m.CreateExtentAttr(Vt.Vec3fArray([lo, hi]))
    m.CreateDisplayColorAttr([Gf.Vec3f(*LOOKS[look[0]]["color"])]); bind(m.GetPrim(), look[1])
    return m


def add_vertiv_props(prim, asset):
    for layer in ("Properties.usda", "ConnectionPoints.usd"):
        f = VERTIV / asset / "layers" / f"{asset}_{layer}"
        if f.exists(): prim.GetReferences().AddReference(rel(f))


# 真實幾何登記表：build() 結束時寫進 /World/Plant 的 "geometry" VariantSet（box / vertiv / full）。
# 這樣檔案不在（例如線上匯出的輕量 zip）也不會有壞掉的 payload；補上資產後在 Composer 切變體即可。
REAL_GEO = []        # dict(path, main, size, rotate_z, source)  source: "vertiv"（CC-BY-4.0，可再散布）/ "nvidia"（NGC 內容包，僅本機）
GEOMETRY_LEVELS = (("box", ()), ("vertiv", ("vertiv",)), ("full", ("vertiv", "nvidia")))


def add_full_geometry(prim, main_usd, size, rotate_z=0.0, note="", source="vertiv"):
    """登記真實幾何：變體選到時 Reference（payload）到子 prim "Full"（資產原點在底部中心 → 平移半個足跡），佔位 Geom 改 purpose=proxy。"""
    REAL_GEO.append(dict(path=prim.GetPath(), main=Path(main_usd), size=size, rotate_z=rotate_z, source=source))
    attr(prim, "aif:core:geometryNote", Sdf.ValueTypeNames.String,
         (note + "; " if note else "") + f"real geometry: {Path(main_usd).name} via /World/Plant geometry variant ({source}); Geom = box")
    return Path(main_usd).exists()


def author_geometry_variants(stage):
    """/World/Plant 的 geometry VariantSet：box（全部方塊）、vertiv（Vertiv CDU / UPS / 乾冷卻器用真實模型）、full（再加 GB300 機櫃低模）。
    只寫 Full 子 prim 與 Geom 的 purpose，不碰 cooling / supply_temp 會寫的屬性。預設選檔案都在的最完整那一級。"""
    plant = stage.GetPrimAtPath(PLANT)
    vs = plant.GetVariantSets().AddVariantSet("geometry")
    for name, srcs in GEOMETRY_LEVELS:
        vs.AddVariant(name); vs.SetVariantSelection(name)
        with vs.GetVariantEditContext():
            for e in REAL_GEO:
                if e["source"] not in srcs: continue
                g = UsdGeom.Xform.Define(stage, e["path"].AppendChild("Full"))
                g.AddTranslateOp().Set(Gf.Vec3d(e["size"][0] / 2, e["size"][1] / 2, 0.0))
                if e["rotate_z"]: g.AddRotateZOp().Set(e["rotate_z"])
                g.GetPrim().GetPayloads().AddPayload(rel(e["main"]))       # payload：Composer 可在 Stage 面板卸載
                Usd.ModelAPI(g.GetPrim()).SetKind(Kind.Tokens.subcomponent); g.GetPrim().SetInstanceable(True)
                UsdGeom.Imageable(stage.GetPrimAtPath(e["path"].AppendChild("Geom"))).CreatePurposeAttr(UsdGeom.Tokens.proxy)
    have = lambda srcs: all(e["main"].exists() for e in REAL_GEO if e["source"] in srcs)
    default = next((n for n, srcs in reversed(GEOMETRY_LEVELS) if have(srcs)), "box")
    vs.SetVariantSelection(default)
    attr(plant, "aif:core:geometryVariants", Sdf.ValueTypeNames.String,
         "geometry: box = proxy boxes; vertiv = Vertiv CDU/UPS/dry cooler (Hugging Face Vertiv/simready-assets, CC-BY-4.0); full = + GB300 low-poly rack (NVIDIA DSX content pack, local only)")
    return default


def author_collections(stage):
    """一次選取用的 USD Collection（掛在 /World/Plant；Composer：Window > Collection，右鍵 Select Contents）。
    explicitOnly：只選列出的 prim（例如每個 POD 的根），不會把底下幾千個子 prim 都選進去。"""
    plant = stage.GetPrimAtPath(PLANT)
    pods = [c for c in plant.GetChildren() if c.GetName().startswith("POD_")]
    sets = {
        "pods": [c.GetPath() for c in pods],
        "shells": [c.GetPath().AppendChild("Shell") for c in pods],
        "coolerModules": [c.GetPath().AppendChild("CoolerModule") for c in pods if c.GetChild("CoolerModule")],
        "dryCoolers": [q.GetPath() for q in Usd.PrimRange(plant) if q.GetName().startswith("DryCooler_")],
        "racks": [q.GetPath() for q in Usd.PrimRange(plant) if q.GetName().startswith("Rack_")],
        "cdus": [q.GetPath() for q in Usd.PrimRange(plant) if q.GetName().startswith("CDU_")],
        "utility": [q.GetPath() for q in plant.GetChild("Utility").GetChildren()] if plant.GetChild("Utility") else [],
    }
    for name, paths in sets.items():
        if not paths: continue
        c = Usd.CollectionAPI.Apply(plant, name)
        c.CreateExpansionRuleAttr(Usd.Tokens.explicitOnly)
        rel_ = c.CreateIncludesRel()
        for q in paths: rel_.AddTarget(q)
    return {k: len(v) for k, v in sets.items()}


def add_gb300(prim, facing):
    props = GB300 / "layers" / "GB300_Properties.usda"; cps = GB300 / "layers" / "GB300_ConnectionPoints.usda"
    if props.exists():
        prim.GetReferences().AddReference(rel(props))
        if cps.exists(): prim.GetReferences().AddReference(rel(cps))
        note = "aif:* from NVIDIA DSX Content Pack GB300_Properties.usda; stand-in for Vera Rubin NVL72 (no SimReady asset yet)"
    else:
        attr(prim, "aif:core:assetClass", Sdf.ValueTypeNames.String, "Compute Rack")
        attr(prim, "aif:core:modelNumber", Sdf.ValueTypeNames.String, "Grace Blackwell 300 NVL72")
        attr(prim, "aif:core:width", Sdf.ValueTypeNames.Float, 600.0); attr(prim, "aif:core:depth", Sdf.ValueTypeNames.Float, 1200.0)
        attr(prim, "aif:core:installationClearance", Sdf.ValueTypeNames.Float, 1200.0); attr(prim, "aif:core:accessibilityRequirement", Sdf.ValueTypeNames.Float, 900.0)
        attr(prim, "aif:spec:maxPowerDcTdp", Sdf.ValueTypeNames.Float, RACK_KW_NAMEPLATE)
        attr(prim, "aif:spec:liquidCooling", Sdf.ValueTypeNames.Float, RACK_KW_LIQUID); attr(prim, "aif:spec:airCooling", Sdf.ValueTypeNames.Float, RACK_KW_AIR)
        note = "aif:* fallback from NVIDIA DSX docs; stand-in for Vera Rubin NVL72"
    attr(prim, "aif:core:standInFor", Sdf.ValueTypeNames.String, "NVIDIA Vera Rubin NVL72 (DSX POD: 7 per container)")
    proxy = GB300 / "proxy" / "proxy_GB300.usd"
    add_full_geometry(prim, proxy, RACK_SIZE, rotate_z=(90.0 if facing > 0 else -90.0), note=note, source="nvidia")
    attr(prim, "layout:facing", Sdf.ValueTypeNames.Token, "+y" if facing > 0 else "-y", "front (air intake / service) side")


# ---------------------------------------------------------------- 尺寸
def pod_origins(n_pods):
    """貨櫃左下角：長邊平行 x，沿 +y 並排，每列最多 PODS_PER_ROW 個，多的往 +x 開新列。"""
    out = []
    for i in range(n_pods):
        row, k = divmod(i, PODS_PER_ROW)
        out.append((row * (CONTAINER[0] + ROW_GAP), k * (CONTAINER[1] + POD_GAP)))
    return out


def plant_dims(n_pods):
    rows = math.ceil(n_pods / PODS_PER_ROW); per = min(n_pods, PODS_PER_ROW)
    return round(rows * CONTAINER[0] + (rows - 1) * ROW_GAP, 2), round(per * CONTAINER[1] + (per - 1) * POD_GAP, 2)


hall_dims = plant_dims   # 舊名相容


def rack_positions():
    """貨櫃內 7 櫃一排，正面朝南側維修門（−y），從西端 CDU 後面排起；回傳 (x, y)（貨櫃局部座標、左下角）。"""
    x0 = 0.3 + EQUIP["CDU"]["size"][0] + 1.0
    return [(x0 + i * RACK_SIZE[0], WALL_T + 0.02) for i in range(RACKS_PER_POD)]


# ---------------------------------------------------------------- 單一貨櫃
def build_pod(stage, path, origin, looks, heat_rejection, n_coolers):
    L, W, H = CONTAINER
    pod = UsdGeom.Xform.Define(stage, path); pod.AddTranslateOp().Set(Gf.Vec3d(origin[0], origin[1], 0.0))
    pp = pod.GetPrim(); Usd.ModelAPI(pp).SetKind(Kind.Tokens.assembly)
    attr(pp, "aif:core:assetClass", Sdf.ValueTypeNames.String, "DSX POD (containerized AI factory)")
    attr(pp, "aif:core:assetDescription", Sdf.ValueTypeNames.String,
         f"ISO 40 ft high-cube container, {RACKS_PER_POD} racks (GB300 NVL72 stand-in for Vera Rubin NVL72), liquid cooled; dry coolers {heat_rejection}")
    attr(pp, "aif:core:overallGeometryDimensions", Sdf.ValueTypeNames.Float3, Gf.Vec3f(L * 1000, W * 1000, H * 1000), "container outer dims (mm)")

    # 殼：Reference 程式生成的通用貨櫃資產（同一份幾何另有 GLB 給 three.js）；不設 instanceable，幾何檢查要讀牆與屋頂屬性
    sh = UsdGeom.Xform.Define(stage, f"{path}/Shell").GetPrim(); Usd.ModelAPI(sh).SetKind(Kind.Tokens.group)
    if CONTAINER_ASSET.exists():
        sh.GetReferences().AddReference(rel(CONTAINER_ASSET), "/DSXPOD_Container")
        Usd.ModelAPI(sh).SetKind(Kind.Tokens.group)          # 資產根是 component，疊在 assembly 下改成 group（本地意見蓋過）
    else:
        box(stage, f"{path}/Shell/Roof", (L, W, 0.05), (0, 0, H - 0.05), ("ContainerWhite", looks["ContainerWhite"]))
        attr(stage.GetPrimAtPath(f"{path}/Shell/Roof"), "layout:overhangToleranceM", Sdf.ValueTypeNames.Float, 0.1)

    # 機櫃
    rk = UsdGeom.Scope.Define(stage, f"{path}/Racks").GetPrim(); Usd.ModelAPI(rk).SetKind(Kind.Tokens.group)
    for i, (x, y) in enumerate(rack_positions(), 1):
        r = box(stage, f"{path}/Racks/Rack_{i:02d}", RACK_SIZE, (x, y, 0.10), ("Rack", looks["Rack"]), Kind.Tokens.component)
        add_gb300(r, -1)

    # 設備：CDU 在西端
    eq = UsdGeom.Scope.Define(stage, f"{path}/Equipment").GetPrim(); Usd.ModelAPI(eq).SetKind(Kind.Tokens.group)
    c = box(stage, f"{path}/Equipment/CDU_01", EQUIP["CDU"]["size"], (0.3, (W - EQUIP['CDU']['size'][1]) / 2, 0.10), ("CDU", looks["CDU"]), Kind.Tokens.component)
    add_vertiv_props(c, EQUIP["CDU"]["asset"]); attr(c, "layout:facing", Sdf.ValueTypeNames.Token, "+x")
    add_full_geometry(c, VERTIV / EQUIP["CDU"]["asset"] / "full" / "simready_usd" / f"{EQUIP['CDU']['asset']}_main.usd", EQUIP["CDU"]["size"],
                      note="Vertiv XDU2300 spec layer", source="vertiv")

    # 乾冷卻器（疊在頂上）：外觀 = 程式生成的散熱模組資產；容量 / 風扇電 = 模組內 3 個 Vertiv MCV430 規格 prim（Geom 為 proxy，Composer 不顯示）
    if heat_rejection == "stacked":
        cm = UsdGeom.Xform.Define(stage, f"{path}/CoolerModule").GetPrim(); Usd.ModelAPI(cm).SetKind(Kind.Tokens.group)
        attr(cm, "aif:core:assetDescription", Sdf.ValueTypeNames.String,
             f"container-footprint dry cooler module stacked on the compute container; capacity modelled as {n_coolers} x Vertiv MCV430 (N+1)")
        if COOLER_ASSET.exists():
            vis = UsdGeom.Xform.Define(stage, f"{path}/CoolerModule/Enclosure"); vis.AddTranslateOp().Set(Gf.Vec3d(0, 0, H))
            vis.GetPrim().GetReferences().AddReference(rel(COOLER_ASSET), "/DSXPOD_CoolerModule")
            Usd.ModelAPI(vis.GetPrim()).SetKind(Kind.Tokens.subcomponent); vis.GetPrim().SetInstanceable(True)
        sx = EQUIP["DryCooler"]["size"][0]; span = n_coolers * sx + (n_coolers - 1) * COOLER_GAP_X; x0 = (L - span) / 2
        for k in range(n_coolers):
            make_drycooler(stage, f"{path}/CoolerModule/DryCooler_{k+1:02d}", (x0 + k * (sx + COOLER_GAP_X), (W - EQUIP['DryCooler']['size'][1]) / 2, H), looks, "stacked",
                           enclosed=COOLER_ASSET.exists())
    return pp


def make_drycooler(stage, path, pos, looks, placement, enclosed=False):
    d = box(stage, path, EQUIP["DryCooler"]["size"], pos, ("DryCooler", looks["DryCooler"]), Kind.Tokens.component)
    add_vertiv_props(d, EQUIP["DryCooler"]["asset"])
    attr(d, "aif:spec:placement", Sdf.ValueTypeNames.String, placement)
    attr(d, "layout:facing", Sdf.ValueTypeNames.Token, "-y", "governing air intake side (coils on the long sides)")
    attr(d, "thermal:exhaustDirection", Sdf.ValueTypeNames.Token, "+z", "fans discharge upward")
    if enclosed:      # 外觀由散熱模組外殼負責；這個 prim 只帶規格與幾何檢查用的足跡
        UsdGeom.Imageable(d.GetChild("Geom")).CreatePurposeAttr(UsdGeom.Tokens.proxy)
        attr(d, "aif:core:geometryNote", Sdf.ValueTypeNames.String, "spec carrier inside the procedural cooler module enclosure; Geom = proxy footprint")
        return d
    full = VERTIV / EQUIP["DryCooler"]["asset"] / "full" / "simready_usd" / f"{EQUIP['DryCooler']['asset']}_main.usd"
    add_full_geometry(d, full, EQUIP["DryCooler"]["size"], note="Vertiv MCV430 (Hugging Face Vertiv/simready-assets)", source="vertiv")
    return d


# ---------------------------------------------------------------- 契約
def author_contract(stage, defaults: Params):
    for param, prim_rel, name, doc in USD_CONTRACT:
        if param == "tcs_supply_c": continue
        from .stage_io import contract_prim
        prim = contract_prim(stage, PLANT, prim_rel)
        if not prim or not prim.IsValid(): continue
        a = prim.GetAttribute(name)
        if a.IsValid() and a.HasAuthoredValue(): continue
        attr(prim, name, Sdf.ValueTypeNames.Float, float(getattr(defaults, param)), f"{doc} [model parameter: {param}]")


# ---------------------------------------------------------------- 主函式
def build(site_key="phoenix", n_pods=1, utilization=0.9, cooling="dry_only", supply="t45", heat_rejection="stacked", n_du=None, layout=None):
    """layout = sizing.plan(...) 的結果。detail 模式：pod.usda 就是整個陣列。campus 模式：pod.usda 是代表區塊（第一塊），
    另寫 campus.usda 以 instanceable Reference 鋪滿所有區塊。沒給 layout 時依 n_pods 自動排。"""
    if n_du is not None: n_pods = n_du          # 舊參數名相容
    if layout is None: layout = sizing._layout(n_pods, [], dict(n_pods=n_pods))
    blk0 = [p for p in layout["pods"] if p["block"] == 0]
    n_pods = len(blk0)
    defaults = Params()
    REAL_GEO.clear()
    old_sublayers = []
    if OUT.exists():
        lyr = Sdf.Layer.FindOrOpen(str(OUT)); old_sublayers = list(lyr.subLayerPaths); lyr.Clear(); lyr.Save()
        stage = Usd.Stage.Open(str(OUT))
    else:
        stage = Usd.Stage.CreateNew(str(OUT))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z); UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    world = UsdGeom.Xform.Define(stage, "/World"); stage.SetDefaultPrim(world.GetPrim())
    Usd.ModelAPI(world.GetPrim()).SetKind(Kind.Tokens.group)

    site = UsdGeom.Scope.Define(stage, "/World/Site").GetPrim()
    svs = site.GetVariantSets().AddVariantSet("site")
    for k in SITES: svs.AddVariant(k)
    for k, s in SITES.items():
        svs.SetVariantSelection(k)
        with svs.GetVariantEditContext():
            attr(site, "aif:site:key", Sdf.ValueTypeNames.String, k)
            attr(site, "aif:site:name", Sdf.ValueTypeNames.String, s["name"])
            attr(site, "aif:site:latitude", Sdf.ValueTypeNames.Double, s["lat"])
            attr(site, "aif:site:longitude", Sdf.ValueTypeNames.Double, s["lon"])
            attr(site, "aif:site:timezone", Sdf.ValueTypeNames.String, s["tz"])
            attr(site, "aif:site:climate", Sdf.ValueTypeNames.String, s["climate"])
            attr(site, "aif:site:weatherSource", Sdf.ValueTypeNames.String, "Open-Meteo ERA5 hourly 2005-2024")
    svs.SetVariantSelection(site_key)

    plant = UsdGeom.Xform.Define(stage, PLANT).GetPrim(); Usd.ModelAPI(plant).SetKind(Kind.Tokens.assembly)
    b0 = layout["blocks"][0]; PL, PW = round(b0["length"], 2), round(b0["width"], 2)
    looks = make_looks(stage)
    attr(plant, "aif:core:assetClass", Sdf.ValueTypeNames.String, "AI Factory site (DSX POD array)")
    attr(plant, "aif:core:assetDescription", Sdf.ValueTypeNames.String,
         f"{n_pods} DSX POD container(s) x {RACKS_PER_POD} racks, warm-water liquid cooling, dry coolers {heat_rejection}; array {PL} x {PW} m")
    attr(plant, "aif:spec:podCount", Sdf.ValueTypeNames.Int, n_pods); attr(plant, "aif:spec:rackCount", Sdf.ValueTypeNames.Int, n_pods * RACKS_PER_POD)
    attr(plant, "aif:spec:itUtilization", Sdf.ValueTypeNames.Double, utilization, "mean IT utilisation (0-1)")
    attr(plant, "aif:spec:coolantMixture", Sdf.ValueTypeNames.String, "75% water / 25% propylene glycol")
    attr(plant, "aif:spec:heatRejectionPlacement", Sdf.ValueTypeNames.String, heat_rejection)
    attr(plant, "thermal:distributionLossFraction", Sdf.ValueTypeNames.Float, 0.005, "downstream distribution losses as fraction of IT (added to UPS loss)")
    attr(plant, "layout:mode", Sdf.ValueTypeNames.Token, layout["mode"], "detail = this stage is the whole site; campus = this stage is one representative block of campus.usda")
    attr(plant, "aif:spec:siteItMW", Sdf.ValueTypeNames.Float, float(layout["it_mw"]), "whole-site IT nameplate (drives the site heat-island term)")
    attr(plant, "aif:spec:sitePodCount", Sdf.ValueTypeNames.Int, int(layout["n_pods"]))
    attr(plant, "aif:spec:siteBlockCount", Sdf.ValueTypeNames.Int, int(layout["n_blocks"]))
    attr(plant, "layout:siteCrossWidthM", Sdf.ValueTypeNames.Float, float(layout["cross_width_m"]), "sqrt(site area): crosswind width for the heat-island box model")
    attr(plant, "layout:siteSizeM", Sdf.ValueTypeNames.Float2, Gf.Vec2f(*layout["site_m"]))

    q_pod = RACKS_PER_POD * RACK_KW_LIQUID * utilization
    n_cool = math.ceil(q_pod / EQUIP["DryCooler"]["capacity_kw"]) + DRYCOOLER_SPARE
    ox, oy = b0["x"], b0["y"]
    for i, pd in enumerate(blk0, 1):
        build_pod(stage, f"{PLANT}/POD_{i:02d}", (pd["x"] - ox, pd["y"] - oy), looks, heat_rejection, n_cool)

    # 設備場（remote）
    if heat_rejection == "remote":
        yd = UsdGeom.Scope.Define(stage, f"{PLANT}/CoolerYard").GetPrim(); Usd.ModelAPI(yd).SetKind(Kind.Tokens.group)
        n_total = n_pods * n_cool; sx, sy = EQUIP["DryCooler"]["size"][:2]
        per = max(2, int((PL + 0.01) // (sx + YARD_GAP_X)))
        box(stage, f"{PLANT}/CoolerYard/Pad", (PL, math.ceil(n_total / per) * (sy + YARD_GAP_Y), 0.15), (0, PW + YARD_SETBACK - 1.0, -0.15), ("Pad", looks["Pad"]))
        for k in range(n_total):
            row, col = divmod(k, per)
            make_drycooler(stage, f"{PLANT}/CoolerYard/DryCooler_{k+1:02d}", (col * (sx + YARD_GAP_X), PW + YARD_SETBACK + row * (sy + YARD_GAP_Y), 0.0), looks, "remote_field")

    # 廠區共用：UPS、輔助冰水機
    ut = UsdGeom.Scope.Define(stage, f"{PLANT}/Utility").GetPrim(); Usd.ModelAPI(ut).SetKind(Kind.Tokens.group)
    ups = box(stage, f"{PLANT}/Utility/UPS_01", EQUIP["UPS"]["size"], (-4.0, 0.0, 0.0), ("UPS", looks["UPS"]), Kind.Tokens.component)
    add_vertiv_props(ups, EQUIP["UPS"]["asset"]); attr(ups, "layout:facing", Sdf.ValueTypeNames.Token, "-x")
    add_full_geometry(ups, VERTIV / EQUIP["UPS"]["asset"] / "full" / "simready_usd" / f"{EQUIP['UPS']['asset']}_main.usd", EQUIP["UPS"]["size"],
                      note="Vertiv APM2 spec layer (site-level power, efficiency feeds the UPS loss)", source="vertiv")
    ch = box(stage, f"{PLANT}/Utility/Chiller_01", (2.0, 1.2, 2.0), (-4.0, 3.0, 0.0), ("Chiller", looks["Chiller"]), Kind.Tokens.component)
    attr(ch, "aif:core:assetClass", Sdf.ValueTypeNames.String, "Chiller")
    attr(ch, "aif:core:assetDescription", Sdf.ValueTypeNames.String, "Placeholder air-cooled trim chiller; active only in cooling = dry_plus_chiller")
    attr(ch, "aif:spec:copAt25C", Sdf.ValueTypeNames.Double, defaults.chiller_cop_25c); attr(ch, "aif:spec:copAt45C", Sdf.ValueTypeNames.Double, defaults.chiller_cop_45c)

    # 廠區連接點（場地的電力 / 冷卻接口）
    cp = UsdGeom.Scope.Define(stage, f"{PLANT}/ConnectionPoints"); cp.CreatePurposeAttr(UsdGeom.Tokens.guide)
    for nm, system, direction, pos in (("site_power_in", "Electrical", "supply", (-5.0, -1.0, 0.5)), ("site_network", "Network", "bidirectional", (-5.0, -1.5, 0.5))):
        x = UsdGeom.Xform.Define(stage, f"{PLANT}/ConnectionPoints/{nm}"); x.AddTranslateOp().Set(Gf.Vec3d(*pos)); p = x.GetPrim()
        attr(p, "simready:connectionPoint:system", Sdf.ValueTypeNames.Token, system); attr(p, "simready:connectionPoint:direction", Sdf.ValueTypeNames.Token, direction)

    UsdGeom.Scope.Define(stage, "/World/Cameras")
    cam = UsdGeom.Camera.Define(stage, "/World/Cameras/Cam_Overview"); cam.CreateFocalLengthAttr(24.0); cam.CreateClippingRangeAttr(Gf.Vec2f(0.1, 2000.0))
    view = Gf.Matrix4d().SetLookAt(Gf.Vec3d(-0.6 * PL - 12, -0.9 * PW - 18, 0.6 * max(PL, PW) + 10), Gf.Vec3d(PL / 2, PW / 2, 2.5), Gf.Vec3d(0, 0, 1))
    cam.AddTransformOp().Set(view.GetInverse())

    author_contract(stage, defaults)

    vs = plant.GetVariantSets()
    cv = vs.AddVariantSet("cooling")
    for name in COOLING: cv.AddVariant(name)
    dcs = [p for p in Usd.PrimRange(plant) if p.GetName().startswith("DryCooler_")]
    for name, cfg in COOLING.items():
        cv.SetVariantSelection(name)
        with cv.GetVariantEditContext():
            ch.SetActive(bool(cfg["has_chiller"]))
            for d in dcs:
                attr(d, "aif:spec:coolingTypeOverride", Sdf.ValueTypeNames.String, "Evaporative (adiabatic pre-cooling)" if cfg["evaporative"] else "Dry")
            attr(plant, "aif:spec:coolingStrategy", Sdf.ValueTypeNames.String, cfg["doc"])
    cv.SetVariantSelection(cooling)
    tv = vs.AddVariantSet("supply_temp")
    for name in SUPPLY_TEMP: tv.AddVariant(name)
    for name, t in SUPPLY_TEMP.items():
        tv.SetVariantSelection(name)
        with tv.GetVariantEditContext():
            attr(plant, "aif:spec:referenceFacilityCoolantTemperature", Sdf.ValueTypeNames.Double, t, "TCS supply water temperature (C)")
    tv.SetVariantSelection(supply)
    author_geometry_variants(stage)
    author_collections(stage)

    root = stage.GetRootLayer()
    for sl in old_sublayers:
        if sl not in root.subLayerPaths: root.subLayerPaths.append(sl)
    root.Save()
    if layout["mode"] == "campus": build_campus(layout, site_key, cooling, supply)
    elif CAMPUS.exists(): CAMPUS.unlink()
    return stage


CAMPUS = OUT_DIR / "campus.usda"


def build_campus(layout, site_key, cooling, supply):
    """園區：每個區塊一個 instanceable Reference → pod.usda </World/Plant>（同一個原型，Composer 只載一份）。
    最後一塊 POD 數不足時仍引用代表區塊，並在 prim 上標實際 POD 數（能耗依 POD 數縮放，幾何是近似）。"""
    if CAMPUS.exists(): CAMPUS.unlink()
    st = Usd.Stage.CreateNew(str(CAMPUS))
    UsdGeom.SetStageUpAxis(st, UsdGeom.Tokens.z); UsdGeom.SetStageMetersPerUnit(st, 1.0)
    w = UsdGeom.Xform.Define(st, "/World"); st.SetDefaultPrim(w.GetPrim()); Usd.ModelAPI(w.GetPrim()).SetKind(Kind.Tokens.group)
    site = st.DefinePrim("/World/Site"); site.GetReferences().AddReference(rel(OUT), "/World/Site")
    site.GetVariantSets().GetVariantSet("site").SetVariantSelection(site_key)
    cp = UsdGeom.Xform.Define(st, "/World/Campus").GetPrim(); Usd.ModelAPI(cp).SetKind(Kind.Tokens.assembly)
    attr(cp, "aif:core:assetClass", Sdf.ValueTypeNames.String, "AI Factory campus (DSX POD blocks)")
    attr(cp, "aif:spec:siteItMW", Sdf.ValueTypeNames.Float, float(layout["it_mw"])); attr(cp, "aif:spec:sitePodCount", Sdf.ValueTypeNames.Int, int(layout["n_pods"]))
    attr(cp, "aif:spec:siteBlockCount", Sdf.ValueTypeNames.Int, int(layout["n_blocks"])); attr(cp, "layout:siteSizeM", Sdf.ValueTypeNames.Float2, Gf.Vec2f(*layout["site_m"]))
    attr(cp, "layout:note", Sdf.ValueTypeNames.String, "screening-level campus: blocks are instances of pod.usda; site heat-island term is a box-model estimate; verify key sites with CFD")
    for b in layout["blocks"]:
        bp = UsdGeom.Xform.Define(st, f"/World/Campus/Block_{b['index']+1:02d}"); bp.AddTranslateOp().Set(Gf.Vec3d(b["x"], b["y"], 0))
        bp.GetPrim().GetReferences().AddReference(rel(OUT), "/World/Plant"); bp.GetPrim().SetInstanceable(True)
        vs = bp.GetPrim().GetVariantSets(); vs.GetVariantSet("cooling").SetVariantSelection(cooling); vs.GetVariantSet("supply_temp").SetVariantSelection(supply)
        attr(bp.GetPrim(), "aif:spec:blockPodCount", Sdf.ValueTypeNames.Int, int(b["n_pods"]))
        if "substation" in b:
            s_ = b["substation"]
            sp = UsdGeom.Cube.Define(st, f"/World/Campus/Substation_{b['index']+1:02d}"); sp.GetSizeAttr().Set(1.0)
            sp.AddTranslateOp().Set(Gf.Vec3d(s_["x"] + s_["l"] / 2, s_["y"] + 2 + s_["w"] / 2, 1.5)); sp.AddScaleOp().Set(Gf.Vec3f(s_["l"] * 0.4, s_["w"], 3.0))
            sp.GetDisplayColorAttr().Set([Gf.Vec3f(0.5, 0.5, 0.45)])
            attr(sp.GetPrim(), "aif:core:assetClass", Sdf.ValueTypeNames.String, "Block substation / switchgear pad (placeholder)")
    cam = UsdGeom.Camera.Define(st, "/World/Cameras/Cam_Campus"); cam.CreateFocalLengthAttr(24.0); cam.CreateClippingRangeAttr(Gf.Vec2f(1.0, 20000.0))
    L, W = layout["site_m"]
    view = Gf.Matrix4d().SetLookAt(Gf.Vec3d(-0.4 * L, -0.6 * W, 0.6 * max(L, W)), Gf.Vec3d(L / 2, W / 2, 0), Gf.Vec3d(0, 0, 1)); cam.AddTransformOp().Set(view.GetInverse())
    st.GetRootLayer().Save()
    return st


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--site", default="phoenix"); ap.add_argument("--n-pods", type=int, default=1)
    ap.add_argument("--cooling", default="dry_only"); ap.add_argument("--supply", default="t45"); ap.add_argument("--heat-rejection", default="stacked", choices=["stacked", "remote"])
    a = ap.parse_args()
    st = build(a.site, a.n_pods, cooling=a.cooling, supply=a.supply, heat_rejection=a.heat_rejection)
    print(f"已建立 {OUT}：{sum(1 for _ in st.Traverse())} 個 prim，{a.n_pods} POD，陣列 {plant_dims(a.n_pods)} m，乾冷卻器 {a.heat_rejection}")
