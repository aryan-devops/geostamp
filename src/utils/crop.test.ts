import { describe, expect, it } from 'vitest';
import { cropForAspect, cropPixels, fitDimensions } from './crop';

describe('crop calculations', () => {
  it('fits the requested aspect ratio inside the source image', () => {
    const crop = cropForAspect(1600, 900, 1);
    expect(crop.width).toBeCloseTo(0.5625);
    expect(crop.height).toBe(1);
    expect(crop.x).toBeCloseTo(0.21875);
  });

  it('converts a normalized crop into source pixels', () => {
    expect(cropPixels({ x: 0.25, y: 0.1, width: 0.5, height: 0.8 }, 1000, 500)).toEqual({ x: 250, y: 50, width: 500, height: 400 });
  });

  it('fits dimensions without enlarging or stretching the image', () => {
    expect(fitDimensions(4000, 2000, 1920, 1080)).toEqual({ width: 1920, height: 960 });
    expect(fitDimensions(800, 600, 1920, 1080)).toEqual({ width: 800, height: 600 });
  });
});
