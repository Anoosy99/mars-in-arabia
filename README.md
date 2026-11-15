# Mars in Arabia · المريخ في جزيرة العرب

**NASA Space Apps Challenge 2026 · Team Dahna**
Challenge: *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*

A 3D web experience that proposes six Saudi sites as field analogs for Moon and Mars bases. Each one is scored against its Mars or Moon twin using open data only, and every number names its source.

## What it does
- **Opening:** a 3D Earth flies into the Arabian Peninsula and turns into Mars.
- **Analog finder:** scans 36,300 cells (0.1°) across the peninsula for three archetypes: volcanic, smooth plains, and rugged. It checks itself against the six field sites and proposes new candidates.
- **Six field sites in 3D:** Harrat Khaybar, Umm Jirsan lava tube, Harrat Rahat, Rub' al Khali, Al Wahbah crater, and the Wabar craters. Each site has:
  - real terrain draped with Sentinel-2 imagery
  - a switch to its **Mars or Moon twin in 3D**, built from MOLA or LOLA elevation
  - a measured comparison with charts: cross-section, slope mix, and monthly ground temperature
  - a field-test plan
- **Bases:** each site is linked to the real Artemis III south-pole regions and to proposed Mars base zones, such as Jezero, Gale, Meridiani and Hebrus Valles.
- **Method and limits:** the formula, the sources, and what an analog on Earth cannot reproduce.

## Score (0–100)
| Part | Weight | How |
|---|---|---|
| Geology | 35% | Rock class from geologic maps (60) plus a cited landform match (40) |
| Terrain | 25% | SRTM vs MOLA/LOLA at the same pixel size: slope distribution (KS), roughness, relief |
| Aridity | 25% | NASA POWER rainfall |
| Thermal swing | 15% | NASA POWER ground (skin) temperature range vs the twin's surface range |

## Data
- **NASA:**
  - POWER (climate, ground temperature)
  - GIBS (Blue Marble, MODIS Terra NDVI)
  - Mars Trek (Viking MDIM 2.1)
  - Moon Trek (LRO WAC)
  - MGS MOLA MEGDR and LRO LOLA LDEM, 128 px/deg (PDS Geosciences Node)
  - SRTM via AWS Terrain Tiles
- **USGS:** SIM 3292 global geologic map of Mars.
- **ESA/EOX:** Sentinel-2 cloudless.
- **Macrostrat:** GSC world geology (Chorlton 2007).

## Run locally
```bash
python -m http.server 5600
```
Then open http://localhost:5600.

To rebuild the data, run these scripts with Python 3 (numpy, Pillow, pyshp):
- `tools/prep_data.py`
- `tools/prep_twins.py`
- `tools/prep_finder.py`
- `tools/prep_measure.py`

## Tools and credits
three.js, GSAP + ScrollTrigger, Lenis, Leaflet; Esri World Imagery basemap (finder); Google Fonts (Geist, Noto Kufi Arabic); Python with numpy, Pillow and pyshp; Macrostrat API.

## AI disclosure
- **Code and data scripts:** written with AI assistance (Claude). This is marked in the `ai-disclosure` meta tag of `index.html`.
- **Demo video voice-over:** generated with AI (ElevenLabs). The video carries a visible label and file metadata saying so.
- **No AI-generated images.** All imagery and elevation are real data from the sources above.
