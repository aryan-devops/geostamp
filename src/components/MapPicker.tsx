import { useEffect, useRef, useState } from 'react';
import L, { type Map as LeafletMap, type Marker } from 'leaflet';
import type { LocationValue, Place } from '../types';

type Props = { value: LocationValue; active: boolean; onChange: (value: LocationValue, selected?: boolean) => void; onSelect: () => void };
type Suggestion = { lat: string; lon: string; display_name: string; address?: Record<string, string> };

function placeFromAddress(address: Record<string, string> = {}, fallback = ''): Place {
  const locality = address.village ?? address.hamlet ?? address.suburb ?? address.neighbourhood ?? address.city ?? address.town;
  return {
    name: fallback,
    locality,
    district: address.county ?? address.state_district,
    division: address.region ?? address.state_district,
    state: address.state,
    country: address.country,
  };
}

export default function MapPicker({ value, active, onChange, onSelect }: Props) {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = L.map(mapNode.current, { zoomControl: true, scrollWheelZoom: false }).setView([21.25, 81.63], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    map.on('click', async (event) => {
      const lat = event.latlng.lat;
      const lon = event.latlng.lng;
      onSelect();
      let place: Place = { name: '' };
      try {
        const url = new URL('https://nominatim.openstreetmap.org/reverse');
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('lat', String(lat));
        url.searchParams.set('lon', String(lon));
        url.searchParams.set('zoom', '18');
        const response = await fetch(url);
        if (response.ok) {
          const data = (await response.json()) as Suggestion;
          place = placeFromAddress(data.address, data.display_name ?? '');
        }
      } catch {
        setMessage('Could not retrieve place details. Coordinates were selected.');
      }
      onChange({ lat, lon, place }, true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [onChange, onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (active) {
      if (!markerRef.current) {
        const icon = L.divIcon({ className: 'location-pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
        markerRef.current = L.marker([value.lat, value.lon], { icon, draggable: true }).addTo(map);
        markerRef.current.on('dragend', async () => {
          const ll = markerRef.current!.getLatLng();
          onSelect();
          try {
            const u = new URL('https://nominatim.openstreetmap.org/reverse');
            u.searchParams.set('format', 'jsonv2'); u.searchParams.set('lat', String(ll.lat)); u.searchParams.set('lon', String(ll.lng));
            const response = await fetch(u);
            const data = response.ok ? (await response.json()) as Suggestion : undefined;
            onChange({ lat: ll.lat, lon: ll.lng, place: placeFromAddress(data?.address, data?.display_name ?? '') }, true);
          } catch {
            onChange({ lat: ll.lat, lon: ll.lng, place: { name: '' } }, true);
            setMessage('Could not retrieve place details. Coordinates were selected.');
          }
        });
      } else markerRef.current.setLatLng([value.lat, value.lon]);
      map.setView([value.lat, value.lon], Math.max(map.getZoom(), 13));
    } else if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
  }, [active, value.lat, value.lon, onChange, onSelect]);

  useEffect(() => {
    if (query.trim().length < 3) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setBusy(true); setMessage('');
      try {
        const url = new URL('https://nominatim.openstreetmap.org/search');
        url.searchParams.set('format', 'jsonv2'); url.searchParams.set('addressdetails', '1'); url.searchParams.set('limit', '5'); url.searchParams.set('q', query);
        const response = await fetch(url, { signal: controller.signal, headers: { 'Accept-Language': navigator.language || 'en' } });
        if (!response.ok) throw new Error('Search unavailable');
        setSuggestions((await response.json()) as Suggestion[]);
      } catch (error) {
        if (!controller.signal.aborted) setMessage('Location search is unavailable right now.');
      } finally { if (!controller.signal.aborted) setBusy(false); }
    }, 450);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [query]);

  function pick(item: Suggestion) {
    const lat = Number(item.lat); const lon = Number(item.lon);
    const place = placeFromAddress(item.address, item.display_name);
    onChange({ lat, lon, place }, true); onSelect(); setQuery(place.locality || item.display_name.split(',')[0]); setSuggestions([]); setMessage('');
  }

  return <div className="map-panel">
    <div className="map-search-wrap">
      <span className="search-icon">⌕</span>
      <input aria-label="Search for a place" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search city, address, landmark…" />
      {busy && <span className="mini-spinner" aria-label="Searching" />}
      {suggestions.length > 0 && <div className="suggestions" role="listbox">{suggestions.map((item) => <button type="button" role="option" key={`${item.lat}-${item.lon}`} onClick={() => pick(item)}>{item.display_name}</button>)}</div>}
    </div>
    <div className="map-canvas" ref={mapNode} aria-label="Interactive OpenStreetMap location picker" />
    {message && <p className="inline-note warning-text">{message}</p>}
    <p className="map-help">Search a place, tap the map, or drag the pin. Map requests go to OpenStreetMap and Nominatim.</p>
  </div>;
}
