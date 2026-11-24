import { describe, expect, it } from 'vitest';
import { assignTimestamps, fromZonedInput, validateRange, type TimestampRange } from './timestamps';

const range: TimestampRange = { start: '2026-11-24T09:00', end: '2026-11-24T10:00', timeZone: 'Asia/Kolkata', minInterval: 30, maxInterval: 90 };

describe('timestamp assignment', () => {
  it('converts a local date-time in the selected zone', () => {
    expect(fromZonedInput('2026-11-24T09:00', 'Asia/Kolkata').toISOString()).toBe('2026-11-24T03:30:00.000Z');
  });

  it('validates the selected range', () => {
    expect(validateRange(range)).toBeUndefined();
    expect(validateRange({ ...range, end: range.start })).toMatch(/after/);
    expect(validateRange({ ...range, maxInterval: 2, minInterval: 3 })).toMatch(/interval/);
  });

  it('assigns unique sequential times within the range', () => {
    const values = assignTimestamps(50, 'sequential', range, []);
    expect(values).toHaveLength(50);
    expect(new Set(values.map((date) => date.getTime())).size).toBe(50);
    expect(values[0].getTime()).toBe(fromZonedInput(range.start, range.timeZone).getTime());
    expect(values[values.length - 1].getTime()).toBe(fromZonedInput(range.end, range.timeZone).getTime());
  });

  it('keeps original dates when present and fills missing values in range', () => {
    const original = new Date('2025-01-01T00:00:00Z');
    const values = assignTimestamps(2, 'original', range, [original, undefined]);
    expect(values[0]).toEqual(original);
    expect(values[1].getTime()).toBe(fromZonedInput(range.end, range.timeZone).getTime());
  });

  it('assigns distinct randomized timestamps inside the range', () => {
    const values = assignTimestamps(4, 'random', range, [], () => 0.25);
    expect(new Set(values.map((date) => date.getTime())).size).toBe(4);
    expect(values.every((date) => date >= fromZonedInput(range.start, range.timeZone) && date <= fromZonedInput(range.end, range.timeZone))).toBe(true);
  });

  it('keeps variable intervals in the requested band and range', () => {
    const values = assignTimestamps(5, 'variable', range, [], () => 0.5);
    const intervals = values.slice(1).map((date, index) => (date.getTime() - values[index].getTime()) / 1000);
    expect(intervals.every((seconds) => seconds >= 30 && seconds <= 90)).toBe(true);
    expect(values[values.length - 1].getTime()).toBeLessThanOrEqual(fromZonedInput(range.end, range.timeZone).getTime());
  });
});
