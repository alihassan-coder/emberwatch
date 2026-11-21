# 04: Live cameras, terms of use, and geometry

Research date: 2026-11-21.

## 0. Headline correction: live HPWREN images now need a licence

Earlier project notes (`research/03-problems-and-datasets.md` #7, `00-final-three-projects.md`) assumed we could pull live HPWREN feeds for the demo. **The current HPWREN Data Use and Licensing page forbids that without a licence**, and the rule applies to commercial *and* non-commercial users ([hpwren.ucsd.edu/cc.html](https://www.hpwren.ucsd.edu/cc.html), fetched 2026-11-21). Verbatim:

> Real-time data is HPWREN data less than 24 hours old. It includes live camera images, live sensor streams, and new data as it is collected. Data more than 24 hours old is archived data.
> Anyone may view real-time data on the HPWREN website. A license from the UC San Diego Office of Innovation and Commercialization is required to:
> - retrieve real-time data automatically, for example with scripts, scrapers, scheduled downloads of image or data URLs, or stream capture;
> - redistribute or rebroadcast real-time data, including embedding live images or streams in another website, app, or service;
> - use real-time data in a product or service, including running detection or analysis models on live feeds.
>
> This requirement applies to commercial and non-commercial users alike. HPWREN may waive it for academic research and teaching; to request a waiver, email feedback.
> [...]
> The CC BY-NC license and the no-fee Commercial Use Permission below cover archived data only, including FIgLib.

The full licence text (archived data CC BY-NC 4.0, no-fee Commercial Use Permission conditions, publishing statement, credit line) is quoted in `01-datasets.md` §2.4.

**Consequence for the demo:** run EmberWatch on **archived frames (> 24 h old)** in a "T-24 h replay" mode, or on FIgLib, **unless** we get a licence or waiver from UCSD OIC. Archived data is CC BY-NC 4.0. Commercial use needs the no-fee Commercial Use Permission, which starts with registering by email.

## 1. HPWREN camera URL patterns (from the public camera viewer's JS)

Taken from the JavaScript of [hpwren.ucsd.edu/cameras/](https://www.hpwren.ucsd.edu/cameras/), fetched 2026-11-21. These are undocumented and may change.

| Purpose | Pattern | Licence class |
|---|---|---|
| Latest full-res frame | `https://cdn.hpwren.ucsd.edu/RT/{camId}.jpg` | real-time, **licence required for automated retrieval** |
| Latest 640 px thumbnail | `https://cdn.hpwren.ucsd.edu/RTS/{camId}-640.jpg` | real-time, same |
| Archive frame | `https://cdn.hpwren.ucsd.edu/MTA/{camId}/large/{YYYY}/{YYYYMMDD}/Q{q}/{time}.jpg` (`q` = quarter-of-day 1–4; `time` = file timestamp) | archived if > 24 h old |
| Archive quarter-day MP4 | `.../{YYYY}/{YYYYMMDD}/Q{q}.mp4` (pattern seen in JS, exact prefix UNVERIFIED) | archived |
| Camera/site metadata | `https://www.hpwren.ucsd.edu/cameras/sites.js` (JS object `var sites = {...}`) | metadata (not imagery) |
| Lens/attitude calibration | `https://www.hpwren.ucsd.edu/cameras/calibration.js` | metadata |

- The viewer states: "Retrospective data is available for 90 days. If you need to access archived data older than 90 days, please [contact]."
- The `camId` convention is `{site}-{dir}-mobo-{c|m}`, e.g. `lp-n-mobo-c`. `c` is the colour imager and `m` the monochrome one (which also sees near-IR at night). This matches the FIgLib folder names ([FIgLib](https://www.hpwren.ucsd.edu/FIgLib/)).
- The listing of archive frames per quarter is fetched by the viewer (exact listing URL not extracted; UNVERIFIED). Easiest path: replicate the viewer's request in browser dev tools.
- **Refresh rate:** FIgLib frames are ~60 s apart (sample names: `1499543863_-02400.jpg`, `1499543923_-02340.jpg`, ...; SmokeyNet paper: "spaced approximately 60 s apart"; [arXiv 2112.08598](https://arxiv.org/abs/2112.08598)). I did not poll the RT endpoint (doing so would itself be automated retrieval), so the **live cadence is UNVERIFIED but assumed ~1/min**.
- Resolution: 1536×2048 or 2048×3072, depending on camera model (SmokeyNet paper).

### Metadata in `sites.js` (parsed 2026-11-21)
- 82 sites, 503 camera entries, all with `"active": "y"`. Owners: `hpwren` 396, `alert` 107.
- Per site: `name`, `lat`, `long`, `elev` (m).
- Per camera: `imager` (color/monochrome), **`azimuth`** (degrees; 0/90/180/270 for the fixed quad cameras), **`horizontalView`** (degrees; 371 cameras at 90°, 110 at 60°, a few at 36/75/103/180), `roll`, `pitch`, `yaw`, `agl` (m above ground).

Examples:

| Site | Name | lat | lon | elev (m) |
|---|---|---|---|---|
| `lp` | Lyons Peak, east of Jamul | 32.70153 | −116.76457 | 1132 |
| `om` | Otay Mountain, east of Otay Mesa | 32.5948 | −116.8447 | 1087 |
| `sm` | San Miguel, west of Jamul | 32.69686 | −116.93612 | 773 |
| `mg` | Mesa Grande, south of Lake Henshaw | 33.18891 | −116.7606 | 1304 |
| `bm` | Big Black Mountain, northeast of Ramona | 33.15992 | −116.80807 | 1236 |
| `rm` | Red Mountain, Fallbrook | 33.40079 | −117.19047 | 483 |
| `syp` | Santa Ynez Peak, Santa Barbara County | 34.52707 | −119.97887 | 1310 |
| `wilson` | Mount Wilson Observatory | 34.22451 | −118.05867 | 1713 |

`calibration.js` holds per-camera lens and attitude terms: `cx, cy` (principal-point offset, px), `k_ratio, k1, k2` (fisheye-style distortion; the viewer defaults to `{k_ratio: 0.886, k1: -0.078, k2: 0.0}`), and time-stamped `roll/pitch/yaw` corrections. **The exact projection formula is not documented.** Read the viewer JS before using it; otherwise accept ~1–2° error from a linear model.

**Good triangulation triples in San Diego County** (overlapping views): Lyons Peak / Otay Mountain / San Miguel, and Mesa Grande / Big Black Mountain. Many FIgLib fires were seen from more than one of these (e.g. `20200806_BorderFire_*` from `om`, `sm`, `lp`, per the SmokeyNet paper's error list). This gives us **historical multi-camera events to validate triangulation offline** without live data.

## 2. Other public camera networks

| Network | Access | Terms |
|---|---|---|
| **ALERTCalifornia** (UCSD; CAL FIRE partnership; viewer at `cameras.alertcalifornia.org`) | Web viewer; I found no public image API. Archive footage on request via the [contact page](https://alertcalifornia.org/faqs/) | "ALERTCalifornia's program data is copyrighted under a CC BY-NC-ND 4.0 license", which "does not grant commercial use"; commercial use means contacting OIC to negotiate a licence with fees ([terms](https://alertcalifornia.org/terms/)). ND = no derivatives. Credit "ALERTCalifornia \| UC San Diego" for live feeds ([crediting](https://alertcalifornia.org/crediting-and-branding/)). The 107 `owner: "alert"` cameras in HPWREN's `sites.js` suggest some ALERT cameras appear in the HPWREN viewer, but their data terms are presumably ALERTCalifornia's (UNVERIFIED). **Not usable for a commercial demo without a licence.** |
| **Pyronear (France)** | Camera feeds go only to partner fire services through pyro-api / the platform; no public live stream found | Code Apache-2.0 ([pyro-engine](https://github.com/pyronear/pyro-engine), [pyro-api](https://github.com/pyronear/pyro-api)); the Pyro-SDIS images are Apache-2.0 ([HF](https://huggingface.co/datasets/pyronear/pyro-sdis)). There is no live public access, so use Pyro-SDIS as static data. |
| **Pano AI** | Commercial, closed | — |

## 3. Bearing from a bounding box

Inputs: camera azimuth `A` (centre of view, degrees clockwise from true north), horizontal FOV `F`, image width `W`, and the box's horizontal pixel position `u`. Use the **bottom-centre of the box** (the plume base is closest to the ignition point; the top drifts with wind). Use the leftmost/rightmost extremes to get an uncertainty interval.

**Linear model** (Pyronear smoke-localisation uses this; [repo](https://github.com/pyronear/smoke-localization)):
`bearing = A + (u/W − 0.5) · F`

**Pinhole model** (better for 90° lenses; focal length in px `f = (W/2) / tan(F/2)`):
`bearing = A + atan((u − W/2 − cx) / f)` (in degrees), then normalise to [0, 360).

For a 90° FOV the two models agree at the centre and at the edges (both give ±45°) but differ in between, by at most ~4.1° (at about u/W ≈ 0.76; e.g. at u/W = 0.75 linear gives 22.5° and pinhole atan(0.5) = 26.6°). This is my own calculation. HPWREN lenses are fisheye-like (`k1 < 0`), so neither model is exact. **Measure the error with landmarks:** the HPWREN viewer loads `landmarks.js` and links PeakFinder for exactly this purpose.

Roll correction (small angles): `bearing ≈ bearing + roll · (v/H − 0.5) · (F_v/F)`. This is negligible for |roll| < 1°.

## 4. Triangulating two bearings

Cameras are 5–40 km apart, so use spherical formulas ([Movable Type, "Intersection of two paths given start points and bearings"](https://www.movable-type.co.uk/scripts/latlong.html)). Angles are in radians, φ = latitude, λ = longitude:

1. `δ12 = 2·asin(√(sin²(Δφ/2) + cos φ1·cos φ2·sin²(Δλ/2)))`
2. `θa = acos((sin φ2 − sin φ1·cos δ12)/(sin δ12·cos φ1))`, `θb = acos((sin φ1 − sin φ2·cos δ12)/(sin δ12·cos φ2))`
3. If `sin(λ2−λ1) > 0`: `θ12 = θa`, `θ21 = 2π − θb`; else `θ12 = 2π − θa`, `θ21 = θb`
4. `α1 = θ13 − θ12`, `α2 = θ21 − θ23`
5. If `sin α1 = 0` and `sin α2 = 0`: infinite solutions. If `sin α1·sin α2 < 0`: ambiguous, meaning the rays diverge and there is **no valid fix**.
6. `α3 = acos(−cos α1·cos α2 + sin α1·sin α2·cos δ12)`
7. `δ13 = atan2(sin δ12·sin α1·sin α2, cos α2 + cos α1·cos α3)`
8. `φ3 = asin(sin φ1·cos δ13 + cos φ1·sin δ13·cos θ13)`
9. `λ3 = λ1 + atan2(sin θ13·sin δ13·cos φ1, cos δ13 − sin φ1·sin φ3)`

The movable-type article warns this formulation "is not always well-conditioned for meridional or equatorial lines".

Practical alternative at < 50 km: project both cameras to a local ENU/UTM plane with `pyproj`. Each bearing becomes a 2D ray; solve the 2×2 linear system; reject solutions with a negative ray parameter (behind the camera) or beyond the visibility range (~40 km, per Pano's 25 mi on clear days; [EPRI](https://restservice.epri.com/publicdownload/000000003002023034/0/Product)).

**Uncertainty:** propagate ±σ_bearing (from the box extent and calibration error, e.g. ±1.5°) by intersecting the four edge rays. That gives a quadrilateral to draw as the plume-location polygon on the map. The error grows quickly when the angle between rays is < 20° or > 160°: reject or flag those.

**Association (which detections are the same plume):** candidate pairs must (a) happen within ±2 frames in time, (b) have rays that intersect in front of both cameras within range, and (c) cross in a cell that is not masked out (e.g. ocean, or Mexico if out of scope). With more than 2 cameras, use least-squares intersection of all rays and report residuals.

**Single-camera fallback:** ray-march against a DEM. Pyronear does this with Copernicus GLO-30 DSM, skyline-based tilt/roll/azimuth calibration, 5 m ray steps and bisection refinement ([smoke-localization](https://github.com/pyronear/smoke-localization)). It is a stretch goal for EmberWatch.

## Decisions this implies for EmberWatch

1. **No automated pulling of live HPWREN images without a licence.** The demo's "live wall" runs in **T-24 h replay mode** on archived MTA frames (> 24 h old), plus FIgLib for "replay a historical ignition". The UI must say so honestly.
2. **Send two emails before launch:** (a) register for the no-fee HPWREN Commercial Use Permission (archived data + FIgLib), and (b) ask UCSD OIC / HPWREN about a real-time licence or waiver. If granted, flip a config flag from `replay` to `live`.
3. **Camera adapter interface** (like Pyronear's `url`/`rtsp`/`mock` adapters): `ArchiveReplayAdapter` (HPWREN MTA), `FigLibSequenceAdapter`, `RTSPAdapter` (for a client's own cameras), and `MockAdapter`. Live HPWREN is just one more adapter behind the licence flag.
4. **Ingest `sites.js` once into a `cameras` table** (lat, lon, elev, azimuth, horizontalView, roll/pitch/yaw, calibration). Cache it; don't scrape it repeatedly.
5. **Bearing:** pinhole model + bottom-centre of the box + an edge-based uncertainty interval. **Triangulation:** local ENU ray intersection with uncertainty polygons. Validate on historical multi-camera FIgLib fires (Border Fire 2020 from `om`/`sm`/`lp`).
6. **Do not use ALERTCalifornia imagery** (CC BY-NC-ND, no commercial use) unless a licence is negotiated.
7. Credit line everywhere HPWREN data appears: "Data courtesy of HPWREN, University of California San Diego (https://www.hpwren.ucsd.edu/)."
