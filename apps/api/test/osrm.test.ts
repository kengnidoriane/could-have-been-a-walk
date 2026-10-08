import { encodePolyline } from '@cbaw/core';
import { describe, expect, it, vi } from 'vitest';
import { NoRouteError, OsrmRouter, RouterUnavailableError } from '../src/routing/osrm';

const A = { lat: 6.2907, lon: -10.7605 };
const B = { lat: 6.295, lon: -10.755 };

function okBody() {
  return {
    code: 'Ok',
    routes: [
      {
        distance: 420,
        geometry: encodePolyline([A, B, A]),
        legs: [
          {
            steps: [
              { name: '', distance: 90, maneuver: { location: [A.lon, A.lat] } },
              { name: 'Lakpazee Road', distance: 120, maneuver: { location: [-10.7597, 6.291] } },
            ],
          },
          {
            steps: [
              { name: 'Tubman Boulevard', distance: 210, maneuver: { location: [B.lon, B.lat] } },
            ],
          },
        ],
      },
    ],
  };
}

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('OsrmRouter', () => {
  it('builds a foot-profile URL with lon,lat pairs', () => {
    const router = new OsrmRouter({ baseUrl: 'https://osrm.example/routed-foot/', cacheDir: null });
    expect(router.url([A, B])).toBe(
      'https://osrm.example/routed-foot/route/v1/foot/-10.76050,6.29070;-10.75500,6.29500?overview=full&geometries=polyline&steps=true',
    );
  });

  it('decodes geometry and accumulates step distances across legs', async () => {
    const router = new OsrmRouter({
      baseUrl: 'x',
      cacheDir: null,
      fetch: fakeFetch(okBody()),
      minIntervalMs: 0,
    });
    const path = await router.route([A, B, A]);
    expect(path.distanceM).toBe(420);
    expect(path.points).toHaveLength(3);
    expect(path.steps.map((s) => [s.name, s.along])).toEqual([
      ['', 0],
      ['Lakpazee Road', 90],
      ['Tubman Boulevard', 210],
    ]);
  });

  it('serves repeated requests from the cache', async () => {
    const fetch = fakeFetch(okBody());
    const router = new OsrmRouter({ baseUrl: 'x', cacheDir: null, fetch, minIntervalMs: 0 });
    await router.route([A, B, A]);
    await router.route([A, B, A]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(router.stats).toEqual({ network: 1, cacheHits: 1 });
  });

  it('spaces network calls out (FOSSGIS: max 1 request per second)', async () => {
    const router = new OsrmRouter({
      baseUrl: 'x',
      cacheDir: null,
      fetch: fakeFetch(okBody()),
      minIntervalMs: 120,
    });
    const t0 = Date.now();
    await Promise.all([router.route([A, B]), router.route([B, A]), router.route([A, A])]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(230);
  });

  it('distinguishes "no route" from "service down"', async () => {
    const noRoute = new OsrmRouter({
      baseUrl: 'x',
      cacheDir: null,
      fetch: fakeFetch({ code: 'NoRoute', message: 'Impossible route between points' }, 400),
      minIntervalMs: 0,
    });
    await expect(noRoute.route([A, B])).rejects.toThrow(NoRouteError);

    const down = new OsrmRouter({
      baseUrl: 'x',
      cacheDir: null,
      fetch: fakeFetch({}, 503),
      minIntervalMs: 0,
    });
    await expect(down.route([A, B])).rejects.toThrow(RouterUnavailableError);

    const offline = new OsrmRouter({
      baseUrl: 'x',
      cacheDir: null,
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
      minIntervalMs: 0,
    });
    await expect(offline.route([A, B])).rejects.toThrow(/unreachable/);
  });
});
