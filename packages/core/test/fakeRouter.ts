import { bearing, destination, haversine, type LatLon } from '../src/geo';
import type { RoutedPath, WalkRouter } from '../src/loop';

/**
 * Routes in straight lines between waypoints, then inflates the distance by a detour factor
 * that depends on the direction, like a real street grid would.
 */
export class FakeRouter implements WalkRouter {
  calls: LatLon[][] = [];

  constructor(
    private detour: (initialBearing: number, radius: number) => number = () => 1.3,
    private failWhen: (waypoints: LatLon[]) => boolean = () => false,
  ) {}

  async route(waypoints: LatLon[]): Promise<RoutedPath> {
    this.calls.push(waypoints);
    if (this.failWhen(waypoints)) throw new Error('NoRoute');

    const start = waypoints[0]!;
    const far = waypoints[2]!;
    const radius = haversine(start, far) / 2;
    const initialBearing = bearing(start, far);
    const factor = this.detour(initialBearing, radius);

    const points: LatLon[] = [];
    const steps: RoutedPath['steps'] = [];
    let along = 0;
    for (let leg = 0; leg < waypoints.length - 1; leg++) {
      const a = waypoints[leg]!;
      const b = waypoints[leg + 1]!;
      const legLength = haversine(a, b);
      steps.push({ name: `Street ${leg + 1}`, along: along * factor, location: a });
      const n = Math.max(1, Math.ceil(legLength / 25));
      for (let k = 0; k < n; k++) {
        points.push(destination(a, bearing(a, b), (legLength * k) / n));
      }
      along += legLength;
    }
    points.push(waypoints[waypoints.length - 1]!);
    return { points, distanceM: along * factor, steps };
  }
}
