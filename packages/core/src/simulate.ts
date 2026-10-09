import { destination, makeRoute, pointAt, type LatLon, type Route } from './geo';
import type { Fix } from './turnBack';

/** One stretch of a scripted walk. */
export interface WalkerLeg {
  /** Walk until this distance along the current path, metres (Infinity: to the end). */
  untilAlong: number;
  /** Multiplies the walker's base speed. */
  speedFactor: number;
  /** Stand still this long when the leg starts (chatting at the park). */
  pauseMs?: number;
}

/**
 * A pretend walker that follows a path with a scripted pace. Used by the tests to simulate
 * slow, fast and chatty walkers, and by the walk page's demo mode.
 */
export class VirtualWalker {
  private path: Route;
  private along = 0;
  private legs: WalkerLeg[];
  private legIndex = 0;
  private pauseLeft: number;

  constructor(
    path: LatLon[],
    private readonly baseMps: number,
    legs: WalkerLeg[] = [{ untilAlong: Infinity, speedFactor: 1 }],
  ) {
    this.path = makeRoute(path);
    this.legs = legs;
    this.pauseLeft = legs[0]?.pauseMs ?? 0;
  }

  get position(): LatLon {
    return pointAt(this.path, this.along);
  }

  get done(): boolean {
    return this.along >= this.path.length - 0.01;
  }

  get paused(): boolean {
    return this.pauseLeft > 0;
  }

  step(dtMs: number): void {
    let left = dtMs;
    while (left > 0 && !this.done) {
      if (this.pauseLeft > 0) {
        const pause = Math.min(this.pauseLeft, left);
        this.pauseLeft -= pause;
        left -= pause;
        continue;
      }
      const leg = this.legs[this.legIndex] ?? { untilAlong: Infinity, speedFactor: 1 };
      const speed = this.baseMps * Math.max(0.05, leg.speedFactor);
      const target = Math.min(leg.untilAlong, this.path.length);
      const needMs = (Math.max(0, target - this.along) / speed) * 1000;
      if (needMs > left) {
        this.along += (speed * left) / 1000;
        left = 0;
      } else {
        this.along = target;
        left -= needMs;
        this.legIndex++;
        this.pauseLeft = this.legs[this.legIndex]?.pauseMs ?? 0;
      }
    }
  }

  /** Leave the current path and walk `path` from its start (e.g. the shortest way back). */
  divert(path: LatLon[], speedFactor = 1): void {
    this.path = makeRoute(path);
    this.along = 0;
    this.legs = [{ untilAlong: Infinity, speedFactor }];
    this.legIndex = 0;
    this.pauseLeft = 0;
  }
}

/** Deterministic pseudo-random numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Move a point by up to `meters` in a random direction: cheap GPS noise. */
export function jitter(point: LatLon, meters: number, random: () => number): LatLon {
  return destination(point, random() * 360, random() * meters);
}

/**
 * The demo-mode walk: a normal start, a long chat at about a third of the loop, then a
 * slower pace. It reliably runs out of time, so the phone gets to say TURN BACK NOW.
 */
export function demoWalkLegs(loopLength: number): WalkerLeg[] {
  return [
    { untilAlong: loopLength * 0.3, speedFactor: 1 },
    { untilAlong: Infinity, speedFactor: 0.9, pauseMs: 6 * 60_000 },
  ];
}

/** Plays a recorded GPS track back: each call hands over the fixes whose time has come. */
export class TrackReplay {
  private cursor = 0;

  /** `fixes` sorted by `t`, in ms since the start of the recording. */
  constructor(private readonly fixes: Fix[]) {}

  due(elapsedMs: number): Fix[] {
    const out: Fix[] = [];
    while (this.cursor < this.fixes.length && this.fixes[this.cursor]!.t <= elapsedMs) {
      out.push(this.fixes[this.cursor++]!);
    }
    return out;
  }

  get done(): boolean {
    return this.cursor >= this.fixes.length;
  }
}
