"""本機後端（同一個 app 也可當 Vercel Python 函式）：伺服前端 web/、提供匯出與（本機才有的）精確模擬。

端點：
  GET  /api/health                  → {ok, geometry, weather_cache, grid}；輕量（不載入 pxr），CDN 快取 1 小時；?deep=1 才回 USD 版本
  GET  /api/export?site=&product=&sku=&units=|site_l=&site_w=&cooling=&supply=
                                    → application/zip；網址是標準形（參數固定、規模用單元數），CDN 快取到下次部署，
                                      同樣的匯出第二次起不跑函式；給 mw 或非整數基地會 307 轉到標準網址
  POST /api/export                  → 同上（舊介面、測試用；不經 CDN 快取）
       body: {site, mw | units | site_l+site_w, cooling, supply, include_proxy?}
  流量保護（Vercel 免費層：Active CPU 每月 4 小時最緊）：同一實例內每個 IP 10 分鐘最多 RATE_PER_IP 次、全實例 RATE_GLOBAL 次
  實際算的匯出（快取命中不算），超過回 429；同一實例一次只跑一個匯出。只在 Vercel 上啟用。
  POST /api/simulate                → 精確 20 年逐時（需要氣象快取；Vercel 上回 501，前端用預算表即可）
  GET  /                            → web/index.html（以及 web/ 底下的靜態檔）

啟動：.venv\Scripts\python.exe -m dsxpod.server   → http://127.0.0.1:8765
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
from typing import Optional
import math, os, threading, time
from collections import deque
from urllib.parse import urlencode
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
# 前端目錄：本機是 web/；Vercel 部署包放在 public/（後端框架模式下 public/ 由 CDN 直接提供，這裡是保險）
WEB = next((d for d in (ROOT / "web", ROOT / "public") if (d / "index.html").exists()), ROOT / "web")
GRID_JSON = next((d / "data" / "results_grid.json" for d in (ROOT / "web", ROOT / "public") if (d / "data" / "results_grid.json").exists()), ROOT / "web" / "data" / "results_grid.json")
app = FastAPI(title="DSX POD MVP", version="0.1")


class Req(BaseModel):
    site: str = "johor"
    mw: Optional[float] = None
    site_l: Optional[float] = None
    site_w: Optional[float] = None
    cooling: str = "dry_only"
    supply: str = "t45"
    include_proxy: bool = False
    geometry: Optional[str] = None          # box / vertiv / full；None = 這台伺服器能打包的最完整等級
    product: str = "dsx_pod"                # dsx_pod / gadu
    sku: Optional[str] = None               # GADU 機櫃型號（products.py 的鍵）
    units: Optional[int] = None             # 單元數（標準形；= mw / 每單元 MW 取整）


ON_VERCEL = bool(os.environ.get("VERCEL"))
RATE_WINDOW_S, RATE_PER_IP, RATE_GLOBAL = 600, 10, 60
_hits: dict = {}                            # ip → deque[時間]
_all = deque()
_export_lock = threading.Lock()             # 同一實例一次一個匯出（usd_out 有模組層級狀態，也避免 CPU 尖峰）
CDN_FOREVER = "public, max-age=0, s-maxage=31536000"   # Vercel CDN 快取到下次部署（部署會清快取）；瀏覽器不快取


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip") or ""
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "?")


def _rate_limit(request: Request):
    """盡力而為的頻率限制（記憶體、單一實例）；真正的防線是 Vercel WAF 規則（見 notes/dsx-pod-deploy.md）。"""
    if not ON_VERCEL: return
    now = time.time(); ip = _client_ip(request)
    q = _hits.setdefault(ip, deque())
    for d in (q, _all):
        while d and now - d[0] > RATE_WINDOW_S: d.popleft()
    if len(q) >= RATE_PER_IP or len(_all) >= RATE_GLOBAL:
        oldest = q[0] if len(q) >= RATE_PER_IP else _all[0]
        retry = int(RATE_WINDOW_S - (now - oldest)) + 1
        raise HTTPException(429, "too many exports, try again later", headers={"Retry-After": str(max(1, retry))})
    q.append(now); _all.append(now)
    if len(_hits) > 5000: _hits.clear()     # 防止記憶體無限長


@app.get("/api/health")
def health(deep: int = 0):
    """預設輕量：不載入 pxr（冷啟動省好幾秒 CPU），CDN 快取 1 小時。?deep=1 才檢查 usd-core（部署診斷）。"""
    out = dict(ok=True, geometry="box" if ON_VERCEL else None, weather_cache=(ROOT / "data" / "weather" / "johor_2005_2024.csv").exists(), grid=GRID_JSON.exists())
    if not ON_VERCEL or deep:
        from .export import available_geometry
        out["geometry"] = available_geometry()
    if deep:
        try:
            from pxr import Usd
            out["usd"] = ".".join(map(str, Usd.GetVersion()))
        except Exception as e:
            out["usd"] = f"ERROR {type(e).__name__}: {e}"[:300]
    return JSONResponse(out, headers={"Cache-Control": "no-store" if deep else "public, max-age=60, s-maxage=3600"})


def _check(req: Req):
    """輸入驗證：不合法回 400 與明確訊息（不要讓 KeyError 變成 500）。"""
    from .weather import SITES
    from .products import PRODUCTS
    if req.site not in SITES: raise HTTPException(400, f"unknown site '{req.site}' (one of {', '.join(SITES)})")
    if req.product not in PRODUCTS: raise HTTPException(400, f"unknown product '{req.product}' (one of {', '.join(PRODUCTS)})")
    if req.sku is not None and req.sku not in PRODUCTS[req.product]["skus"]:
        raise HTTPException(400, f"unknown sku '{req.sku}' for {req.product} (one of {', '.join(PRODUCTS[req.product]['skus'])})")
    if req.mw is None and req.units is None and (req.site_l is None or req.site_w is None): raise HTTPException(400, "give units, mw, or site_l and site_w")
    for k in ("mw", "site_l", "site_w", "units"):
        v = getattr(req, k)
        if v is not None and not (v > 0 and math.isfinite(v)): raise HTTPException(400, f"{k} must be a positive number")
    if req.units is not None:
        from . import sizing
        cap = int(sizing.MAX_MW / sizing.unit_spec(req.product, req.sku)["mw"] + 1e-9)
        if req.units > cap: raise HTTPException(400, f"units must be at most {cap} (1 GW)")


def _canonical(req: Req) -> dict:
    """匯出的標準參數（決定 CDN 快取鍵）：固定順序；電量換成單元數（輸出只取決於單元數）；基地取整數公尺。"""
    from . import sizing
    q = dict(site=req.site, product=req.product)
    if req.product != "dsx_pod" and req.sku: q["sku"] = req.sku
    if req.units is not None or req.mw is not None:
        U = sizing.unit_spec(req.product, req.sku); cap = int(sizing.MAX_MW / U["mw"] + 1e-9)
        q["units"] = req.units if req.units is not None else max(1, min(math.ceil(min(req.mw, sizing.MAX_MW) / U["mw"] - 1e-9), cap))
    else:
        q["site_l"], q["site_w"] = round(min(req.site_l, sizing.MAX_SIDE_M)), round(min(req.site_w, sizing.MAX_SIDE_M))
    q["cooling"], q["supply"] = req.cooling, req.supply
    return q


@app.get("/api/export")
def export_get(request: Request, site: str = "johor", product: str = "dsx_pod", sku: Optional[str] = None, units: Optional[int] = None,
               mw: Optional[float] = None, site_l: Optional[float] = None, site_w: Optional[float] = None, cooling: str = "dry_only", supply: str = "t45"):
    req = Req(site=site, product=product, sku=sku, units=units, mw=mw, site_l=site_l, site_w=site_w, cooling=cooling, supply=supply)
    _check(req)
    canon = _canonical(req)
    if dict(request.query_params) != {k: str(v) for k, v in canon.items()}:   # 不是標準網址：轉過去（便宜），同一個匯出共用一份 CDN 快取
        return RedirectResponse("/api/export?" + urlencode(canon), status_code=307, headers={"Cache-Control": CDN_FOREVER})
    return _export(req, request, cache=True)


@app.post("/api/export")
def export(req: Req, request: Request):
    _check(req)
    return _export(req, request, cache=False)


def _export(req: Req, request: Request, cache: bool):
    _rate_limit(request)
    mw = req.mw
    if req.units is not None:
        from . import sizing
        mw = req.units * sizing.unit_spec(req.product, req.sku)["mw"]
    try:
        from .export import export_package
        with _export_lock:
            data, meta = export_package(req.site, mw=mw, site_l=req.site_l, site_w=req.site_w, cooling=req.cooling, supply=req.supply, include_proxy=req.include_proxy or None, geometry=req.geometry, product=req.product, sku=req.sku)
    except (AssertionError, ValueError) as e:
        raise HTTPException(400, str(e))
    except Exception as e:                                   # traceback 只寫日誌（Vercel 函式日誌看得到），不回傳給用戶端
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": f"export failed ({type(e).__name__})"}, status_code=500)
    size = f"{req.units}units" if req.units is not None else f"{req.mw:g}MW" if req.mw else f"{req.site_l:g}x{req.site_w:g}m"
    name = f"{req.product}{'_' + req.sku if req.product == 'gadu' and req.sku else ''}_{req.site}_{size}_{req.cooling}_{req.supply}.zip"
    headers = {"Content-Disposition": f'attachment; filename="{name}"', "X-Export-Meta": str(meta).replace("\n", " ").encode("ascii", "replace").decode("ascii")}
    if cache: headers["Cache-Control"] = CDN_FOREVER
    return Response(data, media_type="application/zip", headers=headers)


@app.post("/api/simulate")
def simulate(req: Req):
    if not (ROOT / "data" / "weather" / f"{req.site}_2005_2024.csv").exists():
        raise HTTPException(501, "這台伺服器沒有氣象快取；前端請用預算結果表")
    from .engine import simulate as sim
    r = sim(req.site, mw=req.mw, site_l=req.site_l, site_w=req.site_w, cooling=req.cooling, supply=req.supply, write_stage=False)
    r.pop("annual", None)
    return JSONResponse(r)


if (WEB / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(WEB), html=True), name="web")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
