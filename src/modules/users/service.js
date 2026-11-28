const userRepository = require('./repository');
const { resolveWard, getWard } = require('../../shared/administrativeUnits');
const { verifyAddress } = require('../geocoding/service');
const warnings = require('./warnings');

// The ward id is the source of truth; `location` keeps the readable "Ward, City" text.
function wardFields(wardId) {
  const ward = resolveWard(wardId);
  return { locationId: ward.id, location: ward.location };
}

// The pickers need the city of the saved ward.
function withCity(user) {
  return user ? { ...user, cityId: getWard(user.locationId)?.cityId ?? null } : user;
}

function normalizeRole(role) {
  return String(role || '').toUpperCase();
}

function assertAuthenticated(user) {
  if (!user?.id) {
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    throw err;
  }
}

function assertProvider(user) {
  if (normalizeRole(user?.role) !== 'PROVIDER') {
    const err = new Error('Only providers can perform this action');
    err.statusCode = 403;
    throw err;
  }
}

function assertAdmin(user) {
  if (normalizeRole(user?.role) !== 'ADMIN') {
    const err = new Error('Only admins can perform this action');
    err.statusCode = 403;
    throw err;
  }
}

async function createUser(payload) {
  return userRepository.createUser(payload);
}

async function getUserById(id) {
  const user = await userRepository.getPublicUserById(id);
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }

  let providerRatingSummary = null;
  if (normalizeRole(user.role) === 'PROVIDER') {
    providerRatingSummary = await userRepository.getLatestProviderRatingsSummary(user.id);
  }

  return {
    ...user,
    providerRatingSummary,
  };
}

async function getMyProfile(currentUser) {
  assertAuthenticated(currentUser);
  const user = await userRepository.getUserById(currentUser.id);
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
  return {
    ...withCity(userRepository.toSafePrivateUser(user)),
    // Shown on the profile: how many warnings the account has and why.
    warningLimit: warnings.WARNING_LIMIT,
    warnings: await warnings.listWarnings(user.id),
  };
}

async function updateProviderProfile(currentUser, payload) {
  assertAuthenticated(currentUser);
  assertProvider(currentUser);
  const nextPayload = {
    ...(Object.prototype.hasOwnProperty.call(payload, 'address') ? { address: payload.address || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, 'city') ? { city: payload.city || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, 'specialties') ? { specialties: payload.specialties || [] } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, 'safetyComplianceAgreed')
      ? { safetyComplianceAgreed: Boolean(payload.safetyComplianceAgreed) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, 'shortBio') ? { shortBio: payload.shortBio || null } : {}),
  };

  return userRepository.upsertProviderProfile(currentUser.id, nextPayload);
}

async function addProviderCertificate(currentUser, payload) {
  assertAuthenticated(currentUser);
  assertProvider(currentUser);
  const profile = await userRepository.upsertProviderProfile(currentUser.id, {});
  return userRepository.createProviderCertificate({
    providerId: currentUser.id,
    providerProfileId: profile.id,
    title: payload.title,
    certificateType: payload.certificateType,
    fileUrl: payload.fileUrl,
    verificationStatus: 'PENDING',
  });
}

async function verifyProviderCertificate(certificateId, payload, currentUser) {
  assertAuthenticated(currentUser);
  assertAdmin(currentUser);
  const cert = await userRepository.getProviderCertificateById(certificateId);
  if (!cert) {
    const err = new Error('Certificate not found');
    err.statusCode = 404;
    throw err;
  }
  if (payload.verificationStatus === 'REJECTED' && !payload.rejectionReason) {
    const err = new Error('rejectionReason is required when rejecting a certificate');
    err.statusCode = 400;
    throw err;
  }
  return userRepository.updateProviderCertificateVerification(certificateId, {
    verificationStatus: payload.verificationStatus,
    rejectionReason: payload.verificationStatus === 'REJECTED' ? payload.rejectionReason : null,
    verifiedAt: new Date(),
    verifiedByAdminId: currentUser.id,
  });
}

async function getProviderRatingSummary(userId) {
  const user = await userRepository.getUserById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  if (normalizeRole(user.role) !== 'PROVIDER') {
    const err = new Error('Target user is not a provider');
    err.statusCode = 400;
    throw err;
  }
  return userRepository.getLatestProviderRatingsSummary(userId);
}

async function updateProfile(userId, payload) {
  const user = await userRepository.getUserById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  const data = {
    ...(Object.prototype.hasOwnProperty.call(payload, 'name') ? { name: payload.name } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, 'phone') ? { phone: payload.phone || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, 'wardId') ? wardFields(payload.wardId) : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, 'streetAddress') ? { streetAddress: payload.streetAddress || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, 'bio') ? { bio: payload.bio || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, 'profilePhotoUrl') ? { profilePhotoUrl: payload.profilePhotoUrl } : {}),
  };
  const wardChanged = 'locationId' in data && data.locationId !== user.locationId;
  const streetChanged = 'streetAddress' in data && data.streetAddress !== user.streetAddress;
  if (wardChanged || streetChanged) {
    Object.assign(data, await locateHome(
      'locationId' in data ? data.locationId : user.locationId,
      'streetAddress' in data ? data.streetAddress : user.streetAddress
    ));
  }
  return withCity(await userRepository.updateProfile(userId, data));
}

/**
 * Map point of the home address, used to rank nearby tasks. A house the map
 * cannot find still saves: the point is cleared and the ward centre is used.
 */
async function locateHome(wardId, streetAddress) {
  if (!wardId || !streetAddress) return { homeLatitude: null, homeLongitude: null };
  try {
    const found = await verifyAddress({ wardId, streetName: streetAddress });
    return { homeLatitude: found.latitude, homeLongitude: found.longitude };
  } catch {
    return { homeLatitude: null, homeLongitude: null };
  }
}

module.exports = {
  createUser,
  getUserById,
  getMyProfile,
  updateProfile,
  updateProviderProfile,
  addProviderCertificate,
  verifyProviderCertificate,
  getProviderRatingSummary,
};
