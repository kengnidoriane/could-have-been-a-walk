import { makeRoute, simplify, type LatLon } from './geo';
import { decodePolyline, encodePolyline } from './polyline';

/** Everything the phone needs for the walk, with no server and no model. */
export interface WalkPlan {
  title: string;
  /** Meeting start and end, epoch ms. */
  start: number;
  end: number;
  speedKmh: number;
  /** The loop, start = finish. */
  route: LatLon[];
  /** Agenda, with distances in metres along `route`. */
  segments: WalkSegment[];
  startLabel: string;
}

export interface WalkSegment {
  topic: string;
  prompt: string;
  startAlong: number;
  endAlong: number;
  untilLabel: string;
}

export class WalkPlanError extends Error {}

/** Compact wire format: short keys, polyline route, segments as tuples. */
interface Packed {
  v: 1;
  t: string;
  s: number;
  e: number;
  k: number;
  p: string;
  a: [string, string, number, number, string][];
  l: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
) {
  const writer = stream.writable.getWriter();
  void writer.write(bytes).catch(() => undefined);
  void writer.close().catch(() => undefined);
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/**
 * Pack a walk into a URL-safe string. The route is simplified (a few metres of tolerance is
 * invisible on a phone map) so the QR code stays easy to scan from a laptop screen.
 */
export async function encodeWalkPlan(plan: WalkPlan, toleranceM = 4): Promise<string> {
  const full = makeRoute(plan.route);
  const simple = simplify(plan.route, toleranceM);
  const scale = full.length > 0 ? makeRoute(simple).length / full.length : 1;
  const packed: Packed = {
    v: 1,
    t: plan.title.slice(0, 120),
    s: Math.round(plan.start / 1000),
    e: Math.round(plan.end / 1000),
    k: plan.speedKmh,
    p: encodePolyline(simple),
    a: plan.segments.map((s) => [
      s.topic.slice(0, 80),
      s.prompt.slice(0, 140),
      Math.round(s.startAlong * scale),
      Math.round(s.endAlong * scale),
      s.untilLabel.slice(0, 60),
    ]),
    l: plan.startLabel.slice(0, 60),
  };
  const json = new TextEncoder().encode(JSON.stringify(packed));
  return toBase64Url(await pipe(new Uint8Array(json), new CompressionStream('deflate-raw')));
}

export async function decodeWalkPlan(text: string): Promise<WalkPlan> {
  let packed: Packed;
  try {
    const json = await pipe(fromBase64Url(text.trim()), new DecompressionStream('deflate-raw'));
    packed = JSON.parse(new TextDecoder().decode(json)) as Packed;
  } catch {
    throw new WalkPlanError('This walk link is damaged or incomplete.');
  }
  if (packed?.v !== 1 || typeof packed.p !== 'string' || !Array.isArray(packed.a)) {
    throw new WalkPlanError('This walk link comes from another version of the app.');
  }
  const route = decodePolyline(packed.p);
  if (route.length < 2) throw new WalkPlanError('This walk link has no route.');
  return {
    title: String(packed.t),
    start: packed.s * 1000,
    end: packed.e * 1000,
    speedKmh: Number(packed.k),
    route,
    segments: packed.a.map(([topic, prompt, startAlong, endAlong, untilLabel]) => ({
      topic,
      prompt,
      startAlong,
      endAlong,
      untilLabel,
    })),
    startLabel: String(packed.l ?? 'Start'),
  };
}
