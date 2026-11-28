const test = require('node:test');
const assert = require('node:assert/strict');
const nearby = require('./nearby');
const { WARDS } = require('../../shared/administrativeUnits');

const ward = (name, cityId = 79) => WARDS.find((w) => w.cityId === cityId && w.name === name);

test('every ward has a centre inside its city', () => {
  for (const w of WARDS) {
    assert.ok(Number.isFinite(w.lat) && Number.isFinite(w.lng), `${w.name} has no centre`);
    if (w.cityId === 79) assert.ok(w.lat > 8.4 && w.lat < 11.6 && w.lng > 106.2 && w.lng < 107.7, `${w.name} outside HCMC`);
    if (w.cityId === 1) assert.ok(w.lat > 20.5 && w.lat < 21.5 && w.lng > 105.2 && w.lng < 106.1, `${w.name} outside Hanoi`);
  }
});

test('distances between ward centres are realistic', () => {
  const km = (a, b) => nearby.distanceKm(nearby.wardCentre(ward(a).id), nearby.wardCentre(ward(b).id));
  assert.ok(km('Ben Thanh', 'Sai Gon') < 3, 'neighbouring central wards are close');
  assert.ok(km('Ben Thanh', 'Thu Dau Mot') > 15, 'former Binh Duong is far');
  assert.ok(km('Ben Thanh', 'Con Dao') > 150, 'the island is very far');
  const hanoi = nearby.distanceKm(nearby.wardCentre(ward('Ben Thanh').id), nearby.wardCentre(ward('Hoan Kiem', 1).id));
  assert.ok(hanoi > 1000, 'Hanoi is over 1000 km away');
});

test('location score falls with distance and is never negative', () => {
  assert.equal(nearby.locationScore(0), nearby.MAX_LOCATION_SCORE);
  const scores = [0, 1, 2, 4, 8, 15, 50].map(nearby.locationScore);
  for (let i = 1; i < scores.length; i += 1) assert.ok(scores[i] <= scores[i - 1]);
  assert.ok(nearby.locationScore(2) > nearby.locationScore(8));
  assert.equal(nearby.locationScore(null), 0);
  assert.equal(nearby.locationScore(1500), 0);
});

test('the provider point is the home when known, else the ward centre', () => {
  const home = { homeLatitude: 10.77, homeLongitude: 106.70, locationId: ward('Cat Lai').id };
  assert.deepEqual(nearby.providerPoint(home), { latitude: 10.77, longitude: 106.70 });
  const noHouse = { homeLatitude: null, homeLongitude: null, locationId: ward('Cat Lai').id };
  assert.deepEqual(nearby.providerPoint(noHouse), nearby.wardCentre(ward('Cat Lai').id));
  assert.equal(nearby.providerPoint({ locationId: null }), null);
});

test('the task point is the verified site, else the ward centre', () => {
  assert.deepEqual(nearby.taskPoint({ siteLatitude: 10.5, siteLongitude: 106.5, locationId: 1 }), { latitude: 10.5, longitude: 106.5 });
  assert.deepEqual(nearby.taskPoint({ siteLatitude: null, locationId: ward('Ben Thanh').id }), nearby.wardCentre(ward('Ben Thanh').id));
});

test('the shown distance is rounded to 0.5 km so the exact site stays private', () => {
  assert.equal(nearby.displayDistanceKm(0.12), 0.5);
  assert.equal(nearby.displayDistanceKm(1.26), 1.5);
  assert.equal(nearby.displayDistanceKm(3.7), 3.5);
  assert.equal(nearby.displayDistanceKm(null), null);
});
