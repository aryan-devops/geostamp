import JSZip from 'jszip';

export type ExportFile = { name: string; blob: Blob };

export async function createZip(files: ExportFile[], onProgress?: (percent: number) => void): Promise<Blob> {
  const zip = new JSZip();
  for (const file of files) zip.file(file.name, file.blob);
  // JPEG and PNG content is already compressed; STORE keeps archive creation responsive.
  return zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => onProgress?.(meta.percent));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
