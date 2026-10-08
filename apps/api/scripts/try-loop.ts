// Live check against the real routing server: `pnpm --filter @cbaw/api try-loop 6.2907 -10.7605 30`
import { fileURLToPath } from 'node:url';
import { findLoop } from '@cbaw/core';
import { config } from '../src/config';
import { OsrmRouter } from '../src/routing/osrm';

const [lat = 6.2907, lon = -10.7605, minutes = 30, runs = 3] = process.argv.slice(2).map(Number);
const router = new OsrmRouter({
  baseUrl: config.osrmBaseUrl,
  cacheDir: fileURLToPath(new URL('../.cache/osrm/', import.meta.url)),
});

for (let seed = 1; seed <= runs; seed++) {
  const t0 = performance.now();
  const loop = await findLoop(router, {
    start: { lat, lon },
    minutes,
    seed,
    onProbe: (p) =>
      console.log(
        `  probe bearing ${p.bearing.toFixed(0)}° r=${p.radiusM.toFixed(0)} m → ` +
          (p.failure ??
            `${p.rawDistanceM?.toFixed(0)} m raw, ${p.distanceM?.toFixed(0)} m clean (${((p.error ?? 0) * 100).toFixed(1)}%)`),
      ),
  });
  const ms = Math.round(performance.now() - t0);
  console.log(
    `seed ${seed}: ${(loop.distanceM / 1000).toFixed(2)} km for ${loop.targetMin} min target → ` +
      `${loop.durationMin.toFixed(1)} min (${(loop.error * 100).toFixed(1)}%), ` +
      `${loop.routingCalls} calls, overlap ${(loop.overlapRatio * 100).toFixed(0)}%, ${ms} ms, ` +
      `landmarks: ${loop.landmarks.map((l) => `${l.name}@${l.minute.toFixed(0)}'`).join(', ') || '—'}`,
  );
}
console.log('router stats', router.stats);
