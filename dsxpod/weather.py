"""抓取並快取場址的逐時氣象（Open-Meteo Historical API，ERA5 再分析，免費、不需 key），
計算濕球溫度，並依 NOAA ONI 為每個月貼 ENSO 標籤。

用法：
  .venv\Scripts\python.exe dsxpod\weather.py                 # 抓預設六個場址 2005-2024
  .venv\Scripts\python.exe dsxpod\weather.py --sites taoyuan   # 只抓一個
  .venv\Scripts\python.exe dsxpod\weather.py --start 1985 --end 2004   # 趨勢對照組
輸出：data/weather/<site>_<start>_<end>.csv（UTC 逐時：乾球、相對濕度、露點、濕球、風速、日照、氣壓）
      data/weather/oni.csv（NOAA ONI 月表）
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
import argparse, csv, io, math, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "weather"; OUT.mkdir(parents=True, exist_ok=True)

# 六個示範場址（2026-10-25 定案）
SITES = {
    "taoyuan":  dict(name="桃園（台灣）",        lat=25.00, lon=121.30, tz="Asia/Taipei",      climate="亞熱帶濕熱"),
    "johor":    dict(name="柔佛 Sedenak（馬來西亞）", lat=1.62, lon=103.57, tz="Asia/Kuala_Lumpur", climate="赤道濕熱"),
    "phoenix":  dict(name="鳳凰城（美國亞利桑那）", lat=33.45, lon=-112.07, tz="America/Phoenix",  climate="沙漠乾熱"),
    "dallas":   dict(name="達拉斯（美國德州）",   lat=32.78, lon=-96.80, tz="America/Chicago",  climate="濕潤副熱帶、波動大"),
    "dublin":   dict(name="都柏林（愛爾蘭）",     lat=53.35, lon=-6.26, tz="Europe/Dublin",     climate="溫帶海洋"),
    "oslo":     dict(name="奧斯陸（挪威）",       lat=59.91, lon=10.75, tz="Europe/Oslo",       climate="寒帶"),
}
HOURLY = ["temperature_2m", "relative_humidity_2m", "dew_point_2m", "wind_speed_10m", "shortwave_radiation", "surface_pressure"]


def wet_bulb_c(t_c: float, rh: float) -> float:
    """Stull (2011) 經驗式，海平面附近 ±1 °C；資料中心選址比較夠用。"""
    rh = max(1.0, min(100.0, rh))
    return (t_c * math.atan(0.151977 * math.sqrt(rh + 8.313659))
            + math.atan(t_c + rh) - math.atan(rh - 1.676331)
            + 0.00391838 * rh ** 1.5 * math.atan(0.023101 * rh) - 4.686035)


def fetch_site(key: str, start: int, end: int, force=False) -> Path:
    site = SITES[key]
    out = OUT / f"{key}_{start}_{end}.csv"
    if out.exists() and not force:
        print(f"  已有快取 {out.name}"); return out
    url = ("https://archive-api.open-meteo.com/v1/archive"
           f"?latitude={site['lat']}&longitude={site['lon']}"
           f"&start_date={start}-01-01&end_date={end}-12-31"
           f"&hourly={','.join(HOURLY)}&timezone=UTC&format=csv")
    t0 = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": "dsxpod-weather/0.1"})
    raw = urllib.request.urlopen(req, timeout=300).read().decode("utf-8")
    # Open-Meteo 的 CSV 前幾行是 metadata，資料從 'time,' 開頭的那行起
    lines = raw.splitlines()
    start_idx = next(i for i, l in enumerate(lines) if l.startswith("time,"))
    rdr = csv.DictReader(io.StringIO("\n".join(lines[start_idx:])))
    rows = 0
    with open(out, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["time_utc", "t_db_c", "rh_pct", "t_dp_c", "t_wb_c", "wind_ms", "ghi_wm2", "p_hpa"])
        for r in rdr:
            try:
                t = float(r["temperature_2m (°C)"]); rh = float(r["relative_humidity_2m (%)"])
            except (KeyError, ValueError):
                continue
            dp = r.get("dew_point_2m (°C)", ""); ws = r.get("wind_speed_10m (km/h)", "")
            ghi = r.get("shortwave_radiation (W/m²)", ""); p = r.get("surface_pressure (hPa)", "")
            w.writerow([r["time"], t, rh, dp, round(wet_bulb_c(t, rh), 2),
                        round(float(ws) / 3.6, 2) if ws else "", ghi, p])
            rows += 1
    print(f"  {key:8s} {rows:7d} 小時  {out.stat().st_size/1e6:5.1f} MB  {time.time()-t0:4.0f}s")
    return out


def fetch_oni(force=False) -> Path:
    """NOAA Climate Prediction Center 的 ONI（Oceanic Niño Index）月表。"""
    out = OUT / "oni.csv"
    if out.exists() and not force:
        return out
    url = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
    raw = urllib.request.urlopen(url, timeout=60).read().decode("utf-8")
    with open(out, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh); w.writerow(["season", "year", "total", "anom", "phase"])
        for line in raw.splitlines()[1:]:
            parts = line.split()
            if len(parts) < 4:
                continue
            season, year, total, anom = parts[0], int(parts[1]), float(parts[2]), float(parts[3])
            phase = "El Nino" if anom >= 0.5 else "La Nina" if anom <= -0.5 else "Neutral"
            w.writerow([season, year, total, anom, phase])
    print(f"  ONI 月表 → {out.name}")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", default=",".join(SITES))
    ap.add_argument("--start", type=int, default=2005)
    ap.add_argument("--end", type=int, default=2024)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    print(f"場址：{a.sites}  年份：{a.start}-{a.end}")
    for k in a.sites.split(","):
        fetch_site(k.strip(), a.start, a.end, a.force)
        time.sleep(1.0)   # 禮貌性間隔，Open-Meteo 免費層有速率限制
    fetch_oni(a.force)
    print("完成。")
