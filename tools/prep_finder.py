"""Analog Finder: scan the Arabian Peninsula on a 0.1-degree grid and score every cell
for three planetary analog archetypes, using only open data.

Inputs (downloaded here):
  - Elevation  : AWS Terrain Tiles (terrarium, SRTM-based), zoom 7 (~1.1 km pixels)
  - Surface    : NASA GIBS Blue Marble Next Generation (MODIS composite), 0.02-degree pixels
  - Vegetation : NASA MODIS Terra NDVI (8-day, via GIBS), decoded to real NDVI values with the
                 GIBS colormap; the greenest of four seasons (2025) is used
  - Climate    : NASA POWER climatology, regional endpoint (0.5 x 0.625 degree grid)
Outputs:
  - assets/finder/<layer>.png   colour heat layers (overall, volcanic, dune, rugged)
  - assets/finder/finder.json   bbox, candidates, validation against the six field sites

Run:  python tools/prep_finder.py
"""
import io, json, math, os, time, urllib.request
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "finder"); os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "mars-in-arabia-hackathon/1.0"}
LAT0, LAT1, LON0, LON1 = 16.0, 32.5, 34.5, 56.5
FINE = 0.02    # analysis pixel (deg)
CELL = 0.1     # output cell (deg)

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                return r.read()
        except Exception:
            if i == tries - 1: raise
            time.sleep(2 * (i + 1))

# ---------- fine lat/lon grid (row 0 = north) ----------
lats = np.arange(LAT1 - FINE / 2, LAT0, -FINE)
lons = np.arange(LON0 + FINE / 2, LON1, FINE)
LON, LAT = np.meshgrid(lons, lats)
H, W = LAT.shape

# ---------- elevation ----------
Z = 7
def merc(lon, lat, z):
    n = 256 * 2 ** z
    s = np.sin(np.radians(lat))
    return (lon + 180) / 360 * n, (0.5 - np.log((1 + s) / (1 - s)) / (4 * np.pi)) * n
px, py = merc(LON, LAT, Z)
tx0, tx1 = int(px.min() // 256), int(px.max() // 256)
ty0, ty1 = int(py.min() // 256), int(py.max() // 256)
mos = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), np.float32)
for tx in range(tx0, tx1 + 1):
    for ty in range(ty0, ty1 + 1):
        a = np.asarray(Image.open(io.BytesIO(get(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png"))).convert("RGB")).astype(np.float32)
        mos[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
ix = np.clip((px - tx0 * 256).astype(int), 0, mos.shape[1] - 1)
iy = np.clip((py - ty0 * 256).astype(int), 0, mos.shape[0] - 1)
elev = mos[iy, ix]
print("elevation ok", elev.min(), elev.max())
dy = FINE * 111320.0
dx = FINE * 111320.0 * np.cos(np.radians(LAT))
gy, gx = np.gradient(elev)
slope = np.degrees(np.arctan(np.hypot(gx / dx, gy / dy)))

# ---------- surface colour (Blue Marble) ----------
bm = Image.open(io.BytesIO(get(
    "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
    f"&LAYERS=BlueMarble_NextGeneration&CRS=EPSG:4326&BBOX={LAT0},{LON0},{LAT1},{LON1}&WIDTH={W}&HEIGHT={H}&FORMAT=image/png"))).convert("RGB")
rgb = np.asarray(bm).astype(np.float32) / 255.0
R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
bright = (R + G + B) / 3
green = np.clip((G - R) / (R + G + B + 1e-6) * 3, 0, 1)          # vegetation tint
water = (B > R + 0.02) & (bright < 0.35) | (elev <= 0.5)
# ---------- vegetation (MODIS NDVI, decoded exactly from the GIBS colormap) ----------
import re
cmx = get("https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_NDVI.xml").decode()
lut = {}
for m in re.finditer(r'<ColorMapEntry rgb="(\d+),(\d+),(\d+)"[^>]*value="\[([-0-9.]+),([-0-9.]+)\)"', cmx):
    r_, g_, b_, lo_, hi_ = m.groups(); lut[(int(r_) << 16) | (int(g_) << 8) | int(b_)] = (float(lo_) + float(hi_)) / 2
ndvi = np.zeros((H, W), np.float32)
for day in ("2025-03-14", "2025-06-10", "2025-09-14", "2025-12-11"):
    im = Image.open(io.BytesIO(get(
        "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
        f"&LAYERS=MODIS_Terra_NDVI_8Day&TIME={day}&CRS=EPSG:4326&BBOX={LAT0},{LON0},{LAT1},{LON1}&WIDTH={W}&HEIGHT={H}&FORMAT=image/png"))).convert("RGBA")
    a_ = np.asarray(im).astype(np.int64)
    key = (a_[..., 0] << 16) | (a_[..., 1] << 8) | a_[..., 2]
    v_ = np.vectorize(lambda k: lut.get(k, 0.0), otypes=[np.float32])(key)
    v_[a_[..., 3] == 0] = 0.0                           # no data / water
    ndvi = np.maximum(ndvi, v_)
print("ndvi ok, decoded share", float((ndvi > 0).mean()))

# ---------- climate (NASA POWER regional) ----------
pts = {}
for la0, la1 in [(LAT0, 25.5), (25.5, LAT1)]:
    for lo0, lo1 in [(LON0, 44.5), (44.5, 54.5), (52.5, LON1)]:
        got = {}
        for par in ["PRECTOTCORR", "T2M_MAX", "T2M_MIN"]:  # the regional endpoint takes one parameter per call
            u = ("https://power.larc.nasa.gov/api/temporal/climatology/regional?"
                 f"latitude-min={la0}&latitude-max={la1}&longitude-min={lo0}&longitude-max={lo1}"
                 f"&parameters={par}&community=RE&format=JSON")
            for f in json.loads(get(u))["features"]:
                lo, la = f["geometry"]["coordinates"][:2]; v = f["properties"]["parameter"][par]
                ms = [k for k in v if k != "ANN"]
                key = (round(la, 3), round(lo, 3))
                got.setdefault(key, {})[par] = (v["ANN"] * 365 if par == "PRECTOTCORR" else
                                                 max(v[m] for m in ms) if par == "T2M_MAX" else min(v[m] for m in ms))
        for k, d in got.items():
            if len(d) == 3: pts[k] = (d["PRECTOTCORR"], d["T2M_MAX"], d["T2M_MIN"])
plat = np.array([k[0] for k in pts]); plon = np.array([k[1] for k in pts]); pval = np.array(list(pts.values()))
print("climate points", len(pts))

# ---------- aggregate to 0.1-degree cells ----------
f = int(round(CELL / FINE))
h2, w2 = H // f, W // f
def block(a, fn):
    return fn(a[:h2 * f, :w2 * f].reshape(h2, f, w2, f), axis=(1, 3))
c_lat = block(LAT, np.mean); c_lon = block(LON, np.mean)
c_slope = block(slope, np.mean); c_rough = block(slope, np.std)
c_relief = block(elev, np.max) - block(elev, np.min)
c_bright = block(bright, np.mean); c_ndvi = block(ndvi, np.mean)
c_water = block(water.astype(np.float32), np.mean)
c_elev = block(elev, np.mean)
# nearest POWER point per cell
d = (c_lat[..., None] - plat) ** 2 + ((c_lon[..., None] - plon) * 0.8) ** 2
nn = d.argmin(-1)
c_rain, c_tmax, c_tmin = pval[nn, 0], pval[nn, 1], pval[nn, 2]

# ---------- archetype scores (0..1) ----------
cl = lambda v: np.clip(v, 0, 1)
gauss = lambda x, mu, sd: np.exp(-0.5 * ((x - mu) / sd) ** 2)
arid = cl(1 - c_rain / 120.0)                       # 0 mm -> 1, >=120 mm/yr -> 0
bare = cl(1 - (c_ndvi - 0.10) / 0.15)                # MODIS NDVI: <=0.10 bare desert, >=0.25 vegetated
land = cl(1 - c_water * 2.5)
# keep the Arabian Peninsula only: drop cells west of the Red Sea axis
redsea = c_lon < 34.6 + (27.9 - c_lat) * (42.0 - 34.6) / (27.9 - 15.0)
land = np.where(redsea, 0.0, land)
base = arid * bare * land
dark = cl((0.42 - c_bright) / 0.2)                  # basalt fields are dark in Blue Marble
light = cl((c_bright - 0.42) / 0.18)
volcanic = base * (0.65 * dark + 0.35 * gauss(c_slope, 4.5, 3.5))
plains = base * gauss(c_slope, 1.0, 1.4) * (0.55 + 0.45 * light)   # smooth arid plains: landing-site analogs
rugged = base * gauss(c_slope, 13, 6) * cl(c_relief / 500)
# calibrate each archetype to its own 99th percentile over land so the three are comparable
_m = land > 0.5
volcanic, plains, rugged = [cl(L / max(1e-6, np.percentile(L[_m], 99.9))) for L in (volcanic, plains, rugged)]
overall = np.maximum.reduce([volcanic, plains, rugged])
layers = {"overall": overall, "volcanic": volcanic, "plains": plains, "rugged": rugged}

# ---------- colour layers ----------
ramp = np.array([[0.20, 0.08, 0.04], [0.55, 0.18, 0.07], [0.80, 0.33, 0.14], [0.95, 0.62, 0.32], [1.0, 0.92, 0.74]])
def colour(v):
    v = cl(v); t = v * (len(ramp) - 1); i = np.clip(t.astype(int), 0, len(ramp) - 2); fr = (t - i)[..., None]
    c = ramp[i] * (1 - fr) + ramp[i + 1] * fr
    a = cl((v - 0.42) / 0.38) ** 0.8 * 0.95
    return (np.dstack([c, a[..., None]]) * 255).astype(np.uint8)
def smooth(v):  # light 3x3 blur so the heat map reads as a surface, not pixels
    p = np.pad(v, 1, mode="edge")
    return sum(p[i:i + v.shape[0], j:j + v.shape[1]] * w for (i, j), w in
               zip([(i, j) for i in range(3) for j in range(3)], [1, 2, 1, 2, 4, 2, 1, 2, 1])) / 16
for k, v in layers.items():
    Image.fromarray(colour(np.clip(smooth(v), 0, 1)), "RGBA").resize((w2 * 8, h2 * 8), Image.BICUBIC).save(os.path.join(OUT, f"{k}.png"), optimize=True)

# ---------- validation against the six field sites ----------
sites = json.load(open(os.path.join(ROOT, "tools", "sites.json"), encoding="utf-8"))
def cell_of(lat, lon):
    return int((LAT1 - lat) / CELL), int((lon - LON0) / CELL)
ARCH = {"khaybar": "volcanic", "jirsan": "volcanic", "rahat": "volcanic", "wahbah": "volcanic", "rub": "plains", "wabar": "plains"}
val = []
for s in sites:
    r, c = cell_of(s["lat"], s["lng"]); kind = ARCH[s["id"]]; L = layers[kind]
    v = float(L[max(0, r - 1):r + 2, max(0, c - 1):c + 2].max())   # best of the 3x3 neighbourhood (~30 km)
    pct = float((L[land > 0.5] < v).mean() * 100)
    val.append({"id": s["id"], "name": s["name"], "kind": kind, "score": round(v * 100), "percentile": round(pct, 1)})

# ---------- candidates: local maxima, away from the six known sites ----------
NAMED = [  # approximate centres of named volcanic fields / features (for labelling only)
    ("Harrat Lunayyir", 25.17, 37.75), ("Harrat Uwayrid", 27.08, 37.25), ("Harrat Ithnayn", 26.58, 40.20),
    ("Harrat al Birk", 18.37, 41.63), ("Harrat Kishb", 22.80, 41.38), ("Harrat Hutaymah", 26.00, 42.25),
    ("Harrat Rahat", 23.20, 39.75), ("Harrat Khaybar", 25.70, 39.95), ("Harrat Nawasif", 21.70, 42.10),
    ("Harrat ash Shaam (Harrah)", 30.80, 38.30), ("Harrat Hadan", 21.40, 41.40), ("Harrat Hammah", 25.80, 38.10), ("Harrat ar Rahah", 28.00, 36.40),
    ("Jabal Tuwaiq escarpment", 23.80, 46.30), ("Rub' al Khali", 20.50, 51.00), ("Al Nafud", 28.30, 41.00),
    ("Ad Dahna", 25.00, 47.50), ("Hisma plateau", 28.80, 36.30), ("Al Jafurah", 24.50, 49.50),
]
def near_name(lat, lon):
    best, bd = None, 1e9
    for n, a, b in NAMED:
        dkm = math.hypot((lat - a) * 111, (lon - b) * 111 * math.cos(math.radians(lat)))
        if dkm < bd: best, bd = n, dkm
    return (f"near {best}" if bd < 70 else "unnamed area"), round(bd)
cands = []
for kind, L in [("volcanic", volcanic), ("plains", plains), ("rugged", rugged)]:
    A = L.copy()
    for s in sites:  # suppress the known sites
        r, c = cell_of(s["lat"], s["lng"]); A[max(0, r - 5):r + 6, max(0, c - 5):c + 6] = 0
    for _ in range(4):
        r, c = np.unravel_index(A.argmax(), A.shape)
        if A[r, c] < 0.45: break
        lat, lon = float(c_lat[r, c]), float(c_lon[r, c])
        label, dkm = near_name(lat, lon)
        cands.append({"kind": kind, "lat": round(lat, 2), "lng": round(lon, 2), "score": round(float(L[r, c]) * 100),
                      "label": label, "elev": round(float(c_elev[r, c])), "slope": round(float(c_slope[r, c]), 1),
                      "rain": round(float(c_rain[r, c])), "tmax": round(float(c_tmax[r, c]), 1)})
        A[max(0, r - 8):r + 9, max(0, c - 8):c + 9] = 0
cands.sort(key=lambda x: -x["score"])

meta = {
    "generated": time.strftime("%Y-%m-%d"), "bbox": [LAT0, LON0, LAT1, LON1], "cell": CELL,
    "cells": int(h2 * w2), "landCells": int((land > 0.5).sum()),
    "validation": val, "candidates": cands,
    "weights": {"aridity": "1 - rain/120 mm", "vegetation": "MODIS NDVI (greenest of 4 seasons, 2025): bare <= 0.10, vegetated >= 0.25", "volcanic": "0.65 darkness + 0.35 moderate slope",
                "plains": "very gentle slope x brightness", "rugged": "steep slope x local relief"},
}
json.dump(meta, open(os.path.join(OUT, "finder.json"), "w", encoding="utf-8"), indent=1)
print("cells", h2 * w2, "validation", val)
print("top candidates", cands[:8])

# ---------- re-project heat layers to Web Mercator rows (so they align on a slippy map) ----------
def to_merc_rows(path):
    im = np.asarray(Image.open(path)); h = im.shape[0]
    my = lambda la: math.log(math.tan(math.pi / 4 + math.radians(la) / 2))
    y0, y1 = my(LAT1), my(LAT0)
    out = np.empty_like(im)
    for r in range(h):
        y = y0 + (y1 - y0) * (r + 0.5) / h
        la = math.degrees(2 * math.atan(math.exp(y)) - math.pi / 2)
        out[r] = im[min(h - 1, max(0, int((LAT1 - la) / (LAT1 - LAT0) * h)))]
    Image.fromarray(out).save(path, optimize=True)
for k in layers:
    to_merc_rows(os.path.join(OUT, f"{k}.png"))
print("mercator ok")
