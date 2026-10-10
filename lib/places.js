// Safety places shown on the main page: shelters, fuel stations, crisis ATMs.
//
//  shelters  VUGD / 112.lv shelter map (ArcGIS feature service behind https://www.112.lv/lv/patvertnes)
//  fuel      viss.lv fuel station map (https://viss.lv/karte?product=degvielas_uzpildes_stacijas)
//  atm       Latvijas Banka ATM map (https://www.bank.lv/pakalpojumi/bankomatu-karte) — only ATMs flagged "kritiskais"

const UA = { 'User-Agent': 'KrizesParvaldiba-prototype/1.0 (+https://github.com/FicusSus/KrizesParvaldiba)' };
const URLS = {
  shelters: 'https://services9.arcgis.com/f2QOaaoX08g1sAc2/arcgis/rest/services/PatvertnesDati_view/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&resultRecordCount=5000&f=geojson',
  fuel: 'https://viss.lv/karte?product=degvielas_uzpildes_stacijas',
  atm: 'https://projects.kartes.lv/daugava_api/?group_id=84e127a7-d8ae-4596-bca0-1a323582b085',
};

const state = { places: [], status: {} };

async function get(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

async function loadShelters() {
  const j = JSON.parse(await get(URLS.shelters));
  return j.features.filter(f => f.geometry).map(f => {
    const p = f.properties;
    const street = [p.ielasnosaukums, p.ekasnumurs].filter(Boolean).join(' ');
    return {
      id: 'shelter-' + p.objectid, kind: 'shelter',
      name: { lv: p.ekasgalvlietosanasveids || 'Patvertne', en: p.ekasgalvlietosanasveids || 'Shelter' },
      address: [street, p.pilsetasvaiapdzvietasnosaukums].filter(Boolean).join(', '),
      details: { lv: p.komentars || '', en: p.komentars || '' },
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      src: '112.lv (VUGD)',
    };
  });
}

// viss.lv embeds the map points as JS arrays: a=[ids] b=[lat] c=[lon] l=[logos] t=[titles]
async function loadFuel() {
  const html = await get(URLS.fuel);
  const start = html.indexOf('<script> a=');
  if (start < 0) throw new Error('viss.lv: map data not found');
  const block = html.slice(start + 8, html.indexOf('min_left_corner_lat=', start));
  const v = {};
  for (const part of block.split(/\];\s*/)) {
    const m = part.match(/^\s*(\w)=\[([\s\S]*)$/);
    if (m) v[m[1]] = m[2];
  }
  const nums = x => x.split(',').map(Number);
  const strs = x => [...x.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'"));
  const ids = nums(v.a), lats = nums(v.b), lons = nums(v.c), titles = strs(v.t);
  return ids.map((id, i) => ({
    id: 'fuel-' + id, kind: 'fuel',
    name: { lv: titles[i].replace(/,?\s*degvielas uzpildes stacija/i, '').trim(), en: titles[i].replace(/,?\s*degvielas uzpildes stacija/i, '').trim() },
    address: '', details: { lv: '', en: '' },
    lat: lats[i], lon: lons[i], link: `https://viss.lv/?p=${id}`,
    src: 'viss.lv',
  })).filter(p => p.lat && p.lon);
}

async function loadAtms() {
  const j = JSON.parse(await get(URLS.atm));
  return j.features.filter(f => f.geometry && f.properties.kritiskais_klqayKJ8rCL18Rv === '1').map(f => {
    const p = f.properties;
    return {
      id: 'atm-' + f.id, kind: 'atm',
      name: { lv: `${p.bank} krīzes bankomāts`, en: `${p.bank} crisis ATM` },
      address: p.name || '',
      details: {
        lv: [p.type && `Pakalpojumi: ${p.type}`, p.working_time && `Darba laiks: ${p.working_time}`].filter(Boolean).join('. '),
        en: [p.type_2JDlv2VtTGsNypf && `Services: ${p.type_2JDlv2VtTGsNypf}`, p.open_hours_zAVhAaYG21n4sP7 && `Opening hours: ${p.open_hours_zAVhAaYG21n4sP7}`].filter(Boolean).join('. '),
      },
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      src: 'Latvijas Banka',
    };
  });
}

async function track(name, fn) {
  const s = state.status[name] || (state.status[name] = {});
  try {
    const list = await fn();
    s.ok = true; s.error = null; s.count = list.length; s.updated = new Date().toISOString();
    return list;
  } catch (e) {
    s.ok = false; s.error = String(e.message || e);
    console.error(`[${name}]`, s.error);
    return null;
  }
}

let lists = { shelter: [], fuel: [], atm: [] };
async function loadAll() {
  const [sh, fu, at] = await Promise.all([
    track('shelters', loadShelters), track('fuel_stations', loadFuel), track('crisis_atms', loadAtms)]);
  lists = { shelter: sh || lists.shelter, fuel: fu || lists.fuel, atm: at || lists.atm };
  state.places = [...lists.shelter, ...lists.fuel, ...lists.atm];
}

function places() {
  return state.places;
}

function start() {
  loadAll();
  setInterval(loadAll, 6 * 3600e3); // these lists change rarely: refresh every 6 h
}

module.exports = { state, start, places, URLS };
