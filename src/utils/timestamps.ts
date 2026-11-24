export type TimestampMode = 'original' | 'sequential' | 'variable' | 'random';
export type TimestampRange = { start: string; end: string; timeZone: string; minInterval: number; maxInterval: number };

function getParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

export function fromZonedInput(input: string, timeZone: string): Date {
  const [datePart, timePart = '00:00'] = input.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second = 0] = timePart.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const p = getParts(new Date(guess), timeZone);
    const represented = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    guess += target - represented;
  }
  return new Date(guess);
}

export function validateRange(range: TimestampRange): string | undefined {
  if (!range.start || !range.end) return 'Choose both a start and an end time.';
  if (!Number.isFinite(fromZonedInput(range.start, range.timeZone).getTime()) || !Number.isFinite(fromZonedInput(range.end, range.timeZone).getTime())) return 'Enter a valid date and time.';
  if (fromZonedInput(range.start, range.timeZone) >= fromZonedInput(range.end, range.timeZone)) return 'The end time must be after the start time.';
  if (range.minInterval < 0 || range.maxInterval < range.minInterval) return 'Check the minimum and maximum interval.';
  return undefined;
}

export function assignTimestamps(count: number, mode: TimestampMode, range: TimestampRange, originals: Array<Date | undefined>, random = Math.random): Date[] {
  if (!count) return [];
  const start = fromZonedInput(range.start, range.timeZone).getTime();
  const end = fromZonedInput(range.end, range.timeZone).getTime();
  const span = Math.max(0, end - start);
  if (mode !== 'original' && span < count - 1) return Array.from({ length: count }, (_, i) => new Date(start + (span * i) / Math.max(1, count - 1)));
  if (mode === 'original') return Array.from({ length: count }, (_, i) => originals[i] ? new Date(originals[i]!) : new Date(start + Math.floor((span * i) / Math.max(1, count - 1))));
  if (mode === 'random') {
    const seconds = Math.floor(span / 1000);
    if (seconds + 1 < count) return assignTimestamps(count, 'sequential', range, originals, random);
    const seen = new Set<number>();
    return Array.from({ length: count }, () => {
      let value = 0;
      for (let attempts = 0; attempts < 100; attempts += 1) {
        value = Math.floor(random() * (seconds + 1));
        if (!seen.has(value)) break;
      }
      if (seen.has(value)) value = Array.from({ length: seconds + 1 }, (_, slot) => slot).find((slot) => !seen.has(slot)) ?? 0;
      seen.add(value);
      return new Date(start + value * 1000);
    });
  }
  if (mode === 'variable') {
    const intervals = count - 1;
    const minSeconds = Math.max(1, range.minInterval);
    const maxSeconds = Math.max(minSeconds, range.maxInterval);
    const availableSeconds = span / 1000;
    if (minSeconds * intervals > availableSeconds) return assignTimestamps(count, 'sequential', range, originals, random);
    const desired = Array.from({ length: intervals }, () => minSeconds + random() * (maxSeconds - minSeconds));
    const desiredTotal = desired.reduce((sum, value) => sum + value, 0);
    const baselineTotal = minSeconds * intervals;
    const scale = desiredTotal > availableSeconds && desiredTotal > baselineTotal ? (availableSeconds - baselineTotal) / (desiredTotal - baselineTotal) : 1;
    const result = [start];
    for (const value of desired) result.push(Math.min(end, result[result.length - 1] + (minSeconds + (value - minSeconds) * scale) * 1000));
    return result.map((value) => new Date(value));
  }
  return Array.from({ length: count }, (_, i) => new Date(start + Math.round((span * i) / Math.max(1, count - 1))));
}

export function formatStamp(date: Date, timeZone: string, twelveHour = false): string {
  const dateText = new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  const timeText = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: twelveHour }).format(date);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(date);
  const offset = parts.find((p) => p.type === 'timeZoneName')?.value.replace('GMT', 'GMT') ?? '';
  return `${dateText} ${timeText} ${offset}`;
}
