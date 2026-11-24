# GeoStamp Studio

GeoStamp Studio is a local-first photo editor for adding visible date, time, GPS coordinates, and place names to photos. It runs in your browser and processes images on your device.

## Features

- **Add photos:** Import JPG, JPEG, and PNG files. Work with up to 50 photos in one project.
- **Choose a location:** Search for a place, select a point on the map, or enter coordinates. Apply one location to every photo, create nearby variations, or use GPS coordinates read from EXIF.
- **Set photo times:** Use original EXIF capture times, spread times across a date range, choose random gaps between photos, or randomize times within the range. Random gaps default to 1–9 seconds and can be adjusted.
- **Crop to exact dimensions:** Enter a width and height in pixels. Apply the crop to one photo or all photos. Double-click a photo or choose **Adjust crop area** to move the crop selection and resize it with the top, bottom, or corner handles.
- **Customize the stamp:** Choose which time, coordinate, and place lines appear, then adjust the text color, size, spacing, and position.
- **Preview and export:** Compare the original and stamped image, export JPEG or PNG files, and download multiple photos in a ZIP archive.

## Getting started

### Requirements

- Node.js 20.19 or newer, or Node.js 22.12 or newer
- npm
- A modern browser with Canvas and Blob download support

### Install and run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite in your browser.

### Build and preview

```bash
npm run build
npm run preview
```

The production build is written to `dist/`.

### Run unit tests

```bash
npm test
```

## How to use

1. Add your photos with **Choose images** or drag them into the app.
2. Choose a location and select how GPS should be assigned.
3. Set the time range and assignment mode.
4. Enter the crop width and height. Choose **This photo** or **All photos**, then apply the dimensions.
5. Double-click a photo or choose **Adjust crop area** to select which part of the image to keep. Drag inside the crop frame to reposition it; drag a handle to resize it.
6. Review the preview, choose JPEG or PNG, and export one or all photos.

## Privacy and image metadata

- Photo files and rendered images stay in browser memory. GeoStamp Studio does not upload image content or save image files to local storage.
- EXIF date and GPS values are read when available. Canvas-based exports add the visible stamp but do not preserve the source EXIF metadata or write new GPS EXIF tags.
- Theme and editor preferences are saved in `localStorage`; crop settings are kept in memory with the current project.
- Map tiles and place lookups are provided by OpenStreetMap and Nominatim. Map searches and selected coordinates are sent to those providers; photo files are not.
- Multi-photo exports are packaged in memory with JSZip and downloaded directly to your device.

## Limits and notes

- Supported formats: JPG/JPEG and PNG.
- Maximum project size: 50 photos, 100 MB per photo, and 500 MB total.
- Crop output is limited to 12,000 pixels per side and 48 megapixels total.
- Large images can use substantial browser memory. Available memory and download behavior vary by browser and device.
- Nearby GPS variations use synthetic coordinates around the selected point. The selected place name remains on the visible stamp.
- Network time is not used. The app uses the selected time range or EXIF capture time and does not make a time-verification claim.

## Built with

- React and TypeScript
- Vite
- HTML Canvas for image rendering
- Leaflet and OpenStreetMap for the location picker
- Nominatim for place search and reverse geocoding
- exifr for reading EXIF metadata
- JSZip for multi-photo downloads
- Vitest for utility tests

## Project structure

```text
src/
  components/   Map picker
  utils/        Crop, GPS, timestamp, image, and export helpers
  App.tsx       Editor interface and project state
  styles.css    Responsive interface styles
```
