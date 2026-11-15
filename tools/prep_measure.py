"""Turn the score into measurements.

  terrain  : SRTM (Earth) vs MOLA / LOLA (twin), compared at the SAME pixel size over the SAME width
  geology  : rock class from geologic maps (Earth: GSC world map via Macrostrat; Mars: USGS SIM 3292
             global map; Moon: published mare basalt setting) + a cited landform match
  thermal  : NASA POWER ground (skin) temperature range, not air temperature

Needs prep_twins.py first, and the USGS SIM 3292 shapefile (SIM3292_Global_Geology.*) in MARS_GEO dir.
Run: python -I tools/prep_measure.py <dir with SIM3292_Global_Geology.shp>
"""
import json, math, os, sys, urllib.request
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prep_data import mosaic, terr, zoom_for  # noqa: E402
import shapefile  # pyshp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets")
UA = {"User-Agent": "mars-in-arabia"}
WINDOW_M = 60000   # compare the central 60 km (less if the twin crop is smaller)

# ---------- terrain ----------
def slope_deg(e, cell):
    gy, gx = np.gradient(e, cell)
    return np.degrees(np.arctan(np.hypot(gx, gy)))

def metrics(e, cell, width):
    s = slope_deg(e, cell)
    lo, hi = np.percentile(e, [1, 99])
    return {"slopeMean": float(s.mean()), "slopeP90": float(np.percentile(s, 90)),
            "rough": float(s.std()), "reliefPerKm": float((hi - lo) / (width / 1000)), "_s": s}

def ks(a, b):
    a, b = np.sort(a.ravel()), np.sort(b.ravel())
    x = np.union1d(a, b)
    return float(np.max(np.abs(np.searchsorted(a, x, side="right") / a.size - np.searchsorted(b, x, side="right") / b.size)))

ratio = lambda a, b: min(a, b) / max(a, b) if max(a, b) > 0 else 1.0

def terrain(s):
    t = s["twinDem"]; W = min(WINDOW_M, t["widthM"]); cell = t["widthM"] / 512; n = max(16, round(W / cell))
    # twin: rebuild metres from the normalised height file, crop the central W
    q = np.fromfile(os.path.join(OUT, "sites", f"{s['id']}-twin-height.bin"), dtype="<u2").reshape(513, 513)
    et = q / 65535 * t["relief"] + t["elevMin"]
    m = round(W / cell); c0 = (513 - m) // 2
    et = et[c0:c0 + m, c0:c0 + m]
    # Earth: SRTM over the same width, averaged down to the twin's pixel size
    half = W / 2 / 111320
    hl = half / math.cos(math.radians(s["lat"]))
    z = min(13, zoom_for(2 * hl, 2048))
    a = np.asarray(mosaic(s["lng"] - hl, s["lat"] - half, s["lng"] + hl, s["lat"] + half, z, terr, "RGB")).astype(np.float64)
    ee = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    ee = np.asarray(Image.fromarray(ee.astype(np.float32)).resize((n, n), Image.BOX), dtype=np.float64)
    et = np.asarray(Image.fromarray(et.astype(np.float32)).resize((n, n), Image.BOX), dtype=np.float64)
    me, mt = metrics(ee, cell, W), metrics(et, cell, W)
    s_slope = 1 - ks(me["_s"], mt["_s"])
    s_rough = ratio(me["rough"], mt["rough"])
    s_relief = ratio(me["reliefPerKm"], mt["reliefPerKm"])
    score = round(100 * (0.5 * s_slope + 0.25 * s_rough + 0.25 * s_relief))
    clean = lambda d: {k: round(v, 1) for k, v in d.items() if not k.startswith("_")}
    # west-east cross-section through the centre (mean of the middle 3 rows), metres above each profile's lowest point
    def prof(e):
        r = e[n // 2 - 1:n // 2 + 2].mean(0); idx = np.linspace(0, n - 1, 80)
        r = np.interp(idx, np.arange(n), r); return [round(float(v)) for v in r - r.min()]
    edges = [0, 1, 2, 4, 6, 10, 15, 20, 30, 90]
    hist = lambda sl: [round(float(v), 3) for v in np.histogram(sl, bins=edges)[0] / sl.size]
    extra = {"profile": {"earth": prof(ee), "twin": prof(et), "km": round(W / 1000)},
             "slopeHist": {"edges": edges, "earth": hist(me["_s"]), "twin": hist(mt["_s"])}}
    return {**extra, "score": score, "windowKm": round(W / 1000), "cellM": round(cell), "earth": clean(me), "twin": clean(mt),
            "parts": {"slopeShape": round(100 * s_slope), "roughness": round(100 * s_rough), "relief": round(100 * s_relief)}}

# ---------- geology ----------
def macrostrat(lat, lng):
    u = f"https://macrostrat.org/api/v2/geologic_units/map?lat={lat}&lng={lng}"
    d = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40).read())["success"]["data"]
    x = next(x for x in d if x["source_id"] == 154)  # one consistent world map for all six sites
    return f"{x['name']}: {x['lith']}"

class MarsMap:
    def __init__(self, d):
        r = shapefile.Reader(os.path.join(d, "SIM3292_Global_Geology"))
        self.items = [(sh.bbox, list(sh.parts) + [len(sh.points)], sh.points, rc["Unit"], rc["UnitDesc"]) for sh, rc in zip(r.shapes(), r.records())]
    @staticmethod
    def pip(x, y, pts):
        ins, j = False, len(pts) - 1
        for i in range(len(pts)):
            (xi, yi), (xj, yj) = pts[i], pts[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: ins = not ins
            j = i
        return ins
    def unit(self, lon, lat):
        for (x0, y0, x1, y1), parts, pts, u, desc in self.items:
            if x0 <= lon <= x1 and y0 <= lat <= y1 and sum(self.pip(lon, lat, pts[a:b]) for a, b in zip(parts[:-1], parts[1:])) % 2:
                return u, desc
    def majority(self, lat, lon, half):
        from collections import Counter
        c = Counter(self.unit(lon - half + (j + .5) * 2 * half / 9, lat - half + (i + .5) * 2 * half / 9) for i in range(9) for j in range(9))
        (u, desc), k = c.most_common(1)[0]
        return u, desc, round(100 * k / 81)

MOON = {  # published setting of the two Moon twins (both sit on mare basalt plains)
    "jirsan": ("Mare basalt, Oceanus Procellarum (Marius Hills volcanic complex)", "LROC / Haruyama et al. 2009"),
    "wahbah": ("Mare basalt, Mare Serenitatis (Linné is a young crater in it)", "LROC / USGS lunar geologic map"),
}
FEATURE = {  # landform match, each with its source
    "khaybar": (1.0, "Lava flows and cinder cones on both (Tharsis volcanic field)"),
    "jirsan": (1.0, "Lava tube on Earth; the Marius Hills skylight is thought to open into one (Haruyama et al. 2009)"),
    "rahat": (1.0, "Lava flows and cones on both (Elysium volcanic edifice)"),
    "rub": (1.0, "Dune field on both (Nili Patera dunes, HiRISE)"),
    "wahbah": (0.5, "Both are bowl craters, but Al Wahbah is volcanic and Linné is an impact crater"),
    "wabar": (1.0, "Impact craters with iron meteorite fragments on both (Opportunity at Meridiani)"),
}
def rock_class(text):
    t = text.lower()
    if "volcanic" in t or "basalt" in t or "mare" in t: return "volcanic"
    if "sand" in t or "sediment" in t: return "sedimentary"
    if "highland" in t: return "highland (mixed)"
    return "other"

def geology(s, mars):
    earth = macrostrat(s["lat"], s["lng"])
    if s["body"] == "Mars":
        u, desc, share = mars.majority(s["tlat"], s["tlng"], s["thalf"])
        twin, src = f"{u}, {desc} ({share}% of the twin area)", "USGS SIM 3292 global geologic map of Mars"
    else:
        twin, src = MOON[s["id"]]
    ce, ct = rock_class(earth), rock_class(twin)
    rock = 1.0 if ce == ct else 0.5 if (ce, ct) == ("sedimentary", "highland (mixed)") else 0.0
    feat, note = FEATURE[s["id"]]
    return {"score": round(100 * (0.6 * rock + 0.4 * feat)), "earth": earth, "earthClass": ce, "twin": twin, "twinClass": ct,
            "twinSrc": src, "rock": round(100 * rock), "feature": round(100 * feat), "featureNote": note,
            "earthSrc": "GSC world geology (Chorlton 2007) via Macrostrat"}

# ---------- ground temperature ----------
def ground_temp(s):
    u = ("https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=TS_MAX,TS_MIN"
         f"&community=RE&longitude={s['lng']}&latitude={s['lat']}&format=JSON")
    p = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=90).read())["properties"]["parameter"]
    mo = [k for k in p["TS_MAX"] if k != "ANN"]
    return (round(max(p["TS_MAX"][m] for m in mo), 1), round(min(p["TS_MIN"][m] for m in mo), 1),
            [round(p["TS_MAX"][m], 1) for m in mo], [round(p["TS_MIN"][m], 1) for m in mo])

def main():
    mars = MarsMap(sys.argv[1])
    p = os.path.join(OUT, "data.json"); data = json.load(open(p, encoding="utf-8"))
    for s in data["sites"]:
        s["terrainMatch"] = terrain(s)
        s["geologyMatch"] = geology(s, mars)
        c = s["climate"]; c["tsMax"], c["tsMin"], c["tsMonthMax"], c["tsMonthMin"] = ground_temp(s)
        print(s["id"], "terrain", s["terrainMatch"]["score"], s["terrainMatch"]["parts"], "| geology", s["geologyMatch"]["score"],
              s["geologyMatch"]["earthClass"], "->", s["geologyMatch"]["twinClass"], "| ground", s["climate"]["tsMin"], "to", s["climate"]["tsMax"])
    json.dump(data, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()
