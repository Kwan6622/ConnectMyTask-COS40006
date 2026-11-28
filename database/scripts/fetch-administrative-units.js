/**
 * Refreshes src/shared/administrativeUnits.json from the public Vietnam provinces API (v2),
 * which lists the two-level units in force since 1 July 2025 (no districts).
 *
 *   node database/scripts/fetch-administrative-units.js
 *
 * Ward ids are the official ward codes, so every database branch and every client
 * refer to a ward by the same number. A new city needs a migration that inserts its rows.
 */
const fs = require('fs');
const path = require('path');

const SOURCE = 'https://provinces.open-api.vn/api/v2';
// The app is in English: names are stored without accents and without the
// Vietnamese unit word (Phuong / Xa / Dac khu); the unit type is kept in `type`.
const CITIES = [
  { id: 79, name: 'Ho Chi Minh City', geocodeName: 'Ho Chi Minh' },
  { id: 1, name: 'Hanoi', geocodeName: 'Ha Noi' },
];
// Same name twice in one city: add the former area so people can tell them apart.
const DISAMBIGUATE = {
  25807: 'Thanh An (Dau Tieng)', // Xa Thanh An, former Binh Duong
  27676: 'Thanh An (Can Gio)', // the other Thanh An commune, Can Gio
};

/** Strip accents: the source name of Thu Dau Mot becomes "Thu Dau Mot". */
function toAscii(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/\s+/g, ' ')
    .trim();
}
// The source API is Vietnamese; these match its unit words (phuong, xa, dac khu),
// written as escapes so the code itself holds no Vietnamese text.
const TYPES = { 'phường': 'ward', 'xã': 'commune', 'đặc khu': 'special_zone' };
const PREFIX = /^(Phường|Xã|Đặc khu)\s+/;

async function main() {
  const out = path.join(__dirname, '../../src/shared/administrativeUnits.json');
  // Keep ward centres from geocode-ward-centers.js; new wards get one by running it again.
  const previous = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { cities: [] };
  const centres = new Map(previous.cities.flatMap((c) => c.wards)
    .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng))
    .map((w) => [w.id, { lat: w.lat, lng: w.lng }]));
  const cities = [];
  for (const city of CITIES) {
    const response = await fetch(`${SOURCE}/p/${city.id}?depth=2`);
    if (!response.ok) throw new Error(`Province ${city.id}: HTTP ${response.status}`);
    const province = await response.json();
    cities.push({
      ...city,
      wards: province.wards
        .map((ward) => {
          const name = DISAMBIGUATE[ward.code] || toAscii(ward.name.replace(PREFIX, ''));
          return { id: ward.code, name, type: TYPES[ward.division_type] || 'ward', ...centres.get(ward.code) };
        })
        .sort((a, b) => a.id - b.id),
    });
  }
  const data = { source: SOURCE, effectiveFrom: '2025-07-01', fetchedAt: new Date().toISOString().slice(0, 10), cities };
  fs.writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
  cities.forEach((c) => console.log(`${c.name}: ${c.wards.length} units`));
}

main().catch((error) => { console.error(error); process.exit(1); });
