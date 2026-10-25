"""本機後端（同一個 app 也可當 Vercel Python 函式）：伺服前端 web/、提供匯出與（本機才有的）精確模擬。

端點：
  GET  /api/health                  → {ok, weather_cache, grid}
  POST /api/export                  → application/zip（dsxpod.export.export_package）
       body: {site, mw | site_l+site_w, cooling, supply, include_proxy?}
  POST /api/simulate                → 精確 20 年逐時（需要氣象快取；Vercel 上回 501，前端用預算表即可）
  GET  /                            → web/index.html（以及 web/ 底下的靜態檔）

啟動：.venv\Scripts\python.exe -m dsxpod.server   → http://127.0.0.1:8765
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response, JSONResponse
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


@app.get("/api/health")
def health():
    return dict(ok=True, weather_cache=(ROOT / "data" / "weather" / "johor_2005_2024.csv").exists(), grid=GRID_JSON.exists())


@app.post("/api/export")
def export(req: Req):
    from .export import export_package
    try:
        data, meta = export_package(req.site, mw=req.mw, site_l=req.site_l, site_w=req.site_w, cooling=req.cooling, supply=req.supply, include_proxy=req.include_proxy)
    except (AssertionError, ValueError) as e:
        raise HTTPException(400, str(e))
    size = f"{req.mw:g}MW" if req.mw else f"{req.site_l:g}x{req.site_w:g}m"
    name = f"dsx_pod_{req.site}_{size}_{req.cooling}_{req.supply}.zip"
    return Response(data, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"', "X-Export-Meta": str(meta).replace("\n", " ")})


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
