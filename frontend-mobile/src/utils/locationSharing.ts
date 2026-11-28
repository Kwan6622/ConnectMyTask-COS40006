export const LOCATION_SAMPLE_INTERVAL_MS = 5_000;
export const LOCATION_MIN_UPLOAD_INTERVAL_MS = 20_000;
export const LOCATION_MIN_UPLOAD_DISTANCE_METERS = 20;

export type LocationCoordinates = {
  latitude: number;
  longitude: number;
};

export type LastUploadedLocation = LocationCoordinates & {
  uploadedAt: number;
};

function distanceMeters(first: LocationCoordinates, second: LocationCoordinates): number {
  const radians = (value: number): number => value * Math.PI / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(first.latitude))
    * Math.cos(radians(second.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function shouldUploadLocation(
  current: LocationCoordinates,
  lastUploaded: LastUploadedLocation | null,
  now: number
): boolean {
  if (!lastUploaded) return true;
  return now - lastUploaded.uploadedAt >= LOCATION_MIN_UPLOAD_INTERVAL_MS
    || distanceMeters(current, lastUploaded) >= LOCATION_MIN_UPLOAD_DISTANCE_METERS;
}
