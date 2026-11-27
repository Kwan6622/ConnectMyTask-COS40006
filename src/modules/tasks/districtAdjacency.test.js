const test = require('node:test');
const assert = require('node:assert/strict');
const { isSameDistrict, isNearbyDistrict } = require('./districtAdjacency');

test('ward and its former district count as the same area', () => {
  assert.equal(isSameDistrict('District 1', 'Ben Thanh'), true);
  assert.equal(isSameDistrict('Ben Thanh', 'Sai Gon'), true);
  assert.equal(isSameDistrict('district 1', 'District 1'), true);
  assert.equal(isSameDistrict('District 1', 'Ban Co'), false);
});

test('neighbouring former districts match through their wards', () => {
  assert.equal(isNearbyDistrict('District 1', 'Nhieu Loc'), true);
  assert.equal(isNearbyDistrict('Ben Thanh', 'Ban Co'), true);
  assert.equal(isNearbyDistrict('Go Vap', 'Ben Thanh'), false);
  assert.equal(isNearbyDistrict('', 'Ben Thanh'), false);
});
