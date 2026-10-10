// Static map for the offline PDF: fetches OpenStreetMap tiles around a point so that the
// chosen radius fits the box, and provides a projection for drawing markers on top.
const UA = { 'User-Agent': 'KrizesParvaldiba-prototype/1.0 (+https://github.com/FicusSus/KrizesParvaldiba)' };
const TILE = 256;
const cache = new Map(); // "z/x/y" -> { buf, at }
const CACHE_MS = 24 * 3600e3;

const worldPx = (lat, lon, z) => {
  const n = TILE * 2 ** z, s = Math.sin(lat * Math.PI / 180);
  return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
};
const metersPerPx = (lat, z) => 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** z;

async function tile(z, x, y) {
  const key = `${z}/${x}/${y}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.buf;
  const r = await fetch(`https://tile.openstreetmap.org/${key}.png`, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`tile ${key}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  cache.set(key, { buf, at: Date.now() });
  return buf;
}

/**
 * @param boxPx  map size in tile pixels (drawn later at boxPt / boxPx scale)
 * @returns { z, tiles: [{x, y, left, top, buf}], project(lat, lon) -> [px, py] | null, radiusPx }
 */
async function fetchMap(lat, lon, radiusKm, nominalPx = 1000) {
  // Pick a zoom level, then size the box (in tile pixels) so the radius circle + 12 % margin fills it exactly.
  // The PDF scales the box to its fixed size, so tiles are drawn at 0.35–0.7 of the nominal scale (sharp but readable).
  const spanM = radiusKm * 1000 * 2 * 1.12;
  const zExact = Math.log2(156543.03392 * Math.cos(lat * Math.PI / 180) * nominalPx / spanM);
  let z = Math.ceil(zExact), boxPx = spanM / metersPerPx(lat, z);
  if (boxPx > nominalPx / 0.7) { z = Math.floor(zExact); boxPx = spanM / metersPerPx(lat, z); }
  z = Math.max(6, Math.min(16, z));
  boxPx = Math.round(spanM / metersPerPx(lat, z));
  const [cx, cy] = worldPx(lat, lon, z);
  const left = cx - boxPx / 2, top = cy - boxPx / 2;
  const jobs = [];
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + boxPx) / TILE); tx++)
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + boxPx) / TILE); ty++)
      jobs.push({ x: tx, y: ty, left: tx * TILE - left, top: ty * TILE - top });

  // fetch 4 at a time (OSM tile usage policy: modest, identified requests)
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < jobs.length) {
      const j = jobs[i++];
      j.buf = await tile(z, j.x, j.y).catch(() => null);
    }
  }));

  return {
    z, boxPx,
    tiles: jobs.filter(j => j.buf),
    radiusPx: radiusKm * 1000 / metersPerPx(lat, z),
    project(plat, plon) {
      const [x, y] = worldPx(plat, plon, z);
      return [x - left, y - top];
    },
  };
}

module.exports = { fetchMap };
