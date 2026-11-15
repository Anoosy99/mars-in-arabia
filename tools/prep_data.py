"""Download and pre-process the real data the site uses.

Earth terrain : AWS Terrain Tiles (terrarium, SRTM-based elevation)
Earth imagery : Copernicus Sentinel-2 cloudless (EOX, s2cloudless 2020)
Earth climate : NASA POWER climatology API
Globes        : NASA GIBS Blue Marble (Earth), NASA Trek Viking MDIM2.1 (Mars), NASA Trek LRO WAC (Moon)
Twin imagery  : NASA Trek (Mars Viking MDIM2.1 colour, LRO WAC)

Run:  python tools/prep_data.py   (from the project root)
"""
import io, json, math, os, sys, time, urllib.request
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets")
os.makedirs(os.path.join(OUT, "sites"), exist_ok=True)
os.makedirs(os.path.join(OUT, "globes"), exist_ok=True)
UA = {"User-Agent": "mars-in-arabia-hackathon/1.0"}

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))

def img(url):
    return Image.open(io.BytesIO(get(url))).convert("RGB")

# ---------- sites ----------
SITES = json.load(open(os.path.join(ROOT, "tools", "sites.json"), encoding="utf-8"))

def lonlat_to_px(lon, lat, z):
    n = 256 * 2 ** z
    x = (lon + 180) / 360 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y

def mosaic(lon0, lat0, lon1, lat1, z, url_fn, mode):
    x0, y0 = lonlat_to_px(lon0, lat1, z)
    x1, y1 = lonlat_to_px(lon1, lat0, z)
    tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
    W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    canvas = Image.new(mode, (W, H))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            t = Image.open(io.BytesIO(get(url_fn(z, tx, ty)))).convert(mode)
            canvas.paste(t, ((tx - tx0) * 256, (ty - ty0) * 256))
    box = (int(x0 - tx0 * 256), int(y0 - ty0 * 256), int(x1 - tx0 * 256), int(y1 - ty0 * 256))
    return canvas.crop(box)

def zoom_for(span_deg, target_px):
    return max(1, min(15, round(math.log2(target_px * 360 / (256 * span_deg)))))

terr = lambda z, x, y: f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
s2 = lambda z, x, y: f"https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"

def trek_crop(body, layer, lon, lat, half_deg, z, size=1024):
    """Crop around lon/lat from NASA Trek equirectangular tiles (EPSG:4326, 2x1 tiles at z0)."""
    ppd = 256 * 2 ** (z + 1) / 360.0
    cx, cy = (lon + 180) * ppd, (90 - lat) * ppd
    r = half_deg * ppd
    x0, y0, x1, y1 = cx - r, cy - r, cx + r, cy + r
    tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
    canvas = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            u = f"https://trek.nasa.gov/tiles/{body}/EQ/{layer}/1.0.0/default/default028mm/{z}/{ty}/{tx}.jpg"
            canvas.paste(img(u), ((tx - tx0) * 256, (ty - ty0) * 256))
    c = canvas.crop((int(x0 - tx0 * 256), int(y0 - ty0 * 256), int(x1 - tx0 * 256), int(y1 - ty0 * 256)))
    return c.resize((size, size), Image.LANCZOS)

TREK_LAYER = {"Mars": "Mars_Viking_MDIM21_ClrMosaic_global_232m", "Moon": "LRO_WAC_Mosaic_Global_303ppd_v02"}

def process_site(s):
    lat, lon, h = s["lat"], s["lng"], s["half"]
    lat0, lat1, lon0, lon1 = lat - h, lat + h, lon - h, lon + h
    # elevation
    zt = min(14, zoom_for(2 * h, 1024))
    dem = mosaic(lon0, lat0, lon1, lat1, zt, terr, "RGB")
    a = np.asarray(dem.resize((513, 513), Image.BICUBIC)).astype(np.float64)
    elev = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    lo, hi = np.percentile(elev, [0.3, 99.7])  # drop tile artefacts / single-cell spikes
    elev = np.clip(elev, lo, hi)
    # 3x3 median removes single-cell spikes from tile seams
    pad = np.pad(elev, 1, mode="edge")
    elev = np.median(np.stack([pad[i:i + 513, j:j + 513] for i in range(3) for j in range(3)]), axis=0)
    # metres per grid cell
    cell_m = (2 * h * 111320 * math.cos(math.radians(lat))) / 512
    gy, gx = np.gradient(elev, cell_m)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    stats = {
        "elevMin": round(float(elev.min())), "elevMax": round(float(elev.max())),
        "relief": round(float(elev.max() - elev.min())),
        "slopeMean": round(float(slope.mean()), 1), "slopeP90": round(float(np.percentile(slope, 90)), 1),
        "roughness": round(float(slope.std()), 1),
        "trafficable": round(float((slope < 15).mean() * 100)), "steep": round(float((slope > 25).mean() * 100), 1),
        "areaKm2": round((2 * h * 111.32 * math.cos(math.radians(lat))) * (2 * h * 111.32)),
        "cellM": round(cell_m, 1), "zoom": zt,
    }
    q = np.round((elev - elev.min()) / max(1e-6, elev.max() - elev.min()) * 65535).astype("<u2")
    q.tofile(os.path.join(OUT, "sites", f"{s['id']}-height.bin"))
    # imagery
    zi = min(16, zoom_for(2 * h, 2600))
    sat = mosaic(lon0, lat0, lon1, lat1, zi, s2, "RGB").resize((2048, 2048), Image.LANCZOS)
    sat.save(os.path.join(OUT, "sites", f"{s['id']}-sat.jpg"), quality=88)
    # twin imagery
    tw = trek_crop(s["body"], TREK_LAYER[s["body"]], s["tlng"], s["tlat"], s["thalf"], s["tz"], size=1600)
    from PIL import ImageOps
    tw = ImageOps.autocontrast(tw, cutoff=0.5)
    tw.save(os.path.join(OUT, "sites", f"{s['id']}-twin.jpg"), quality=88)
    # climate (NASA POWER, long-term climatology)
    u = ("https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M_MAX,T2M_MIN,T2M,"
         f"PRECTOTCORR,RH2M,ALLSKY_SFC_SW_DWN,WS2M&community=RE&longitude={lon}&latitude={lat}&format=JSON")
    p = json.loads(get(u))["properties"]["parameter"]
    months = [k for k in p["T2M_MAX"] if k != "ANN"]
    clim = {
        "tMaxHot": round(max(p["T2M_MAX"][m] for m in months), 1),
        "tMinCold": round(min(p["T2M_MIN"][m] for m in months), 1),
        "tMean": round(p["T2M"]["ANN"], 1),
        "rainMm": round(p["PRECTOTCORR"]["ANN"] * 365),
        "humidity": round(p["RH2M"]["ANN"]),
        "solar": round(p["ALLSKY_SFC_SW_DWN"]["ANN"], 2),
        "wind": round(p["WS2M"]["ANN"], 1),
        "monthlyMax": [round(p["T2M_MAX"][m], 1) for m in months],
        "monthlyMin": [round(p["T2M_MIN"][m], 1) for m in months],
    }
    return {**s, "dem": stats, "climate": clim}

def globes():
    g = os.path.join(OUT, "globes")
    def earth(w, h, name):
        e = img("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
                f"&LAYERS=BlueMarble_NextGeneration&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH={w}&HEIGHT={h}&FORMAT=image/jpeg")
        e.save(os.path.join(g, name), quality=90)
    earth(4096, 2048, "earth.jpg")
    try:
        earth(8192, 4096, "earth-8k.jpg")
    except Exception as ex:
        print("earth 8k failed", ex)
    for body, layer, name in [("Mars", TREK_LAYER["Mars"], "mars"), ("Moon", TREK_LAYER["Moon"], "moon")]:
        z = 4
        canvas = Image.new("RGB", (256 * 2 ** (z + 1), 256 * 2 ** z))
        for ty in range(2 ** z):
            for tx in range(2 ** (z + 1)):
                u = f"https://trek.nasa.gov/tiles/{body}/EQ/{layer}/1.0.0/default/default028mm/{z}/{ty}/{tx}.jpg"
                canvas.paste(img(u), (tx * 256, ty * 256))
        canvas.save(os.path.join(g, f"{name}-8k.jpg"), quality=88)
        canvas.resize((4096, 2048), Image.LANCZOS).save(os.path.join(g, f"{name}.jpg"), quality=90)

if __name__ == "__main__":
    if "--skip-globes" not in sys.argv:
        globes(); print("globes ok")
    out = []
    for s in SITES:
        out.append(process_site(s)); print("site ok", s["id"], out[-1]["dem"], out[-1]["climate"]["rainMm"])
    meta = {"generated": time.strftime("%Y-%m-%d"), "sites": out}
    json.dump(meta, open(os.path.join(OUT, "data.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("done")
