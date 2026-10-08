import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  decodePolyline,
  RouterUnavailableError,
  type LatLon,
  type RoutedPath,
  type RouteStep,
  type WalkRouter,
} from '@cbaw/core';

export { RouterUnavailableError };

/** The router answered, but there is no walkable route through these points. */
export class NoRouteError extends Error {}

interface OsrmStep {
  name: string;
  distance: number;
  maneuver: { location: [number, number] };
}

interface OsrmResponse {
  code: string;
  message?: string;
  routes?: { distance: number; geometry: string; legs: { steps: OsrmStep[] }[] }[];
  waypoints?: { distance: number }[];
}

export interface OsrmOptions {
  /** e.g. https://routing.openstreetmap.de/routed-foot */
  baseUrl: string;
  userAgent?: string;
  /** Minimum gap between network calls. The FOSSGIS server asks for at most 1 request/second. */
  minIntervalMs?: number;
  /** Directory for the on-disk response cache; null disables it. */
  cacheDir?: string | null;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** OSRM HTTP client for walking routes, with an in-memory + on-disk cache and a polite throttle. */
export class OsrmRouter implements WalkRouter {
  readonly stats = { network: 0, cacheHits: 0 };
  private readonly memory = new Map<string, RoutedPath>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OsrmOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  url(waypoints: LatLon[]): string {
    // 5 decimals ≈ 1 m: plenty for walking, and repeated requests hit the cache.
    const coords = waypoints.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
    const base = this.options.baseUrl.replace(/\/+$/, '');
    return `${base}/route/v1/foot/${coords}?overview=full&geometries=polyline&steps=true`;
  }

  async route(waypoints: LatLon[]): Promise<RoutedPath> {
    const url = this.url(waypoints);
    const cached = this.memory.get(url) ?? (await this.readDisk(url));
    if (cached) {
      this.stats.cacheHits++;
      this.memory.set(url, cached);
      return cached;
    }

    const body = await this.throttled(() => this.fetchJson(url));
    if (body.code !== 'Ok' || !body.routes?.[0]) {
      throw new NoRouteError(body.message ?? body.code);
    }
    const path = toRoutedPath(body.routes[0], body.waypoints);
    this.memory.set(url, path);
    await this.writeDisk(url, path);
    return path;
  }

  private throttled<T>(task: () => Promise<T>): Promise<T> {
    const minInterval = this.options.minIntervalMs ?? 1100;
    const run = this.queue.then(async () => {
      const wait = this.lastCallAt + minInterval - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCallAt = Date.now();
      return task();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async fetchJson(url: string): Promise<OsrmResponse> {
    this.stats.network++;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: {
          'User-Agent':
            this.options.userAgent ??
            'could-have-been-a-walk/0.1 (+https://github.com/kengnidoriane/could-have-been-a-walk)',
        },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      });
    } catch (err) {
      throw new RouterUnavailableError(`Routing service unreachable: ${(err as Error).message}`);
    }
    // OSRM answers 400 with a JSON body for "NoRoute"/"NoSegment"; 5xx means the server is unwell.
    if (res.status >= 500 || res.status === 429) {
      throw new RouterUnavailableError(`Routing service answered HTTP ${res.status}`);
    }
    try {
      return (await res.json()) as OsrmResponse;
    } catch {
      throw new RouterUnavailableError(`Routing service sent invalid JSON (HTTP ${res.status})`);
    }
  }

  private cachePath(url: string): string | null {
    if (!this.options.cacheDir) return null;
    return join(this.options.cacheDir, `${createHash('sha1').update(url).digest('hex')}.json`);
  }

  private async readDisk(url: string): Promise<RoutedPath | undefined> {
    const file = this.cachePath(url);
    if (!file) return undefined;
    try {
      return JSON.parse(await readFile(file, 'utf8')) as RoutedPath;
    } catch {
      return undefined;
    }
  }

  private async writeDisk(url: string, path: RoutedPath): Promise<void> {
    const file = this.cachePath(url);
    if (!file || !this.options.cacheDir) return;
    try {
      await mkdir(this.options.cacheDir, { recursive: true });
      await writeFile(file, JSON.stringify(path));
    } catch {
      // A cache that can't be written is not an error.
    }
  }
}

export function toRoutedPath(
  route: NonNullable<OsrmResponse['routes']>[number],
  waypoints: OsrmResponse['waypoints'] = [],
): RoutedPath {
  const steps: RouteStep[] = [];
  let along = 0;
  for (const leg of route.legs) {
    for (const step of leg.steps) {
      const [lon, lat] = step.maneuver.location;
      steps.push({ name: step.name ?? '', along, location: { lat, lon } });
      along += step.distance;
    }
  }
  return {
    points: decodePolyline(route.geometry),
    distanceM: route.distance,
    steps,
    snapDistancesM: waypoints.map((w) => w.distance),
  };
}
