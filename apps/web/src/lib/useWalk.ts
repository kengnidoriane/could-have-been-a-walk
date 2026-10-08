import {
  assess,
  demoWalkLegs,
  haversine,
  jitter,
  kmhToMps,
  makeRoute,
  seededRandom,
  startTracker,
  VirtualWalker,
  type Assessment,
  type Fix,
  type LatLon,
  type WalkPlan,
} from '@cbaw/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { alertGentle, alertTurnBack, keepScreenOn, unlockAudio } from './alerts';
import { fetchWayBack, type WayBack } from './osrm';
import { saveWalk } from './walkStats';

export type WalkMode = 'gps' | 'demo';
export type WalkStatus = 'ready' | 'walking' | 'arrived' | 'stopped';

export interface WalkView {
  status: WalkStatus;
  mode: WalkMode;
  speedUp: number;
  now: number;
  assessment: Assessment | null;
  /** Where the walkers actually went. */
  trail: LatLon[];
  walkedM: number;
  wayBack: LatLon[] | null;
  gpsError: string | null;
  /** The TURN BACK NOW screen is up and not acknowledged yet. */
  takeover: boolean;
  startedAt: number | null;
}

const DEMO_FIX_EVERY_MS = 5000;

/**
 * Runs a walk: real GPS, or a scripted replay at 10× for demos. Everything happens on the
 * phone; the only network call is the shortest way back, when it starts to matter.
 */
export function useWalk(plan: WalkPlan) {
  const route = useMemo(() => makeRoute(plan.route), [plan]);
  const start = plan.route[0]!;
  const [view, setView] = useState<WalkView>({
    status: 'ready',
    mode: 'gps',
    speedUp: 1,
    now: Date.now(),
    assessment: null,
    trail: [],
    walkedM: 0,
    wayBack: null,
    gpsError: null,
    takeover: false,
    startedAt: null,
  });

  const tracker = useRef(startTracker());
  const pendingFix = useRef<Fix | null>(null);
  const clock = useRef<{ realStart: number; simStart: number; factor: number } | null>(null);
  const walker = useRef<VirtualWalker | null>(null);
  const random = useRef(seededRandom(7));
  const lastDemoFix = useRef(0);
  const lastTick = useRef(0);
  const wayBack = useRef<WayBack | null>(null);
  const fetching = useRef(false);
  const trail = useRef<LatLon[]>([]);
  const walkedM = useRef(0);
  const cleanup = useRef<(() => void)[]>([]);
  const startedAt = useRef<number | null>(null);
  const takeover = useRef(false);

  const simNow = () => {
    const c = clock.current;
    return c ? c.simStart + (Date.now() - c.realStart) * c.factor : Date.now();
  };

  const stopTimers = useCallback(() => {
    cleanup.current.forEach((fn) => fn());
    cleanup.current = [];
  }, []);

  useEffect(() => stopTimers, [stopTimers]);

  const askWayBack = useCallback(
    (from: LatLon) => {
      if (fetching.current) return;
      fetching.current = true;
      fetchWayBack(from, start)
        .then((w) => {
          wayBack.current = w;
        })
        .catch(() => {
          // Offline: the straight-line estimate stays in charge.
          wayBack.current = {
            from,
            distanceM: haversine(from, start) * 1.3,
            points: [from, start],
          };
        })
        .finally(() => {
          fetching.current = false;
        });
    },
    [start],
  );

  const tick = useCallback(() => {
    const now = simNow();
    const dt = lastTick.current ? now - lastTick.current : 0;
    lastTick.current = now;

    let fix: Fix | null = null;
    if (walker.current) {
      walker.current.step(dt);
      if (now - lastDemoFix.current >= DEMO_FIX_EVERY_MS) {
        lastDemoFix.current = now;
        const p = jitter(walker.current.position, 4, random.current);
        fix = { lat: p.lat, lon: p.lon, accuracy: 8, t: now };
      }
    } else {
      fix = pendingFix.current;
      pendingFix.current = null;
    }

    if (fix && fix.accuracy <= 35) {
      const here = { lat: fix.lat, lon: fix.lon };
      const last = trail.current[trail.current.length - 1];
      const step = last ? haversine(last, here) : 0;
      if (!last || step > 3) {
        walkedM.current += step;
        trail.current = [...trail.current.slice(-1500), here];
      }
    }

    const w = wayBack.current;
    const position = trail.current[trail.current.length - 1];
    const directM = w && position && haversine(w.from, position) < 60 ? w.distanceM : null;
    const previous = tracker.current.decision;
    const result = assess(tracker.current, {
      route,
      fix,
      now,
      end: plan.end,
      speedKmh: plan.speedKmh,
      directM,
    });
    tracker.current = result.tracker;
    const a = result.assessment;

    // Confirm the way back with the router once it matters, and again after moving on.
    const matters = a.willCutShort || a.raw === 'TURN_BACK_NOW' || a.decision === 'TURN_BACK_NOW';
    if (matters && (!w || haversine(w.from, a.position) > 150)) askWayBack(a.position);

    if (a.decision !== previous) {
      if (a.decision === 'TURN_BACK_NOW') {
        alertTurnBack();
        takeover.current = true;
      } else if (a.decision === 'SUGGEST_EXTENSION') {
        alertGentle();
      }
    }

    let status: WalkStatus = 'walking';
    if (a.arrived) {
      status = 'arrived';
      stopTimers();
      saveWalk({
        at: Date.now(), // real time, even in a demo replay (its clock is simulated)
        title: plan.title,
        distanceM: walkedM.current,
        minutes: startedAt.current ? (now - startedAt.current) / 60_000 : 0,
        demo: !!walker.current,
      });
    }

    setView((v) => ({
      ...v,
      status,
      now,
      assessment: a,
      trail: trail.current,
      walkedM: walkedM.current,
      wayBack:
        a.decision === 'TURN_BACK_NOW' || a.willCutShort ? (wayBack.current?.points ?? null) : null,
      takeover: takeover.current && status === 'walking',
    }));
  }, [route, plan, askWayBack, stopTimers]);

  const begin = useCallback(
    (mode: WalkMode, speedUp = 10) => {
      unlockAudio();
      stopTimers();
      tracker.current = startTracker();
      wayBack.current = null;
      trail.current = [];
      walkedM.current = 0;
      takeover.current = false;
      lastTick.current = 0;
      lastDemoFix.current = 0;

      if (mode === 'demo') {
        // The replay starts when the meeting starts, and runs `speedUp` times faster.
        clock.current = { realStart: Date.now(), simStart: plan.start, factor: speedUp };
        walker.current = new VirtualWalker(
          plan.route,
          kmhToMps(plan.speedKmh),
          demoWalkLegs(route.length),
        );
      } else {
        clock.current = null;
        walker.current = null;
        if (!navigator.geolocation) {
          setView((v) => ({ ...v, gpsError: 'This browser has no location service.' }));
        } else {
          const id = navigator.geolocation.watchPosition(
            (pos) => {
              pendingFix.current = {
                lat: pos.coords.latitude,
                lon: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                t: Date.now(),
              };
              setView((v) => (v.gpsError ? { ...v, gpsError: null } : v));
            },
            (err) =>
              setView((v) => ({
                ...v,
                gpsError:
                  err.code === err.PERMISSION_DENIED
                    ? 'Location is blocked. The timer still works; allow location for TURN BACK NOW.'
                    : 'Looking for GPS… (step outside, away from tall buildings)',
              })),
            { enableHighAccuracy: true, maximumAge: 2000, timeout: 30_000 },
          );
          cleanup.current.push(() => navigator.geolocation.clearWatch(id));
        }
      }

      startedAt.current = simNow();
      cleanup.current.push(keepScreenOn());
      const interval = setInterval(tick, mode === 'demo' ? 250 : 1000);
      cleanup.current.push(() => clearInterval(interval));
      setView((v) => ({
        ...v,
        status: 'walking',
        mode,
        speedUp: mode === 'demo' ? speedUp : 1,
        startedAt: startedAt.current,
        takeover: false,
        gpsError: null,
      }));
      tick();
    },
    [plan, route, tick, stopTimers],
  );

  /** "We're heading back": close the takeover; the demo walkers take the shortest way home. */
  const acknowledge = useCallback(() => {
    takeover.current = false;
    if (walker.current) {
      const here = walker.current.position;
      const w = wayBack.current;
      const path = w && haversine(w.from, here) < 80 ? [here, ...w.points.slice(1)] : [here, start];
      walker.current.divert(path, 0.95);
    }
    setView((v) => ({ ...v, takeover: false }));
  }, [start]);

  const end = useCallback(() => {
    stopTimers();
    setView((v) => ({ ...v, status: 'stopped', takeover: false }));
  }, [stopTimers]);

  return { view, route, begin, acknowledge, end };
}
