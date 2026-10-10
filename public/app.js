/* Krīzes karte — frontend */
const RIGA = [56.9496, 24.1052];
const S = {
  lang: localStorage.getItem('lang') || 'lv',
  config: null,
  pos: null, posIsFallback: false,
  events: [], nearby: [], filter: 'all',
  forecast: null,
  token: sessionStorage.getItem('token'), user: null,
  addr: new Map(),        // "lat,lon" -> address
  layerOn: { radar: true, warnings: true, road: true, flood: true, people: true, shelter: true, fuel: true, atm: true },
  places: [],
  // selected categories in "Drošības punkti" (several at once; remembered in the browser)
  placeKinds: (() => {
    try { const k = JSON.parse(localStorage.getItem('placeKinds')); if (Array.isArray(k) && k.length) return new Set(k); } catch {}
    return new Set(['shelter', 'fuel', 'atm']);
  })(),
  // radius for the "Brīdinājumi un notikumi" list and the purple map circle (1–100 km, remembered in the browser)
  hazardRadiusKm: 10, // every visit starts at 10 km
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function t(key, vars = {}) {
  let s = (I18N[S.lang] && I18N[S.lang][key]) ?? I18N.lv[key] ?? key;
  for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
  return s;
}
const L_ = obj => (obj ? obj[S.lang] || obj.lv || '' : '');

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  const r = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.status), { status: r.status, data: j });
  return j;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = (kind === 'alert' ? icon('phone', 22) : kind === 'ok' ? icon('check', 22) : icon('info', 22)) + `<div>${esc(msg)}</div>`;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'alert' ? 12000 : 5000);
}

function distKm(a, b, c, d) {
  const R = Math.PI / 180, dLat = (c - a) * R, dLon = (d - b) * R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * R) * Math.cos(c * R) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
function inRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- time formatting ----------
const pad = n => String(n).padStart(2, '0');
function fmtTime(iso, { withDay = true } = {}) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (!withDay) return hm;
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - day0) / 86400000);
  if (diff === 0) return `${t('today')} ${hm}`;
  if (diff === 1) return `${t('tomorrow')} ${hm}`;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}${iso.length > 10 ? ' ' + hm : ''}`;
}
const fmtFull = d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const localInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// ---------- i18n ----------
function applyLang() {
  document.documentElement.lang = S.lang;
  $$('.lang button').forEach(b => b.classList.toggle('active', b.dataset.lang === S.lang));
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $('#rcDesc').placeholder = t('descPlaceholder');
  document.title = t('appName');
  renderTicker(); renderNearby(); renderForecast(); renderSession(); renderTypeList(); renderPlaces(); drawPlaces();
  if (R.type) fillReportCard();
  drawEvents();
}

function renderTicker() {
  const freq = S.config?.radio || '';
  const item = `<span class="ticker-item">${icon('radio', 22)}<span>${esc(t('ticker', { freq: '' }))}</span><span class="freq">${esc(freq)}</span><span>· ${esc(t('tickerPhone'))}</span><span class="freq">${esc(S.config?.radioPhone || '')}</span><small>${esc(t('tickerSub'))}</small></span>`;
  $('#tickerTrack').innerHTML = item.repeat(4) + item.repeat(4);
  $('#reportRadio').textContent = `${freq}`;
}

// ---------- map ----------
const map = L.map('map', { zoomControl: true, attributionControl: true }).setView(RIGA, 8);
map.zoomControl.setPosition('topleft');
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, className: 'base-tiles',
  attribution: '&copy; OpenStreetMap · LVĢMC · LVC · RainViewer',
}).addTo(map);

const layers = {
  radar: L.layerGroup(), warnings: L.layerGroup().addTo(map), road: L.layerGroup().addTo(map),
  flood: L.layerGroup().addTo(map), people: L.layerGroup().addTo(map),
  shelter: placeCluster('shelter').addTo(map), fuel: placeCluster('fuel').addTo(map), atm: placeCluster('atm').addTo(map),
};
const markerById = new Map();
let meMarker = null, radiusCircle = null;

async function loadRadar() {
  try {
    const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
    const last = j.radar.past[j.radar.past.length - 1];
    layers.radar.clearLayers();
    L.tileLayer(`${j.host}${last.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0.6, maxNativeZoom: 7, maxZoom: 19, zIndex: 300 })
      .addTo(layers.radar);
    if (S.layerOn.radar) layers.radar.addTo(map);
  } catch (e) { console.warn('radar', e); }
}

function layerOf(e) {
  if (e.src === 'people') return 'people';
  if (e.id.startsWith('hydro-')) return 'flood';
  if (e.id.startsWith('cap-')) return 'warnings';
  return 'road';
}

function markerClass(e) {
  if (e.id.startsWith('cap-')) return 'weather cap-' + e.level;
  return [e.group, e.icon].join(' ');
}

function popupHtml(e) {
  const src = e.src === 'people' ? t('srcPeople') : e.src === 'LVC' ? t('srcLVC') : t('srcLVGMC');
  const loc = e.address || S.addr.get(key(e)) || L_(e.location);
  const until = e.until ? fmtTime(e.until) + (e.untilEstimated ? ` (${t('estimated')})` : '') : t('unknown');
  return `<div class="pp-title"><span class="pi ${e.group}">${icon(e.icon, 18)}</span>${esc(L_(e.title))}${e.count > 1 ? ` · ${esc(t('reports', { n: e.count }))}` : ''}</div>
    ${L_(e.desc) && L_(e.desc) !== L_(e.title) ? `<div class="pp-desc">${esc(L_(e.desc))}</div>` : ''}
    <div class="pp-meta">
      ${loc ? `<span>${icon('pin', 14)}</span><b>${esc(loc)}</b>` : ''}
      ${e.from ? `<span>${esc(t('popupFrom'))}</span><b>${esc(fmtTime(e.from))}</b>` : ''}
      <span>${esc(t('popupUntil'))}</span><b>${esc(until)}</b>
      <span>${esc(t('popupSource'))}</span><b>${esc(src)}</b>
    </div>
    ${L_(e.risks) ? `<div class="pp-risks"><b>${esc(t('popupRisks'))}:</b>\n${esc(L_(e.risks))}</div>` : ''}
    ${e.src === 'people' ? `<div class="pp-actions" data-for="${esc(e.id)}">${resolveButtonHtml()}</div>` : ''}`;
}

function drawEvents() {
  for (const k of ['warnings', 'road', 'flood', 'people']) layers[k].clearLayers();
  markerById.clear();
  // warnings: lowest level first so red is on top
  const sorted = [...S.events].sort((a, b) => (a.levelRank || 0) - (b.levelRank || 0));
  for (const e of sorted) {
    const layer = layers[layerOf(e)];
    if (e.geometry?.type === 'MultiPolygon') {
      const color = { yellow: '#e0a800', orange: '#f07b16', red: '#d62839' }[e.level] || '#e0a800';
      L.geoJSON(e.geometry, { style: { color, weight: 2, fillColor: color, fillOpacity: 0.12, dashArray: '6 4' }, interactive: false }).addTo(layer);
    } else if (e.geometry?.type === 'MultiLineString') {
      L.geoJSON(e.geometry, { style: { color: e.icon === 'closed' ? '#d62839' : '#17834b', weight: 5, opacity: .75 } })
        .bindPopup(() => popupHtml(e)).addTo(layer);
    }
    if (layerOf(e) === 'flood') {
      L.circle([e.lat, e.lon], { radius: 3000, color: '#6d3fd6', weight: 1, fillColor: '#b9a4f5', fillOpacity: .3 }).addTo(layer);
    }
    const badge = e.count > 1 ? `<span class="badge">${e.count}</span>` : '';
    const m = L.marker([e.lat, e.lon], {
      icon: L.divIcon({ className: 'mk-wrap', html: `<div class="mk ${markerClass(e)}">${icon(e.icon, 20)}${badge}</div>`, iconSize: [38, 38], iconAnchor: [19, 19] }),
      zIndexOffset: e.src === 'people' ? 500 : 0,
    }).bindPopup(() => popupHtml(e), { maxWidth: 340 }).addTo(layer);
    markerById.set(e.id, m);
  }
}

function setMyPosition(lat, lon, fallback = false) {
  S.pos = [lat, lon]; S.posIsFallback = fallback;
  if (meMarker) meMarker.setLatLng(S.pos);
  else meMarker = L.marker(S.pos, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 1000 })
    .bindTooltip(() => t('youAreHere')).addTo(map);
  const km = S.hazardRadiusKm;
  if (radiusCircle) radiusCircle.setLatLng(S.pos).setRadius(km * 1000);
  else radiusCircle = L.circle(S.pos, { radius: km * 1000, color: '#6d3fd6', weight: 2, dashArray: '4 6', fill: true, fillOpacity: .04, interactive: false }).addTo(map);
  map.fitBounds(radiusCircle.getBounds(), { padding: [20, 20] });
  const note = $('#mapNote');
  note.hidden = !fallback; note.textContent = fallback ? t('locFallback') : '';
  if (fallback) setTimeout(() => (note.hidden = true), 7000);
  computeNearby(); loadForecast(); renderPlaces(); drawPlaces();
}

function locate() {
  // ?lat=..&lon=.. in the URL overrides geolocation (handy for presentations)
  const q = new URLSearchParams(location.search);
  if (q.get('lat') && q.get('lon')) return setMyPosition(+q.get('lat'), +q.get('lon'));
  if (!navigator.geolocation) return setMyPosition(...RIGA, true);
  navigator.geolocation.getCurrentPosition(
    p => setMyPosition(p.coords.latitude, p.coords.longitude),
    () => setMyPosition(...RIGA, true),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

// ---------- events + nearby list ----------
async function loadEvents() {
  try {
    const j = await api('/api/events');
    S.events = j.events;
    if (!j.ready) setTimeout(loadEvents, 4000); // server still fetching its first data
    drawEvents(); computeNearby();
  } catch (e) { console.error(e); }
}

function eventDistance(e) {
  const [lat, lon] = S.pos;
  if (e.geometry?.type === 'MultiPolygon')
    return e.geometry.coordinates.some(p => inRing(lat, lon, p[0])) ? 0 : Infinity;
  let d = distKm(lat, lon, e.lat, e.lon);
  if (e.geometry?.type === 'MultiLineString')
    for (const line of e.geometry.coordinates) for (const [x, y] of line) d = Math.min(d, distKm(lat, lon, y, x));
  return d;
}

function computeNearby() {
  if (!S.pos) return;
  const km = S.hazardRadiusKm;
  S.nearby = S.events.map(e => ({ e, d: eventDistance(e) }))
    .filter(x => x.d <= km)
    .sort((a, b) => (a.e.group === 'weather' && a.d === 0 ? -1 : 0) - (b.e.group === 'weather' && b.d === 0 ? -1 : 0) || a.d - b.d);
  renderNearby();
  fetchAddresses();
}

const key = e => `${(+e.lat).toFixed(4)},${(+e.lon).toFixed(4)}`;

// Resolve street addresses for listed events (one at a time; server caches and rate-limits)
let addrBusy = false;
async function fetchAddresses() {
  if (addrBusy) return;
  addrBusy = true;
  try {
    for (const { e } of S.nearby) {
      if (e.id.startsWith('cap-') || e.address || S.addr.has(key(e))) continue;
      const j = await api(`/api/geocode?lat=${e.lat}&lon=${e.lon}`).catch(() => null);
      S.addr.set(key(e), j?.address || '');
      const cell = document.querySelector(`[data-loc="${CSS.escape(e.id)}"]`);
      if (cell) cell.innerHTML = locHtml(e);
    }
  } finally { addrBusy = false; }
}

function locHtml(e) {
  const a = e.address || S.addr.get(key(e));
  const ref = L_(e.location);
  if (e.id.startsWith('cap-')) return esc(ref);
  if (a === undefined) return `${esc(ref)}<br><small class="muted">${esc(t('loading'))}</small>`;
  return esc(a || ref) + (a && ref && ref !== a ? `<br><small>${esc(ref)}</small>` : '');
}

// Radius slider for the hazards list
$('#hazardRadius').addEventListener('input', e => {
  S.hazardRadiusKm = +e.target.value;
  radiusCircle?.setRadius(S.hazardRadiusKm * 1000);
  computeNearby();
  updatePlacesCircle();
});
$('#hazardRadius').addEventListener('change', () => {
  if (radiusCircle) map.fitBounds(radiusCircle.getBounds(), { padding: [20, 20] });
});

function renderNearby() {
  const km = S.hazardRadiusKm;
  $('#nearbyTitle').textContent = t('nearbyTitle', { km });
  $('#hazardRadius').value = km;
  $('#hazardRadiusVal').textContent = `${km} km`;
  const counts = { all: S.nearby.length, road: 0, weather: 0, people: 0 };
  S.nearby.forEach(({ e }) => counts[e.group]++);
  $$('[data-count]').forEach(b => (b.textContent = `(${counts[b.dataset.count]})`));
  $$('.chip').forEach(c => c.classList.toggle('active', c.dataset.filter === S.filter));

  const rows = S.nearby.filter(({ e }) => S.filter === 'all' || e.group === S.filter);
  const body = $('#eventRows');
  if (!S.pos) { body.innerHTML = `<tr><td colspan="6" class="empty">${esc(t('locating'))}</td></tr>`; return; }
  if (!rows.length) { body.innerHTML = `<tr><td colspan="6" class="empty">${icon('check', 32, 'style="margin:0 auto 8px;color:#1f9a5a"')}${esc(t('noNearby', { km }))}</td></tr>`; return; }
  body.innerHTML = rows.map(({ e, d }) => {
    const src = e.src === 'people' ? t('srcPeople') : e.src === 'LVC' ? 'LVC' : 'LVĢMC';
    const until = e.until ? esc(fmtTime(e.until)) + (e.untilEstimated ? `<small>${esc(t('estimated'))}</small>` : '') : esc(t('unknown'));
    const desc = L_(e.desc) && L_(e.desc) !== L_(e.title) ? L_(e.desc) : '';
    return `<tr class="row" data-id="${esc(e.id)}">
      <td><div class="ev-name"><span class="ev-ic ${e.group} ${e.icon}">${icon(e.icon, 20)}</span>
        <div>${esc(L_(e.title))}${e.count > 1 ? ` <span class="ev-dist">×${e.count}</span>` : ''}<div class="ev-dist">${d === 0 ? '📍 0 km' : d.toFixed(1) + ' km'}</div></div></div></td>
      <td class="ev-desc"><span>${esc(desc)}</span></td>
      <td class="ev-loc" data-loc="${esc(e.id)}">${locHtml(e)}</td>
      <td class="ev-until">${until}</td>
      <td class="ev-src">${esc(src)}</td>
      <td class="ev-go">${icon('chevron', 20)}</td></tr>`;
  }).join('');
}

function focusEvent(id) {
  const e = S.events.find(x => x.id === id);
  const m = markerById.get(id);
  if (!e || !m) return;
  const lk = layerOf(e);
  if (!S.layerOn[lk]) { S.layerOn[lk] = true; layers[lk].addTo(map); $(`[data-layer="${lk}"]`).checked = true; }
  map.flyTo([e.lat, e.lon], Math.max(map.getZoom(), 13), { duration: .6 });
  setTimeout(() => m.openPopup(), 650);
  $('.map-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------- safety places: shelters, fuel stations, crisis ATMs ----------
const PLACE_LIST_STEP = 6, PLACES_ALL_ZOOM = 14;
const placeMarkers = new Map();
let placesCircle = null;
S.placeRadiusKm = 10; // every visit starts at 10 km
S.placeListLimit = PLACE_LIST_STEP;
S.pinnedPlace = null; // a place opened from the list stays on the map even outside the radius

// One cluster group per kind: nearby markers merge into a numbered bubble in the kind's colour
function placeCluster(kind) {
  return L.markerClusterGroup({
    maxClusterRadius: 45, showCoverageOnHover: false, disableClusteringAtZoom: 16,
    iconCreateFunction: c => L.divIcon({
      className: 'mk-wrap', html: `<div class="pcl ${kind}">${icon(kind, 14)}<b>${c.getChildCount()}</b></div>`,
      iconSize: [46, 30], iconAnchor: [23, 15],
    }),
  });
}

async function loadPlaces() {
  try {
    const j = await api('/api/places');
    S.places = j.places;
    if (!j.ready) setTimeout(loadPlaces, 4000);
    drawPlaces(); renderPlaces();
  } catch (e) { console.error(e); }
}

function placeAddress(p) {
  return p.address || S.addr.get(key(p)) || '';
}

function placePopup(p) {
  const addr = placeAddress(p);
  const extra = p.kind === 'atm' ? t('critAtm') : '';
  return `<div class="pp-title"><span class="pi place ${p.kind}">${icon(p.kind, 18)}</span>${esc(L_(p.name))}</div>
    ${L_(p.details) ? `<div class="pp-desc">${esc(L_(p.details))}</div>` : ''}
    ${extra ? `<div class="pp-desc">${esc(extra)}</div>` : ''}
    <div class="pp-meta">
      <span>${icon('pin', 14)}</span><b class="pp-addr">${esc(addr || t('loading'))}</b>
      <span>${esc(t('popupSource'))}</span><b>${esc(p.src)}</b>
    </div>
    ${p.link ? `<div class="pp-desc"><a href="${esc(p.link)}" target="_blank" rel="noopener">${esc(t('moreInfo'))} ↗</a></div>` : ''}`;
}

function placeMarker(p) {
  const m = L.marker([p.lat, p.lon], {
    icon: L.divIcon({ className: 'mk-wrap', html: `<div class="pmk ${p.kind}">${icon(p.kind, 16)}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
  }).bindPopup(() => placePopup(p), { maxWidth: 320 });
  m.on('popupopen', () => resolvePlaceAddress(p, m));
  return m;
}

// Shows every place within the chosen radius (clustered); when zoomed in, also everything in view.
function drawPlaces() {
  updatePlacesCircle();
  if (!S.places.length) return;
  const bounds = map.getBounds().pad(0.2), zoomed = map.getZoom() >= PLACES_ALL_ZOOM;
  const wanted = new Set();
  for (const p of S.places) {
    const inRadius = S.pos && distKm(S.pos[0], S.pos[1], p.lat, p.lon) <= S.placeRadiusKm;
    if (inRadius || (zoomed && bounds.contains([p.lat, p.lon])) || p.id === S.pinnedPlace) wanted.add(p.id);
  }
  const remove = { shelter: [], fuel: [], atm: [] }, add = { shelter: [], fuel: [], atm: [] };
  for (const [id, m] of placeMarkers)
    if (!wanted.has(id)) { remove[id.split('-')[0]].push(m); placeMarkers.delete(id); }
  for (const p of S.places) {
    if (!wanted.has(p.id) || placeMarkers.has(p.id)) continue;
    const m = placeMarker(p);
    placeMarkers.set(p.id, m);
    add[p.kind].push(m);
  }
  for (const kind in add) {
    if (remove[kind].length) layers[kind].removeLayers(remove[kind]);
    if (add[kind].length) layers[kind].addLayers(add[kind]);
  }
}

// Dotted green circle for the places radius (the purple circle stays the 10 km hazard radius)
function updatePlacesCircle() {
  if (!S.pos) return;
  const hazardKm = S.hazardRadiusKm;
  if (S.placeRadiusKm === hazardKm) { placesCircle?.remove(); placesCircle = null; return; }
  if (!placesCircle) placesCircle = L.circle(S.pos, { color: '#157a45', weight: 2, dashArray: '2 6', fill: false, interactive: false }).addTo(map);
  placesCircle.setLatLng(S.pos).setRadius(S.placeRadiusKm * 1000);
}

async function resolvePlaceAddress(p, marker) {
  if (placeAddress(p) || S.addr.has(key(p))) return;
  const j = await api(`/api/geocode?lat=${p.lat}&lon=${p.lon}`).catch(() => null);
  S.addr.set(key(p), j?.address || '');
  if (marker?.isPopupOpen()) marker.setPopupContent(placePopup(p));
  const cell = document.querySelector(`[data-ploc="${CSS.escape(p.id)}"]`);
  if (cell) cell.textContent = placeAddress(p) || '—';
}

// ---------- offline PDF (always available) ----------
function renderOffline() {
  $('#offSub').innerHTML = esc(t('offSub', { km: S.placeRadiusKm })) + ` <a href="#" id="offRadiusLink">${esc(t('offChange'))}</a>`;
}

let offBusy = false;
async function downloadOfflinePdf() {
  if (offBusy) return;
  const [lat, lon] = S.pos || RIGA;
  offBusy = true;
  $('#offBtn').disabled = true; $('#offBtnText').textContent = t('offPreparing');
  try {
    const r = await fetch(`/api/offline-pdf?lat=${lat}&lon=${lon}&radius=${S.placeRadiusKm}&lang=${S.lang}`);
    if (!r.ok) throw new Error(r.status);
    const name = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'krizes-karte.pdf';
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(t('offDone'), 'ok');
  } catch (e) {
    console.error(e); toast(t('errGeneric'), 'alert');
  } finally {
    offBusy = false; $('#offBtn').disabled = false; $('#offBtnText').textContent = t('offBtn');
  }
}
$('#offBtn').addEventListener('click', downloadOfflinePdf);
document.addEventListener('click', ev => {
  if (!ev.target.closest('#offRadiusLink')) return;
  ev.preventDefault();
  $('.places-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#placeRadius').focus({ preventScroll: true });
});

function renderPlaces() {
  renderOffline();
  const km = S.placeRadiusKm;
  $('#placesTitle').textContent = t('placesTitle');
  $('#placeRadius').value = km;
  $('#placeRadiusVal').textContent = `${km} km`;
  $$('.ptab').forEach(b => { const on = S.placeKinds.has(b.dataset.kind); b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
  const body = $('#placeRows'), more = $('#placesMore');
  more.hidden = true;
  if (!S.pos || !S.places.length) {
    $$('[data-pcount]').forEach(b => (b.textContent = ''));
    body.innerHTML = `<tr><td colspan="5" class="empty">${esc(t(S.pos ? 'loading' : 'locating'))}</td></tr>`;
    return;
  }
  const withDist = S.places.map(p => ({ p, d: distKm(S.pos[0], S.pos[1], p.lat, p.lon) })).sort((a, b) => a.d - b.d);
  for (const kind of ['shelter', 'fuel', 'atm'])
    $(`[data-pcount="${kind}"]`).textContent = `(${withDist.filter(x => x.p.kind === kind && x.d <= km).length})`;

  // all selected categories together, nearest first regardless of category
  const ofKind = withDist.filter(x => S.placeKinds.has(x.p.kind));
  const near = ofKind.filter(x => x.d <= km);
  const rows = near.length ? near.slice(0, S.placeListLimit) : ofKind.slice(0, 3);
  const NOTE = { shelter: 'placesNoteShelter', fuel: 'placesNoteFuel', atm: 'placesNoteAtm' };
  const KIND_LABEL = { shelter: 'kShelter', fuel: 'kFuel', atm: 'kAtm' };
  const notes = ['shelter', 'fuel', 'atm'].filter(k => S.placeKinds.has(k)).map(k => esc(t(NOTE[k]))).join(' ');
  $('#placesNote').innerHTML = `${notes} ${near.length ? '' : `<b>${esc(t('placesNoneNear', { km }))}</b>`}`;

  body.innerHTML = rows.map(({ p, d }) => `<tr class="prow" data-pid="${esc(p.id)}">
      <td><div class="ev-name"><span class="ev-ic place ${p.kind}">${icon(p.kind, 20)}</span><div>${esc(L_(p.name))}<div class="ev-dist pk-label ${p.kind}">${esc(t(KIND_LABEL[p.kind]))}</div></div></div></td>
      <td class="ev-loc" data-ploc="${esc(p.id)}">${esc(placeAddress(p) || t('loading'))}</td>
      <td class="ev-until">${d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km'}</td>
      <td class="ev-src">${esc(p.src)}</td>
      <td class="ev-go">${icon('chevron', 20)}</td></tr>`).join('');
  const left = near.length - rows.length;
  if (near.length && left > 0) { more.hidden = false; more.textContent = t('showMore'); }
  // fuel stations have no address in the source: resolve the listed ones
  (async () => { for (const { p } of rows) if (!placeAddress(p)) await resolvePlaceAddress(p); })();
}

function focusPlace(id) {
  const p = S.places.find(x => x.id === id);
  if (!p) return;
  if (!S.layerOn[p.kind]) { S.layerOn[p.kind] = true; layers[p.kind].addTo(map); $(`[data-layer="${p.kind}"]`).checked = true; }
  S.pinnedPlace = id;
  drawPlaces();
  const m = placeMarkers.get(id);
  $('.map-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
  map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 16), { duration: .6 });
  map.once('moveend', () => layers[p.kind].zoomToShowLayer(m, () => m.openPopup()));
}

$('#placeRadius').addEventListener('input', e => {
  S.placeRadiusKm = +e.target.value;
  S.placeListLimit = PLACE_LIST_STEP;
  renderPlaces(); drawPlaces();
});
$('#placeRadius').addEventListener('change', () => {
  if (!S.pos) return;
  const r = Math.max(S.placeRadiusKm, S.hazardRadiusKm) * 1000;
  map.fitBounds(L.latLng(S.pos).toBounds(r * 2), { padding: [20, 20] });
});
$('#placesMore').addEventListener('click', () => { S.placeListLimit += PLACE_LIST_STEP * 2; renderPlaces(); });

map.on('moveend', drawPlaces);
document.addEventListener('click', ev => {
  const tab = ev.target.closest('.ptab');
  if (tab) {
    // toggle the category; at least one stays selected
    const k = tab.dataset.kind;
    if (S.placeKinds.has(k)) { if (S.placeKinds.size > 1) S.placeKinds.delete(k); } else S.placeKinds.add(k);
    try { localStorage.setItem('placeKinds', JSON.stringify([...S.placeKinds])); } catch {}
    S.placeListLimit = PLACE_LIST_STEP;
    renderPlaces();
  }
  const row = ev.target.closest('tr.prow');
  if (row) focusPlace(row.dataset.pid);
});

// ---------- forecast ----------
async function loadForecast() {
  if (!S.pos) return;
  try {
    S.forecast = await api(`/api/forecast?lat=${S.pos[0]}&lon=${S.pos[1]}`);
    if (!S.forecast.ready) setTimeout(loadForecast, 15000); // big LVĢMC file still downloading on the server
  } catch (e) { console.error(e); }
  renderForecast();
}

function renderForecast() {
  const f = S.forecast;
  const place = f?.city ? `${f.city.name}${f.city.distanceKm > 1 ? ` (${f.city.distanceKm.toFixed(0)} km)` : ''}` : '…';
  $('#fcSub').textContent = t('fcSub', { place });
  $('#fcUpdated').textContent = t('dataUpdated', { t: f?.updated ? fmtFull(new Date(f.updated)) : '—' });
  const list = $('#fcList');
  if (!f) { list.innerHTML = `<div class="fc-ok">${esc(t('loading'))}</div>`; return; }
  if (!f.items.length) {
    list.innerHTML = f.ready
      ? `<div class="fc-ok">${icon('check')}<b>${esc(t('fcNone'))}</b>${esc(t('fcNoneSub'))}</div>`
      : `<div class="fc-ok">${esc(t('fcWait'))}</div>`;
    return;
  }
  list.innerHTML = f.items.map(it => {
    const capCls = it.capLevel ? 'cap-' + it.capLevel : '';
    const lvl = it.capLevel ? t('cap' + it.capLevel[0].toUpperCase() + it.capLevel.slice(1)) : it.level === 'high' ? t('lvlHigh') : t('lvlMedium');
    const now = Date.now();
    const when = it.from && new Date(it.from) > now
      ? t('possibleBetween', { a: fmtTime(it.from), b: fmtTime(it.until) })
      : t('possibleUntil', { t: fmtTime(it.until) });
    return `<div class="fc-item ${it.official ? 'official' : ''} ${capCls}">
      <div class="fc-ic">${icon(it.icon === 'warning' ? 'wind' : it.icon)}</div>
      <div>
        <div class="fc-top"><div class="fc-title">${esc(L_(it.title))}</div><span class="lvl ${capCls || it.level}">${esc(lvl)}</span></div>
        <div class="fc-desc">${esc(L_(it.desc))}</div>
        ${it.official ? `<div class="fc-desc"><b>${esc(t('official'))}</b> · ${esc(L_(it.location))}</div>` : ''}
        <div class="fc-when">${icon('clock')}${esc(when)}</div>
      </div></div>`;
  }).join('');
}

// ---------- session ----------
async function checkSession() {
  if (!S.token) return renderSession();
  try { S.user = (await api('/api/me')).user; }
  catch { S.token = null; sessionStorage.removeItem('token'); }
  renderSession();
}
function renderSession() {
  const el = $('#sessionLine');
  if (!S.user) { el.innerHTML = ''; return; }
  el.innerHTML = `${icon('user', 16)}<span>${esc(t('loggedAs', { u: S.user.username }))}</span> · <button id="logoutBtn">${esc(t('logout'))}</button>`;
  $('#logoutBtn').onclick = async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    S.token = null; S.user = null; sessionStorage.removeItem('token'); renderSession();
  };
}

// ---------- submit flow: login -> type -> report form ----------
function openModal(id) { $$('.overlay').forEach(o => (o.hidden = o.id !== id)); }
function closeAll() { $$('.overlay').forEach(o => (o.hidden = true)); }

function startSubmit() {
  S.afterLogin = null;
  if (S.user) openModal('typeModal');
  else { $('#loginError').hidden = true; $('#loginForm').reset(); openModal('loginModal'); setTimeout(() => $('#loginForm [name=username]').focus(), 50); }
}

$('#loginForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  try {
    const r = await api('/api/login', { method: 'POST', body: { username: fd.get('username'), password: fd.get('password') } });
    S.token = r.token; S.user = r.user; sessionStorage.setItem('token', r.token);
    renderSession();
    if (S.afterLogin) { const next = S.afterLogin; S.afterLogin = null; closeAll(); next(); } // e.g. removing a report
    else openModal('typeModal');
  } catch {
    const e = $('#loginError'); e.textContent = t('badLogin'); e.hidden = false;
  }
});

// ---------- removing published reports (any logged-in user, for everyone) ----------
function resolveButtonHtml() {
  return `<button class="pp-resolve" data-resolve>${icon('check', 16)}${esc(t('resolveBtn'))}</button>`;
}

async function resolveReport(id) {
  const e = S.events.find(x => x.id === id);
  if (!e) return;
  if (!S.user) {
    S.afterLogin = () => resolveReport(id);
    $('#loginError').hidden = true; $('#loginForm').reset(); openModal('loginModal');
    return;
  }
  try {
    const r = await api('/api/reports/resolve', { method: 'POST', body: { ids: e.reportIds } });
    map.closePopup();
    toast(t('resolvedToast', { n: r.removed }), 'ok');
    loadEvents();
  } catch (err) {
    if (err.status === 401) { S.user = null; S.token = null; sessionStorage.removeItem('token'); renderSession(); return resolveReport(id); }
    toast(t('errGeneric'), 'alert');
  }
}

// Two-step confirmation inside the popup (capture phase: Leaflet stops click propagation out of popups)
document.addEventListener('click', ev => {
  const box = ev.target.closest('.pp-actions');
  if (!box || !ev.target.closest('button')) return;
  ev.stopPropagation(); // the button gets replaced; Leaflet would otherwise treat this as a map click and close the popup
  const id = box.dataset.for, e = S.events.find(x => x.id === id);
  if (ev.target.closest('[data-resolve]')) {
    box.innerHTML = `<div class="pp-confirm">${esc(t(e?.count > 1 ? 'resolveConfirmMany' : 'resolveConfirm', { n: e?.count || 1 }))}</div>
      <div class="pp-confirm-btns"><button class="pp-yes" data-resolve-yes>${esc(t('resolveYes'))}</button><button class="pp-no" data-resolve-no>${esc(t('resolveNo'))}</button></div>`;
  } else if (ev.target.closest('[data-resolve-no]')) {
    box.innerHTML = resolveButtonHtml();
  } else if (ev.target.closest('[data-resolve-yes]')) {
    resolveReport(id);
  }
}, true);

function renderTypeList() {
  if (!S.config) return;
  $('#typeList').innerHTML = Object.entries(S.config.reportTypes).map(([k, v]) =>
    `<button class="type-opt" data-type="${k}"><span class="t-ic">${icon(v.icon)}</span><span class="t-name">${esc(v[S.lang])}</span><span class="chev">${icon('chevron')}</span></button>`).join('');
}
$('#typeList').addEventListener('click', ev => {
  const b = ev.target.closest('[data-type]');
  if (b) { closeAll(); openReport(b.dataset.type); }
});

// report screen state
const R = { type: null, lat: null, lon: null, time: null, address: '', editing: false, map: null, marker: null, badWords: [] };

function openReport(type) {
  R.type = type; R.time = new Date(); R.editing = false; R.address = ''; R.badWords = [];
  [R.lat, R.lon] = S.pos || RIGA;
  $('#reportScreen').hidden = false;
  $('#rcDesc').value = ''; $('#reportError').hidden = true;
  $('#rcTypeSelect').innerHTML = Object.entries(S.config.reportTypes).map(([k, v]) => `<option value="${k}">${esc(v[S.lang])}</option>`).join('');
  if (!R.map) {
    R.map = L.map('reportMap', { zoomControl: false }).setView([R.lat, R.lon], 17);
    L.control.zoom({ position: 'topright' }).addTo(R.map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'base-tiles', attribution: '&copy; OpenStreetMap' }).addTo(R.map);
    R.map.on('click', e => { if (R.editing) moveReportMarker(e.latlng.lat, e.latlng.lng); });
  }
  setTimeout(() => { R.map.invalidateSize(); R.map.setView([R.lat, R.lon], 17); }, 50);
  placeReportMarker();
  setEditing(false);
  fillReportCard();
  lookupReportAddress();
  updateWordCount();
}

function placeReportMarker() {
  const ic = L.divIcon({ className: 'pick-marker', html: `<div class="mk">${icon(S.config.reportTypes[R.type].icon)}</div>`, iconSize: [64, 64], iconAnchor: [32, 32] });
  if (R.marker) { R.marker.setLatLng([R.lat, R.lon]); R.marker.setIcon(ic); }
  else {
    R.marker = L.marker([R.lat, R.lon], { icon: ic, draggable: false }).addTo(R.map);
    R.marker.on('dragend', () => { const p = R.marker.getLatLng(); moveReportMarker(p.lat, p.lng); });
  }
}

function moveReportMarker(lat, lon) {
  R.lat = lat; R.lon = lon; R.marker.setLatLng([lat, lon]);
  fillReportCard(); lookupReportAddress();
}

async function lookupReportAddress() {
  const want = [R.lat, R.lon];
  $('#rcAddress').value = t('loading');
  const j = await api(`/api/geocode?lat=${R.lat}&lon=${R.lon}`).catch(() => ({}));
  if (want[0] !== R.lat || want[1] !== R.lon) return;
  R.address = j.address || ''; $('#rcAddress').value = R.address;
  R.addressPinned = true; // address matches the marker
}

// ---------- address autocomplete: typing an address suggests matches; picking one moves the marker there ----------
const addrBox = $('#addrSuggest');
let addrTimer = null, addrItems = [], addrActive = -1;

function setReportLocation(lat, lon, label) {
  R.lat = lat; R.lon = lon;
  R.marker.setLatLng([lat, lon]);
  R.map.setView([lat, lon], Math.max(R.map.getZoom(), 17));
  R.address = label; $('#rcAddress').value = label;
  R.addressPinned = true;
  hideSuggestions();
  fillReportCard();
  updateWordCount();
}

async function searchAddress(q) {
  const j = await api(`/api/address-search?q=${encodeURIComponent(q)}&lat=${R.lat}&lon=${R.lon}`).catch(() => ({ results: [] }));
  return j.results || [];
}

function hideSuggestions() { addrBox.hidden = true; addrItems = []; addrActive = -1; }

function renderSuggestions() {
  if (!addrItems.length) { addrBox.hidden = true; return; }
  addrBox.innerHTML = addrItems.map((r, i) =>
    `<button type="button" class="addr-opt${i === addrActive ? ' active' : ''}" data-i="${i}">${icon('pin', 16)}<span>${esc(r.label)}</span></button>`).join('');
  addrBox.hidden = false;
}

$('#rcAddress').addEventListener('input', e => {
  R.address = e.target.value;
  R.addressPinned = false; // typed text no longer matches the marker until a suggestion is picked
  clearTimeout(addrTimer);
  const q = e.target.value.trim();
  if (q.length < 3) { hideSuggestions(); return; }
  addrTimer = setTimeout(async () => {
    const results = await searchAddress(q);
    if ($('#rcAddress').value.trim() !== q) return; // user kept typing
    addrItems = results; addrActive = -1;
    renderSuggestions();
  }, 350);
});
$('#rcAddress').addEventListener('keydown', e => {
  if (addrBox.hidden) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); addrActive = (addrActive + 1) % addrItems.length; renderSuggestions(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); addrActive = (addrActive - 1 + addrItems.length) % addrItems.length; renderSuggestions(); }
  else if (e.key === 'Enter') { e.preventDefault(); const r = addrItems[Math.max(0, addrActive)]; if (r) setReportLocation(r.lat, r.lon, r.label); }
  else if (e.key === 'Escape') hideSuggestions();
});
addrBox.addEventListener('mousedown', e => {
  const b = e.target.closest('.addr-opt');
  if (!b) return;
  e.preventDefault(); // keep focus; pick before the input's blur hides the list
  const r = addrItems[+b.dataset.i];
  if (r) setReportLocation(r.lat, r.lon, r.label);
});
$('#rcAddress').addEventListener('blur', () => setTimeout(hideSuggestions, 150));

// Before sending: a typed address that was never matched is looked up, so the marker sits at that address
async function resolveTypedAddress() {
  if (R.addressPinned || !R.address.trim()) return;
  const [r] = await searchAddress(R.address.trim());
  if (r) { setReportLocation(r.lat, r.lon, R.address.trim()); toast(t('addrMatched', { a: r.label }), ''); }
  else toast(t('addrNotFound'), 'alert');
}

function fillReportCard() {
  const tp = S.config.reportTypes[R.type];
  $('#rcIcon').innerHTML = icon(tp.icon);
  $('#rcTypeName').textContent = tp[S.lang];
  $('#rcTypeSelect').value = R.type;
  $('#rcCoords').textContent = `${t('lat')}: ${R.lat.toFixed(5).replace('.', ',')} · ${t('lon')}: ${R.lon.toFixed(5).replace('.', ',')}`;
  $('#rcTime').value = localInput(R.time);
  $('#editBtnText').textContent = R.editing ? t('doneEditing') : t('editSubmission');
  $('#reportHint').textContent = R.editing ? t('editHint') + ' ' + t('dragHint') : '';
  $('#reportHint').hidden = !R.editing;
}

function setEditing(on) {
  R.editing = on;
  $('#reportForm').classList.toggle('editing', on);
  $('#editBtn').classList.toggle('on', on);
  $('#rcAddress').readOnly = !on; $('#rcTime').readOnly = !on;
  $('#rcAddress').placeholder = on ? t('addrPlaceholder') : '';
  if (!on) hideSuggestions();
  $('#rcTypeName').hidden = on; $('#rcTypeSelect').hidden = !on;
  if (R.marker) on ? R.marker.dragging.enable() : R.marker.dragging.disable();
  fillReportCard();
}
$('#editBtn').onclick = () => setEditing(!R.editing);
$('#rcTypeSelect').onchange = e => { R.type = e.target.value; placeReportMarker(); fillReportCard(); };
$('#rcTime').onchange = e => { const d = new Date(e.target.value); if (!isNaN(d)) R.time = d; };

const countWords = s => (s.trim().match(/\S+/g) || []).length;
let profTimer = null;
function updateWordCount() {
  const max = S.config.descriptionMaxWords, n = countWords($('#rcDesc').value);
  const c = $('#rcCount'); c.textContent = t('words', { n, max }); c.classList.toggle('over', n > max);
  clearTimeout(profTimer);
  profTimer = setTimeout(async () => {
    const j = await api('/api/profanity-check', { method: 'POST', body: { text: $('#rcDesc').value + ' ' + R.address } }).catch(() => ({ found: [] }));
    R.badWords = j.found || [];
    showReportProblems();
  }, 350);
  showReportProblems();
}
function showReportProblems() {
  const max = S.config.descriptionMaxWords, n = countWords($('#rcDesc').value);
  const err = $('#reportError');
  const msg = n > max ? t('tooManyWords', { max }) : R.badWords.length ? t('badWords', { w: R.badWords.join(', ') }) : '';
  err.textContent = msg; err.hidden = !msg;
  $('#sendBtn').disabled = !!msg;
}
$('#rcDesc').addEventListener('input', updateWordCount);

// The report is sent only with the "Iesniegt" button: Enter in a field must not submit it
$('#reportForm').addEventListener('submit', ev => ev.preventDefault());
$('#reportForm').addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA' && ev.target.id !== 'sendBtn') ev.preventDefault();
});
$('#sendBtn').addEventListener('click', async () => {
  const btn = $('#sendBtn'); btn.disabled = true;
  try {
    await resolveTypedAddress();
    const r = await api('/api/reports', { method: 'POST', body: {
      type: R.type, lat: R.lat, lon: R.lon, address: R.address,
      observed_at: R.time.toISOString(), description: $('#rcDesc').value,
    } });
    $('#reportScreen').hidden = true;
    const typeNow = R.type; R.type = null;
    toast(t('thanks'), 'ok');
    if (r.notification) toast(t('sentAlert', { n: r.notification.count, phone: r.notification.phone }), 'alert');
    await loadEvents();
    const mine = S.events.find(e => e.id === 'user-' + r.id) ||
      S.events.find(e => e.src === 'people' && e.kind === typeNow && distKm(e.lat, e.lon, R.lat, R.lon) < 0.06);
    if (mine) focusEvent(mine.id);
  } catch (e) {
    const err = $('#reportError');
    if (e.data?.error === 'profanity') err.textContent = t('badWords', { w: e.data.words.join(', ') });
    else if (e.status === 401) { $('#reportScreen').hidden = true; S.user = null; startSubmit(); return; }
    else err.textContent = t('errGeneric');
    err.hidden = false;
  } finally { btn.disabled = false; }
});

// ---------- wiring ----------
document.addEventListener('click', ev => {
  const a = ev.target.closest('[data-action]');
  if (a) {
    const act = a.dataset.action;
    if (act === 'open-submit') startSubmit();
    if (act === 'close') closeAll();
    if (act === 'close-report') { $('#reportScreen').hidden = true; R.type = null; }
  }
  const row = ev.target.closest('tr.row');
  if (row) focusEvent(row.dataset.id);
  const chip = ev.target.closest('.chip');
  if (chip) { S.filter = chip.dataset.filter; renderNearby(); }
  const lb = ev.target.closest('.lang button');
  if (lb) { S.lang = lb.dataset.lang; localStorage.setItem('lang', S.lang); applyLang(); }
});
$$('.overlay').forEach(o => o.addEventListener('click', ev => { if (ev.target === o) closeAll(); }));
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { closeAll(); } });
$$('[data-layer]').forEach(cb => cb.addEventListener('change', () => {
  const k = cb.dataset.layer; S.layerOn[k] = cb.checked;
  cb.checked ? layers[k].addTo(map) : map.removeLayer(layers[k]);
}));
$('#locateBtn').onclick = locate;
$('#fcInfoBtn').onclick = () => ($('#fcInfo').hidden = !$('#fcInfo').hidden);
$$('[data-icon]').forEach(el => { if (!el.innerHTML.trim()) el.innerHTML = icon(el.dataset.icon); });

if (innerWidth < 700) $('#layerBox').open = false; // keep the map free on phones

(async function init() {
  S.config = await api('/api/config');
  applyLang();
  layers.radar.addTo(map); loadRadar();
  await checkSession();
  loadEvents();
  loadPlaces();
  locate();
  setInterval(loadEvents, 5 * 60e3);       // road events / warnings / reports: every 5 min
  setInterval(loadForecast, 30 * 60e3);    // forecast: every 30 min
  setInterval(loadRadar, 10 * 60e3);
})();
