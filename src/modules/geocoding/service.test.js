const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyAddress, getResultWard, isStreetMatch, isHouseNumberMatch, toAlleyQuery } = require('./service');

// Shapes below are copied from real distancematrix.ai responses (2026-11-25).
function result(formatted, lat, lng, components = []) {
  return { formatted_address: formatted, geometry: { location: { lat, lng } }, address_components: components };
}

/** Mock the provider: `byWard` maps "with ward" / "no ward" queries to results. */
function mockGeocoder(handler) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url) => {
    const address = new URL(url).searchParams.get('address');
    calls.push(address);
    return { ok: true, status: 200, json: async () => ({ status: 'OK', result: handler(address) }) };
  };
  return { calls, restore: () => { global.fetch = original; } };
}

const isHinted = (address, ward) => address.includes(`, ${ward}, Ho Chi Minh`);

test.beforeEach(() => { process.env.GEOCODING_API_KEY = 'test-key'; });

test('house number is required before calling the provider', async () => {
  const geo = mockGeocoder(() => []);
  try {
    await assert.rejects(verifyAddress({ district: 'Sai Gon', streetName: 'Nguyen Hue' }), /house number/);
    assert.equal(geo.calls.length, 0);
  } finally { geo.restore(); }
});

test('accepts the address when the unhinted lookup lands in the chosen ward', async () => {
  const geo = mockGeocoder(() => [result('10 Nguyễn Huệ, Sài Gòn, Hồ Chí Minh 70000, Vietnam', 10.7729, 106.7052)]);
  try {
    const verified = await verifyAddress({ district: 'Sai Gon', streetName: '10 Nguyen Hue' });
    assert.equal(verified.latitude, 10.7729);
    assert.equal(geo.calls.length, 1);
    assert.ok(!geo.calls[0].includes('Sai Gon,'), 'first lookup must not carry the ward');
  } finally { geo.restore(); }
});

test('rejects a wrong ward even though the provider echoes it back kilometres away', async () => {
  const geo = mockGeocoder((address) => (isHinted(address, 'Vuon Lai')
    ? [result('50 Điện Biên Phủ, Vườn Lài, Hồ Chí Minh, Vietnam', 10.7700, 106.6700)]
    : [result('50 Điện Biên Phủ, Gia Định, Hồ Chí Minh, Vietnam', 10.8010, 106.7090)]));
  try {
    await assert.rejects(
      verifyAddress({ district: 'Vuon Lai', streetName: '50 Dien Bien Phu' }),
      /belongs to Gia Dinh, not Vuon Lai/
    );
  } finally { geo.restore(); }
});

test('accepts a ward-border address when both lookups are the same place', async () => {
  const geo = mockGeocoder((address) => (isHinted(address, 'Ban Co')
    ? [result('300 Nguyễn Thị Minh Khai, Bàn Cờ, Hồ Chí Minh, Vietnam', 10.77501, 106.68901)]
    : [result('300 Nguyễn Thị Minh Khai, Xuân Hòa, Hồ Chí Minh, Vietnam', 10.77510, 106.68920)]));
  try {
    const verified = await verifyAddress({ district: 'Ban Co', streetName: '300 Nguyen Thi Minh Khai' });
    assert.match(verified.address, /Bàn Cờ/);
  } finally { geo.restore(); }
});

test('uses the ward-hinted lookup when the unhinted one is a same-named street elsewhere', async () => {
  const geo = mockGeocoder((address) => (isHinted(address, 'An Dong')
    ? [result('500 Nguyễn Trãi, An Đông, Hồ Chí Minh, Vietnam', 10.7550, 106.6700)]
    : [result('500 Nguyễn Trãi, Lái Thiêu, Hồ Chí Minh, Vietnam', 10.9050, 106.7000)]));
  try {
    const verified = await verifyAddress({ district: 'An Dong', streetName: '500 Nguyen Trai' });
    assert.equal(verified.latitude, 10.7550);
  } finally { geo.restore(); }
});

test('ward names that contain each other are not confused', async () => {
  const geo = mockGeocoder(() => [result('10 Đ. Hoàng Văn Thụ, Tân Sơn Hòa, Hồ Chí Minh, Vietnam', 10.7994, 106.6605)]);
  try {
    await assert.rejects(verifyAddress({ district: 'Tan Son', streetName: '10 Hoang Van Thu' }), /belongs to Tan Son Hoa/);
    const ok = await verifyAddress({ district: 'Tan Son Hoa', streetName: '10 Hoang Van Thu' });
    assert.equal(ok.latitude, 10.7994);
  } finally { geo.restore(); }
});

test('ward is read from the formatted address, not from glued components', () => {
  assert.equal(getResultWard(result('600 Đ. Nguyễn Thị Minh Khai, Tân Phú, Tân Đông Hiệp, Hồ Chí Minh, Vietnam', 0, 0)), 'tan dong hiep');
  assert.equal(getResultWard(result('1500 Huỳnh Tấn Phát, P, Tân Mỹ, Hồ Chí Minh 700000, Vietnam', 0, 0)), 'tan my');
  assert.equal(getResultWard(result('Sai Gon, Ho Chi Minh, Vietnam', 0, 0, [{ types: ['locality'], long_name: 'sai gon ho chi minh' }])), 'sai gon');
});

test('street names match common spellings and reject other streets', () => {
  const r = result('100 3 Tháng 2, Diên Hồng, Hồ Chí Minh 700000, Vietnam', 0, 0, [{ types: ['route'], long_name: '3 tháng 2 diên hồng' }]);
  assert.equal(isStreetMatch(r, 'Ba Thang Hai'), true);
  assert.equal(isStreetMatch(r, '3 Thang 2'), true);
  assert.equal(isStreetMatch(r, 'Thang'), false);
  const lvs = result('50 Đ. Lê Văn Sỹ, Phú Nhuận, Hồ Chí Minh, Vietnam', 0, 0);
  assert.equal(isStreetMatch(lvs, 'Le Van Sy'), true);
});

test('house number must match exactly; alley results do not count', () => {
  assert.equal(isHouseNumberMatch(result('10 Nguyễn Huệ, Sài Gòn, Hồ Chí Minh, Vietnam', 0, 0), '10'), true);
  assert.equal(isHouseNumberMatch(result('100 Nguyễn Huệ, Sài Gòn, Hồ Chí Minh, Vietnam', 0, 0), '10'), false);
  const alley = result('Cách Mạng Tháng Tám/50 Hẻm 1073, Khu Phố 1, Tân Sơn Nhất, Hồ Chí Minh, Vietnam', 0, 0,
    [{ types: ['street_number'], long_name: '/50' }]);
  assert.equal(isHouseNumberMatch(alley, '50'), false);
  assert.equal(isHouseNumberMatch(result('A35 Bạch Đằng, Tân Sơn Hòa, Hồ Chí Minh, Vietnam', 0, 0), 'A35'), true);
});

// Real responses for "47/24 Bui Dinh Tuy" (2026-11-27): the typed form comes back
// empty or as a deeper sub-alley; the "24 Hem 47 ..." form resolves the exact house.
test('alley numbers are verified through the "<n> Hem <alley> <street>" lookup', async () => {
  const geo = mockGeocoder((address) => {
    if (address.startsWith('24 Hem 47 Bui Dinh Tuy')) {
      return [result('47/24 Hẻm 47 Bùi Đình Túy, Bình Thạnh, Hồ Chí Minh, Vietnam', 10.80704, 106.70800, [
        { types: ['street_number'], long_name: '47/24' },
        { types: ['route'], long_name: 'hẻm 47 bùi đình túy' },
      ])];
    }
    return [result('47/24/30C Bùi Đình Tuý, Bình Thạnh, Hồ Chí Minh 700000, Vietnam', 10.80696, 106.70623, [
      { types: ['street_number'], long_name: '47/24/30c' },
    ])];
  });
  try {
    const verified = await verifyAddress({ district: 'Binh Thanh', streetName: '47/24 Bui Dinh Tuy' });
    assert.equal(verified.address, '47/24 Hẻm 47 Bùi Đình Túy, Bình Thạnh, Hồ Chí Minh, Vietnam');
    assert.equal(verified.latitude, 10.80704);
    assert.deepEqual(geo.calls, ['47/24 Bui Dinh Tuy, Ho Chi Minh, Vietnam', '24 Hem 47 Bui Dinh Tuy, Ho Chi Minh, Vietnam']);
    await assert.rejects(verifyAddress({ district: 'Gia Dinh', streetName: '47/24 Bui Dinh Tuy' }), /belongs to Binh Thanh/);
  } finally { geo.restore(); }
});

test('alley form only applies to alley numbers and matches the alley route to the main street', () => {
  assert.equal(toAlleyQuery({ houseNumber: '47/24', roadName: 'Bui Dinh Tuy' }), '24 Hem 47 Bui Dinh Tuy');
  assert.equal(toAlleyQuery({ houseNumber: '12/3/5', roadName: 'Le Loi' }), '5 Hem 12/3 Le Loi');
  assert.equal(toAlleyQuery({ houseNumber: '47', roadName: 'Bui Dinh Tuy' }), null);
  const alley = result('47/24 Hẻm 47 Bùi Đình Túy, Bình Thạnh, Hồ Chí Minh, Vietnam', 0, 0, [{ types: ['route'], long_name: 'hẻm 47 bùi đình túy' }]);
  assert.equal(isStreetMatch(alley, 'Bui Dinh Tuy', '47/24'), true);
  assert.equal(isStreetMatch(alley, 'Bui Dinh Tuy', '48/24'), false, 'a different alley must not match');
  assert.equal(isHouseNumberMatch(alley, '47/24'), true);
  assert.equal(isHouseNumberMatch(result('47/24/30C Bùi Đình Tuý, Bình Thạnh, Hồ Chí Minh, Vietnam', 0, 0), '47/24'), false);
});
