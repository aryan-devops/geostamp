import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import * as exifr from 'exifr';
import MapPicker from './components/MapPicker';
import type { AssignedValue, CropRect, ImageRecord, LocationValue, OverlaySettings, Place } from './types';
import { FULL_CROP } from './types';
import { cropForAspect } from './utils/crop';
import { formatDecimal, isValidCoordinates, nearbyCoordinate, toDmsPair } from './utils/gps';
import { assignTimestamps, formatStamp, fromZonedInput, validateRange, type TimestampMode, type TimestampRange } from './utils/timestamps';
import { createZip, downloadBlob } from './utils/export';
import { canvasBlob, loadImage, overlayLines, renderProcessed } from './utils/imageProcessing';
import { outputFilename, sanitizePrefix } from './utils/filenames';

type Theme = 'light' | 'dark';
type Prefs = { theme: Theme; fontSize: number; margin: number; twelveHour: boolean; quality: number };
type Override = { time?: string; lat?: string; lon?: string };
const PREF_KEY = 'geostamp-studio-preferences';
const DEFAULT_OVERLAY: OverlaySettings = { showNetwork: false, showLocal: true, showCoordinates: true, showLocality: true, showDistrict: true, showState: true, fontSize: 30, color: '#f8f8f7', shadow: 2, lineSpacing: 32, margin: 40, twelveHour: false };

function readPrefs(): Prefs {
  const fallback: Prefs = { theme: 'light', fontSize: 30, margin: 40, twelveHour: false, quality: 0.92 };
  try {
    const stored = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') as Partial<Prefs>;
    return {
      theme: stored.theme === 'dark' ? 'dark' : 'light',
      fontSize: typeof stored.fontSize === 'number' ? Math.max(18, Math.min(42, stored.fontSize)) : fallback.fontSize,
      margin: typeof stored.margin === 'number' ? Math.max(16, Math.min(96, stored.margin)) : fallback.margin,
      twelveHour: stored.twelveHour === true,
      quality: typeof stored.quality === 'number' ? Math.max(0.5, Math.min(1, stored.quality)) : fallback.quality,
    };
  } catch { return fallback; }
}
function dateTimeLocalInZone(date: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const v = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return `${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}`;
}
function initialRange(): TimestampRange {
  const zone = 'Asia/Kolkata';
  const now = new Date();
  const start = new Date(now); start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 8 * 60 * 60 * 1000);
  return { start: dateTimeLocalInZone(start, zone), end: dateTimeLocalInZone(end, zone), timeZone: zone, minInterval: 1, maxInterval: 9 };
}
function Icon({ children }: { children: string }) { return <span className="icon" aria-hidden="true">{children}</span>; }
function SectionTitle({ title, note }: { title: string; note?: string }) { return <div className="section-title"><div><h2>{title}</h2>{note && <p>{note}</p>}</div></div>; }

export default function App() {
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs());
  const [theme, setTheme] = useState<Theme>(prefs.theme);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [currentId, setCurrentId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [uploadMessage, setUploadMessage] = useState('');
  const [location, setLocation] = useState<LocationValue>({ lat: 0, lon: 0, place: { name: '' } });
  const [locationActive, setLocationActive] = useState(false);
  const [latInput, setLatInput] = useState('');
  const [lonInput, setLonInput] = useState('');
  const [timestampMode, setTimestampMode] = useState<TimestampMode>('variable');
  const [range, setRange] = useState<TimestampRange>(initialRange);
  const [gpsMode, setGpsMode] = useState<'same' | 'nearby' | 'original'>('same');
  const [radius, setRadius] = useState(100);
  const [customRadius, setCustomRadius] = useState(750);
  const [overlay, setOverlay] = useState<OverlaySettings>({ ...DEFAULT_OVERLAY, fontSize: prefs.fontSize, margin: prefs.margin, twelveHour: prefs.twelveHour });
  const [cropMode, setCropMode] = useState<'individual' | 'bulk'>('individual');
  const [outputFormat, setOutputFormat] = useState<'jpg' | 'png'>('jpg');
  const [quality, setQuality] = useState(prefs.quality);
  const [maxWidth, setMaxWidth] = useState('');
  const [maxHeight, setMaxHeight] = useState('');
  const [cropCustomWidth, setCropCustomWidth] = useState('');
  const [cropCustomHeight, setCropCustomHeight] = useState('');
  const [filenamePrefix, setFilenamePrefix] = useState('GeoStamp');
  const [beforeAfter, setBeforeAfter] = useState<'after' | 'before'>('after');
  const [cropEditorOpen, setCropEditorOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [showAssignments, setShowAssignments] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0, current: '' });
  const [zipPercent, setZipPercent] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [draggedId, setDraggedId] = useState('');
  const [cropDrag, setCropDrag] = useState<{ mode: 'move' | 'resize' | 'resize-top' | 'resize-bottom'; startX: number; startY: number; crop: CropRect } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const imagesRef = useRef<ImageRecord[]>([]);
  const cancelRef = useRef(false);
  const manualGeocodeTimer = useRef<number | undefined>(undefined);
  const skipPrefsWrite = useRef(false);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (skipPrefsWrite.current) { skipPrefsWrite.current = false; return; }
    const next = { ...prefs, theme, fontSize: overlay.fontSize, margin: overlay.margin, twelveHour: overlay.twelveHour, quality };
    setPrefs(next);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch { /* preferences are optional */ }
  }, [theme, overlay.fontSize, overlay.margin, overlay.twelveHour, quality]);
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => () => { imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url)); window.clearTimeout(toastTimer.current); window.clearTimeout(manualGeocodeTimer.current); }, []);
  useEffect(() => { if (locationActive) { setLatInput(location.lat.toFixed(6)); setLonInput(location.lon.toFixed(6)); } }, [location.lat, location.lon, locationActive]);
  const currentIndex = images.findIndex((image) => image.id === currentId);
  const current = images[currentIndex] ?? images[0];
  useEffect(() => {
    if (!current) { setCropCustomWidth(''); setCropCustomHeight(''); return; }
    const size = current.cropOutput ?? { width: current.width, height: current.height };
    setCropCustomWidth(String(size.width));
    setCropCustomHeight(String(size.height));
  }, [current?.id]);
  const activeIds = selectedIds.size ? selectedIds : new Set(images.map((image) => image.id));
  const rangeError = validateRange(range);
  const variableRangeError = !rangeError && timestampMode === 'variable' && images.length > 1 && Math.max(1, range.minInterval) * (images.length - 1) * 1000 > fromZonedInput(range.end, range.timeZone).getTime() - fromZonedInput(range.start, range.timeZone).getTime() ? 'This range is too short for the minimum interval. Widen the range or lower the minimum.' : undefined;

  const timestampAssignments = useMemo(() => assignTimestamps(images.length, timestampMode, range, images.map((image) => image.exifDate)), [images, timestampMode, range]);
  const assignments = useMemo<AssignedValue[]>(() => images.map((image, index) => {
    const override = overrides[image.id];
    const timestamp = override?.time ? fromZonedInput(override.time, range.timeZone) : timestampAssignments[index] ?? new Date();
    const lat = override?.lat !== undefined && override.lat !== '' ? Number(override.lat) : gpsMode === 'original' && image.exifLat !== undefined ? image.exifLat : location.lat;
    const lon = override?.lon !== undefined && override.lon !== '' ? Number(override.lon) : gpsMode === 'original' && image.exifLon !== undefined ? image.exifLon : location.lon;
    const nearby = gpsMode === 'nearby' ? nearbyCoordinate(location.lat, location.lon, radius === -1 ? customRadius : radius, () => 0.5 + (index + 1) / (images.length + 2) * 0.45) : undefined;
    return { timestamp, lat: nearby && override?.lat === undefined ? nearby.lat : lat, lon: nearby && override?.lon === undefined ? nearby.lon : lon, isOriginalTime: timestampMode === 'original' && Boolean(image.exifDate) && !override?.time, isOriginalGps: gpsMode === 'original' && image.exifLat !== undefined && image.exifLon !== undefined && !override?.lat && !override?.lon };
  }), [images, overrides, range.timeZone, timestampAssignments, timestampMode, gpsMode, location.lat, location.lon, radius, customRadius]);

  const notify = useCallback((message: string) => {
    setToast(message); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(''), 3600);
  }, []);
  const updateLocation = useCallback((next: LocationValue, selected = true) => { setLocation(next); if (selected) setLocationActive(true); }, []);
  const selectLocation = useCallback(() => setLocationActive(true), []);

  const currentAssignment = current ? assignments[images.indexOf(current)] : undefined;
  const currentCrop = current?.crop ?? FULL_CROP;
  const cropSizeText = current ? `${current.cropOutput?.width ?? Math.round(currentCrop.width * current.width)} × ${current.cropOutput?.height ?? Math.round(currentCrop.height * current.height)} px` : 'Add a photo to crop';
  const placeForAssignment = (assignment: AssignedValue, imageId?: string): Place => {
    const isBasePoint = Math.abs(assignment.lat - location.lat) < 0.000001 && Math.abs(assignment.lon - location.lon) < 0.000001;
    const hasManualGps = imageId ? overrides[imageId]?.lat !== undefined || overrides[imageId]?.lon !== undefined : false;
    return isBasePoint || (gpsMode === 'nearby' && locationActive && !hasManualGps) ? location.place : { name: '' };
  };
  const currentHasCoordinates = Boolean(locationActive || currentAssignment?.isOriginalGps || (current && overrides[current.id]?.lat !== undefined && overrides[current.id]?.lon !== undefined));
  const currentOverlay = currentAssignment ? overlayLines(currentAssignment, placeForAssignment(currentAssignment, current?.id), { ...overlay, showCoordinates: overlay.showCoordinates && currentHasCoordinates }, range.timeZone) : [];
  const openCropEditor = (imageId: string) => { setCurrentId(imageId); setCropMode('individual'); setBeforeAfter('before'); setCropEditorOpen(true); };
  const closeCropEditor = () => { setCropEditorOpen(false); setBeforeAfter('after'); setCropDrag(null); };

  useEffect(() => {
    if (!cropEditorOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeCropEditor(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cropEditorOpen]);

  useEffect(() => {
    const canvas = document.getElementById('final-preview') as HTMLCanvasElement | null;
    if (!canvas || !current || !currentAssignment || beforeAfter === 'before') return;
    let cancelled = false;
    renderProcessed(current, currentAssignment, placeForAssignment(currentAssignment, current.id), overlay, range.timeZone, 1600, 1100, outputFormat === 'png' ? 'image/png' : 'image/jpeg')
      .then((rendered) => {
        if (cancelled) return;
        canvas.width = rendered.width; canvas.height = rendered.height;
        const context = canvas.getContext('2d'); context?.drawImage(rendered, 0, 0);
      })
      .catch(() => { if (!cancelled) notify('Preview could not be rendered for this image.'); });
    return () => { cancelled = true; };
  }, [current, currentAssignment, location.place, overlay, range.timeZone, beforeAfter, quality, outputFormat, notify]);

  const processUpload = async (list: FileList | File[]) => {
    const all = Array.from(list);
    if (!all.length) return;
    const capacity = Math.max(0, 50 - images.length);
    const accepted: File[] = [];
    const issues: string[] = [];
    let acceptedBytes = images.reduce((total, image) => total + image.file.size, 0);
    for (const file of all) {
      if (!/\.(jpe?g|png)$/i.test(file.name) && !['image/jpeg', 'image/png'].includes(file.type)) issues.push(`${file.name}: unsupported format`);
      else if (file.size > 100 * 1024 * 1024) issues.push(`${file.name}: larger than 100 MB`);
      else if (acceptedBytes + file.size > 500 * 1024 * 1024) issues.push(`${file.name}: project is limited to 500 MB in browser memory`);
      else { accepted.push(file); acceptedBytes += file.size; }
    }
    const batch = accepted.slice(0, capacity);
    if (accepted.length > capacity) issues.push(`Only ${capacity} more image${capacity === 1 ? '' : 's'} fit the 50 image limit.`);
    setUploadMessage(issues.join(' · '));
    if (!batch.length) return;
    setUploadProgress({ done: 0, total: batch.length });
    const added: ImageRecord[] = [];
    for (const file of batch) {
      const url = URL.createObjectURL(file);
      try {
        const [source, meta] = await Promise.all([loadImage(url), exifr.parse(file, { exif: true, gps: true }).catch(() => undefined)]);
        const dateCandidate = meta?.DateTimeOriginal ?? meta?.CreateDate;
        const exifDate = dateCandidate instanceof Date ? dateCandidate : dateCandidate ? new Date(dateCandidate) : undefined;
        const exifLat = Number.isFinite(meta?.latitude) ? Number(meta.latitude) : undefined;
        const exifLon = Number.isFinite(meta?.longitude) ? Number(meta.longitude) : undefined;
        added.push({ id: crypto.randomUUID(), file, url, name: file.name, width: source.naturalWidth, height: source.naturalHeight, exifDate, exifLat, exifLon, crop: { ...FULL_CROP }, status: 'ready' });
      } catch (error) {
        URL.revokeObjectURL(url); issues.push(`${file.name}: ${(error as Error).message}`);
      }
      setUploadProgress((progressValue) => ({ ...progressValue, done: progressValue.done + 1 }));
    }
    if (added.length) {
      setImages((existing) => [...existing, ...added]);
      setCurrentId((id) => id || added[0].id);
      setSelectedIds((ids) => new Set([...ids, ...added.map((image) => image.id)]));
    }
    setUploadMessage(issues.join(' · '));
    window.setTimeout(() => setUploadProgress({ done: 0, total: 0 }), 900);
  };
  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) void processUpload(event.target.files); event.target.value = ''; };
  const onDrop = (event: DragEvent) => { event.preventDefault(); void processUpload(event.dataTransfer.files); };

  const removeImage = (id: string) => {
    const target = images.find((image) => image.id === id); if (target) URL.revokeObjectURL(target.url);
    const next = images.filter((image) => image.id !== id); setImages(next); setSelectedIds((items) => { const out = new Set(items); out.delete(id); return out; });
    setOverrides((items) => { const out = { ...items }; delete out[id]; return out; });
    if (currentId === id) setCurrentId(next[0]?.id ?? '');
  };
  const clearAll = () => {
    images.forEach((image) => URL.revokeObjectURL(image.url)); setImages([]); setCurrentId(''); setSelectedIds(new Set()); setOverrides({}); setUploadMessage(''); setUploadProgress({ done: 0, total: 0 });
  };
  const toggleSelect = (id: string) => setSelectedIds((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const selectAll = () => setSelectedIds(selectedIds.size === images.length ? new Set() : new Set(images.map((image) => image.id)));
  const reorder = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    setImages((old) => { const next = [...old]; const from = next.findIndex((item) => item.id === draggedId); const to = next.findIndex((item) => item.id === targetId); const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; }); setDraggedId('');
  };

  const updateCrop = (crop: CropRect) => {
    if (!current) return;
    const aspect = (crop.width * current.width) / (crop.height * current.height);
    setImages((old) => old.map((image) => {
      if (image.id === current.id) return { ...image, crop };
      if (cropMode !== 'bulk') return image;
      return { ...image, crop: cropForAspect(image.width, image.height, aspect) };
    }));
  };
  const applyCropDimensions = () => {
    const width = Math.round(Number(cropCustomWidth));
    const height = Math.round(Number(cropCustomHeight));
    if (!current) return;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 12000 || height > 12000 || width * height > 48_000_000) {
      notify('Use a size up to 12,000 px per side and 48 megapixels total.');
      return;
    }
    const aspect = width / height;
    setImages((old) => old.map((image) => {
      if (cropMode === 'bulk' || image.id === current.id) {
        return { ...image, crop: cropForAspect(image.width, image.height, aspect), cropOutput: { width, height } };
      }
      return image;
    }));
    notify(cropMode === 'bulk' ? `Applied ${width} × ${height} to all ${images.length} photos.` : `Applied ${width} × ${height} to this photo.`);
  };
  const resetCrop = () => {
    if (!current) return;
    setImages((old) => old.map((image) => cropMode === 'bulk' || image.id === current.id ? { ...image, crop: { ...FULL_CROP }, cropOutput: undefined } : image));
    setCropCustomWidth(String(current.width));
    setCropCustomHeight(String(current.height));
  };
  const cropPointerDown = (event: ReactPointerEvent<HTMLElement>, mode: 'move' | 'resize' | 'resize-top' | 'resize-bottom') => {
    event.preventDefault(); event.stopPropagation();
    const frame = event.currentTarget.closest('.image-frame');
    if (frame instanceof HTMLElement) frame.setPointerCapture(event.pointerId);
    setCropDrag({ mode, startX: event.clientX, startY: event.clientY, crop: currentCrop });
  };
  const cropPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!cropDrag || !current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - cropDrag.startX) / bounds.width; const dy = (event.clientY - cropDrag.startY) / bounds.height;
    const c = cropDrag.crop;
    if (cropDrag.mode === 'move') {
      updateCrop({ ...c, x: Math.max(0, Math.min(1 - c.width, c.x + dx)), y: Math.max(0, Math.min(1 - c.height, c.y + dy)) });
      return;
    }
    const aspect = current.cropOutput ? current.cropOutput.width / current.cropOutput.height : (c.width * current.width) / (c.height * current.height);
    if (cropDrag.mode === 'resize') {
      let width = Math.max(0.03, Math.min(1 - c.x, c.width + dx));
      let height = width * current.width / (aspect * current.height);
      if (height > 1 - c.y) {
        height = 1 - c.y;
        width = height * aspect * current.height / current.width;
      }
      updateCrop({ ...c, width, height });
      return;
    }
    const bottom = c.y + c.height;
    let height = Math.max(0.03, Math.min(cropDrag.mode === 'resize-top' ? bottom : 1 - c.y, c.height + (cropDrag.mode === 'resize-top' ? -dy : dy)));
    let width = height * aspect * current.height / current.width;
    if (width > 1) {
      width = 1;
      height = width * current.width / (aspect * current.height);
    }
    const center = c.x + c.width / 2;
    const x = Math.max(0, Math.min(1 - width, center - width / 2));
    const y = cropDrag.mode === 'resize-top' ? Math.max(0, bottom - height) : c.y;
    updateCrop({ ...c, x, y, width, height });
  };
  const renderCropOverlay = () => <div className="crop-overlay" style={{ left: `${currentCrop.x * 100}%`, top: `${currentCrop.y * 100}%`, width: `${currentCrop.width * 100}%`, height: `${currentCrop.height * 100}%` }} onPointerDown={(e) => cropPointerDown(e, 'move')}><span className="crop-grid"/><button className="crop-edge-handle crop-edge-top" aria-label="Resize crop from the top edge" title="Drag to adjust the top edge" onPointerDown={(e) => cropPointerDown(e, 'resize-top')}>↕</button><button className="crop-edge-handle crop-edge-bottom" aria-label="Resize crop from the bottom edge" title="Drag to adjust the bottom edge" onPointerDown={(e) => cropPointerDown(e, 'resize-bottom')}>↕</button><button className="crop-handle" aria-label="Resize crop from the corner" title="Drag to resize crop" onPointerDown={(e) => cropPointerDown(e, 'resize')}>↘</button></div>;
  const adjustCropScale = (factor: number) => {
    if (!current) return;
    const c = currentCrop;
    const maxScale = Math.min(1 / c.width, 1 / c.height);
    const minScale = Math.max(0.03 / c.width, 0.03 / c.height);
    const scale = Math.max(minScale, Math.min(maxScale, factor));
    if (Math.abs(scale - 1) < 0.001) return;
    const width = c.width * scale;
    const height = c.height * scale;
    updateCrop({ ...c, x: Math.max(0, Math.min(1 - width, c.x + (c.width - width) / 2)), y: Math.max(0, Math.min(1 - height, c.y + (c.height - height) / 2)), width, height });
  };

  const setOverride = (id: string, key: keyof Override, value: string) => setOverrides((old) => ({ ...old, [id]: { ...old[id], [key]: value } }));
  const changeCoordinate = (axis: 'lat' | 'lon', value: string) => {
    window.clearTimeout(manualGeocodeTimer.current);
    if (axis === 'lat') setLatInput(value); else setLonInput(value);
  };
  const commitCoordinates = () => {
    if (!latInput.trim() || !lonInput.trim()) return;
    const lat = Number(latInput); const lon = Number(lonInput);
    if (!isValidCoordinates(lat, lon)) { notify('Enter a valid latitude and longitude.'); return; }
    updateLocation({ lat, lon, place: { name: '' } }, true);
  };
  const reverseGeocodeManual = async () => {
    const lat = Number(latInput); const lon = Number(lonInput);
    if (!latInput.trim() || !lonInput.trim() || !isValidCoordinates(lat, lon)) { notify('Enter a valid latitude and longitude.'); return; }
    try {
      const url = new URL('https://nominatim.openstreetmap.org/reverse');
      url.searchParams.set('format', 'jsonv2'); url.searchParams.set('addressdetails', '1'); url.searchParams.set('lat', String(lat)); url.searchParams.set('lon', String(lon));
      const response = await fetch(url, { headers: { 'Accept-Language': navigator.language || 'en' } });
      if (!response.ok) throw new Error('Lookup unavailable');
      const data = await response.json() as { display_name?: string; address?: Record<string, string> };
      const address = data.address ?? {};
      const locality = address.village ?? address.hamlet ?? address.suburb ?? address.neighbourhood ?? address.city ?? address.town;
      const place: Place = { name: data.display_name ?? '', locality, district: address.county ?? address.state_district, division: address.region ?? address.state_district, state: address.state, country: address.country };
      updateLocation({ lat, lon, place }, true);
    } catch { notify('Place details could not be retrieved. Coordinates are saved.'); }
  };
  const scheduleManualGeocode = () => { commitCoordinates(); window.clearTimeout(manualGeocodeTimer.current); if (latInput.trim() && lonInput.trim() && isValidCoordinates(Number(latInput), Number(lonInput))) manualGeocodeTimer.current = window.setTimeout(() => void reverseGeocodeManual(), 550); };

  const exportImages = async (onlyCurrent = false) => {
    if (!images.length) { notify('Add an image before exporting.'); return; }
    if (!locationActive && gpsMode !== 'original') { notify('Select a location on the map or enter coordinates first.'); return; }
    if (gpsMode === 'original' && !locationActive && images.some((image) => (image.exifLat === undefined || image.exifLon === undefined) && !(overrides[image.id]?.lat && overrides[image.id]?.lon))) { notify('Select a fallback location for images without original GPS metadata.'); return; }
    if (locationActive && (!latInput.trim() || !lonInput.trim() || !isValidCoordinates(Number(latInput), Number(lonInput)))) { notify('Enter valid latitude and longitude values.'); return; }
    if (rangeError) { notify(rangeError); return; }
    if (variableRangeError) { notify(variableRangeError); return; }
    const targets = onlyCurrent && current ? [current] : images.filter((image) => activeIds.has(image.id));
    if (!targets.length) { notify('Select at least one image to export.'); return; }
    const rangeStart = fromZonedInput(range.start, range.timeZone).getTime(); const rangeEnd = fromZonedInput(range.end, range.timeZone).getTime();
    for (const image of targets) {
      const override = overrides[image.id]; const assigned = assignments[images.indexOf(image)];
      if (override?.time !== undefined) {
        const timestamp = override.time ? fromZonedInput(override.time, range.timeZone).getTime() : NaN;
        if (!Number.isFinite(timestamp) || timestamp < rangeStart || timestamp > rangeEnd) { notify(`Check the assigned time for ${image.name}; it must be inside the selected range.`); return; }
      }
      if (override?.lat !== undefined || override?.lon !== undefined) {
        if ((override.lat !== undefined && !override.lat.trim()) || (override.lon !== undefined && !override.lon.trim())) { notify(`Check the assigned GPS coordinates for ${image.name}.`); return; }
        const lat = Number(override.lat ?? assigned.lat); const lon = Number(override.lon ?? assigned.lon);
        if (!isValidCoordinates(lat, lon)) { notify(`Check the assigned GPS coordinates for ${image.name}.`); return; }
      }
    }
    setProcessing(true); cancelRef.current = false; setZipPercent(null); setProgress({ done: 0, total: targets.length, failed: 0, current: '' });
    const exports: Array<{ name: string; blob: Blob }> = []; const failed: string[] = []; const mime = outputFormat === 'png' ? 'image/png' : 'image/jpeg';
    try {
      for (const [index, image] of targets.entries()) {
        if (cancelRef.current) break;
        setProgress((p) => ({ ...p, current: `Image ${index + 1} of ${targets.length} · ${image.name}` }));
        try {
          const assigned = assignments[images.indexOf(image)];
          const canvas = await renderProcessed(image, assigned, placeForAssignment(assigned, image.id), overlay, range.timeZone, Number(maxWidth) || undefined, Number(maxHeight) || undefined, mime);
          const blob = await canvasBlob(canvas, mime, quality);
          exports.push({ name: outputFilename(filenamePrefix, exports.length + 1, outputFormat), blob });
        } catch (error) { failed.push(`${image.name}: ${(error as Error).message}`); }
        setProgress((p) => ({ ...p, done: p.done + 1, failed: failed.length }));
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      if (cancelRef.current) { notify('Export cancelled.'); return; }
      if (targets.length === 1) {
        if (exports[0]) downloadBlob(exports[0].blob, exports[0].name);
      } else if (exports.length) {
        setProgress((p) => ({ ...p, current: 'Compressing ZIP archive…' })); setZipPercent(0);
        const blob = await createZip(exports, (percent) => setZipPercent(percent));
        downloadBlob(blob, `${sanitizePrefix(filenamePrefix)}_images.zip`);
      }
      notify(failed.length ? `Exported ${exports.length} of ${targets.length}; ${failed.length} failed.` : `Exported ${targets.length} image${targets.length === 1 ? '' : 's'}.`);
      if (failed.length) setUploadMessage(failed.join(' · '));
    } catch (error) { notify(`Export failed: ${(error as Error).message}`); }
    finally { setProcessing(false); setZipPercent(null); setProgress({ done: 0, total: 0, failed: 0, current: '' }); }
  };

  const resetProject = () => { clearAll(); setLocationActive(false); setLocation({ lat: 0, lon: 0, place: { name: '' } }); setLatInput(''); setLonInput(''); setTimestampMode('variable'); setRange(initialRange()); setGpsMode('same'); setRadius(100); setOverlay({ ...DEFAULT_OVERLAY, fontSize: prefs.fontSize, margin: prefs.margin, twelveHour: prefs.twelveHour }); setBeforeAfter('after'); setOverrides({}); setMaxWidth(''); setMaxHeight(''); setCropCustomWidth(''); setCropCustomHeight(''); notify('Project settings reset.'); };
  const clearPrefs = () => { localStorage.removeItem(PREF_KEY); skipPrefsWrite.current = true; const defaults: Prefs = { theme: 'light', fontSize: 30, margin: 40, twelveHour: false, quality: 0.92 }; setPrefs(defaults); setTheme('light'); setOverlay((old) => ({ ...old, fontSize: 30, margin: 40, twelveHour: false })); setQuality(0.92); notify('Saved preferences cleared.'); };

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><span>G</span></div><div><strong>GeoStamp</strong><span>STUDIO</span></div></div>
      <div className="top-divider" />
      <div className="project-name"><span className="project-dot" />Untitled project <span className="saved-label">Local workspace</span></div>
      <div className="top-actions">
        {processing ? <button className="button subtle" disabled={zipPercent !== null} onClick={() => { cancelRef.current = true; }}>{zipPercent !== null ? 'Finishing archive…' : 'Cancel export'}</button> : <button className="button primary" onClick={() => void exportImages()} disabled={!images.length}><Icon>⇩</Icon> Export {selectedIds.size ? `(${selectedIds.size})` : 'all'}</button>}
        <button className="icon-button" aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '◐' : '☼'}</button>
        <button className="icon-button reset-button" aria-label="Reset project" title="Reset project" onClick={resetProject}>↺</button>
      </div>
    </header>
    <main className="editor-grid">
      <aside className="left-sidebar panel-scroll">
        <details className="settings-accordion" open>
        <summary><strong>Editing settings</strong><span>Images · Location · Timestamp · Crop</span></summary>
        <section className="settings-section assets-section">
          <div className="section-title"><div><h2>Images</h2><p>{images.length} of 50 in project</p></div>{images.length > 0 && <button className="text-button" onClick={clearAll}>Clear all</button>}</div>
          <div className={`upload-drop ${images.length ? 'compact' : ''}`} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
            {images.length ? <><div className="upload-icon small"><Icon>↑</Icon></div><div><strong>Drop images here</strong><span>JPG, PNG · up to 100 MB each</span></div><button className="button small-button" onClick={() => fileInputRef.current?.click()}>Browse</button></> : <><div className="upload-icon"><Icon>↑</Icon></div><strong>Bring your photos in</strong><span>Drag and drop, or browse files</span><button className="button primary upload-button" onClick={() => fileInputRef.current?.click()}>Choose images</button><small>JPG or PNG · up to 50 images</small></>}
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" multiple hidden onChange={onFileInput} />
          </div>
          {uploadProgress.total > 0 && <div className="progress-row"><span>Reading images</span><span>{uploadProgress.done}/{uploadProgress.total}</span><div className="progress-track"><i style={{ width: `${uploadProgress.done / uploadProgress.total * 100}%` }} /></div></div>}
          {uploadMessage && <p className="inline-note warning-text">{uploadMessage}</p>}
          {images.length > 0 && <><div className="image-list-heading"><label className="check-label"><input type="checkbox" checked={selectedIds.size === images.length} onChange={selectAll} />Select all</label><span>{selectedIds.size || images.length} selected</span></div><div className="image-list">
            {images.map((image, index) => <div key={image.id} className={`image-row ${image.id === current?.id ? 'active' : ''} ${draggedId === image.id ? 'dragging' : ''}`} onClick={() => setCurrentId(image.id)} onDoubleClick={() => openCropEditor(image.id)} draggable onDragStart={() => setDraggedId(image.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => reorder(image.id)}>
              <input aria-label={`Select ${image.name}`} type="checkbox" checked={selectedIds.has(image.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSelect(image.id)} />
              <img src={image.url} alt="" />
              <div className="image-row-copy"><strong title={image.name}>{image.name}</strong><span>{image.width} × {image.height} · {(image.file.size / 1048576).toFixed(1)} MB</span></div>
              <button className="remove-image" aria-label={`Remove ${image.name}`} onClick={(e) => { e.stopPropagation(); removeImage(image.id); }}>×</button>
              {index === currentIndex && <span className="current-image-dot" />}
            </div>)}
          </div></>}
        </section>
        <section className="settings-section crop-settings">
          <SectionTitle title="Crop" note="Choose the exact output size" />
          <div className="crop-mode-switch" role="group" aria-label="Apply crop to">
            <button className={cropMode === 'individual' ? 'active' : ''} aria-pressed={cropMode === 'individual'} onClick={() => setCropMode('individual')}>This photo</button>
            <button className={cropMode === 'bulk' ? 'active' : ''} aria-pressed={cropMode === 'bulk'} onClick={() => setCropMode('bulk')}>All photos</button>
          </div>
          <div className="crop-dimensions">
            <label>Width <span className="crop-size-input"><input type="number" min="1" max="12000" inputMode="numeric" placeholder={current ? String(current.width) : 'e.g. 1920'} value={cropCustomWidth} onChange={(e) => setCropCustomWidth(e.target.value)} aria-label="Crop width in pixels" /><b>px</b></span></label>
            <span className="crop-times" aria-hidden="true">×</span>
            <label>Height <span className="crop-size-input"><input type="number" min="1" max="12000" inputMode="numeric" placeholder={current ? String(current.height) : 'e.g. 1080'} value={cropCustomHeight} onChange={(e) => setCropCustomHeight(e.target.value)} aria-label="Crop height in pixels" /><b>px</b></span></label>
          </div>
          <p className="crop-help">{cropMode === 'bulk' ? `The same output size will be applied to all ${images.length} photos.` : 'Your crop is framed to these exact pixel dimensions.'} In the preview, drag the crop up or down; move the top or bottom grip to resize. Max 12,000 px per side and 48 MP total.</p>
          <button className="button primary crop-apply-button" onClick={applyCropDimensions} disabled={!current || !cropCustomWidth.trim() || !cropCustomHeight.trim()}>{cropMode === 'bulk' ? `Apply to all ${images.length} photos` : 'Apply to this photo'}</button>
          <button className="button crop-edit-button" onClick={() => current && openCropEditor(current.id)} disabled={!current}>Adjust crop area</button>
          <div className="crop-actions"><button className="text-button" onClick={resetCrop} disabled={!current}>Reset crop</button><span>{cropSizeText}</span></div>
        </section>
        <section className="settings-section location-section">
          <SectionTitle title="Location" note="Choose a place to stamp" />
          <MapPicker value={location} active={locationActive} onChange={updateLocation} onSelect={selectLocation} />
          <div className="coordinates-grid">
            <label>Latitude<input inputMode="decimal" value={latInput} onChange={(e) => changeCoordinate('lat', e.target.value)} onBlur={scheduleManualGeocode} aria-label="Latitude in decimal degrees" /></label>
            <label>Longitude<input inputMode="decimal" value={lonInput} onChange={(e) => changeCoordinate('lon', e.target.value)} onBlur={scheduleManualGeocode} aria-label="Longitude in decimal degrees" /></label>
          </div>
          <div className="coordinate-readout"><span>{locationActive ? location.place.locality || location.place.name.split(',')[0]?.trim() || 'Pinned coordinates' : 'No location selected'}</span><button className="text-button" disabled={!locationActive} onClick={() => { void navigator.clipboard?.writeText(formatDecimal(location.lat, location.lon)); notify('Coordinates copied.'); }}>Copy coordinates</button></div>
          <div className="coordinate-formats"><span>Decimal</span><strong>{locationActive ? formatDecimal(location.lat, location.lon) : 'Select a place to begin'}</strong><span>DMS · stamp format</span><strong>{locationActive ? toDmsPair(location.lat, location.lon) : '—'}</strong></div>
        </section>
        <section className="settings-section compact-section">
          <SectionTitle title="GPS assignment" note="Choose the coordinates for each image" />
          <div className="choice-list">
            {[['same', 'Same coordinates', 'Use this pin for every image'], ['nearby', 'Nearby variations', 'Create offsets around the pin'], ['original', 'Original GPS', 'Keep coordinates from EXIF']].map(([value, title, note]) => <label key={value} className={`choice-row ${gpsMode === value ? 'selected' : ''}`}><input type="radio" name="gps-mode" value={value} checked={gpsMode === value} onChange={() => setGpsMode(value as typeof gpsMode)} /><span><strong>{title}</strong><small>{note}</small></span></label>)}
          </div>
          {gpsMode === 'nearby' && <div className="radius-row"><label>Offset radius<select value={radius} onChange={(e) => setRadius(Number(e.target.value))}><option value={50}>50 m</option><option value={100}>100 m</option><option value={250}>250 m</option><option value={500}>500 m</option><option value={1000}>1 km</option><option value={5000}>5 km</option><option value={-1}>Custom</option></select></label>{radius === -1 && <label>Metres<input type="number" min="1" max="50000" value={customRadius} onChange={(e) => setCustomRadius(Number(e.target.value))} /></label>}<p className="inline-note">The pin’s place name stays on the stamp; the offset coordinates are synthetic.</p></div>}
          {gpsMode === 'original' && <p className="inline-note">Images without GPS metadata use the selected map location. Missing values stay clearly marked in the list.</p>}
        </section>
        <section className="settings-section compact-section">
          <SectionTitle title="Timestamp" note="Set the date and time range" />
          <label className="field-label">Assignment mode<select value={timestampMode} onChange={(e) => setTimestampMode(e.target.value as TimestampMode)}><option value="original">Original EXIF capture time</option><option value="sequential">Sequential across range</option><option value="variable">Random 1–9 sec gaps</option><option value="random">Randomized in range</option></select></label>
          <div className="form-grid"><label>Start<input type="datetime-local" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} /></label><label>End<input type="datetime-local" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} /></label></div>
          <details className="advanced-options"><summary><span>More time options</span><small>{range.timeZone}</small></summary>
            <label className="field-label">Time zone<select value={range.timeZone} onChange={(e) => setRange({ ...range, timeZone: e.target.value })}>{['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/London', 'Australia/Sydney', Intl.DateTimeFormat().resolvedOptions().timeZone].filter((zone, i, array) => array.indexOf(zone) === i).map((zone) => <option key={zone}>{zone}</option>)}</select></label>
          </details>
          {timestampMode === 'variable' && <><div className="form-grid interval-options"><label>Min gap (sec)<input type="number" min="1" max="60" value={range.minInterval} onChange={(e) => setRange({ ...range, minInterval: Number(e.target.value) })} /></label><label>Max gap (sec)<input type="number" min="1" max="60" value={range.maxInterval} onChange={(e) => setRange({ ...range, maxInterval: Number(e.target.value) })} /></label></div><p className="inline-note interval-note">Each photo gets a random gap. Default: 1–9 seconds.</p></>}
          {rangeError && <p className="inline-note warning-text">{rangeError}</p>}{variableRangeError && <p className="inline-note warning-text">{variableRangeError}</p>}
          <button className="assignment-toggle" onClick={() => setShowAssignments(!showAssignments)} aria-expanded={showAssignments}><span>{showAssignments ? 'Hide' : 'Review'} all assignments</span><span>{images.length} images <b>{showAssignments ? '⌃' : '⌄'}</b></span></button>
          {showAssignments && <div className="assignment-table-wrap"><table className="assignment-table"><thead><tr><th>Image</th><th>Date / time</th><th>Lat</th><th>Lon</th></tr></thead><tbody>{images.map((image, index) => { const assignment = assignments[index]; const hasGpsValue = locationActive || assignment?.isOriginalGps || (overrides[image.id]?.lat !== undefined && overrides[image.id]?.lon !== undefined); const timeSource = assignment?.isOriginalTime ? 'Original EXIF' : overrides[image.id]?.time !== undefined ? 'Manual override' : 'Edited assignment'; const gpsSource = assignment?.isOriginalGps ? 'Original EXIF' : overrides[image.id]?.lat !== undefined || overrides[image.id]?.lon !== undefined ? 'Manual override' : gpsMode === 'nearby' ? 'Synthetic offset' : gpsMode === 'original' ? 'Selected fallback' : 'Assigned'; return <tr key={image.id}><td title={image.name}>{index + 1}. {image.name}</td><td><input type="datetime-local" value={overrides[image.id]?.time ?? dateTimeLocalInZone(assignment?.timestamp ?? new Date(), range.timeZone)} onChange={(e) => setOverride(image.id, 'time', e.target.value)} aria-label={`Timestamp for ${image.name}`} /><small>{timeSource}</small></td><td><input value={overrides[image.id]?.lat ?? (hasGpsValue ? assignment?.lat.toFixed(6) : '')} onChange={(e) => setOverride(image.id, 'lat', e.target.value)} aria-label={`Latitude for ${image.name}`} />{hasGpsValue && <small>{gpsSource}</small>}</td><td><input value={overrides[image.id]?.lon ?? (hasGpsValue ? assignment?.lon.toFixed(6) : '')} onChange={(e) => setOverride(image.id, 'lon', e.target.value)} aria-label={`Longitude for ${image.name}`} /></td></tr>; })}</tbody></table></div>}
        </section>
        <section className="settings-section compact-section export-settings">
          <SectionTitle title="Export settings" note="Output is saved to your device" />
          <label className="field-label">File format<select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as 'jpg' | 'png')}><option value="jpg">JPEG</option><option value="png">PNG</option></select></label>
          <details className="advanced-options"><summary><span>More export options</span><small>{outputFormat.toUpperCase()} · {Math.round(quality * 100)}%</small></summary>
            {outputFormat === 'jpg' && <label className="range-label">JPEG quality <strong>{Math.round(quality * 100)}%</strong><input type="range" min="0.5" max="1" step="0.01" value={quality} onChange={(e) => setQuality(Number(e.target.value))} /></label>}
            <div className="form-grid"><label>Max width px<input type="number" placeholder="Original" value={maxWidth} onChange={(e) => setMaxWidth(e.target.value)} /></label><label>Max height px<input type="number" placeholder="Original" value={maxHeight} onChange={(e) => setMaxHeight(e.target.value)} /></label></div>
            <label className="field-label">Filename prefix<input value={filenamePrefix} onChange={(e) => setFilenamePrefix(e.target.value)} /></label>
          </details>
          <button className="button primary full-button" disabled={!images.length || processing} onClick={() => void exportImages()}>{processing ? zipPercent !== null ? 'Compressing ZIP…' : 'Preparing export…' : `Download ${selectedIds.size ? 'selected' : 'all'} as ${images.length > 1 ? 'ZIP' : outputFormat.toUpperCase()}`}</button>
        </section>
        </details>
      </aside>

      <section className="workspace">
        <div className="workspace-toolbar">
          <div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{current?.name ?? 'No image selected'}</strong></div>
          <div className="preview-actions">
            <button className="nav-image" title="Previous image" aria-label="Previous image" disabled={!images.length || currentIndex <= 0} onClick={() => setCurrentId(images[currentIndex - 1]?.id ?? '')}>‹</button>
            <button className="nav-image" title="Next image" aria-label="Next image" disabled={!images.length || currentIndex >= images.length - 1} onClick={() => setCurrentId(images[currentIndex + 1]?.id ?? '')}>›</button>
            <button className={`toggle-button ${beforeAfter === 'before' ? 'active' : ''}`} onClick={() => setBeforeAfter(beforeAfter === 'before' ? 'after' : 'before')} disabled={!current}><span className="compare-icon">◑</span>{beforeAfter === 'before' ? 'Original' : 'Before / after'}</button>
            <div className="zoom-controls"><button aria-label="Zoom out" disabled={zoom <= 50} onClick={() => setZoom((value) => Math.max(50, value - 25))}>−</button><span>{zoom}%</span><button aria-label="Zoom in" disabled={zoom >= 200} onClick={() => setZoom((value) => Math.min(200, value + 25))}>+</button><button className="fit-zoom" onClick={() => setZoom(100)}>Fit</button></div>
            {current && <button className="icon-button download-one" onClick={() => void exportImages(true)} title="Download current image" aria-label="Download current image">⇩</button>}
          </div>
        </div>
        <div className="canvas-stage" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          {!current ? <div className="empty-state"><div className="empty-illustration"><div className="empty-sun"/><div className="empty-mountain one"/><div className="empty-mountain two"/><div className="empty-frame"><span>+</span></div></div><h1>Start with your photos</h1><p>Add images, choose their location and time, then download the stamped copies. Everything stays on this device.</p><button className="button primary" onClick={() => fileInputRef.current?.click()}>Choose an image</button><span className="empty-footnote"><Icon>⌁</Icon> Local processing · no cloud uploads</span></div> : <div className="preview-shell">
            <div className="preview-topline"><span><i className="live-dot"/> Preview</span><span>{beforeAfter === 'before' ? 'Original image' : 'Final output'} · fit to workspace</span></div>
            <div className="preview-viewport">
              <div className="image-frame" style={{ transform: `scale(${zoom / 100})` }} onDoubleClick={() => current && openCropEditor(current.id)} onPointerMove={cropPointerMove} onPointerUp={() => setCropDrag(null)} onPointerCancel={() => setCropDrag(null)}>
                {beforeAfter === 'before' ? <img className="original-preview" src={current.url} alt={`Original image with crop editor for ${current.name}`} /> : <canvas id="final-preview" aria-label={`Processed preview of ${current.name}`} />}
                {beforeAfter === 'before' && renderCropOverlay()}
              </div>
            </div>
            <div className="preview-caption"><span>{current.name}</span><span>{current.width} × {current.height} px <b>·</b> {(current.file.size / 1048576).toFixed(1)} MB</span></div>
          </div>}
        </div>
        {images.length > 0 && <div className="filmstrip-bar"><div className="filmstrip-label"><span>FILMSTRIP</span><span>{images.length} {images.length === 1 ? 'image' : 'images'} · double-click a photo to crop</span></div><div className="filmstrip-scroll">{images.map((image, index) => <button key={image.id} className={`filmstrip-item ${image.id === current?.id ? 'active' : ''}`} onClick={() => setCurrentId(image.id)} onDoubleClick={() => openCropEditor(image.id)} title={`${image.name} · double-click to crop`}><img src={image.url} alt=""/><span>{String(index + 1).padStart(2, '0')}</span></button>)}<button className="filmstrip-add" onClick={() => fileInputRef.current?.click()} aria-label="Add images">+</button></div></div>}
        {processing && <div className="processing-card"><div className="processing-head"><strong>{zipPercent !== null ? 'Compressing ZIP archive' : 'Preparing your export'}</strong><span>{zipPercent !== null ? `${Math.round(zipPercent)}%` : `${progress.done} / ${progress.total}`}</span></div><span className="processing-current">{progress.current}</span><div className="progress-track"><i style={{ width: `${zipPercent !== null ? zipPercent : progress.total ? progress.done / progress.total * 100 : 0}%` }}/></div><div className="processing-foot"><span>{Math.max(0, progress.done - progress.failed)} succeeded · {progress.failed} failed</span><span>Images are rendered in your browser</span></div></div>}
      </section>

      <aside className="right-sidebar panel-scroll">
        <section className="right-card overlay-card">
          <div className="right-heading"><div><div className="eyebrow">STAMP DESIGN</div><h2>Overlay</h2></div><span className="preview-chip">LIVE</span></div>
          <p className="muted-paragraph">A quiet, camera-style mark aligned to the upper-right corner.</p>
          <div className="stamp-sample">{currentOverlay.length ? currentOverlay.slice(0, 4).map((line, index) => <span key={`${line}-${index}`}>{line}</span>) : <span className="sample-empty">Location and time will appear here</span>}</div>
          <details className="advanced-options"><summary><span>Stamp content</span><small>Choose displayed lines</small></summary>
          <div className="control-block"><label className="control-label">Include in stamp</label>
            <div className="toggle-list">{[
              ['showNetwork', 'Network time', 'No trusted time source'], ['showLocal', 'Local time', 'Assigned capture time'], ['showCoordinates', 'GPS coordinates', 'Degrees, minutes, seconds'], ['showLocality', 'Locality', location.place.locality || 'From map selection'], ['showDistrict', 'Division / district', location.place.division || location.place.district || 'From map selection'], ['showState', 'State', location.place.state || 'From map selection'],
            ].map(([key, label, description]) => <label key={key} className={`toggle-row ${key === 'showNetwork' ? 'muted-toggle' : ''}`}><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={Boolean(overlay[key as keyof OverlaySettings])} disabled={key === 'showNetwork'} onChange={(e) => setOverlay({ ...overlay, [key]: e.target.checked })}/><i/></label>)}</div>
            <p className="integrity-note">Synthetic or manually assigned times remain marked as edited in the assignment review. The overlay contains no verification claim.</p>
          </div>
          </details>
        </section>
        <section className="right-card type-card">
          <div className="right-heading"><div><div className="eyebrow">TYPE & POSITION</div><h2>Appearance</h2></div></div>
          <details className="advanced-options"><summary><span>Appearance options</span><small>{overlay.fontSize}px · top right</small></summary>
          <label className="range-label">Font size <strong>{overlay.fontSize}px</strong><input type="range" min="18" max="42" value={overlay.fontSize} onChange={(e) => setOverlay({ ...overlay, fontSize: Number(e.target.value) })}/></label>
          <div className="inline-controls"><label>Text colour<input type="color" value={overlay.color} onChange={(e) => setOverlay({ ...overlay, color: e.target.value })}/></label><label>Time display<select value={overlay.twelveHour ? '12' : '24'} onChange={(e) => setOverlay({ ...overlay, twelveHour: e.target.value === '12' })}><option value="24">24 hour</option><option value="12">12 hour</option></select></label></div>
          <label className="range-label">Line spacing <strong>{overlay.lineSpacing}px</strong><input type="range" min="24" max="48" value={overlay.lineSpacing} onChange={(e) => setOverlay({ ...overlay, lineSpacing: Number(e.target.value) })}/></label>
          <label className="range-label">Edge margin <strong>{overlay.margin}px</strong><input type="range" min="16" max="96" value={overlay.margin} onChange={(e) => setOverlay({ ...overlay, margin: Number(e.target.value) })}/></label>
          <label className="range-label">Shadow <strong>{overlay.shadow}/10</strong><input type="range" min="0" max="8" value={overlay.shadow} onChange={(e) => setOverlay({ ...overlay, shadow: Number(e.target.value) })}/></label>
          <div className="position-row"><span>Position</span><span className="position-grid active" aria-label="Overlay position: top right"><i/></span><span className="position-hint">Top right · right aligned</span></div>
          </details>
        </section>
        <section className="right-card info-card">
          <div className="right-heading"><div><div className="eyebrow">IMAGE DETAILS</div><h2>Inspector</h2></div></div>
          {current ? <><div className="info-filename"><div className="file-icon">▧</div><div><strong>{current.name}</strong><span>{current.file.type || 'Image'} · {(current.file.size / 1048576).toFixed(2)} MB</span></div></div><div className="info-grid"><div><span>Dimensions</span><strong>{current.width} × {current.height}</strong></div><div><span>Capture time</span><strong>{current.exifDate ? formatStamp(current.exifDate, range.timeZone, false) : 'Not in EXIF'}</strong></div><div><span>Source GPS</span><strong>{current.exifLat !== undefined ? toDmsPair(current.exifLat, current.exifLon ?? 0) : 'Not in EXIF'}</strong></div><div><span>Output crop</span><strong>{current.cropOutput ? `${current.cropOutput.width} × ${current.cropOutput.height}` : `${Math.round(currentCrop.width * current.width)} × ${Math.round(currentCrop.height * current.height)}`}</strong></div></div><div className="source-badge"><span className="badge-dot"/> Original image remains untouched</div></> : <p className="muted-paragraph">Image dimensions, source metadata and output details will appear here.</p>}
        </section>
        <div className="privacy-card"><div className="privacy-icon">⌁</div><div><strong>Private by design</strong><p>Your image data never leaves this device. Map search and map tiles make requests to their providers.</p><button className="text-button" onClick={clearPrefs}>Clear saved settings</button></div></div>
        {current && <button className="button outline full-button" onClick={() => void exportImages(true)} disabled={processing}><Icon>⇩</Icon> Download this image</button>}
      </aside>
    </main>
    {cropEditorOpen && current && <div className="crop-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCropEditor(); }}>
      <section className="crop-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-editor-title">
        <header className="crop-editor-header"><div><span className="crop-editor-eyebrow">PHOTO CROP</span><h2 id="crop-editor-title">Choose the visible area</h2><p>{current.name}</p></div><button className="icon-button crop-editor-close" aria-label="Close crop editor" onClick={closeCropEditor}>×</button></header>
        <p className="crop-editor-help">Drag inside the frame to move your selection up or down. Pull the top or bottom grip to choose exactly what stays in the crop.</p>
        <div className="crop-editor-stage">
          <div className="image-frame crop-editor-image" onPointerMove={cropPointerMove} onPointerUp={() => setCropDrag(null)} onPointerCancel={() => setCropDrag(null)}>
            <img className="original-preview" src={current.url} alt={`Choose crop area for ${current.name}`} />
            {renderCropOverlay()}
          </div>
        </div>
        <footer className="crop-editor-footer"><div className="crop-editor-sizing"><span>Output size <strong>{cropSizeText}</strong></span><div className="crop-scale-controls" role="group" aria-label="Crop area size"><span>Crop area</span><button className="crop-scale-button" aria-label="Make crop area smaller" title="Make crop area smaller" onClick={() => adjustCropScale(0.92)}>−</button><button className="crop-scale-button" aria-label="Make crop area larger" title="Make crop area larger" onClick={() => adjustCropScale(1.08)}>+</button></div></div><div><button className="button outline" onClick={resetCrop}>Reset</button><button className="button primary" onClick={closeCropEditor}>Done</button></div></footer>
      </section>
    </div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
