export function sanitizePrefix(prefix: string): string {
  return prefix.trim().replace(/[\\/:*?"<>|]/g, '_') || 'GeoStamp';
}

export function outputFilename(prefix: string, index: number, extension: 'jpg' | 'png', width = 3): string {
  return `${sanitizePrefix(prefix)}_${String(index).padStart(width, '0')}.${extension}`;
}
