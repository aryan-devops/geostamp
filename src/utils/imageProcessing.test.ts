import { describe, expect, it } from 'vitest';
import { overlayLines } from './imageProcessing';

describe('stamp place names', () => {
  it('uses the selected place name and avoids repeating it as the district', () => {
    const lines = overlayLines(
      { timestamp: new Date('2026-11-24T08:30:00Z'), lat: 21.25, lon: 81.63, isOriginalTime: false, isOriginalGps: false },
      { name: 'Raipur, Chhattisgarh, India', district: 'Raipur', state: 'Chhattisgarh' },
      { showNetwork: false, showLocal: true, showCoordinates: true, showLocality: true, showDistrict: true, showState: true, fontSize: 30, color: '#fff', shadow: 2, lineSpacing: 32, margin: 40, twelveHour: false },
      'Asia/Kolkata',
    );
    expect(lines.filter((line) => line === 'Raipur')).toHaveLength(1);
    expect(lines).toContain('Chhattisgarh');
  });
});
