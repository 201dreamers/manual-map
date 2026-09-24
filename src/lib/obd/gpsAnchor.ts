/**
 * Calibrating dead reckoning against GPS, where GPS cannot be trusted.
 *
 * This app exists because satellite positioning in the region it is used is routinely
 * jammed and spoofed: fixes jump thousands of kilometres, or freeze in place for minutes
 * and then resume. Using that as a distance reference the naive way would be worse than
 * not calibrating at all, because the calibration factor persists between drives - one
 * bad window would quietly scale every distance the app reports from then on.
 *
 * So the trust relationship is inverted from the counter path. There, the odometer is
 * truth and integrated speed is the estimate. Here, **integrated speed is the reference
 * and GPS is the candidate**, and calibration happens only where the two corroborate
 * over a long stretch. That works because the two fail in unrelated ways: spoofing moves
 * GPS but cannot touch the wheel-speed sensor, and tyre wear skews the wheel-speed
 * sensor but not GPS. Sustained agreement is therefore evidence; disagreement means
 * discard the window, never split the difference.
 *
 * The governing asymmetry, applied at every decision below: refusing to calibrate costs
 * nothing, and calibrating wrongly is durable damage. Every ambiguous case resolves to
 * "don't".
 *
 * Pure, like the rest of the reckoning stack: state in, state out, no clock, no I/O.
 */

import { CALIBRATION_MAX, CALIBRATION_MIN, CALIBRATION_MIN_METERS } from './reckoning';

/**
 * Worst reported accuracy still considered usable. The weakest of the gates by far, kept
 * because it is free: a spoofer controls the reported accuracy and will happily claim a
 * metre, so this catches honest poor reception and nothing else.
 */
export const MAX_ACCURACY_METERS = 25;

/**
 * How far off the planned route a fix may land. The driver is following the route, so a
 * genuine fix stays within a lane or two of it; a spoofed one projects nowhere near.
 * Deliberately generous, because the cost of a false reject is only a paused window.
 */
export const MAX_OFFROUTE_METERS = 60;

/**
 * A fix implying travel faster than this is not a car. Catches the gross teleport - the
 * jump to another continent - before the finer comparison below has to reason about it.
 */
export const MAX_PLAUSIBLE_SPEED_KMH = 250;

/**
 * How far GPS and the reckoner may disagree between consecutive fixes before the fix is
 * discarded. Absolute floor plus a proportional term, because at a standstill any
 * difference is noise and at speed the honest error scales.
 */
export const MAX_STEP_DISAGREEMENT_METERS = 150;
export const MAX_STEP_DISAGREEMENT_FRACTION = 2;

/** Movement below this between fixes is indistinguishable from receiver noise. */
export const FROZEN_MOVEMENT_METERS = 5;

/**
 * Reckoned movement that must accumulate, while GPS does not move, before the receiver
 * is called frozen. The reckoner is the arbiter here, which is the whole point: it
 * separates "stuck receiver" from "stopped at a red light", which GPS cannot do alone.
 */
export const FROZEN_RECKONED_METERS = 120;

/**
 * Two windows must agree within this before anything is committed. A single well-formed
 * spoof can produce one plausible window; producing two consecutive ones that agree with
 * each other and with the wheel sensor is a much higher bar.
 */
export const WINDOW_AGREEMENT = 0.03;

/**
 * Largest change to the calibration factor from one accepted pair of windows. Real drift
 * is slow - tyre wear over months - so there is never a reason to jump. This is the last
 * line of defence: even if everything above is defeated, the damage per drive is bounded.
 */
export const MAX_CALIBRATION_STEP = 0.02;

export type FixVerdict =
  | 'accepted'
  | 'rejected-accuracy'
  | 'rejected-offroute'
  | 'rejected-teleport'
  | 'rejected-frozen';

/** One GPS fix, already projected onto the route by the caller. */
export interface GpsSample {
  /** Distance along the route of the projected fix, or null when it is off-route. */
  routeDistanceMeters: number | null;
  /** How far the raw fix sat from the route line. */
  offRouteMeters: number;
  accuracyMeters: number | null;
  timestampMs: number;
  /** The reckoner's own distance at the same moment. The reference, not the candidate. */
  reckonedMeters: number;
}

export interface GpsAnchorState {
  /** The fix that opened the current window, or null when no window is open. */
  window: { routeMeters: number; reckonedMeters: number } | null;
  /** The previous accepted fix, for the step comparisons. */
  previous: { routeMeters: number; reckonedMeters: number; timestampMs: number } | null;
  /** Reckoned movement accumulated while GPS has stood still. */
  frozenReckonedMeters: number;
  /** Ratio from the last completed window, awaiting corroboration by the next. */
  pendingRatio: number | null;
  lastVerdict: FixVerdict | null;
  /** Windows completed and accepted. Exposed so the interface can say why nothing moved. */
  acceptedWindows: number;
  rejectedFixes: number;
}

export function createGpsAnchorState(): GpsAnchorState {
  return {
    window: null,
    previous: null,
    frozenReckonedMeters: 0,
    pendingRatio: null,
    lastVerdict: null,
    acceptedWindows: 0,
    rejectedFixes: 0,
  };
}

/** Everything a rejection must undo: the window is void, not merely paused. */
function reject(state: GpsAnchorState, verdict: FixVerdict): GpsAnchorResult {
  return {
    state: {
      ...state,
      window: null,
      previous: null,
      frozenReckonedMeters: 0,
      // A rejected fix also voids any ratio waiting for corroboration. Corroboration is
      // meant to span a continuously trustworthy stretch; allowing a spoof in the middle
      // would let two windows either side of it vouch for each other.
      pendingRatio: null,
      lastVerdict: verdict,
      rejectedFixes: state.rejectedFixes + 1,
    },
    calibration: null,
  };
}

export interface GpsAnchorResult {
  state: GpsAnchorState;
  /** A new calibration factor, or null when nothing was committed by this fix. */
  calibration: number | null;
}

/**
 * Feeds one fix through every gate, then through the window logic.
 *
 * `currentK` is the factor in force, which a committed result moves toward by at most
 * `MAX_CALIBRATION_STEP`.
 */
export function applyGpsSample(
  state: GpsAnchorState,
  sample: GpsSample,
  currentK: number,
): GpsAnchorResult {
  const { routeDistanceMeters, offRouteMeters, accuracyMeters, timestampMs, reckonedMeters } =
    sample;

  // Off-route, unprojectable, or nonsensical: nothing to measure against.
  if (routeDistanceMeters === null || !Number.isFinite(routeDistanceMeters)) {
    return reject(state, 'rejected-offroute');
  }
  if (!Number.isFinite(offRouteMeters) || offRouteMeters > MAX_OFFROUTE_METERS) {
    return reject(state, 'rejected-offroute');
  }
  // An unreported accuracy is treated as usable: some devices omit it, and refusing them
  // outright would disable the anchor on that hardware. The other gates still apply.
  if (accuracyMeters !== null && (!Number.isFinite(accuracyMeters) || accuracyMeters > MAX_ACCURACY_METERS)) {
    return reject(state, 'rejected-accuracy');
  }

  const previous = state.previous;
  if (previous === null) {
    // First usable fix: open a window rather than measure anything.
    return {
      state: {
        ...state,
        window: { routeMeters: routeDistanceMeters, reckonedMeters },
        previous: { routeMeters: routeDistanceMeters, reckonedMeters, timestampMs },
        frozenReckonedMeters: 0,
        lastVerdict: 'accepted',
      },
      calibration: null,
    };
  }

  const gpsStep = routeDistanceMeters - previous.routeMeters;
  const reckonedStep = reckonedMeters - previous.reckonedMeters;
  const dtSeconds = (timestampMs - previous.timestampMs) / 1000;

  // Gross teleport, judged on implied speed. Guarded on dt so a duplicated timestamp
  // cannot divide by zero into infinity and reject a perfectly good fix.
  if (dtSeconds > 0) {
    const impliedKmh = (Math.abs(gpsStep) / dtSeconds) * 3.6;
    if (impliedKmh > MAX_PLAUSIBLE_SPEED_KMH) return reject(state, 'rejected-teleport');
  }

  // Frozen receiver: GPS has not moved while the wheels say the car has.
  if (Math.abs(gpsStep) < FROZEN_MOVEMENT_METERS) {
    const frozenReckonedMeters = state.frozenReckonedMeters + Math.max(reckonedStep, 0);
    if (frozenReckonedMeters > FROZEN_RECKONED_METERS) {
      return reject(state, 'rejected-frozen');
    }
    // Not yet conclusive - the car may simply be stopped - so hold the window open and
    // carry the accumulator forward rather than counting this as a measurement.
    return {
      state: {
        ...state,
        previous: { routeMeters: routeDistanceMeters, reckonedMeters, timestampMs },
        frozenReckonedMeters,
        lastVerdict: 'accepted',
      },
      calibration: null,
    };
  }

  // Finer disagreement: the two moved, but by amounts that cannot both be true.
  const allowed =
    MAX_STEP_DISAGREEMENT_METERS + Math.abs(reckonedStep) * MAX_STEP_DISAGREEMENT_FRACTION;
  if (Math.abs(gpsStep - reckonedStep) > allowed) return reject(state, 'rejected-teleport');

  const window = state.window ?? { routeMeters: routeDistanceMeters, reckonedMeters };
  const next: GpsAnchorState = {
    ...state,
    window,
    previous: { routeMeters: routeDistanceMeters, reckonedMeters, timestampMs },
    frozenReckonedMeters: 0,
    lastVerdict: 'accepted',
  };

  const windowGps = routeDistanceMeters - window.routeMeters;
  const windowReckoned = reckonedMeters - window.reckonedMeters;
  if (windowReckoned < CALIBRATION_MIN_METERS || windowGps <= 0) {
    return { state: next, calibration: null };
  }

  // The window is long enough to mean something.
  const ratio = windowGps / windowReckoned;

  // Rejected, never clamped. Outside these bounds is not a car that needs an unusual
  // correction, it is a measurement that is wrong, and clamping it to the edge of the
  // band would bake in the largest error the band permits.
  if (ratio < CALIBRATION_MIN || ratio > CALIBRATION_MAX) {
    return reject(next, 'rejected-teleport');
  }

  const pending = state.pendingRatio;
  const closed: GpsAnchorState = {
    ...next,
    // The next window starts here, so windows tile the drive rather than overlapping.
    window: { routeMeters: routeDistanceMeters, reckonedMeters },
    acceptedWindows: state.acceptedWindows + 1,
  };

  if (pending === null || Math.abs(pending - ratio) > WINDOW_AGREEMENT) {
    // Nothing to corroborate against yet, or the two disagree. Either way this becomes
    // the candidate and nothing is committed.
    return { state: { ...closed, pendingRatio: ratio }, calibration: null };
  }

  // Two consecutive windows agree. Move toward them, by a bounded step.
  const target = (pending + ratio) / 2;
  const step = Math.max(-MAX_CALIBRATION_STEP, Math.min(MAX_CALIBRATION_STEP, target - currentK));
  const committed = Math.min(Math.max(currentK + step, CALIBRATION_MIN), CALIBRATION_MAX);

  return { state: { ...closed, pendingRatio: ratio }, calibration: committed };
}
