/**
 * Adds an approximate centre point (lat, lng) to every ward in
 * src/shared/administrativeUnits.json, used to rank tasks by distance.
 * Uses the same geocoding provider as address verification (GEOCODING_API_KEY).
 *
 *   node database/scripts/geocode-ward-centers.js          # only wards without a point
 *   node database/scripts/geocode-ward-centers.js --all    # redo every ward
 *
 * A point outside the city's bounding box is rejected and reported, so a wrong
 * match (e.g. a same-named place in another province) never gets stored.
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

const FILE = path.join(__dirname, '../../src/shared/administrativeUnits.json');
const GEOCODING_URL = process.env.GEOCODING_API_URL || 'https://api.distancematrix.ai/maps/api/geocode/json';
// Generous boxes around each city (HCMC includes former Binh Duong, Ba Ria-Vung Tau and Con Dao).
const BOUNDS = {
  79: { minLat: 8.4, maxLat: 11.6, minLng: 106.2, maxLng: 107.7 },
  1: { minLat: 20.5, maxLat: 21.5, minLng: 105.2, maxLng: 106.1 },
};

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** "Thanh An (Can Gio)" -> "Thanh An, Can Gio" so the former area helps the geocoder. */
function queryName(name) {
  const match = name.match(/^(.*?)\s*\((.*)\)$/);
  return match ? `${match[1]}, ${match[2]}` : name;
}

// Only used inside geocoder queries (the provider knows the Vietnamese unit word);
// stored names stay English.
const UNIT_WORD = { ward: 'Phuong', commune: 'Xa', special_zone: 'Dac khu' };
// Wards the provider only finds with their former district in the query.
const AREA_HINT = { 9568: 'Ha Dong' }; // Phu Luong, Hanoi
// Checked by hand: the provider returns these without a place name, so the name check rejects them.
const MANUAL_POINTS = {
  10402: { lat: 20.678, lng: 105.8211 }, // Ung Hoa commune, Hanoi (provider point for "Xa Ung Hoa")
};

const simplify = (value) => String(value || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
  .toLowerCase().replace(/^(phuong|xa|dac khu)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * First result inside the city's box whose own name is the ward we asked for.
 * The provider sometimes answers with a different place (asking for Dai Thanh
 * returned Hung Dao), so a result named otherwise is not trusted.
 */
async function geocode(query, box, wardName) {
  const url = new URL(GEOCODING_URL);
  url.searchParams.set('address', query);
  url.searchParams.set('key', process.env.GEOCODING_API_KEY);
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  const wanted = simplify(wardName);
  const hit = (body?.result || []).find((result) => {
    const point = result?.geometry?.location;
    const formatted = String(result?.formatted_address || '');
    const firstSegment = simplify(formatted.split(',')[0]);
    // Wards of the provinces merged into HCMC in 2025 come back labelled only
    // "Ho Chi Minh City, Binh Duong" (or Ba Ria - Vung Tau), with a per-ward point.
    const mergedProvinceLabel = /^ho chi minh city (binh duong|ba ria vung tau)( vietnam)?$/.test(simplify(formatted));
    return point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
      && point.lat >= box.minLat && point.lat <= box.maxLat
      && point.lng >= box.minLng && point.lng <= box.maxLng
      && (firstSegment === wanted || mergedProvinceLabel);
  });
  return hit ? hit.geometry.location : null;
}

async function main() {
  if (!process.env.GEOCODING_API_KEY) throw new Error('GEOCODING_API_KEY is not set');
  const redoAll = process.argv.includes('--all');
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const failed = [];
  let added = 0;

  for (const city of data.cities) {
    const box = BOUNDS[city.id];
    for (const ward of city.wards) {
      if (!redoAll && Number.isFinite(ward.lat) && Number.isFinite(ward.lng)) continue;
      if (MANUAL_POINTS[ward.id]) {
        Object.assign(ward, MANUAL_POINTS[ward.id]);
        added += 1;
        continue;
      }
      const queries = [
        `${queryName(ward.name)}, ${city.geocodeName}, Vietnam`,
        `${UNIT_WORD[ward.type] || ''} ${queryName(ward.name)}, ${city.geocodeName}, Vietnam`.trim(),
        ...(AREA_HINT[ward.id] ? [`${queryName(ward.name)}, ${AREA_HINT[ward.id]}, ${city.geocodeName}, Vietnam`] : []),
      ];
      let point = null;
      for (const query of queries) {
        try {
          point = await geocode(query, box, ward.name.replace(/\s*\(.*\)$/, ''));
        } catch (error) {
          failed.push(`${city.name} / ${ward.name}: ${error.message}`);
        }
        await sleep(120);
        if (point) break;
      }
      if (point) {
        ward.lat = Math.round(point.lat * 1e5) / 1e5;
        ward.lng = Math.round(point.lng * 1e5) / 1e5;
        added += 1;
      } else {
        failed.push(`${city.name} / ${ward.name}: no point inside the city`);
      }
    }
  }

  fs.writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${added} ward centres stored`);
  if (failed.length) {
    console.log(`${failed.length} need attention:`);
    failed.forEach((line) => console.log(`  ${line}`));
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
