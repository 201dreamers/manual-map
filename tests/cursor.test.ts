import {
  check,
  installStorageStub,
  report,
  settleStepAnimation,
  stubDirections,
} from './harness';
import {
  buildRouteGeometry,
  isWithinTapRadius,
  projectOntoRoute,
  TAP_SNAP_PIXELS,
} from '../src/lib/geo';

installStorageStub();

// A 2 km straight north-south road, so distances along it are easy to reason about.
const ROUTE_COORDS: [number, number][] = [
  [30.5, 50.45],
  [30.5, 50.459],
  [30.5, 50.468],
];
stubDirections(ROUTE_COORDS, 2000);

// ---------- projectOntoRoute ----------
const geometry = buildRouteGeometry(ROUTE_COORDS);
const total = geometry.totalDistanceMeters;

const midpoint = projectOntoRoute(geometry.line, [30.5, 50.459]);
check('projection lands on the route', midpoint !== null);
check('projection reports the halfway distance',
  Math.abs(midpoint!.distanceMeters - total / 2) < 25,
  `${midpoint!.distanceMeters.toFixed(0)}m of ${total.toFixed(0)}m`);
check('projection snaps onto the line, not the tap',
  Math.abs(midpoint!.coordinate[0] - 30.5) < 1e-6);

// A tap beside the road still projects onto it, at the same distance along.
const offRoad = projectOntoRoute(geometry.line, [30.503, 50.459]);
check('an off-road tap still projects onto the line',
  offRoad !== null && Math.abs(offRoad.distanceMeters - total / 2) < 25,
  `${offRoad?.distanceMeters.toFixed(0)}m`);
check('an off-road projection is pulled back to the road',
  Math.abs(offRoad!.coordinate[0] - 30.5) < 1e-6);

// Past either end, turf clamps to the terminus rather than extrapolating.
const beyondEnd = projectOntoRoute(geometry.line, [30.5, 50.52]);
check('a tap past the end clamps to the route end',
  beyondEnd !== null && Math.abs(beyondEnd.distanceMeters - total) < 1,
  `${beyondEnd?.distanceMeters.toFixed(0)}m`);

// ---------- AC-508: the screen-space gate ----------
check('a tap on the snapped point is inside the radius',
  isWithinTapRadius({ x: 100, y: 100 }, { x: 100, y: 100 }));
check('a tap just inside the radius is accepted',
  isWithinTapRadius({ x: 100, y: 100 }, { x: 100, y: 100 + TAP_SNAP_PIXELS - 1 }));
check('a tap exactly at the radius is accepted',
  isWithinTapRadius({ x: 100, y: 100 }, { x: 100, y: 100 + TAP_SNAP_PIXELS }));
check('a tap past the radius is refused',
  !isWithinTapRadius({ x: 100, y: 100 }, { x: 100, y: 100 + TAP_SNAP_PIXELS + 1 }));
check('the radius is measured diagonally, not per axis',
  !isWithinTapRadius({ x: 100, y: 100 }, { x: 100 + 40, y: 100 + 40 }));

// ---------- AC-507 / AC-509: moving the cursor ----------
const { useSimulationStore } = await import('../src/store/simulationStore');
const s = () => useSimulationStore.getState();

s().setToken('pk.' + 'a'.repeat(60));

// With no route, a move is a no-op rather than a crash (section 24).
s().moveCursorTo(500);
check('moving without a route is ignored', s().telemetry.currentDistanceMeters === 0);

await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
check('fixture: route built', s().geometry !== null);

const routeTotal = s().geometry!.totalDistanceMeters;
const stopsBefore = s().routePoints.length;
const coordsBefore = JSON.stringify(s().geometry!.coordinates);

s().moveCursorTo(routeTotal / 2);
check('AC-507 the move glides rather than teleporting',
  s().telemetry.currentDistanceMeters === 0,
  `${s().telemetry.currentDistanceMeters.toFixed(0)}m immediately after the tap`);
settleStepAnimation(s);
check('AC-507 the cursor moves to the tapped distance',
  Math.abs(s().telemetry.currentDistanceMeters - routeTotal / 2) < 1e-6,
  `${s().telemetry.currentDistanceMeters.toFixed(0)}m`);
check('AC-507 display telemetry follows immediately',
  Math.abs(s().displayTelemetry.currentDistanceMeters - routeTotal / 2) < 1e-6);
check('AC-507 no stop is added', s().routePoints.length === stopsBefore);
check('AC-507 the geometry is untouched',
  JSON.stringify(s().geometry!.coordinates) === coordsBefore);
check('AC-507 remaining distance follows the move',
  Math.abs(s().telemetry.remainingDistanceMeters - routeTotal / 2) < 1e-6);

// Out-of-range values clamp instead of running off the end.
s().moveCursorTo(routeTotal * 10);
settleStepAnimation(s);
check('a move past the end clamps to the route end',
  Math.abs(s().telemetry.currentDistanceMeters - routeTotal) < 1e-6);
s().moveCursorTo(-500);
settleStepAnimation(s);
check('a negative move clamps to the start', s().telemetry.currentDistanceMeters === 0);

// AC-509: a move during playback keeps the drive running.
s().play();
check('fixture: playing', s().config.isPlaying);
check('fixture: play locked the route', s().isRouteLocked);
s().moveCursorTo(routeTotal / 4);
settleStepAnimation(s);
check('AC-509 playback continues after the move', s().config.isPlaying);
check('AC-509 a glide never pauses the drive the way a step does', s().config.isPlaying);
check('AC-509 the cursor moved while playing',
  Math.abs(s().telemetry.currentDistanceMeters - routeTotal / 4) < 1e-6,
  `${s().telemetry.currentDistanceMeters.toFixed(0)}m`);

// Playback resumes from the new point, not the old one.
s().advance(1);
check('AC-509 the drive continues from the new point',
  s().telemetry.currentDistanceMeters > routeTotal / 4,
  `${s().telemetry.currentDistanceMeters.toFixed(1)}m`);

// A step glide in flight must not drag the marker back.
s().pause();
s().step(1);
s().moveCursorTo(routeTotal / 2);
settleStepAnimation(s);
check('a move replaces an in-flight step glide',
  Math.abs(s().telemetry.currentDistanceMeters - routeTotal / 2) < 1e-6,
  `${s().telemetry.currentDistanceMeters.toFixed(1)}m`);

// The camera is left exactly as it was: a move is not a recenter.
s().setCameraTracking(false);
s().moveCursorTo(routeTotal / 3);
settleStepAnimation(s);
check('AC-507 a move does not re-engage camera tracking',
  !s().config.cameraTrackingEnabled);
s().setCameraTracking(true);
s().moveCursorTo(routeTotal / 3);
settleStepAnimation(s);
check('AC-507 a move does not release camera tracking',
  s().config.cameraTrackingEnabled);

report('cursor');
