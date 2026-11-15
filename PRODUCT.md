# Mars in Arabia — product truth

- **What:** A web experience for NASA Space Apps 2026 (challenge: Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars). It proposes six Saudi sites as Moon/Mars analogs and characterizes each with open data.
- **Team:** Dahna (Kuala Lumpur local event).
- **Audience:** NASA and space-agency judges (need data provenance, method, honest limits) and the public/students (need a clear, inspiring story).
- **Surface mode:** Experience on top (cinematic story), Operate/Read below (site explorer, method, sources).
- **Language:** English UI with Arabic site names.
- **Truth rules:** Every number is labelled measured (with its source) or assessed (team judgement). No invented statistics. "Where the analogy breaks down" is shown for every site.
- **Data:** SRTM elevation (AWS Terrain Tiles), Copernicus Sentinel-2 cloudless (EOX), NASA POWER climatology, NASA GIBS Blue Marble, NASA Mars/Moon Trek (Viking MDIM 2.1, LRO WAC). Pre-processed by `tools/prep_data.py`.
