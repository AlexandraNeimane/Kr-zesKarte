// Krīzes pārvaldība — prototype server.  Run:  npm start  ->  http://localhost:3000
const express = require('express');
const path = require('path');
const config = require('./config');
const { db, seedUsers, login, logout, userForToken } = require('./lib/db');
const sources = require('./lib/sources');
const profanity = require('./lib/profanity');
const places = require('./lib/places');
const { buildPdf } = require('./lib/offline-pdf');
const { fetchMap } = require('./lib/static-map');

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

console.log(`Demo users seeded: ${seedUsers()}`);
console.log(`Profanity lists: ${JSON.stringify(profanity.stats())}`);
sources.start();
places.start();

// Shelters, fuel stations and crisis ATMs (main page only)
app.get('/api/places', (req, res) => res.json({
  places: places.places(),
  status: places.state.status,
  ready: Object.keys(places.state.status).length === 3,
}));

// ---------- report types (what users can submit) ----------
const REPORT_TYPES = {
  flood:    { icon: 'flood',    lv: 'Applūdis ceļš/teritorija', en: 'Flooded road/area' },
  tree:     { icon: 'tree',     lv: 'Kritis koks',              en: 'Fallen tree' },
  power:    { icon: 'power',    lv: 'Pārrauti elektrības vadi', en: 'Downed power lines' },
  accident: { icon: 'accident', lv: 'Ceļu satiksmes negadījums', en: 'Road traffic accident' },
  ice:      { icon: 'ice',      lv: 'Apledojums',               en: 'Icy road conditions' },
  other:    { icon: 'other',    lv: 'Citi',                     en: 'Other' },
};

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const user = userForToken(token);
  if (!user) return res.status(401).json({ error: 'not_logged_in' });
  req.user = user; req.token = token;
  next();
}

// ---------- reverse geocoding (OpenStreetMap Nominatim, max 1 request/second, cached) ----------
let geoChain = Promise.resolve();
function reverseGeocode(lat, lon) {
  const key = `${(+lat).toFixed(4)},${(+lon).toFixed(4)}`;
  const hit = db.prepare('SELECT address FROM geocode_cache WHERE key = ?').get(key);
  if (hit) return Promise.resolve(hit.address);
  const job = geoChain.then(async () => {
    const again = db.prepare('SELECT address FROM geocode_cache WHERE key = ?').get(key);
    if (again) return again.address;
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=lv&lat=${lat}&lon=${lon}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'KrizesParvaldiba-prototype/1.0 (+https://github.com/FicusSus/KrizesParvaldiba)' } });
    await new Promise(ok => setTimeout(ok, 1100));
    if (!r.ok) throw new Error('nominatim ' + r.status);
    const j = await r.json();
    const a = j.address || {};
    const street = [a.road || a.pedestrian || a.footway || a.path, a.house_number].filter(Boolean).join(' ');
    const place = a.city || a.town || a.village || a.hamlet || a.suburb || a.municipality || '';
    const address = [street, place].filter(Boolean).join(', ') || j.display_name || '';
    db.prepare('INSERT OR REPLACE INTO geocode_cache VALUES (?,?)').run(key, address);
    return address;
  });
  geoChain = job.catch(() => {});
  return job;
}

// ---------- API ----------
app.get('/api/config', (req, res) => res.json({
  radio: config.RADIO_FREQUENCY, radioPhone: config.RADIO_PHONE, emergencyPhone: config.EMERGENCY_PHONE,
  clusterRadiusM: config.CLUSTER_RADIUS_M, clusterThreshold: config.CLUSTER_THRESHOLD,
  nearbyRadiusKm: config.NEARBY_RADIUS_KM, descriptionMaxWords: config.DESCRIPTION_MAX_WORDS,
  reportTypes: REPORT_TYPES,
}));

app.get('/api/status', (req, res) => res.json({ sources: sources.state.status, urls: sources.URLS, profanity: profanity.stats() }));

// A report is visible for REPORT_VISIBLE_HOURS after it was submitted. Every new report of the same incident
// (same type within SAME_INCIDENT_RADIUS_M) that arrives while it is still visible restarts that period.
function reportExpiries(rows) {
  const visibleMs = config.REPORT_VISIBLE_HOURS * 3600e3;
  const times = rows.map(r => Date.parse(r.created_at));
  return rows.map((r, i) => {
    let expiry = times[i] + visibleMs;
    for (let j = i + 1; j < rows.length; j++) {        // rows are sorted oldest first
      if (times[j] > expiry) break;                     // the chain is broken: later reports start a new incident
      const s = rows[j];
      if (s.type === r.type && sources.distanceKm(r.lat, r.lon, s.lat, s.lon) * 1000 <= config.SAME_INCIDENT_RADIUS_M)
        expiry = times[j] + visibleMs;
    }
    return expiry;
  });
}

function userReportEvents() {
  const since = new Date(Date.now() - 30 * 24 * 3600e3).toISOString();
  const rows = db.prepare(`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id = r.user_id
    WHERE r.resolved_at IS NULL AND r.created_at >= ? ORDER BY r.created_at ASC`).all(since);
  const expiries = reportExpiries(rows);
  const now = Date.now();
  return rows.map((r, i) => {
    const t = REPORT_TYPES[r.type] || REPORT_TYPES.other;
    const until = new Date(expiries[i]);
    return {
      id: 'user-' + r.id, src: 'people', group: 'people', icon: t.icon, kind: r.type,
      title: { lv: t.lv, en: t.en },
      desc: { lv: r.description || '', en: r.description || '' },
      location: { lv: r.address || '', en: r.address || '' }, address: r.address,
      from: r.observed_at, until: until.toISOString(), untilEstimated: true,
      lat: r.lat, lon: r.lon, isDemo: !!r.is_demo, author: r.username, reportIds: [r.id],
    };
  }).filter(e => new Date(e.until).getTime() > now).reverse(); // newest first
}

// All map events. Many reports at the same spot clutter the map: keep the newest per type within 50 m.
function allEvents() {
  const { state } = sources;
  const shown = [];
  for (const e of userReportEvents()) {
    const dup = shown.find(s => s.kind === e.kind && sources.distanceKm(s.lat, s.lon, e.lat, e.lon) < 0.05);
    if (dup) { dup.count = (dup.count || 1) + 1; dup.reportIds.push(...e.reportIds); } else shown.push(e);
  }
  return [...state.warnings, ...state.roadEvents, ...state.hydroEvents, ...shown];
}

app.get('/api/events', (req, res) => {
  const { state } = sources;
  res.json({
    updated: new Date().toISOString(),
    ready: !!(state.status.lvc_events && state.status.lvgmc_warnings),
    events: allEvents(),
  });
});

// ---------- offline PDF: text version of the map for a location + radius ----------
function eventDistanceKm(e, lat, lon) {
  if (e.geometry?.type === 'MultiPolygon') return sources.warningCovers(e, lat, lon) ? 0 : Infinity;
  let d = sources.distanceKm(lat, lon, e.lat, e.lon);
  if (e.geometry?.type === 'MultiLineString')
    for (const line of e.geometry.coordinates) for (const [x, y] of line) d = Math.min(d, sources.distanceKm(lat, lon, y, x));
  return d;
}

const cachedAddress = (lat, lon) =>
  db.prepare('SELECT address FROM geocode_cache WHERE key = ?').get(`${(+lat).toFixed(4)},${(+lon).toFixed(4)}`)?.address;

const PDF_PLACES_PER_KIND = 60, PDF_MAP_PLACES_PER_KIND = 10, PDF_GEOCODE_BUDGET_MS = 10000;

app.get('/api/offline-pdf', async (req, res) => {
  const lat = +req.query.lat, lon = +req.query.lon;
  const radiusKm = Math.min(100, Math.max(1, Math.round(+req.query.radius || config.NEARBY_RADIUS_KM)));
  const lang = req.query.lang === 'en' ? 'en' : 'lv';
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'lat/lon' });

  const hazards = allEvents().map(e => ({ e, d: eventDistanceKm(e, lat, lon) }))
    .filter(x => x.d <= radiusKm)
    .sort((a, b) => (a.d === 0 ? -1 : 0) - (b.d === 0 ? -1 : 0) || a.d - b.d);
  const placeSets = {};
  for (const kind of ['shelter', 'atm', 'fuel']) {
    const all = places.places().filter(p => p.kind === kind)
      .map(p => ({ p, d: sources.distanceKm(lat, lon, p.lat, p.lon) }))
      .filter(x => x.d <= radiusKm).sort((a, b) => a.d - b.d);
    placeSets[kind] = { total: all.length, list: all.slice(0, PDF_PLACES_PER_KIND) };
  }

  // Addresses: cached ones for everything, live lookups (1/s) for the nearest items within a time budget
  const needing = [];
  for (const h of hazards) {
    if (h.e.geometry?.type === 'MultiPolygon') continue;
    h.address = h.e.address || cachedAddress(h.e.lat, h.e.lon) || '';
    if (!h.address) needing.push(h);
  }
  for (const kind of ['shelter', 'atm', 'fuel']) for (const x of placeSets[kind].list) {
    x.address = x.p.address || cachedAddress(x.p.lat, x.p.lon) || '';
    if (!x.address) needing.push(x);
  }
  needing.sort((a, b) => a.d - b.d);
  const mapPromise = fetchMap(lat, lon, radiusKm, 1006).catch(e => { console.error('[pdf map]', e.message); return null; });
  const deadline = Date.now() + PDF_GEOCODE_BUDGET_MS;
  const address = await reverseGeocode(lat, lon).catch(() => '');
  for (const x of needing) {
    if (Date.now() > deadline) break;
    const it = x.e || x.p;
    x.address = await reverseGeocode(it.lat, it.lon).catch(() => '');
  }

  const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Riga' }).slice(0, 16).replace(/[: ]/g, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="krizes-karte-${radiusKm}km-${stamp}.pdf"`);
  buildPdf({
    lat, lon, radiusKm, lang, address, radio: config.RADIO_FREQUENCY, radioPhone: config.RADIO_PHONE, phone: config.EMERGENCY_PHONE,
    forecast: forecastFor(lat, lon), hazards, places: placeSets,
    map: await mapPromise, mapPerKind: PDF_MAP_PLACES_PER_KIND,
  }, res);
});

app.get('/api/forecast', (req, res) => {
  const lat = +req.query.lat, lon = +req.query.lon;
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'lat/lon' });
  res.json(forecastFor(lat, lon));
});

// Critical 24 h items for a location (also used by the offline PDF)
function forecastFor(lat, lon) {
  const now = Date.now(), dayAhead = now + 24 * 3600e3;
  const items = [];

  // 1) Official LVĢMC warnings covering this location within the next 24 h
  for (const w of sources.state.warnings) {
    if (!sources.warningCovers(w, lat, lon)) continue;
    if (w.from && new Date(w.from).getTime() > dayAhead) continue;
    items.push({ ...w, geometry: undefined, official: true,
      level: { yellow: 'medium', orange: 'high', red: 'high' }[w.level] || 'medium', capLevel: w.level });
  }
  // 2) Critical values from the LVĢMC hourly forecast for the nearest populated place
  const city = sources.nearestCity(lat, lon);
  if (city) {
    const rows = sources.state.cityForecast.get(city.id).filter(r => r.t >= now - 3600e3 && r.t <= dayAhead);
    for (const it of sources.criticalFromForecast(rows)) {
      // Skip if an official warning of the same kind is already shown
      if (!items.some(w => w.icon === it.icon)) items.push(it);
    }
  }
  // 3) Flood risk from hydrological forecast within 30 km
  for (const h of sources.state.hydroEvents) {
    if (sources.distanceKm(lat, lon, h.lat, h.lon) <= 30) items.push({ ...h });
  }
  const st = sources.state.status;
  return {
    city: city && { name: city.name, distanceKm: city.distanceKm },
    items,
    updated: [st.lvgmc_forecast?.updated, st.lvgmc_warnings?.updated].filter(Boolean).sort().pop() || null,
    ready: !!st.lvgmc_forecast?.ok,
  };
}

app.get('/api/geocode', async (req, res) => {
  const lat = +req.query.lat, lon = +req.query.lon;
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'lat/lon' });
  try { res.json({ address: await reverseGeocode(lat, lon) }); }
  catch (e) { res.json({ address: '', error: String(e.message) }); }
});

// ---------- address autocomplete (Photon, OpenStreetMap data; built for search-as-you-type, unlike Nominatim) ----------
const addrCache = new Map(); // query -> { at, results }
app.get('/api/address-search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < 3) return res.json({ results: [] });
  const lat = +req.query.lat, lon = +req.query.lon;
  const key = `${q.toLowerCase()}|${isFinite(lat) ? lat.toFixed(1) : ''},${isFinite(lon) ? lon.toFixed(1) : ''}`;
  const hit = addrCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60e3) return res.json({ results: hit.results });
  const params = new URLSearchParams({ q, limit: '8', bbox: '20.9,55.6,28.3,58.1' }); // Latvia
  if (isFinite(lat) && isFinite(lon)) { params.set('lat', lat); params.set('lon', lon); } // prefer nearby results
  try {
    const r = await fetch(`https://photon.komoot.io/api/?${params}`, {
      headers: { 'User-Agent': 'KrizesParvaldiba-prototype/1.0 (+https://github.com/FicusSus/KrizesParvaldiba)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error('photon ' + r.status);
    const j = await r.json();
    const seen = new Set(), results = [];
    for (const f of j.features || []) {
      const p = f.properties || {};
      if (p.countrycode && p.countrycode !== 'LV') continue;
      const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : '';
      const main = street || p.name || '';
      const place = p.city || p.town || p.village || p.district || p.county || '';
      const label = [main, place !== main ? place : ''].filter(Boolean).join(', ');
      if (!label || seen.has(label)) continue;
      seen.add(label);
      results.push({ label, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] });
      if (results.length >= 5) break;
    }
    addrCache.set(key, { at: Date.now(), results });
    res.json({ results });
  } catch (e) {
    res.json({ results: [], error: String(e.message) });
  }
});

app.post('/api/login', (req, res) => {
  const r = login(req.body?.username, req.body?.password);
  if (!r) return res.status(401).json({ error: 'bad_credentials' });
  res.json(r);
});
app.post('/api/logout', auth, (req, res) => { logout(req.token); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

app.post('/api/profanity-check', (req, res) => res.json({ found: profanity.check(req.body?.text || '') }));

function wordCount(s) { return (s.trim().match(/\S+/g) || []).length; }

app.post('/api/reports', auth, async (req, res) => {
  const { type, lat, lon, observed_at } = req.body || {};
  let { address, description } = req.body || {};
  description = String(description || '').trim();
  if (!REPORT_TYPES[type]) return res.status(400).json({ error: 'bad_type' });
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'bad_location' });
  if (wordCount(description) > config.DESCRIPTION_MAX_WORDS) return res.status(400).json({ error: 'too_long' });
  const bad = profanity.check(description + ' ' + (address || ''));
  if (bad.length) return res.status(400).json({ error: 'profanity', words: bad });
  const observed = observed_at ? new Date(observed_at) : new Date();
  if (isNaN(observed)) return res.status(400).json({ error: 'bad_time' });
  if (!address) address = await reverseGeocode(lat, lon).catch(() => '');

  const info = db.prepare(`INSERT INTO reports(user_id, type, lat, lon, address, observed_at, description, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(req.user.id, type, lat, lon, address, observed.toISOString(), description, new Date().toISOString());
  const notification = checkCluster(type, lat, lon, address);
  res.json({ ok: true, id: Number(info.lastInsertRowid), notification });
});

// Any logged-in user can remove published reports (e.g. once the problem is resolved) for everyone.
// A grouped map marker sends all of its report ids.
app.post('/api/reports/resolve', auth, (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 500);
  if (!ids.length) return res.status(400).json({ error: 'no_ids' });
  const upd = db.prepare('UPDATE reports SET resolved_at = ?, resolved_by = ? WHERE id = ? AND resolved_at IS NULL');
  const now = new Date().toISOString();
  let removed = 0;
  for (const id of ids) removed += Number(upd.run(now, req.user.id, id).changes);
  console.log(`Reports ${ids.join(', ')} removed by ${req.user.username}`);
  res.json({ ok: true, removed });
});

// ---------- 25 reports of the same type within 250 m -> alert the emergency line ----------
function checkCluster(type, lat, lon, address) {
  const since = new Date(Date.now() - config.CLUSTER_WINDOW_HOURS * 3600e3).toISOString();
  const d = 0.005; // ~500 m bounding box prefilter
  const near = db.prepare(`SELECT * FROM reports WHERE type = ? AND created_at >= ? AND resolved_at IS NULL
    AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`).all(type, since, lat - d, lat + d, lon - 2 * d, lon + 2 * d)
    .filter(r => sources.distanceKm(lat, lon, r.lat, r.lon) * 1000 <= config.CLUSTER_RADIUS_M);
  if (near.length < config.CLUSTER_THRESHOLD) return null;

  const already = db.prepare(`SELECT * FROM notifications WHERE type = ? AND created_at >= ?`).all(type, since)
    .some(n => sources.distanceKm(lat, lon, n.lat, n.lon) * 1000 <= config.CLUSTER_RADIUS_M);
  if (already) return null;

  const t = REPORT_TYPES[type];
  const message = `AUTOMĀTISKS ZIŅOJUMS: ${near.length} iedzīvotāju ziņojumi par "${t.lv}" ${config.CLUSTER_RADIUS_M} m rādiusā. ` +
    `Vieta: ${address || ''} (${lat.toFixed(5)}, ${lon.toFixed(5)}). Pirmais ziņojums: ${new Date(near.map(r => r.observed_at).sort()[0]).toLocaleString('lv-LV', { timeZone: 'Europe/Riga' })}.`;
  const status = config.NOTIFY_WEBHOOK_URL ? 'sending' : 'simulated';
  const info = db.prepare(`INSERT INTO notifications(created_at, phone, type, lat, lon, address, report_count, message, status)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(new Date().toISOString(), config.EMERGENCY_PHONE, type, lat, lon, address, near.length, message, status);
  console.log(`\n*** PAZIŅOJUMS -> ${config.EMERGENCY_PHONE} ***\n${message}\n`);

  if (config.NOTIFY_WEBHOOK_URL) {
    // Hook for a real SMS/voice gateway (e.g. Twilio, Infobip) — set NOTIFY_WEBHOOK_URL to enable.
    fetch(config.NOTIFY_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: config.EMERGENCY_PHONE, message }) })
      .then(r => db.prepare('UPDATE notifications SET status = ? WHERE id = ?').run(r.ok ? 'sent' : 'failed ' + r.status, info.lastInsertRowid))
      .catch(e => db.prepare('UPDATE notifications SET status = ? WHERE id = ?').run('failed ' + e.message, info.lastInsertRowid));
  }
  return { id: Number(info.lastInsertRowid), phone: config.EMERGENCY_PHONE, count: near.length, message };
}

app.get('/api/notifications', (req, res) => {
  res.json({ notifications: db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50').all() });
});

// ---------- demo helpers for the presentation ----------
app.post('/api/demo/simulate', auth, (req, res) => {
  const { type = 'tree', lat, lon } = req.body || {};
  const count = Math.min(+req.body?.count || config.CLUSTER_THRESHOLD - 1, 100);
  if (!REPORT_TYPES[type] || !isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'bad_input' });
  const ins = db.prepare(`INSERT INTO reports(user_id, type, lat, lon, address, observed_at, description, created_at, is_demo)
    VALUES (?,?,?,?,?,?,?,?,1)`);
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    // random point within ~150 m
    const r = Math.random() * 150 / 111320, a = Math.random() * 2 * Math.PI;
    const t = new Date(now - Math.random() * 3600e3).toISOString();
    ins.run(req.user.id, type, lat + r * Math.cos(a), lon + r * Math.sin(a) / Math.cos(lat * Math.PI / 180), '', t,
      'Demonstrācijas ziņojums', t);
  }
  res.json({ ok: true, created: count, notification: checkCluster(type, lat, lon, '') });
});

app.post('/api/demo/reset', auth, (req, res) => {
  const a = db.prepare('DELETE FROM reports WHERE is_demo = 1').run().changes;
  const b = db.prepare('DELETE FROM notifications').run().changes;
  res.json({ ok: true, reportsDeleted: a, notificationsDeleted: b });
});

app.listen(config.PORT, () => console.log(`\nKrīzes pārvaldība: http://localhost:${config.PORT}\n`));
