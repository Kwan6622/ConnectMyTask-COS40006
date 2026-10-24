export type ForegroundCoordinates = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

export type VerificationState = {
  isValid?: boolean;
  expiresAt?: string | null;
};

export function isVerificationCurrent(verification: VerificationState | null | undefined, now = Date.now()): boolean {
  if (!verification?.isValid || !verification.expiresAt) return false;
  const expiresAt = new Date(verification.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function buildLocationEvidence(
  coords: ForegroundCoordinates,
  timestamp: number
): { lat: number; lng: number; accuracy: number; timestamp: string } {
  if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)
    || coords.accuracy == null || !Number.isFinite(coords.accuracy) || coords.accuracy <= 0) {
    throw new Error('GPS did not provide valid coordinates and accuracy.');
  }
  const capturedAt = new Date(timestamp);
  if (Number.isNaN(capturedAt.getTime())) throw new Error('GPS timestamp is invalid.');
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy: coords.accuracy,
    timestamp: capturedAt.toISOString(),
  };
}

export function buildVerificationEvidence(
  coords: ForegroundCoordinates,
  timestamp: number,
  nonce = Math.random().toString(36).slice(2, 12)
) {
  return {
    requestId: `gps_${Math.trunc(timestamp)}_${nonce.replace(/[^A-Za-z0-9_-]/g, "")}`,
    ...buildLocationEvidence(coords, timestamp),
  };
}
