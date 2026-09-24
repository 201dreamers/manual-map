/**
 * Look-ahead zoom: stepping the camera out while it stays locked on the vehicle, so
 * more of the road ahead is visible without giving up heading-up tracking.
 */

/** One press moves a whole zoom level: smaller steps are not worth a tap while driving. */
export const ZOOM_STEP = 1;

/**
 * Floor for the look-ahead buttons. Below this the route is a thread on a country
 * map and the vehicle marker has nothing to sit against.
 */
export const MIN_LOOK_AHEAD_ZOOM = 10;

/**
 * Applies a zoom step and clamps it into the usable range. The upper bound is the
 * map's own maximum rather than the tracking zoom, because zooming further in than
 * the tracking default is a legitimate thing to want at a junction.
 */
export function steppedZoom(currentZoom: number, delta: number, maxZoom: number): number {
  if (!Number.isFinite(currentZoom)) return MIN_LOOK_AHEAD_ZOOM;
  const stepped = currentZoom + delta;
  return Math.min(Math.max(stepped, MIN_LOOK_AHEAD_ZOOM), maxZoom);
}

/**
 * Where the vehicle sits vertically on screen while the camera follows it, as a
 * fraction of container height. Dead centre (0.5) wastes half the view on road
 * already driven, so the marker is pushed well down and the road ahead gets the space.
 */
export const VEHICLE_SCREEN_ANCHOR = 0.75;

/**
 * Pixels kept between the marker and the bottom of the viewport. On a short screen the
 * anchor fraction alone would drop the marker behind the floating controls, so the
 * clearance wins and the anchor gives way.
 */
export const MIN_VEHICLE_BOTTOM_CLEARANCE = 200;

/**
 * Floor on the anchor, as a fraction of container height. Without it a very tall
 * control cluster would push the marker off the top of the screen chasing clearance.
 */
export const MIN_VEHICLE_SCREEN_ANCHOR = 0.3;

/**
 * Where the marker actually lands, in pixels from the top of the container.
 *
 * `bottomClearance` defaults to the constant but is normally passed the cluster's
 * measured height. The constant was a guess at that height, and it went stale every
 * time the controls changed - which is what put the marker behind them.
 *
 * The previous fallback returned the middle of the container whenever the clearance
 * could not be met. That was actively wrong once the cluster passed half the viewport:
 * the middle is *below* the top of the controls, so the fallback hid the marker rather
 * than rescuing it. Clearance wins instead, exactly as D-13 says it should, floored so
 * the marker cannot climb off the top of the screen.
 */
export function vehicleAnchorY(
  containerHeight: number,
  bottomClearance = MIN_VEHICLE_BOTTOM_CLEARANCE,
): number {
  if (!Number.isFinite(containerHeight) || containerHeight <= 0) return 0;
  const preferred = containerHeight * VEHICLE_SCREEN_ANCHOR;
  const clearanceLimit = containerHeight - bottomClearance;
  const floor = containerHeight * MIN_VEHICLE_SCREEN_ANCHOR;
  return Math.max(Math.min(preferred, clearanceLimit), floor);
}

/**
 * Padding that lands a centred coordinate on the anchor instead of the middle of the
 * screen. Mapbox centres within the padded box, so a top inset of
 * `2 * anchorY - height` puts the box centre exactly on the anchor.
 *
 * Applied with `retainPadding: false`, so it shifts one camera move without sticking
 * to the map and skewing later framing such as fit-to-route.
 */
export function trackingPadding(
  containerHeight: number,
  bottomClearance = MIN_VEHICLE_BOTTOM_CLEARANCE,
): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
  return {
    top: Math.max(2 * vehicleAnchorY(containerHeight, bottomClearance) - containerHeight, 0),
    bottom: 0,
    left: 0,
    right: 0,
  };
}

/**
 * Per-frame easing for zoom changes while the camera is following the vehicle.
 * A tracking frame calls `jumpTo`, which stops any running animation, so an easeTo
 * cannot survive playback - the zoom has to be eased by the tracking loop itself.
 */
export const ZOOM_SMOOTHING = 0.25;

/** Below this the remaining difference is invisible, so it is closed in one step. */
const ZOOM_SNAP_EPSILON = 0.001;

/** Eases one frame of zoom towards a target, snapping once the gap stops mattering. */
export function lerpZoom(from: number, to: number, factor: number): number {
  if (!Number.isFinite(from)) return to;
  if (Math.abs(to - from) < ZOOM_SNAP_EPSILON) return to;
  return from + (to - from) * factor;
}
