import { haversine, type LatLon, type RoutedPath, type WalkRouter } from '@cbaw/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { NoRouteError, RouterUnavailableError } from '../src/routing/osrm';

const OFFICE = { lat: 6.2907, lon: -10.7605 };

/** Straight lines between waypoints with a fixed 1.3 detour factor. */
const straightRouter: WalkRouter = {
  async route(waypoints: LatLon[]): Promise<RoutedPath> {
    let d = 0;
    for (let i = 1; i < waypoints.length; i++) d += haversine(waypoints[i - 1]!, waypoints[i]!);
    return {
      points: waypoints,
      distanceM: d * 1.3,
      steps: [{ name: 'Tubman Boulevard', along: d * 0.4, location: waypoints[1]! }],
    };
  },
};

const failing = (error: Error): WalkRouter => ({
  async route() {
    throw error;
  },
});

async function post(router: WalkRouter, body: unknown) {
  const app = buildApp({ router });
  const res = await app.inject({ method: 'POST', url: '/api/loop', payload: body as object });
  await app.close();
  return res;
}

describe('POST /api/loop', () => {
  it('returns a loop sized for the meeting', async () => {
    const res = await post(straightRouter, { start: OFFICE, minutes: 30, seed: 4 });
    expect(res.statusCode).toBe(200);
    const loop = res.json();
    expect(loop.targetMin).toBe(27);
    expect(loop.withinTolerance).toBe(true);
    expect(loop.landmarks[0].name).toBe('Tubman Boulevard');
    expect(typeof loop.elapsedMs).toBe('number');
  });

  it('rejects invalid input with a readable message', async () => {
    const res = await post(straightRouter, { start: { lat: 123, lon: 0 }, minutes: 5 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
    expect(res.json().message).toMatch(/lat/);
  });

  it('answers 422 when no loop exists around the start', async () => {
    const res = await post(failing(new NoRouteError('NoSegment')), { start: OFFICE, minutes: 30 });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('no_loop');
  });

  it('answers 502 when the routing service is down', async () => {
    const res = await post(failing(new RouterUnavailableError('HTTP 503')), {
      start: OFFICE,
      minutes: 30,
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('routing_unavailable');
  });
});
