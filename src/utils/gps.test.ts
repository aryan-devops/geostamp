import { describe, expect, it } from 'vitest';
import { formatDecimal, isValidCoordinates, nearbyCoordinate, toDms, toDmsPair } from './gps';

describe('GPS utilities', () => {
  it('formats decimal coordinates as DMS with hemispheres', () => {
    expect(toDms(21.1779706, 'lat')).toBe('21°10\'40.694"N');
    expect(toDms(-81.6848856, 'lon')).toBe('81°41\'5.588"W');
    expect(toDmsPair(21.1779706, 81.6848856)).toBe('21°10\'40.694"N 81°41\'5.588"E');
  });

  it('checks decimal coordinate boundaries and formats them', () => {
    expect(isValidCoordinates(90, 180)).toBe(true);
    expect(isValidCoordinates(90.01, 0)).toBe(false);
    expect(isValidCoordinates(Number.NaN, 0)).toBe(false);
    expect(formatDecimal(21.2, -81.3)).toBe('21.200000, -81.300000');
  });

  it('keeps nearby coordinates within the requested radius', () => {
    const base = { lat: 21.25, lon: 81.63 };
    const point = nearbyCoordinate(base.lat, base.lon, 500, () => 0.75);
    expect(point.lat).not.toBe(base.lat);
    expect(point.lon).not.toBe(base.lon);
    const distance = Math.hypot((point.lat - base.lat) * 111_320, (point.lon - base.lon) * 111_320 * Math.cos(base.lat * Math.PI / 180));
    expect(distance).toBeLessThanOrEqual(501);
  });
});
