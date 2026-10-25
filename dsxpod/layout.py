"""步驟 5：幾何成為模型輸入。從 Stage 的幾何算三件事，寫到 pod_checks.usda（sublayer 進 pod.usda）：

1. 淨空檢查：每台設備正面要留 aif:core:installationClearance（GB300：1,200 mm）、背面留 aif:core:accessibilityRequirement
   （900 mm）；淨空帶不能碰到其他設備或牆。這兩個欄位哪個算正面是我們的假設（正面 = 進風 / 維修面，用 layout:facing 標）。
2. 乾冷卻器再循環：進風面中心到最近「熱排風」（thermal:role = exhaust 的 prim，或其他乾冷卻器）的距離 → 再循環 K（經驗表，
   CFD 才準）。以前是 placement 字串給常數，現在位置決定；在 Composer 拖動乾冷卻器就會改變能耗。
3. 容量檢查：乾冷卻器 maximumCoolingCapacity、CDU nominalCoolingCapacity 對液冷熱；回傳需要幾台。

用法：.venv\Scripts\python.exe -m dsxpod.layout            # 對目前變體選擇跑檢查並寫 pod_checks.usda
     .venv\Scripts\python.exe -m dsxpod.layout --site phoenix --cooling dry_plus_chiller
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
import argparse, math, os
from pathlib import Path
from pxr import Usd, UsdGeom, Sdf, Gf

ROOT = Path(__file__).resolve().parent.parent
POD_PATH = "/World/Plant"     # 步驟 8：廠區（底下 POD_01..n 貨櫃）
EQUIP_PARENTS = ("Racks", "Cooling", "Equipment", "CoolerModule", "CoolerYard", "Utility", "PowerSkid", "Chillers")
CHECKS_PATH = "/World/Checks"
CHECKS_LAYER = ROOT / "data" / "twin" / "pod_checks.usda"

# 乾冷卻器進風到熱排風的距離 → 進風溫升 K（經驗規則；ASHRAE / 廠商建議屋頂機組離排風 ≥ 3 m，>10 m 視為無影響）
RECIRC_TABLE = ((2.0, 3.0), (5.0, 2.0), (10.0, 1.0), (float("inf"), 0.0))
FACING = {"+y": (0, 1), "-y": (0, -1), "+x": (1, 0), "-x": (-1, 0)}


def _attr(prim, name, default=None):
    a = prim.GetAttribute(name) if prim and prim.IsValid() else None
    v = a.Get() if a and a.HasAuthoredValue() else None
    return default if v in (None, "") else v


class Footprint:
    """設備在地面的矩形（世界座標、軸對齊），含朝向。"""
    def __init__(self, prim, xf_cache, bbox_cache):
        self.prim = prim; self.path = prim.GetPath().pathString; self.name = relname(prim)
        M = xf_cache.GetLocalToWorldTransform(prim)
        w = _attr(prim, "aif:core:width"); d = _attr(prim, "aif:core:depth")
        geom = prim.GetChild("Geom")
        size = None
        if w and d:
            size = (float(w) / 1000.0, float(d) / 1000.0)                 # aif 是 mm；佔位方塊 x = 寬、y = 深
        elif geom and geom.IsValid() and geom.GetTypeName() == "Cube":
            sc = _attr(geom, "xformOp:scale", Gf.Vec3f(1, 1, 1)); size = (float(sc[0]), float(sc[1]))
        if size is not None:
            pts = [M.Transform(Gf.Vec3d(x, y, 0)) for x in (0, size[0]) for y in (0, size[1])]
            self.xmin = min(p[0] for p in pts); self.xmax = max(p[0] for p in pts)
            self.ymin = min(p[1] for p in pts); self.ymax = max(p[1] for p in pts)
            self.z = M.Transform(Gf.Vec3d(0, 0, 0))[2]
        else:
            # 沒有規格尺寸也沒有方塊（例如瓦楞牆）：直接用世界包圍盒
            r = bbox_cache.ComputeWorldBound(prim).ComputeAlignedRange()
            self.xmin, self.ymin, self.z = r.GetMin()[0], r.GetMin()[1], r.GetMin()[2]
            self.xmax, self.ymax = r.GetMax()[0], r.GetMax()[1]
        self.height = float(_attr(prim, "aif:core:height", 0.0)) / 1000.0 or (float(_attr(geom, "xformOp:scale", Gf.Vec3f(1, 1, 2))[2]) if geom and geom.IsValid() else 2.0)
        self.facing = str(_attr(prim, "layout:facing", "+y"))
        self.front_m = float(_attr(prim, "aif:core:installationClearance", 0.0)) / 1000.0
        self.back_m = float(_attr(prim, "aif:core:accessibilityRequirement", 0.0)) / 1000.0

    def center(self): return ((self.xmin + self.xmax) / 2, (self.ymin + self.ymax) / 2)

    def top_center(self):
        cx, cy = self.center(); return (cx, cy, self.z + self.height)

    def face_center(self, sign=+1):
        """sign=+1 正面中心、−1 背面中心（地面高度 + 一半高度）。"""
        dx, dy = FACING.get(self.facing, (0, 1)); cx, cy = self.center()
        hx, hy = (self.xmax - self.xmin) / 2, (self.ymax - self.ymin) / 2
        return (cx + sign * dx * hx, cy + sign * dy * hy, self.z + self.height / 2)

    def band(self, side):
        """正面 / 背面的淨空帶矩形。"""
        dx, dy = FACING.get(self.facing, (0, 1)); dist = self.front_m if side == "front" else self.back_m
        if side == "back": dx, dy = -dx, -dy
        if dist <= 0: return None
        if dx > 0: return (self.xmax, self.xmax + dist, self.ymin, self.ymax)
        if dx < 0: return (self.xmin - dist, self.xmin, self.ymin, self.ymax)
        if dy > 0: return (self.xmin, self.xmax, self.ymax, self.ymax + dist)
        return (self.xmin, self.xmax, self.ymin - dist, self.ymin)

    def rect(self): return (self.xmin, self.xmax, self.ymin, self.ymax)


def overlap(a, b, eps=1e-6):
    """兩個 (xmin,xmax,ymin,ymax) 的重疊面積 > 0？"""
    return (min(a[1], b[1]) - max(a[0], b[0]) > eps) and (min(a[3], b[3]) - max(a[2], b[2]) > eps)


def penetration(a, b):
    """b 侵入 a 的深度（沿較淺的方向），0 表示沒碰到。"""
    if not overlap(a, b): return 0.0
    return min(min(a[1], b[1]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[2], b[2]))


def relname(prim):
    """訊息用的短名：所屬 POD + 自己的名字（POD_02/DryCooler_01）；不在 POD 底下就用自己的名字。"""
    q = prim.GetParent()
    while q and q.IsValid() and not q.IsPseudoRoot():
        if q.GetName().startswith("POD_"): return f"{q.GetName()}/{prim.GetName()}"
        q = q.GetParent()
    return prim.GetName()


def safe(name): return name.replace("/", "_")


def _pod(prim):
    q = prim.GetParent()
    while q and q.IsValid() and not q.IsPseudoRoot():
        if q.GetName().startswith("POD_"): return q.GetName()
        q = q.GetParent()
    return None


def recirculation_k(distance_m):
    for lim, k in RECIRC_TABLE:
        if distance_m <= lim: return k
    return 0.0


def collect(stage, pod_path=POD_PATH):
    xf = UsdGeom.XformCache(Usd.TimeCode.Default()); bb = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_])
    equip, walls, exhausts, roofs = [], [], [], []
    for p in stage.Traverse():
        ps = p.GetPath().pathString
        if not ps.startswith(pod_path + "/") or not p.IsActive(): continue
        parent = p.GetParent().GetName()
        if parent in EQUIP_PARENTS and p.GetName().split("_")[0] in ("Rack", "CDU", "DryCooler", "UPS", "Chiller"): equip.append(Footprint(p, xf, bb))
        elif p.GetName() in ("Wall_N", "Wall_S", "Wall_W", "Wall_E") and "/Shell/" in ps: walls.append(Footprint(p, xf, bb))
        elif p.GetName() == "Roof" and "/Shell/" in ps:
            f = Footprint(p, xf, bb); f.tol = float(_attr(p, "layout:overhangToleranceM", 0.0)); roofs.append(f)
        if _attr(p, "thermal:role") == "exhaust":
            r = bb.ComputeWorldBound(p).ComputeAlignedRange()
            c = r.GetMidpoint() if not r.IsEmpty() else xf.GetLocalToWorldTransform(p).Transform(Gf.Vec3d(0, 0, 0))
            exhausts.append((p.GetPath().pathString, (c[0], c[1], c[2])))
    collect.roofs = roofs
    return equip, walls, exhausts


def analyze(stage, pod_path=POD_PATH):
    """回傳 dict：violations（list）、recirculation（dict）、capacity（list）、summary。"""
    equip, walls, exhausts = collect(stage, pod_path)
    by_name = {e.name: e for e in equip}
    out = dict(violations=[], recirculation={}, capacity=[], n_equipment=len(equip))

    # 1. 淨空：淨空帶 vs 其他設備與牆；設備本體 vs 設備本體（重疊）
    for e in equip:
        if e.prim.GetName().startswith("DryCooler") and e.z > 0.5:
            others = [o for o in equip if o is not e and o.z > 0.5]        # 屋頂上的只跟屋頂上的比
            wall_list = []
        else:
            others = [o for o in equip if o is not e and o.z <= 0.5]; wall_list = walls
        for side in ("front", "back"):
            band = e.band(side)
            if band is None: continue
            req = e.front_m if side == "front" else e.back_m
            for o in others:
                pen = penetration(band, o.rect())
                if pen > 1e-3:
                    out["violations"].append(dict(kind=f"clearance_{side}", subject=e.path, other=o.path, required_m=req,
                                                  actual_m=round(req - pen, 3), message=f"{e.name} {side} clearance {req:.2f} m blocked by {o.name} (only {req - pen:.2f} m)"))
            for w in wall_list:
                if side == "front" and _attr(w.prim, "layout:serviceDoors", False): continue   # 維修門那面：正面淨空在門外
                pen = penetration(band, w.rect())
                if pen > 1e-3:
                    out["violations"].append(dict(kind=f"clearance_{side}", subject=e.path, other=w.path, required_m=req,
                                                  actual_m=round(req - pen, 3), message=f"{e.name} {side} clearance {req:.2f} m blocked by {w.name} (only {req - pen:.2f} m)"))
        for o in others:
            if o.path > e.path and penetration(e.rect(), o.rect()) > 1e-3:
                out["violations"].append(dict(kind="overlap", subject=e.path, other=o.path, required_m=0.0,
                                              actual_m=-round(penetration(e.rect(), o.rect()), 3), message=f"{e.name} overlaps {o.name}"))
        for w in walls:
            if e.z <= 0.5 and penetration(e.rect(), w.rect()) > 1e-3:
                out["violations"].append(dict(kind="overlap", subject=e.path, other=w.path, required_m=0.0,
                                              actual_m=-round(penetration(e.rect(), w.rect()), 3), message=f"{e.name} intersects {w.name}"))

    # 1b. 屋頂設備不得懸出屋頂（容許 layout:overhangToleranceM；步驟 6 的瀏覽器檢視抓到過乾冷卻器浮在屋頂外）
    roofs = getattr(collect, "roofs", [])
    for e in equip:
        if e.z <= 0.5 or not roofs: continue
        under = [r for r in roofs if overlap(r.rect(), e.rect())]
        if not under:
            out["violations"].append(dict(kind="overhang", subject=e.path, other=roofs[0].path, required_m=0.0, actual_m=0.0,
                                          message=f"{e.name} is elevated but not on any roof")); continue
        r = max(under, key=lambda r: penetration(r.rect(), e.rect())); rr = r.rect()
        over = max(rr[0] - e.xmin, e.xmax - rr[1], rr[2] - e.ymin, e.ymax - rr[3], 0.0)
        if over > r.tol + 1e-3:
            out["violations"].append(dict(kind="overhang", subject=e.path, other=r.path, required_m=r.tol, actual_m=-round(over, 3),
                                          message=f"{e.name} overhangs the roof by {over:.2f} m (tolerance {r.tol:.2f} m)"))

    # 2. 乾冷卻器再循環：進風面中心到最近熱排風的 3D 距離
    for e in equip:
        if not e.prim.GetName().startswith("DryCooler"): continue
        fx, fy, fz = e.face_center(+1)
        # 熱源：排風口 + 其他乾冷卻器的排風（風扇朝上的取頂部中心，否則取背面中心）
        # 同一個 POD 散熱模組裡的鄰機不算（模組設計已含）；疊放時熱源是「其他 POD」的乾冷卻器與排風口
        mine = _pod(e.prim)
        cands = list(exhausts) + [(o.path, o.top_center() if _attr(o.prim, "thermal:exhaustDirection") == "+z" else o.face_center(-1))
                                  for o in equip if o is not e and o.prim.GetName().startswith("DryCooler") and (mine is None or _pod(o.prim) != mine)]
        if not cands:
            out["recirculation"][e.path] = dict(k=0.0, distance_m=None, source=None); continue
        src, (x, y, z) = min(cands, key=lambda c: math.dist((fx, fy, fz), c[1]))
        d = math.dist((fx, fy, fz), (x, y, z))
        out["recirculation"][e.path] = dict(k=recirculation_k(d), distance_m=round(d, 2), source=src)

    # 3. 容量：液冷熱 = Σ 機櫃 liquidCooling × 負載率
    pod = stage.GetPrimAtPath(pod_path); util = float(_attr(pod, "aif:spec:itUtilization", 0.9))
    racks = [e for e in equip if e.prim.GetName().startswith("Rack")]
    q_liq = sum(float(_attr(r.prim, "aif:spec:liquidCooling", 116.0)) for r in racks) * util
    q_total = sum((float(_attr(r.prim, 'aif:spec:maxPowerDcTdp', 0) or 0) for r in racks)) * util or q_liq   # 冰水機容量用（液冷 + 氣冷）
    import collections
    n_by_class = collections.Counter(e.prim.GetName().rsplit("_", 1)[0] for e in equip)
    seen = set()
    for e in equip:
        cls = e.prim.GetName().rsplit("_", 1)[0]
        if cls in seen: continue
        cap = None; label = None
        if e.prim.GetName().startswith("DryCooler"):
            cap = _attr(e.prim, "aif:spec:maximumCoolingCapacity") or _attr(e.prim, "aif:spec:nominalCoolingCapacity"); label = "aif:spec:maximumCoolingCapacity"
        elif e.prim.GetName().startswith("CDU"):
            cap = _attr(e.prim, "aif:spec:nominalCoolingCapacity"); label = "aif:spec:nominalCoolingCapacity"
        elif e.prim.GetName().startswith("Chiller") and _attr(e.prim, "aif:spec:nominalCoolingCapacity"):
            cap = _attr(e.prim, "aif:spec:nominalCoolingCapacity"); label = "aif:spec:nominalCoolingCapacity"
        if cap:
            load = q_total if e.prim.GetName().startswith("Chiller") else q_liq        # 冰水機接全部排熱（液冷 + 氣冷）
            n = math.ceil(load / float(cap)); have = n_by_class[e.prim.GetName().rsplit("_", 1)[0]]
            seen.add(cls)
            out["capacity"].append(dict(subject=e.path, capacity_kw=float(cap), load_kw=round(load, 1), units_needed=n, units_present=have, source=label,
                                        ok=have >= n, message=f"{cls}: {load:.0f} kW heat vs {float(cap):.0f} kW per unit → {n} unit(s) needed, {have} present"))
    out["summary"] = dict(violations=len(out["violations"]), racks=len(racks), q_liq_kw=round(q_liq, 1),
                          capacity_short=[c["subject"] for c in out["capacity"] if not c["ok"]])
    return out


def write_checks(stage, result, variants: dict, layer=None):
    """寫到 /World/Checks/<variant 組合>/...（獨立層）。"""
    name = "__".join(f"{k}_{v}" for k, v in sorted(variants.items())).replace(".", "p").replace("-", "_") or "current"
    if layer is not None: stage.SetEditTarget(Usd.EditTarget(layer))
    UsdGeom.Scope.Define(stage, CHECKS_PATH)
    grp = stage.DefinePrim(f"{CHECKS_PATH}/{name}", "Scope")
    def setv(prim, n, v, t): prim.CreateAttribute(n, t, custom=True).Set(v)
    for k, v in variants.items(): setv(grp, f"check:variant:{k}", str(v), Sdf.ValueTypeNames.String)
    setv(grp, "check:violations", int(result["summary"]["violations"]), Sdf.ValueTypeNames.Int)
    setv(grp, "check:racks", int(result["summary"]["racks"]), Sdf.ValueTypeNames.Int)
    setv(grp, "check:liquidHeatKw", float(result["summary"]["q_liq_kw"]), Sdf.ValueTypeNames.Float)
    for i, v in enumerate(result["violations"]):
        p = stage.DefinePrim(f"{grp.GetPath()}/Violation_{i+1:02d}", "Scope")
        setv(p, "check:kind", v["kind"], Sdf.ValueTypeNames.Token); setv(p, "check:message", v["message"], Sdf.ValueTypeNames.String)
        setv(p, "check:requiredM", float(v["required_m"]), Sdf.ValueTypeNames.Float); setv(p, "check:actualM", float(v["actual_m"]), Sdf.ValueTypeNames.Float)
        p.CreateRelationship("check:subject", custom=True).SetTargets([Sdf.Path(v["subject"])])
        p.CreateRelationship("check:other", custom=True).SetTargets([Sdf.Path(v["other"])])
    for path, r in result["recirculation"].items():
        p = stage.DefinePrim(f"{grp.GetPath()}/Recirculation_{safe(relname(stage.GetPrimAtPath(path)))}", "Scope")
        setv(p, "check:recirculationK", float(r["k"]), Sdf.ValueTypeNames.Float)
        if r["distance_m"] is not None: setv(p, "check:exhaustDistanceM", float(r["distance_m"]), Sdf.ValueTypeNames.Float)
        p.CreateRelationship("check:subject", custom=True).SetTargets([Sdf.Path(path)])
        if r["source"]: p.CreateRelationship("check:other", custom=True).SetTargets([Sdf.Path(r["source"])])
    for c in result["capacity"]:
        p = stage.DefinePrim(f"{grp.GetPath()}/Capacity_{safe(relname(stage.GetPrimAtPath(c['subject'])))}", "Scope")
        setv(p, "check:capacityKw", c["capacity_kw"], Sdf.ValueTypeNames.Float); setv(p, "check:loadKw", c["load_kw"], Sdf.ValueTypeNames.Float)
        setv(p, "check:unitsNeeded", int(c["units_needed"]), Sdf.ValueTypeNames.Int); setv(p, "check:unitsPresent", int(c["units_present"]), Sdf.ValueTypeNames.Int); setv(p, "check:ok", bool(c["ok"]), Sdf.ValueTypeNames.Bool)
        setv(p, "check:message", c["message"], Sdf.ValueTypeNames.String)
        p.CreateRelationship("check:subject", custom=True).SetTargets([Sdf.Path(c["subject"])])
    return grp


def open_checks_layer(stage):
    rl = Sdf.Layer.FindOrOpen(str(CHECKS_LAYER)) if CHECKS_LAYER.exists() else None
    if rl is None: rl = Sdf.Layer.CreateNew(str(CHECKS_LAYER))
    else: rl.Clear()
    rl.comment = "DSX POD 佈局 / 淨空 / 再循環 / 容量檢查（dsxpod/layout.py 產生，可整層刪除重跑）"
    root = stage.GetRootLayer(); r = os.path.relpath(CHECKS_LAYER, Path(root.realPath).parent).replace(os.sep, "/")
    if r not in root.subLayerPaths: root.subLayerPaths.insert(0, r)
    return rl


def print_result(res):
    s = res["summary"]
    print(f"設備 {res['n_equipment']} 件，機櫃 {s['racks']}，液冷熱 {s['q_liq_kw']:.0f} kW，違規 {s['violations']} 項")
    for v in res["violations"]: print("  ✗", v["message"])
    for path, r in res["recirculation"].items():
        print(f"  ↻ {path.split('/World/Plant/')[-1]}: 進風距最近熱排風 {r['distance_m']} m（{r['source'].split('/World/Plant/')[-1] if r['source'] else '—'}）→ 再循環 +{r['k']:g} K")
    for c in res["capacity"]: print("  " + ("✓" if c["ok"] else "✗"), c["message"])


if __name__ == "__main__":
    from .usd_out import OUT
    from .stage_io import current_variants, set_variants
    ap = argparse.ArgumentParser(); ap.add_argument("--cooling"); ap.add_argument("--site"); ap.add_argument("--no-write", action="store_true")
    a = ap.parse_args()
    st = Usd.Stage.Open(str(OUT))
    set_variants(st, site=a.site, cooling=a.cooling)
    sel = current_variants(st); print("變體：", sel)
    res = analyze(st); print_result(res)
    if not a.no_write:
        rl = open_checks_layer(st); write_checks(st, res, {"cooling": sel.get("cooling", "")}, layer=rl); rl.Save(); st.GetRootLayer().Save()
        print(f"→ {CHECKS_LAYER.name}（已 sublayer 進 pod.usda）")
