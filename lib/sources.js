// Official data sources. Each loader fills `state` and records its status for /api/status.
//
//  lvgmc_warnings  LVĢMC weather warnings (CAP 1.2 XML)          https://bridinajumi.meteo.lv/
//  lvc_events      LVC / National Access Point road events (MVT) https://map.transportdata.gov.lv/
//  lvgmc_forecast  LVĢMC hourly forecasts for populated places   data.gov.lv "Meteoroloģiskās prognozes apdzīvotām vietām"
//  lvgmc_hydro     LVĢMC hydrological forecasts                  data.gov.lv "Hidroloģiskās prognozes"
const readline = require('readline');
const { Readable } = require('stream');
const { VectorTile } = require('@mapbox/vector-tile');
const Pbf = require('pbf');

const UA = { 'User-Agent': 'KrizesParvaldiba-prototype/1.0 (+https://github.com/FicusSus/KrizesParvaldiba)' };
const DATA_GOV = 'https://data.gov.lv/dati/dataset';
const URLS = {
  capList: 'https://bridinajumi.meteo.lv/list.php',
  capBase: 'https://bridinajumi.meteo.lv/',
  lvcTiles: 'https://map.transportdata.gov.lv/gis/pg_tileserv',
  cities: `${DATA_GOV}/01519599-fd66-4d60-8735-51b1c294c417/resource/f692fae6-99cd-4bee-95ec-f158a595873a/download/cities.csv`,
  cityForecast: `${DATA_GOV}/01519599-fd66-4d60-8735-51b1c294c417/resource/4e9b37dc-a486-4af1-8964-b370f659811a/download/forecast_cities.csv`,
  hydroForecast: `${DATA_GOV}/5d9b0379-c0b8-4ce9-9094-7c30b5502433/resource/a967bf11-139f-4040-84d6-ce7c68006a8b/download/hidro_forecast.csv`,
  hydroStations: `${DATA_GOV}/40d80be5-0c09-47c4-80f3-fad4bec19f33/resource/93fd5e2c-20c4-496e-a920-ff29bda20383/download/hidro_stacijas.csv`,
};

const state = {
  warnings: [],     // events from CAP
  roadEvents: [],   // events from LVC
  hydroEvents: [],  // flood-risk events from hydro forecast
  cities: [],       // [{id, name, lat, lon}]
  cityForecast: new Map(), // city id -> [{t, T, Tapp, W, G, P, TS}] sorted by time
  status: {},
};

async function get(url, as = 'text') {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return as === 'buffer' ? Buffer.from(await r.arrayBuffer()) : r.text();
}

async function track(name, fn) {
  const s = state.status[name] || (state.status[name] = {});
  try {
    s.count = await fn();
    s.ok = true; s.error = null; s.updated = new Date().toISOString();
  } catch (e) {
    s.ok = false; s.error = String(e.message || e);
    console.error(`[${name}]`, s.error);
  }
}

// ---------- helpers ----------
const toRad = d => d * Math.PI / 180;
function distanceKm(aLat, aLon, bLat, bLon) {
  const dLat = toRad(bLat - aLat), dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Ray casting on a ring of [lon, lat]
function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Latvian local time string "YYYY-MM-DD HH:MM:SS" -> Date (handles summer/winter time)
function rigaTime(str) {
  const guess = new Date(str.replace(' ', 'T') + 'Z');
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Riga', timeZoneName: 'longOffset' })
    .formatToParts(guess).find(p => p.type === 'timeZoneName').value; // "GMT+03:00"
  const m = off.match(/([+-])(\d\d):(\d\d)/);
  const mins = m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
  return new Date(guess.getTime() - mins * 60000);
}

function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const head = parseCsvLine(lines[0]);
  return lines.slice(1).map(l => Object.fromEntries(parseCsvLine(l).map((v, i) => [head[i], v])));
}

// ---------- LVĢMC weather warnings (CAP) ----------
const CAP_TYPES = {
  wind: ['wind', 'Vējš', 'Wind'], rain: ['rain', 'Lietus', 'Rain'], rainshowers: ['rain', 'Lietusgāzes', 'Rain showers'],
  snow: ['snow', 'Sniegs', 'Snow'], heat: ['heat', 'Karstums', 'Heat'], frost: ['cold', 'Sals', 'Cold'],
  ice: ['ice', 'Apledojums', 'Glazed ice'], fog: ['fog', 'Migla', 'Fog'], fires: ['fire', 'Ugunsbīstamība', 'Forest fire'],
  water: ['flood', 'Krasta parādības', 'Coastal event'], thunderstorm: ['thunder', 'Pērkona negaiss', 'Thunderstorm'],
  ground: ['cold', 'Salna', 'Ground frost'], radiation: ['sun', 'UV starojums', 'UV radiation'],
};
const LEVELS = { yellow: ['Dzeltenais', 'Yellow', 1], orange: ['Oranžais', 'Orange', 2], red: ['Sarkanais', 'Red', 3] };

const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? m[1].trim() : ''; };
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

async function loadWarnings() {
  const files = JSON.parse(await get(URLS.capList)) || []; // the feed returns null when there are no warnings
  const events = [];
  for (const file of files) {
    const xml = await get(URLS.capBase + file);
    const infos = [...xml.matchAll(/<info>([\s\S]*?)<\/info>/g)].map(m => m[1]);
    const byLang = {};
    for (const info of infos) byLang[tag(info, 'language').slice(0, 2)] = info;
    const lv = byLang.lv || infos[0], en = byLang.en || infos[0];
    if (!lv) continue;
    const expires = tag(lv, 'expires');
    if (expires && new Date(expires) < new Date()) continue;

    const kind = (file.match(/_([A-Za-z]+)\.2\.49/) || [])[1]?.toLowerCase() || '';
    const levelKey = (file.match(/ALERT_(\w+?)_/) || [])[1]?.toLowerCase() || 'yellow';
    const [icon, nameLv, nameEn] = CAP_TYPES[kind] || ['warning', 'Brīdinājums', 'Warning'];
    const level = LEVELS[levelKey] || LEVELS.yellow;

    const polygons = [...lv.matchAll(/<polygon>([\s\S]*?)<\/polygon>/g)].map(m =>
      m[1].trim().split(/\s+/).map(p => { const [la, lo] = p.split(',').map(Number); return [lo, la]; }));
    if (!polygons.length) continue;
    const biggest = polygons.reduce((a, b) => (b.length > a.length ? b : a));
    const lat = biggest.reduce((s, p) => s + p[1], 0) / biggest.length;
    const lon = biggest.reduce((s, p) => s + p[0], 0) / biggest.length;

    events.push({
      id: 'cap-' + tag(xml, 'identifier'),
      src: 'LVĢMC', group: 'weather', icon, level: levelKey, levelRank: level[2],
      title: { lv: unxml(tag(lv, 'event')) || `${level[0]} brīdinājums: ${nameLv}`, en: unxml(tag(en, 'event')) || `${level[1]} warning: ${nameEn}` },
      desc: { lv: unxml(tag(lv, 'description')), en: unxml(tag(en, 'description')) },
      risks: { lv: unxml(tag(lv, 'risks')), en: unxml(tag(en, 'risks')) },
      location: { lv: unxml(tag(lv, 'areaDesc')), en: unxml(tag(en, 'areaDesc')) },
      certainty: tag(lv, 'certainty'),
      from: tag(lv, 'onset') || tag(lv, 'effective'), until: expires || null,
      lat, lon,
      geometry: { type: 'MultiPolygon', coordinates: polygons.map(p => [p]) },
    });
  }
  state.warnings = events;
  return events.length;
}

// Is a point inside the warning area (or how far from it)?
function warningCovers(ev, lat, lon) {
  return ev.geometry.coordinates.some(poly => pointInRing(lat, lon, poly[0]));
}

// ---------- LVC road events (vector tiles from the National Access Point map) ----------
const ROAD_TYPES = {
  accident: ['accident', 'Ceļu satiksmes negadījums', 'Road traffic accident'],
  fallenTrees: ['tree', 'Kritis koks', 'Fallen tree'],
  animalsOnTheRoad: ['animal', 'Dzīvnieki uz ceļa', 'Animals on the road'],
  maintenanceWork: ['roadworks', 'Ceļa uzturēšanas darbi', 'Road maintenance'],
  constructionWork: ['roadworks', 'Ceļa remontdarbi', 'Road works'],
  RailroadWorks: ['roadworks', 'Darbi uz dzelzceļa pārbrauktuves', 'Railway crossing works'],
  roadClosed: ['closed', 'Ceļš slēgts', 'Road closed'],
  vehiclesForbidden: ['closed', 'Satiksme aizliegta', 'Traffic prohibited'],
  flooding: ['flood', 'Applūdis ceļš', 'Flooded road'],
  ice: ['ice', 'Apledojums', 'Icy road'], blackIce: ['ice', 'Melnais ledus', 'Black ice'],
  slipperyRoad: ['ice', 'Slidens ceļš', 'Slippery road'],
  lanesBlocked: ['closed', 'Slēgta josla', 'Lane closed'],
  hazardsOnTheRoad: ['warning', 'Bīstamība uz ceļa', 'Hazard on the road'],
  objectOnTheRoad: ['warning', 'Šķērslis uz ceļa', 'Object on the road'],
  obstruction: ['warning', 'Šķērslis uz ceļa', 'Obstruction'],
};
const SKIP = new Set(['UVIS', 'massRestrictions', 'virtualMassRestriction', 'virtualMassRestrictionWithException',
  'widthRestrictions', 'heightRestrictions', 'trucksForbidden']);
const RESTRICTIONS = {
  roadBlocked: ['ceļš slēgts', 'road blocked'], lanesBlocked: ['slēgta josla', 'lane closed'],
  roadPartiallyObstructed: ['ceļš daļēji aizšķērsots', 'road partially obstructed'],
};
// Latvia lies within zoom-6 tiles x 35..37, y 19..20
const TILES = [[35, 19], [36, 19], [37, 19], [35, 20], [36, 20], [37, 20]];

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const humanize = s => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
const parseTs = s => (s ? new Date(s.replace(' ', 'T').replace(/\+00$/, 'Z')) : null);

async function loadRoadEvents() {
  const byId = new Map();
  for (const layer of ['public.mvt_kafkamessages_notplannedevent_public', 'public.mvt_kafkamessages_plannedevent_public']) {
    for (const [x, y] of TILES) {
      const tile = new VectorTile(new Pbf(await get(`${URLS.lvcTiles}/${layer}/6/${x}/${y}.pbf`, 'buffer')));
      for (const name in tile.layers) {
        const L = tile.layers[name];
        for (let i = 0; i < L.length; i++) {
          const f = L.feature(i), p = f.properties;
          if (SKIP.has(p.event_enum)) continue;
          const key = layer.includes('notplanned') + ':' + p.id;
          const g = f.toGeoJSON(x, y, 6).geometry;
          if (!byId.has(key)) byId.set(key, { p, parts: [] });
          byId.get(key).parts.push(g);
        }
      }
    }
  }

  const now = new Date(), soon = new Date(now.getTime() + 24 * 3600e3);
  const events = [];
  for (const [key, { p, parts }] of byId) {
    const from = parseTs(p.date_from), until = parseTs(p.date_to);
    if (until && until < now) continue;
    if (p.status !== 'ACTIVE' && !(p.status === 'PLANNED' && from && from < soon)) continue;

    const [icon, lv, en] = ROAD_TYPES[p.event_enum] || ['warning', humanize(p.event_enum), humanize(p.event_enum)];
    const lines = [], points = [];
    for (const g of parts) {
      if (g.type === 'Point') points.push(g.coordinates);
      else if (g.type === 'LineString') lines.push(g.coordinates);
      else if (g.type === 'MultiLineString') lines.push(...g.coordinates);
      else if (g.type === 'MultiPoint') points.push(...g.coordinates);
    }
    const first = lines[0] ? lines[0][Math.floor(lines[0].length / 2)] : points[0];
    if (!first) continue;

    const restr = (p.restrictions || '').match(/\w+/g)?.filter(r => RESTRICTIONS[r]) || [];
    const descLv = [], descEn = [];
    if (restr.length) { descLv.push(restr.map(r => RESTRICTIONS[r][0]).join(', ')); descEn.push(restr.map(r => RESTRICTIONS[r][1]).join(', ')); }
    if (p.notes) { descLv.push(p.notes.trim()); descEn.push(p.notes.trim()); }
    if (p.speed_limit) { descLv.push(`Ātruma ierobežojums ${p.speed_limit} km/h`); descEn.push(`Speed limit ${p.speed_limit} km/h`); }
    if (p.detour) { descLv.push(`Apbraucamais ceļš: ${p.detour}`); descEn.push(`Detour: ${p.detour}`); }
    if (p.animal_alive_status) { descLv.push(`Dzīvnieks: ${p.animal_alive_status.toLowerCase()}`); descEn.push(`Animal: ${p.animal_alive_status === 'Miris' ? 'dead' : 'alive'}`); }
    if (p.contractor) { descLv.push(`Darbu veicējs: ${p.contractor}`); descEn.push(`Contractor: ${p.contractor}`); }

    const loc = [p.geographic_name, p.linear_reference].filter(Boolean).join(', ');
    events.push({
      id: 'lvc-' + key.replace(/\W/g, ''), src: 'LVC', group: 'road', icon, kind: p.event_enum,
      title: { lv, en },
      desc: { lv: cap(descLv.join('. ')) || lv, en: cap(descEn.join('. ')) || en },
      location: { lv: loc, en: loc },
      from: from?.toISOString() || null, until: until?.toISOString() || null,
      lat: first[1], lon: first[0],
      geometry: lines.length ? { type: 'MultiLineString', coordinates: lines } : null,
    });
  }
  state.roadEvents = events;
  return events.length;
}

// ---------- LVĢMC forecasts for populated places ----------
const PARAMS = { 2: 'T', 3: 'Tapp', 4: 'W', 6: 'G', 7: 'P', 11: 'TS' };

async function loadCityForecast() {
  state.cities = parseCsv(await get(URLS.cities)).map(r => ({
    id: r.CITY_ID, name: r.NOSAUKUMS, lat: +r.LAT, lon: +r.LON, type: r.TIPS,
  })).filter(c => c.lat && c.lon);

  const from = Date.now() - 3600e3, to = Date.now() + 25 * 3600e3;
  const r = await fetch(URLS.cityForecast, { headers: UA, signal: AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error(`${r.status} forecast_cities.csv`);
  const rl = readline.createInterface({ input: Readable.fromWeb(r.body) });
  const map = new Map(), timeCache = new Map();
  for await (const line of rl) {
    const [city, param, date, value] = line.replace(/"/g, '').split(',');
    const key = PARAMS[param];
    if (!key) continue;
    let t = timeCache.get(date);
    if (t === undefined) { t = rigaTime(date).getTime(); timeCache.set(date, t); }
    if (t < from || t > to) continue;
    let rows = map.get(city);
    if (!rows) map.set(city, rows = new Map());
    let row = rows.get(t);
    if (!row) rows.set(t, row = { t });
    row[key] = parseFloat(value);
  }
  state.cityForecast = new Map([...map].map(([id, rows]) => [id, [...rows.values()].sort((a, b) => a.t - b.t)]));
  return state.cityForecast.size;
}

function nearestCity(lat, lon) {
  let best = null, bestD = Infinity;
  for (const c of state.cities) {
    if (!state.cityForecast.has(c.id)) continue;
    const d = distanceKm(lat, lon, c.lat, c.lon);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best && { ...best, distanceKm: bestD };
}

// Turn an hourly forecast into a short list of CRITICAL items only.
function criticalFromForecast(rows) {
  const items = [];
  const span = (pred) => {
    const hit = rows.filter(pred);
    return hit.length ? { from: new Date(hit[0].t).toISOString(), until: new Date(hit[hit.length - 1].t + 3600e3).toISOString(), rows: hit } : null;
  };
  const max = (rs, k) => Math.max(...rs.map(r => r[k] ?? -Infinity));
  const min = (rs, k) => Math.min(...rs.map(r => r[k] ?? Infinity));

  const gust = span(r => r.G >= 15);
  if (gust) {
    const g = max(gust.rows, 'G');
    items.push({ icon: 'wind', level: g >= 20 ? 'high' : 'medium', from: gust.from, until: gust.until,
      title: { lv: 'Stiprs vējš', en: 'Strong wind' },
      desc: { lv: `Vēja brāzmas līdz ${Math.round(g)} m/s. Iespējami lauzti koki un elektrības traucējumi.`,
              en: `Wind gusts up to ${Math.round(g)} m/s. Fallen trees and power outages possible.` } });
  }

  const total = rows.reduce((s, r) => s + (r.P || 0), 0);
  const heavy = span(r => r.P >= 4);
  const snowy = rows.filter(r => r.P >= 0.3 && r.T <= 1);
  if (snowy.length >= 2) {
    const sum = snowy.reduce((s, r) => s + r.P, 0);
    items.push({ icon: 'snow', level: sum >= 10 ? 'high' : 'medium',
      from: new Date(snowy[0].t).toISOString(), until: new Date(snowy[snowy.length - 1].t + 3600e3).toISOString(),
      title: { lv: 'Sniegs', en: 'Snow' },
      desc: { lv: `Gaidāmi sniega nokrišņi (~${sum.toFixed(1)} mm ūdens ekvivalentā). Apgrūtināti braukšanas apstākļi.`,
              en: `Snowfall expected (~${sum.toFixed(1)} mm water equivalent). Difficult driving conditions.` } });
  } else if (heavy || total >= 15) {
    const s = heavy || span(r => r.P >= 1);
    items.push({ icon: 'rain', level: total >= 30 || max(rows, 'P') >= 10 ? 'high' : 'medium', from: s.from, until: s.until,
      title: { lv: 'Spēcīgs lietus', en: 'Heavy rain' },
      desc: { lv: `Nokrišņi līdz ${max(rows, 'P').toFixed(1)} mm stundā, kopā ~${total.toFixed(0)} mm. Iespējama ūdens uzkrāšanās uz ceļiem.`,
              en: `Rain up to ${max(rows, 'P').toFixed(1)} mm/h, ~${total.toFixed(0)} mm in total. Water may pool on roads.` } });
  }

  const storm = span(r => r.TS >= 40);
  if (storm) items.push({ icon: 'thunder', level: max(storm.rows, 'TS') >= 70 ? 'high' : 'medium', from: storm.from, until: storm.until,
    title: { lv: 'Pērkona negaiss', en: 'Thunderstorm' },
    desc: { lv: `Pērkona negaisa varbūtība līdz ${Math.round(max(storm.rows, 'TS'))}%.`, en: `Thunderstorm probability up to ${Math.round(max(storm.rows, 'TS'))}%.` } });

  // Icing: freezing temperature with precipitation in the same or previous 6 hours
  const icy = span(r => r.T <= 0.5 && rows.some(q => q.t <= r.t && q.t > r.t - 6 * 3600e3 && q.P >= 0.1));
  const frost = span(r => r.T <= 0);
  if (icy) items.push({ icon: 'ice', level: 'high', from: icy.from, until: icy.until,
    title: { lv: 'Apledojums', en: 'Icing' },
    desc: { lv: `Temperatūra līdz ${min(icy.rows, 'T').toFixed(0)} °C pēc nokrišņiem — slideni ceļi un ietves.`,
            en: `Temperature down to ${min(icy.rows, 'T').toFixed(0)} °C after precipitation — slippery roads and pavements.` } });
  else if (frost) items.push({ icon: 'ice', level: 'medium', from: frost.from, until: frost.until,
    title: { lv: 'Sals, iespējams apledojums', en: 'Frost, possible ice' },
    desc: { lv: `Gaisa temperatūra līdz ${min(frost.rows, 'T').toFixed(0)} °C. Vietām iespējami slideni ceļi.`,
            en: `Air temperature down to ${min(frost.rows, 'T').toFixed(0)} °C. Roads may be slippery in places.` } });

  const heat = span(r => r.T >= 30);
  if (heat) items.push({ icon: 'heat', level: max(heat.rows, 'T') >= 33 ? 'high' : 'medium', from: heat.from, until: heat.until,
    title: { lv: 'Karstums', en: 'Heat' },
    desc: { lv: `Gaisa temperatūra līdz ${Math.round(max(heat.rows, 'T'))} °C.`, en: `Air temperature up to ${Math.round(max(heat.rows, 'T'))} °C.` } });

  const cold = span(r => r.Tapp <= -20);
  if (cold) items.push({ icon: 'cold', level: 'high', from: cold.from, until: cold.until,
    title: { lv: 'Stiprs sals', en: 'Severe cold' },
    desc: { lv: `Sajūtu temperatūra līdz ${Math.round(min(cold.rows, 'Tapp'))} °C.`, en: `Feels like ${Math.round(min(cold.rows, 'Tapp'))} °C.` } });

  return items;
}

// ---------- LVĢMC hydrological forecast -> flood risk ----------
async function loadHydro() {
  const stations = new Map(parseCsv(await get(URLS.hydroStations))
    .map(s => [s.STATION_ID, { name: s.NAME, lat: +s.GEOGR2, lon: +s.GEOGR1 }]));
  const rows = parseCsv(await get(URLS.hydroForecast)).filter(r => r.PARAM === 'UDLIM');
  const byStation = new Map();
  for (const r of rows) {
    if (!byStation.has(r.STATION_ID)) byStation.set(r.STATION_ID, []);
    byStation.get(r.STATION_ID).push({ date: r.DATUMS.slice(0, 10), median: +r.MEDIANA, max: +r.MAXIM });
  }
  const events = [];
  for (const [id, list] of byStation) {
    const st = stations.get(id);
    if (!st || !st.lat) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    // Some stations (e.g. sea-level station SEDA99MS) publish values in other units / noisy data around -1000: skip them
    if (list.some(r => !isFinite(r.median) || r.median < -50)) continue;
    const base = list[0].median;
    const peak = list.reduce((a, b) => (b.median > a.median ? b : a));
    const rise = peak.median - base;
    if (rise < 0.5 || rise > 5) continue; // only meaningful rises; > 5 m is treated as a data error
    const rise24 = (list[1]?.median ?? base) - base;
    events.push({
      id: 'hydro-' + id, src: 'LVĢMC', group: 'weather', icon: 'flood', level: rise >= 1 ? 'high' : 'medium',
      rise24,
      title: { lv: 'Plūdu risks', en: 'Flood risk' },
      desc: { lv: `Prognozēta ūdens līmeņa celšanās par ${rise.toFixed(2)} m līdz ${peak.date} (stacija ${st.name}).`,
              en: `Water level forecast to rise by ${rise.toFixed(2)} m by ${peak.date} (station ${st.name}).` },
      location: { lv: st.name, en: st.name },
      from: list[0].date, until: peak.date, lat: st.lat, lon: st.lon, geometry: null,
    });
  }
  state.hydroEvents = events;
  return `${events.length} riski / ${byStation.size} stacijas`;
}

// ---------- scheduling ----------
function start() {
  const fast = () => Promise.all([track('lvgmc_warnings', loadWarnings), track('lvc_events', loadRoadEvents)]);
  const slow = () => Promise.all([track('lvgmc_forecast', loadCityForecast), track('lvgmc_hydro', loadHydro)]);
  fast(); slow();
  setInterval(fast, 5 * 60e3);   // warnings + road events every 5 min
  setInterval(slow, 30 * 60e3);  // forecasts every 30 min
}

module.exports = { state, start, distanceKm, warningCovers, nearestCity, criticalFromForecast, URLS };
