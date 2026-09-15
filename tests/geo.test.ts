import { check, report } from './harness';
import {
  bearingAtDistance,
  buildRouteGeometry,
  clampDistance,
  coordinateAtDistance,
  lerpBearing,
  shortestAngleDelta,
} from '../src/lib/geo';
import type { CoordinateTuple } from '../src/types/domain';


// Straight 1 km due-north-ish segment plus an eastward leg.
const coords: CoordinateTuple[] = [
  [30.5, 50.45],
  [30.5, 50.459],  // ~1000 m north
  [30.514, 50.459], // ~1000 m east
];
const g = buildRouteGeometry(coords);
check('total length ~2000m', Math.abs(g.totalDistanceMeters - 2000) < 60, `${g.totalDistanceMeters.toFixed(1)}m`);

const mid = coordinateAtDistance(g, 500);
check('midpoint of first leg keeps longitude', Math.abs(mid[0] - 30.5) < 1e-6, JSON.stringify(mid));

check('clamp upper', clampDistance(g, 1e9) === g.totalDistanceMeters);
check('clamp lower', clampDistance(g, -500) === 0);
check('clamp NaN', clampDistance(g, Number.NaN) === 0);

const b0 = bearingAtDistance(g, 100);
check('bearing on north leg ~0deg', Math.min(Math.abs(b0), Math.abs(b0 - 360)) < 5, `${b0.toFixed(2)}`);
const b1 = bearingAtDistance(g, 1500);
check('bearing on east leg ~90deg', Math.abs(b1 - 90) < 5, `${b1.toFixed(2)}`);
const bEnd = bearingAtDistance(g, g.totalDistanceMeters);
check('bearing at route end stays finite', Number.isFinite(bEnd), `${bEnd.toFixed(2)}`);

check('shortest delta wraps 350->10', shortestAngleDelta(350, 10) === 20);
check('shortest delta wraps 10->350', shortestAngleDelta(10, 350) === -20);
check('lerp crosses north seam', Math.abs(lerpBearing(350, 10, 0.5) - 0) < 1e-6, `${lerpBearing(350, 10, 0.5)}`);

// Downsampling safeguard: a dense 4000-vertex line is simplified but keeps its length.
const dense: CoordinateTuple[] = Array.from({ length: 4000 }, (_, i) => [30.5 + i * 0.00001, 50.45]);
const denseGeom = buildRouteGeometry(dense);
check('dense route downsampled', denseGeom.coordinates.length < dense.length, `${denseGeom.coordinates.length} vertices`);
check('dense route length preserved', Math.abs(denseGeom.totalDistanceMeters - 2837) < 60, `${denseGeom.totalDistanceMeters.toFixed(1)}m`);

// Frame math from requirements 6.3 reproduced against the geometry helpers.
let distance = 0;
const speedKmh = 72; // 20 m/s
for (let frame = 0; frame < 60; frame++) distance += (speedKmh / 3.6) * (1 / 60);
check('one second at 72 km/h advances 20 m', Math.abs(distance - 20) < 1e-9, `${distance.toFixed(6)}m`);

// Regression guard for the arrow wobble: the heading fed to the marker and camera
// must advance monotonically along a smooth curve, never oscillate frame to frame.
{
  const curve: [number, number][] = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    curve.push([30.5 + t * 0.02, 50.45 + Math.sin(t * Math.PI) * 0.004]);
  }
  const smooth = buildRouteGeometry(curve);
  const metresPerFrame = 60 / 3.6 / 60; // 60 km/h at 60 fps
  let previous = bearingAtDistance(smooth, 0);
  let lastDirection = 0;
  let flips = 0;
  let maxStep = 0;

  for (let d = metresPerFrame; d < smooth.totalDistanceMeters; d += metresPerFrame) {
    const next = bearingAtDistance(smooth, d);
    const delta = shortestAngleDelta(previous, next);
    if (delta !== 0) {
      if (lastDirection !== 0 && Math.sign(delta) !== lastDirection) flips++;
      lastDirection = Math.sign(delta);
    }
    maxStep = Math.max(maxStep, Math.abs(delta));
    previous = next;
  }

  check('heading never reverses along a smooth curve', flips === 0, `${flips} flips`);
  check('per-frame heading change stays sub-degree', maxStep < 1, `${maxStep.toFixed(3)} deg`);
}

report('geo');
