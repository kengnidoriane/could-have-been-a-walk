import type { LatLon } from '@cbaw/core';
import L from 'leaflet';
import { useEffect, useRef } from 'react';

export interface MapPin {
  label: string;
  title: string;
  point: LatLon;
  active?: boolean;
}

export interface MapViewProps {
  start: LatLon;
  loop?: LatLon[] | null;
  /** Part of the loop already walked, drawn on top. */
  walked?: LatLon[] | null;
  landmarks?: { name: string; point: LatLon }[];
  pins?: MapPin[];
  /** The shortest way back, shown when it's time to turn around. */
  returnPath?: LatLon[] | null;
  you?: { point: LatLon; accuracy?: number } | null;
  /** Clicking the map moves the start when this is set. */
  onPick?: (point: LatLon) => void;
  /** Re-fit the view whenever this changes. */
  fitKey?: string;
  follow?: boolean;
  label?: string;
  className?: string;
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const toLatLng = (p: LatLon): L.LatLngTuple => [p.lat, p.lon];

/** OpenStreetMap's volunteer-run tiles by default; point this at a tile provider for heavy use. */
const TILE_URL =
  (import.meta.env.VITE_TILE_URL as string | undefined) ??
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const startIcon = L.divIcon({
  className: 'map-start',
  html: '<span aria-hidden="true">⌂</span>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

function pinIcon(pin: MapPin) {
  return L.divIcon({
    className: `map-pin${pin.active ? ' is-active' : ''}`,
    html: `<span>${escapeHtml(pin.label)}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

const youIcon = L.divIcon({
  className: 'map-you',
  html: '<span></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export function MapView(props: MapViewProps) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<Record<'route' | 'pins' | 'you' | 'back', L.LayerGroup> | null>(null);
  const onPick = useRef(props.onPick);
  onPick.current = props.onPick;

  // Create the map once.
  useEffect(() => {
    if (!element.current) return;
    const m = L.map(element.current, { zoomControl: true, attributionControl: true });
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      // CORS mode: lets the service worker keep tiles for offline walks without opaque padding.
      crossOrigin: true,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    m.setView(toLatLng(props.start), 16);
    m.on('click', (e: L.LeafletMouseEvent) => {
      onPick.current?.({ lat: e.latlng.lat, lon: e.latlng.lng });
    });
    layers.current = {
      route: L.layerGroup().addTo(m),
      back: L.layerGroup().addTo(m),
      pins: L.layerGroup().addTo(m),
      you: L.layerGroup().addTo(m),
    };
    map.current = m;
    // Leaflet measures its container once; tell it when the layout changes size.
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(element.current);
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
      layers.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; props sync below
  }, []);

  // Loop, walked part, start, landmarks.
  useEffect(() => {
    const group = layers.current?.route;
    if (!group) return;
    group.clearLayers();
    if (props.loop && props.loop.length > 1) {
      L.polyline(props.loop.map(toLatLng), { className: 'map-loop-casing', weight: 9 }).addTo(
        group,
      );
      L.polyline(props.loop.map(toLatLng), { className: 'map-loop', weight: 5 }).addTo(group);
    }
    if (props.walked && props.walked.length > 1) {
      L.polyline(props.walked.map(toLatLng), { className: 'map-walked', weight: 5 }).addTo(group);
    }
    for (const landmark of props.landmarks ?? []) {
      L.circleMarker(toLatLng(landmark.point), { radius: 4, className: 'map-landmark' })
        .bindTooltip(escapeHtml(landmark.name), { direction: 'top', className: 'map-tooltip' })
        .addTo(group);
    }
    L.marker(toLatLng(props.start), { icon: startIcon, keyboard: false, title: 'Start & finish' })
      .bindTooltip('Start & finish', { direction: 'bottom', className: 'map-tooltip' })
      .addTo(group);
  }, [props.loop, props.walked, props.landmarks, props.start]);

  // Agenda pins.
  useEffect(() => {
    const group = layers.current?.pins;
    if (!group) return;
    group.clearLayers();
    for (const pin of props.pins ?? []) {
      L.marker(toLatLng(pin.point), { icon: pinIcon(pin), title: pin.title, zIndexOffset: 500 })
        .bindTooltip(escapeHtml(pin.title), { direction: 'top', className: 'map-tooltip' })
        .addTo(group);
    }
  }, [props.pins]);

  // Way back.
  useEffect(() => {
    const group = layers.current?.back;
    if (!group) return;
    group.clearLayers();
    if (props.returnPath && props.returnPath.length > 1) {
      L.polyline(props.returnPath.map(toLatLng), { className: 'map-return', weight: 6 }).addTo(
        group,
      );
    }
  }, [props.returnPath]);

  // Live position.
  useEffect(() => {
    const group = layers.current?.you;
    if (!group) return;
    group.clearLayers();
    if (!props.you) return;
    if (props.you.accuracy && props.you.accuracy > 15) {
      L.circle(toLatLng(props.you.point), {
        radius: props.you.accuracy,
        className: 'map-accuracy',
      }).addTo(group);
    }
    L.marker(toLatLng(props.you.point), {
      icon: youIcon,
      keyboard: false,
      zIndexOffset: 1000,
    }).addTo(group);
    if (props.follow) map.current?.panTo(toLatLng(props.you.point), { animate: true });
  }, [props.you, props.follow]);

  // Fit to the loop when asked.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const points = props.loop && props.loop.length > 1 ? props.loop : [props.start];
    if (points.length > 1) {
      m.fitBounds(L.latLngBounds(points.map(toLatLng)), { padding: [28, 28] });
    } else {
      m.setView(toLatLng(props.start), 16);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the caller asks
  }, [props.fitKey]);

  return (
    <div
      ref={element}
      className={`map ${props.onPick ? 'is-picking' : ''} ${props.className ?? ''}`}
      role="application"
      aria-label={props.label ?? 'Map of the walking loop'}
    />
  );
}
