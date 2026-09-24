import { readFileSync } from 'node:fs';
import { check, installStorageStub, report, stubDirections } from './harness';
import {
  lerpZoom,
  MIN_LOOK_AHEAD_ZOOM,
  MIN_VEHICLE_BOTTOM_CLEARANCE,
  steppedZoom,
  trackingPadding,
  vehicleAnchorY,
  VEHICLE_SCREEN_ANCHOR,
  ZOOM_SMOOTHING,
  ZOOM_STEP,
} from '../src/lib/camera';

installStorageStub();

const ROUTE_COORDS: [number, number][] = [
  [30.5, 50.45],
  [30.5, 50.459],
  [30.5, 50.468],
];
stubDirections(ROUTE_COORDS, 2000);

const MAX_ZOOM = 22;

// ---------- AC-510: the zoom step ----------
check('a press steps a whole level out', steppedZoom(16, -ZOOM_STEP, MAX_ZOOM) === 15);
check('a press steps a whole level in', steppedZoom(16, ZOOM_STEP, MAX_ZOOM) === 17);
check('three presses out reach the expected level',
  steppedZoom(steppedZoom(steppedZoom(16, -1, MAX_ZOOM), -1, MAX_ZOOM), -1, MAX_ZOOM) === 13);

// Section 24: clamping is silent at both ends.
check('zooming out clamps at the floor',
  steppedZoom(MIN_LOOK_AHEAD_ZOOM, -ZOOM_STEP, MAX_ZOOM) === MIN_LOOK_AHEAD_ZOOM);
check('a huge step out still clamps at the floor',
  steppedZoom(16, -99, MAX_ZOOM) === MIN_LOOK_AHEAD_ZOOM);
check('zooming in clamps at the map maximum',
  steppedZoom(MAX_ZOOM, ZOOM_STEP, MAX_ZOOM) === MAX_ZOOM);
check('the ceiling is the map maximum, not the tracking zoom',
  steppedZoom(16, ZOOM_STEP, MAX_ZOOM) > 16);
check('a non-finite zoom falls back to the floor',
  steppedZoom(Number.NaN, -ZOOM_STEP, MAX_ZOOM) === MIN_LOOK_AHEAD_ZOOM);

// ---------- the store only asks; the map clamps ----------
const { useSimulationStore } = await import('../src/store/simulationStore');
const s = () => useSimulationStore.getState();

s().setToken('pk.' + 'a'.repeat(60));
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);

const firstId = s().zoomRequest.id;
s().requestZoom(-ZOOM_STEP);
check('a zoom request is raised', s().zoomRequest.id === firstId + 1);
check('the request carries the direction', s().zoomRequest.delta === -ZOOM_STEP);

s().requestZoom(-ZOOM_STEP);
check('repeated presses each raise a request', s().zoomRequest.id === firstId + 2,
  `${s().zoomRequest.id - firstId} requests`);

s().requestZoom(ZOOM_STEP);
check('the opposite direction is carried too', s().zoomRequest.delta === ZOOM_STEP);

// AC-510: zooming must not disturb what the camera is doing.
s().play();
const trackingBefore = s().config.cameraTrackingEnabled;
const playingBefore = s().config.isPlaying;
const distanceBefore = s().telemetry.currentDistanceMeters;
s().requestZoom(-ZOOM_STEP);
check('AC-510 zooming leaves camera tracking engaged',
  s().config.cameraTrackingEnabled === trackingBefore && trackingBefore);
check('AC-510 zooming does not pause playback', s().config.isPlaying === playingBefore);
check('AC-510 zooming does not move the marker',
  s().telemetry.currentDistanceMeters === distanceBefore);
s().pause();

// ---------- AC-511 / AC-512: which gestures still release tracking ----------
// The binding lives inside the map lifecycle, which needs WebGL, so the guard reads
// the source: a regression here is silent on a device until tracking dies mid-drive.
const mapView = readFileSync('src/components/MapView.tsx', 'utf8');

check('AC-511 zoom is not bound to the tracking-kill handler',
  !/map\.on\('zoomstart', handleUserGesture\)/.test(mapView));
check('AC-512 drag still releases tracking',
  /map\.on\('dragstart', handleUserGesture\)/.test(mapView));
check('rotate still releases tracking',
  /map\.on\('rotatestart', handleUserGesture\)/.test(mapView));
check('AC-511 pinch rotation is suppressed while tracking',
  mapView.includes('touchZoomRotate.disableRotation()'));
check('AC-511 pinch rotation is restored once tracking stops',
  mapView.includes('touchZoomRotate.enableRotation()'));

// ---------- the vehicle sits below centre so more road is visible ahead ----------
// Tall enough that the anchor fraction wins over the bottom clearance.
const HEIGHT = 900;
const padded = trackingPadding(HEIGHT);

// Mapbox centres inside the padded box, so the marker lands at (top + height) / 2.
const anchorY = (padded.top + (HEIGHT - padded.bottom)) / 2;
check('the marker sits at the configured anchor',
  Math.abs(anchorY - HEIGHT * VEHICLE_SCREEN_ANCHOR) < 1e-6,
  `${anchorY.toFixed(0)}px of ${HEIGHT}px`);
check('the marker sits below the middle of the screen', anchorY > HEIGHT / 2);
check('the marker stays on screen', anchorY < HEIGHT);
check('more of the view is ahead of the marker than behind',
  HEIGHT - anchorY < anchorY);
check('only the top is inset, so the anchor moves down and not sideways',
  padded.bottom === 0 && padded.left === 0 && padded.right === 0);

// A container with no measurable height must not produce a negative inset.
check('a zero-height container yields no padding', trackingPadding(0).top === 0);
check('a non-finite height yields no padding', trackingPadding(Number.NaN).top === 0);

// On a short screen the marker would otherwise land behind the floating controls.
const SHORT = 600;
check('a short screen keeps the marker clear of the bottom',
  SHORT - vehicleAnchorY(SHORT) >= MIN_VEHICLE_BOTTOM_CLEARANCE,
  `${(SHORT - vehicleAnchorY(SHORT)).toFixed(0)}px of clearance`);
check('a short screen still puts the marker below centre',
  vehicleAnchorY(SHORT) > SHORT / 2, `${vehicleAnchorY(SHORT).toFixed(0)}px of ${SHORT}px`);
check('a tall screen is governed by the anchor, not the clearance',
  Math.abs(vehicleAnchorY(HEIGHT) - HEIGHT * VEHICLE_SCREEN_ANCHOR) < 1e-6);
// The old rule returned the middle when the clearance could not be met, which put the
// marker *below* the top of the controls - hiding it in exactly the case the clearance
// exists to prevent. Clearance wins instead, floored so it cannot leave the screen.
check('a viewport shorter than the clearance keeps the clearance, not the middle',
  vehicleAnchorY(300) === 100, `${vehicleAnchorY(300)}px`);
check('the floor stops a huge cluster pushing the marker off the top',
  vehicleAnchorY(300, 250) === 90, `${vehicleAnchorY(300, 250)}px`);
// A measured cluster is passed in rather than assumed: 695px viewport, 320px of controls.
check('a measured clearance is honoured exactly',
  vehicleAnchorY(695, 320) === 375, `${vehicleAnchorY(695, 320)}px`);
check('and still leaves the marker below the floor',
  vehicleAnchorY(695, 320) > 695 * 0.3);
check('the inset is never negative', trackingPadding(300).top >= 0);

// Every camera move that should hold the anchor must ask for it, and none of them may
// let the padding stick, or fit-to-route would frame off-centre afterwards.
const anchoredMoves =
  mapView.match(/padding: trackingPadding\([\s\S]*?\),\s*retainPadding: false/g) ?? [];
check('every anchored camera move applies the anchor without retaining it',
  anchoredMoves.length === (mapView.match(/padding: trackingPadding\(/g) ?? []).length,
  `${anchoredMoves.length} anchored moves`);
check('the anchor is applied by more than one code path', anchoredMoves.length >= 3,
  `${anchoredMoves.length} call sites`);
check('no camera move retains padding', !/retainPadding: true/.test(mapView));

// ---------- the tracking loop eases the zoom itself ----------
// A tracking frame is a jumpTo, and jumpTo calls _stop(), so an easeTo started by the
// buttons is cancelled on the next frame. Playback therefore has to ease it per frame.
check('one frame moves part of the way', lerpZoom(16, 13, ZOOM_SMOOTHING) < 16);
check('one frame does not overshoot the target', lerpZoom(16, 13, ZOOM_SMOOTHING) > 13);

let eased = 16;
let frames = 0;
while (eased !== 13) {
  eased = lerpZoom(eased, 13, ZOOM_SMOOTHING);
  if (++frames > 600) break;
}
check('the ease reaches the target exactly', eased === 13, `${frames} frames`);
check('the ease settles inside a second at 60 FPS', frames <= 60, `${frames} frames`);
check('an already-reached target is a no-op', lerpZoom(13, 13, ZOOM_SMOOTHING) === 13);
check('a non-finite current zoom snaps to the target',
  lerpZoom(Number.NaN, 13, ZOOM_SMOOTHING) === 13);

// The wiring cannot be exercised without WebGL, so these read the source instead.
check('the tracking frame drives the zoom rather than copying the current one',
  /zoom = lerpZoom\(map\.getZoom\(\), zoomTargetRef\.current, ZOOM_SMOOTHING\)/.test(mapView));
// Tracking frames are driven by telemetry, which is static while paused, so a request
// that relied on them alone would do nothing on a centred but stopped route.
check('a zoom request always animates, tracking or not',
  !/if \(!useSimulationStore\.getState\(\)\.config\.cameraTrackingEnabled\) \{\s*map\.easeTo/.test(
    mapView,
  ));
check('a zoom request while tracking re-anchors instead of zooming about the middle',
  /center: telemetry\.currentCoordinate,\s*zoom: next,\s*padding: trackingPadding/.test(mapView));
check('a zoom request with the camera released just changes the zoom',
  /\} else \{\s*map\.easeTo\(\{ zoom: next, duration: ZOOM_EASE_DURATION_MS \}\);/.test(mapView));
check('a pinch takes over the tracking target',
  /map\.on\('zoom'[\s\S]*?zoomTargetRef\.current = map\.getZoom\(\)/.test(mapView));

report('zoom');
