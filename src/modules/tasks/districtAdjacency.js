const { HO_CHI_MINH_WARD_GROUPS } = require('../../shared/hoChiMinhWards');

const DISTRICT_NEIGHBORS = {
  'district 1': ['district 3', 'district 4', 'district 5', 'binh thanh', 'phu nhuan'],
  'district 2': ['district 1', 'district 9', 'thu duc', 'binh thanh'],
  'district 3': ['district 1', 'district 10', 'phu nhuan', 'binh thanh'],
  'district 4': ['district 1', 'district 7', 'district 8'],
  'district 5': ['district 1', 'district 6', 'district 10', 'district 11'],
  'district 6': ['district 5', 'district 11', 'tan phu', 'district 8'],
  'district 7': ['district 4', 'district 8', 'nha be'],
  'district 8': ['district 4', 'district 6', 'district 7', 'binh chanh'],
  'district 9': ['district 2', 'thu duc', 'district 12'],
  'district 10': ['district 3', 'district 5', 'district 11', 'tan binh'],
  'district 11': ['district 5', 'district 6', 'district 10', 'tan phu'],
  'district 12': ['go vap', 'tan binh', 'district 9', 'thu duc'],
  'binh thanh': ['district 1', 'district 2', 'district 3', 'phu nhuan', 'go vap'],
  'phu nhuan': ['district 1', 'district 3', 'binh thanh', 'tan binh', 'go vap'],
  'go vap': ['phu nhuan', 'binh thanh', 'district 12', 'tan binh'],
  'tan binh': ['phu nhuan', 'go vap', 'district 10', 'district 12', 'tan phu'],
  'tan phu': ['tan binh', 'district 6', 'district 11'],
  'thu duc': ['district 2', 'district 9', 'district 12'],
  'nha be': ['district 7', 'binh chanh'],
  'binh chanh': ['district 8', 'nha be'],
};

function normalizeDistrict(value) {
  return String(value || '').toLowerCase().trim();
}

// Tasks and users now store a ward (e.g. "Ben Thanh"), while provider
// profiles and older tasks may still hold a former district (e.g. "District 1").
// Map both forms to former-district keys so the two can be compared.
const WARD_TO_DISTRICTS = HO_CHI_MINH_WARD_GROUPS.reduce((acc, group) => {
  const districtKey = normalizeDistrict(group.oldDistrict);
  group.wards.forEach((ward) => {
    const wardKey = normalizeDistrict(ward);
    acc[wardKey] = [...(acc[wardKey] || []), districtKey];
  });
  return acc;
}, {});

const KNOWN_DISTRICTS = new Set([
  ...Object.keys(DISTRICT_NEIGHBORS),
  ...HO_CHI_MINH_WARD_GROUPS.map((group) => normalizeDistrict(group.oldDistrict)),
]);

function resolveDistricts(value) {
  const key = normalizeDistrict(value);
  if (!key) return [];
  const districts = new Set(WARD_TO_DISTRICTS[key] || []);
  if (KNOWN_DISTRICTS.has(key)) districts.add(key);
  return [...districts];
}

function isSameDistrict(a, b) {
  const aKey = normalizeDistrict(a);
  const bKey = normalizeDistrict(b);
  if (!aKey || !bKey) return false;
  if (aKey === bKey) return true;
  const bDistricts = resolveDistricts(bKey);
  return resolveDistricts(aKey).some((district) => bDistricts.includes(district));
}

function isNearbyDistrict(base, target) {
  const baseDistricts = resolveDistricts(base);
  const targetDistricts = resolveDistricts(target);
  if (!baseDistricts.length || !targetDistricts.length) return false;
  return baseDistricts.some((district) => (
    (DISTRICT_NEIGHBORS[district] || []).some((neighbor) => targetDistricts.includes(neighbor))
  ));
}

module.exports = {
  DISTRICT_NEIGHBORS,
  normalizeDistrict,
  resolveDistricts,
  isSameDistrict,
  isNearbyDistrict,
};
