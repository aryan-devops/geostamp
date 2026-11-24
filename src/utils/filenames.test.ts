import { describe, expect, it } from 'vitest';
import { outputFilename, sanitizePrefix } from './filenames';

describe('output filename generation', () => {
  it('numbers outputs consistently and sanitizes unsafe characters', () => {
    expect(outputFilename('GeoStamp', 3, 'jpg')).toBe('GeoStamp_003.jpg');
    expect(outputFilename('trip/one', 12, 'png')).toBe('trip_one_012.png');
  });

  it('uses a safe default for an empty prefix', () => {
    expect(outputFilename('  ', 1, 'jpg')).toBe('GeoStamp_001.jpg');
    expect(sanitizePrefix('journey:one')).toBe('journey_one');
  });
});
