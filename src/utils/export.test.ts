import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createZip } from './export';

describe('archive export', () => {
  it('creates an in-memory zip with the supplied files', async () => {
    const progress: number[] = [];
    const blob = await createZip([{ name: 'GeoStamp_001.txt', blob: new Blob(['local output']) }], (value) => progress.push(value));
    const archive = await JSZip.loadAsync(blob);
    expect(await archive.file('GeoStamp_001.txt')?.async('string')).toBe('local output');
    expect(progress[progress.length - 1]).toBe(100);
  });
});
