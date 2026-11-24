import type { CropRect } from '../types';
import { FULL_CROP } from '../types';

export function cropForAspect(imageWidth: number, imageHeight: number, aspect: number): CropRect {
  if (!(aspect > 0)) return { ...FULL_CROP };
  const imageAspect = imageWidth / imageHeight;
  if (imageAspect > aspect) {
    const width = aspect / imageAspect;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = imageAspect / aspect;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

export function cropPixels(crop: CropRect, width: number, height: number) {
  const x = Math.round(crop.x * width);
  const y = Math.round(crop.y * height);
  const w = Math.max(1, Math.round(crop.width * width));
  const h = Math.max(1, Math.round(crop.height * height));
  return { x, y, width: Math.min(w, width - x), height: Math.min(h, height - y) };
}

export function fitDimensions(sourceWidth: number, sourceHeight: number, maxWidth?: number, maxHeight?: number) {
  const scale = Math.min(1, maxWidth ? maxWidth / sourceWidth : 1, maxHeight ? maxHeight / sourceHeight : 1);
  return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
}
