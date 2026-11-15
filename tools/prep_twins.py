# AI disclosure: written with AI assistance (Claude) for Team Dahna, NASA Space Apps 2026.
"""Real elevation for each Mars / Moon twin, so the twin can be shown in 3D.

Mars: MGS MOLA MEGDR 128 px/deg (~463 m), PDS Geosciences Node.
Moon: LRO LOLA LDEM 128 px/deg (~237 m), PDS Geosciences Node.
Only the rows we need are fetched with HTTP range requests.
Writes assets/sites/<id>-twin-height.bin (513x513 uint16) and adds `twinDem` to assets/data.json.
Run: python -I tools/prep_twins.py
"""
import json, math, os, urllib.request
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets")
PPD = 128
MOLA = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/megt{lat}{lon:03d}hb.img"
LOLA = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_128.img"
KM_PER_DEG = {"Mars": 59.16, "Moon": 30.32}


def tiles(body):
    """(url, top lat, west lon, lines, samples, dtype, scale) for every source file."""
    if body == "Moon":
        return [(LOLA, 90, 0, 180 * PPD, 360 * PPD, "<i2", 0.5)]
    out = []
    for top, tag in ((88, "88n"), (44, "44n"), (0, "00n"), (-44, "44s")):
        for w in (0, 90, 180, 270):
            out.append((MOLA.format(lat=tag, lon=w), top, w, 44 * PPD, 90 * PPD, ">i2", 1.0))
    return out


def fetch_rows(url, l0, l1, samples, dtype):
    row = samples * 2
    req = urllib.request.Request(url, headers={"Range": f"bytes={l0 * row}-{(l1 + 1) * row - 1}", "User-Agent": "mars-in-arabia"})
    data = urllib.request.urlopen(req, timeout=180).read()
    return np.frombuffer(data, dtype=dtype).reshape(l1 - l0 + 1, samples)


def block(body, lat, lon, half):
    lon = lon % 360
    g0, g1 = int(math.floor((90 - (lat + half)) * PPD)), int(math.ceil((90 - (lat - half)) * PPD)) - 1
    s0, s1 = int(math.floor((lon - half) * PPD)), int(math.ceil((lon + half) * PPD)) - 1
    out = np.full((g1 - g0 + 1, s1 - s0 + 1), np.nan)
    for url, top, w, lines, samples, dtype, scale in tiles(body):
        tl0, ts0 = (90 - top) * PPD, w * PPD
        a0, a1 = max(g0, tl0), min(g1, tl0 + lines - 1)
        b0, b1 = max(s0, ts0), min(s1, ts0 + samples - 1)
        if a0 > a1 or b0 > b1:
            continue
        rows = fetch_rows(url, a0 - tl0, a1 - tl0, samples, dtype)
        out[a0 - g0:a1 - g0 + 1, b0 - s0:b1 - s0 + 1] = rows[:, b0 - ts0:b1 - ts0 + 1] * scale
    assert not np.isnan(out).any(), "gap in mosaic"
    return out


def main():
    p = os.path.join(OUT, "data.json")
    data = json.load(open(p, encoding="utf-8"))
    for s in data["sites"]:
        elev = block(s["body"], s["tlat"], s["tlng"], s["thalf"])
        img = Image.fromarray(elev.astype(np.float32), "F").resize((513, 513), Image.BICUBIC)
        e = np.asarray(img.filter(ImageFilter.MedianFilter(3)), dtype=np.float64)
        lo, hi = np.percentile(e, [0.3, 99.7])
        e = np.clip(e, lo, hi)
        q = np.round((e - lo) / max(1e-6, hi - lo) * 65535).astype("<u2")
        q.tofile(os.path.join(OUT, "sites", f"{s['id']}-twin-height.bin"))
        width_m = s["thalf"] * 2 * KM_PER_DEG[s["body"]] * 1000 * math.cos(math.radians(s["tlat"]))
        s["twinDem"] = {
            "elevMin": round(float(lo)), "elevMax": round(float(hi)), "relief": round(float(hi - lo)),
            "widthM": round(width_m), "cellM": round(width_m / 512, 1),
            "src": "MGS MOLA MEGDR 128 px/deg" if s["body"] == "Mars" else "LRO LOLA LDEM 128 px/deg",
        }
        print(s["id"], s["twin"], s["twinDem"])
    json.dump(data, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
