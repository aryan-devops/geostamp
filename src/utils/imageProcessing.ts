import type { AssignedValue, ImageRecord, OverlaySettings, Place } from '../types';
import { cropPixels, fitDimensions } from './crop';
import { toDmsPair } from './gps';
import { formatStamp } from './timestamps';

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This image could not be decoded by the browser.'));
    image.src = url;
  });
}

export function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The browser could not create an output image.')), type, quality));
}

export function overlayLines(assigned: AssignedValue, place: Place, overlay: OverlaySettings, timezone: string): string[] {
  const lines: string[] = [];
  if (overlay.showNetwork) lines.push(`Network: ${formatStamp(assigned.timestamp, timezone, overlay.twelveHour)}`);
  if (overlay.showLocal) lines.push(`Local: ${formatStamp(assigned.timestamp, timezone, overlay.twelveHour)}`);
  if (overlay.showCoordinates) lines.push(toDmsPair(assigned.lat, assigned.lon));
  const placeName = place.locality || place.name.split(',')[0]?.trim();
  if (overlay.showLocality && placeName) lines.push(placeName);
  const normalizedPlaceName = placeName?.trim().toLocaleLowerCase();
  const adminName = [place.division, place.district].find((name) => name && name.trim().toLocaleLowerCase() !== normalizedPlaceName);
  if (overlay.showDistrict && adminName) lines.push(adminName);
  if (overlay.showState && place.state) lines.push(place.state);
  return lines;
}

export async function renderProcessed(
  image: ImageRecord,
  assigned: AssignedValue,
  place: Place,
  overlay: OverlaySettings,
  timezone: string,
  maxWidth?: number,
  maxHeight?: number,
  type = 'image/jpeg',
) {
  const source = await loadImage(image.url);
  const crop = cropPixels(image.crop, source.naturalWidth, source.naturalHeight);
  const outputSize = image.cropOutput ?? { width: crop.width, height: crop.height };
  const fitted = fitDimensions(outputSize.width, outputSize.height, maxWidth, maxHeight);
  const canvas = document.createElement('canvas');
  canvas.width = fitted.width;
  canvas.height = fitted.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser.');
  if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  const lines = overlayLines(assigned, place, overlay, timezone);
  const scale = canvas.width / 1280;
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = overlay.color;
  ctx.font = `300 ${Math.max(10, overlay.fontSize * scale)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  ctx.shadowColor = `rgba(0,0,0,${Math.min(0.9, overlay.shadow / 10)})`;
  ctx.shadowBlur = overlay.shadow * scale;
  ctx.shadowOffsetX = scale;
  ctx.shadowOffsetY = scale;
  lines.forEach((line, index) => ctx.fillText(line, canvas.width - overlay.margin * scale, overlay.margin * scale + index * overlay.lineSpacing * scale));
  ctx.restore();
  return canvas;
}
