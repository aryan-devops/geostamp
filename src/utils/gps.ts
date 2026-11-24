const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (radiansValue: number) => (radiansValue * 180) / Math.PI;

export function isValidCoordinates(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function toDms(value: number, axis: 'lat' | 'lon', precision = 3): string {
  const absolute = Math.abs(value);
  const d = Math.floor(absolute);
  const minuteFloat = (absolute - d) * 60;
  const m = Math.floor(minuteFloat);
  const s = (minuteFloat - m) * 60;
  const hemi = axis === 'lat' ? (value < 0 ? 'S' : 'N') : value < 0 ? 'W' : 'E';
  return `${d}°${m}'${s.toFixed(precision)}"${hemi}`;
}

export function toDmsPair(lat: number, lon: number, precision = 3): string {
  return `${toDms(lat, 'lat', precision)} ${toDms(lon, 'lon', precision)}`;
}

export function formatDecimal(lat: number, lon: number): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

/** Move a point uniformly within a circle on the earth's surface. */
export function nearbyCoordinate(lat: number, lon: number, radiusMeters: number, random = Math.random): { lat: number; lon: number } {
  const earthRadius = 6_371_000;
  const distance = Math.sqrt(random()) * Math.max(0, radiusMeters);
  const bearing = random() * Math.PI * 2;
  const angularDistance = distance / earthRadius;
  const lat1 = radians(lat);
  const lon1 = radians(lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1), Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: Math.max(-90, Math.min(90, degrees(lat2))), lon: ((degrees(lon2) + 540) % 360) - 180 };
}
