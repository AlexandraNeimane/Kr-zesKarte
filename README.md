# Krīzes karte — prototype

A web app that warns residents of Latvia about hazards within 10 km and lets them report road obstacles.

## Run

Requires Node.js 22.5+ (uses the built-in `node:sqlite`).

```
npm install
npm start
```

Open http://localhost:3000. The first load takes ~10–20 s while the server downloads the LVĢMC forecast (~70 MB).

- `?lat=56.95&lon=24.11` in the URL sets the location manually (useful for presentations, or if the browser blocks geolocation).
- **Demo login credentials:** `data/demo-users.json` (passwords are stored hashed in the database).
- **System panel:** http://localhost:3000/admin.html shows data-source status, the 8000 8989 alert log and the cluster simulation.

## Data sources (all live)

| What | Source | Refresh |
|---|---|---|
| Weather warnings (polygons, LV/EN) | LVĢMC CAP feed, bridinajumi.meteo.lv | 5 min |
| Road events: fallen trees, animals, road works, closures, accidents | LVC National Access Point map (map.transportdata.gov.lv, vector tiles) | 5 min |
| 24 h forecast (critical items only) | LVĢMC "Meteoroloģiskās prognozes apdzīvotām vietām", data.gov.lv | 30 min |
| Flood risk | LVĢMC "Hidroloģiskās prognozes" + station coordinates, data.gov.lv | 30 min |
| Precipitation radar | RainViewer | 10 min |
| Street addresses | OpenStreetMap Nominatim (cached, 1 req/s) | on demand |
| Shelters (787) | VUGD / 112.lv shelter map (ArcGIS feature service `PatvertnesDati_view`) | 6 h |
| Fuel stations (400) | viss.lv fuel station map | 6 h |
| Crisis ATMs (111) | Latvijas Banka ATM map (projects.kartes.lv), ATMs flagged "kritiskais" | 6 h |

Shelters, fuel stations and crisis ATMs appear **only on the main page**, as clustered map layers and in the "Drošības punkti" list. The user picks the search radius (1–100 km, default 10 km, remembered in the browser). When zoomed in, all places in view are shown.

Not connected: the NAP minute-level traffic and weather-station datasets require a registered NAP account.

## Key rules

- **Nearby list:** events within the radius chosen with its slider (1–100 km, default 10 km, remembered in the browser; it also sizes the purple map circle). LVĢMC warnings are included when the user is inside the warning area.
- **Forecast panel:** official LVĢMC warnings for the location, plus thresholds from the hourly forecast: gusts ≥ 15 m/s, rain ≥ 4 mm/h or ≥ 15 mm/24 h, thunderstorm ≥ 40 %, freezing after precipitation, ≥ 30 °C, feels-like ≤ −20 °C. Flood risk is shown for stations within 30 km whose forecast water level rises ≥ 0.5 m.
- **Emergency alert:** 25 reports of the same type within 250 m (last 24 h) create one alert to **8000 8989**. In the prototype the alert is logged and marked "simulated". Set `NOTIFY_WEBHOOK_URL` to POST it to a real SMS/voice gateway.
- **Report expiry:** a resident report disappears 48 h after it was submitted. If another report of the same incident (same type within 250 m) arrives while it is still visible, the 48 h restart from that latest report, so incidents stay visible as long as people keep reporting them (`REPORT_VISIBLE_HOURS`, `SAME_INCIDENT_RADIUS_M` in config.js).
- **Address autocomplete:** in the report form (after "Labot") typing an address suggests matches from Photon (OpenStreetMap data; Nominatim forbids autocomplete). Picking one moves the marker to that address. A typed address that was never picked is looked up when the report is submitted, so the incident lands at the right coordinates.
- **Removing reports:** any logged-in user can remove any published resident report (e.g. once the problem is resolved) with "Problēma atrisināta — noņemt" in its map popup. It disappears for everyone and no longer counts toward the 25-report alert. The database keeps it with `resolved_at` / `resolved_by` for history. A grouped marker (several reports of the same type within 50 m) removes all of its reports after a confirmation that shows the count.
- **Offline PDF:** the "Bezsaistes kopija (PDF)" card (top of the right column, always visible) downloads a printable document for the user's location and the radius chosen in "Drošības punkti": emergency numbers, radio frequency, a map page (OpenStreetMap tiles scaled so the radius circle fills it, with road sections and numbered markers: hazards 1, 2…, shelters P1…, crisis ATMs K1…, fuel D1… matching the lists; up to 10 places per type on the map), 24 h critical forecast, all hazards and resident reports, shelters, crisis ATMs and fuel stations (distance, compass direction, address, GPS coordinates; up to 60 nearest per type), and what-to-do instructions. Every page shows the creation time and that the information may be outdated. It is generated in the page language (LV/EN) by `GET /api/offline-pdf?lat=&lon=&radius=&lang=` and takes ~10 s because missing addresses are looked up.
- **Prohibited words:** `data/profanity/` holds the LDNOOBW English and Russian lists plus a Latvian list (`lv.txt`, `*` = stem). Matching ignores diacritics.
- Settings (radio frequency, phone number, radius, threshold) are in `config.js`.

## Presentation script for the 25-report alert

1. Log in on the system panel, click **📍 Mana vieta**, choose a type and click **Simulēt** (24 reports).
2. On the main page, submit the same type at the same place. The 25th report triggers the red "notified 8000 8989" message, and the alert appears in the system panel.
3. Use **Notīrīt demo datus** to reset.
