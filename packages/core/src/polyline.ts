import type { LatLon } from './geo';

// Encoded Polyline Algorithm Format (the one Google and OSRM use), precision 5 by default.

function encodeSigned(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

export function encodePolyline(points: LatLon[], precision = 5): string {
  const factor = 10 ** precision;
  let lastLat = 0;
  let lastLon = 0;
  let out = '';
  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lon = Math.round(p.lon * factor);
    out += encodeSigned(lat - lastLat) + encodeSigned(lon - lastLon);
    lastLat = lat;
    lastLon = lon;
  }
  return out;
}

export function decodePolyline(encoded: string, precision = 5): LatLon[] {
  const factor = 10 ** precision;
  const points: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new Error('Truncated polyline');
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push({ lat: lat / factor, lon: lon / factor });
  }
  return points;
}
