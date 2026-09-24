/**
 * Dead reckoning for OBD-driven tracking: turning a stream of vehicle-speed samples
 * into a distance travelled, and correcting the result against the odometer.
 *
 * The two sources fail differently, which is the whole reason both are used. Error in
 * integrated speed is unbounded and grows with the distance driven; error in an
 * odometer reading is bounded at its quantization step no matter how far the car goes,
 * because every read is re-anchored to truth. The odometer alone is far too coarse to
 * move a cursor smoothly at a 250 m step distance, so speed supplies the motion and the
 * odometer supplies the anchor.
 *
 * Everything here is pure: state in, state out, no clock, no I/O. The transport and the
 * store own those. That keeps the arithmetic verifiable headlessly, which matters
 * because no vehicle exists in the build environment.
 */

/**
 * PID 010D reports whole km/h in a single byte, and ECUs generally truncate rather than
 * round, so a reported value of A means the true speed is somewhere in [A, A+1). Using A
 * alone therefore under-reads by about half a km/h on average - roughly 1% at city
 * speeds, which is around a kilometre lost per hundred driven.
 */
export const SPEED_QUANTIZATION_BIAS_KMH = 0.5;

/**
 * Longest gap between speed samples that is still treated as motion, in seconds. Beyond
 * this the link has stalled rather than the car having driven steadily, and integrating
 * the last known speed across it would invent road that was never travelled - a ten
 * second stall at 60 km/h would fabricate 167 m.
 */
export const DT_MAX_SECONDS = 3;

/**
 * Distance that must be integrated before the calibration factor is trusted. The
 * odometer quantizes to 100 m, so a shorter baseline makes quantization a large fraction
 * of the measurement: at 500 m it is 20% and the estimate is noise. At 2 km it is 5%,
 * and it keeps shrinking because the estimate is cumulative rather than windowed.
 */
export const CALIBRATION_MIN_METERS = 2000;

/**
 * Bounds on the calibration factor. Wheel-speed sensors are scaled to a nominal rolling
 * radius, so tire wear, pressure and non-stock sizes move the reading by a few percent.
 * A correction beyond 20% is not a tire, it is a bad odometer decode or a rollover, and
 * applying it would be worse than applying nothing.
 */
export const CALIBRATION_MIN = 0.8;
export const CALIBRATION_MAX = 1.2;

/** Odometer PID 01A6 reports in units of 0.1 km, so one count is 100 metres. */
export const ODOMETER_UNIT_METERS = 100;

/**
 * Time constant for bleeding a correction into the cursor, in seconds. D-20: a
 * correction is eased in rather than applied at once, the same principle as the bearing
 * smoothing in `lerpBearing` and the zoom easing in `camera.ts`.
 */
export const RESIDUAL_TIME_CONSTANT_SECONDS = 1;

/**
 * Hard ceiling on a correction, as a fraction of the distance the car actually covered
 * in that sample. It caps a frame's total movement at 1.5x its natural step, so a large
 * residual bleeds off over several seconds instead of visibly jumping the marker.
 *
 * This is the constraint that decides the trade: smoothness wins and convergence takes
 * longer. A residual of 80 m at 50 km/h cannot clear inside four seconds without moving
 * the marker at nearly two and a half times its real speed, which is exactly the
 * teleport D-20 forbids.
 */
export const MAX_BLEED_FRACTION = 0.5;

export interface ReckoningState {
  /** Distance travelled since reckoning began, in metres. The output of the module. */
  distanceMeters: number;
  /** The same integration with the calibration held at 1, kept so `k` stays derivable. */
  rawIntegratedMeters: number;
  /** Calibration scale applied to integrated speed. */
  k: number;
  /** True once `k` has been derived from the odometer rather than assumed. */
  isCalibrated: boolean;
  /** Set when an odometer implied a correction outside the plausible bounds. */
  calibrationRejected: boolean;
  /** Metres of correction still waiting to be eased in. Signed. */
  residualMeters: number;
  /** Previous raw odometer reading, in the PID's own 0.1 km units. */
  odoPrevRaw: number | null;
  /** Odometer distance accumulated since the first reading, in metres. */
  odoTotalMeters: number;
  /** `distanceMeters` when the odometer first reported, so the two share an origin. */
  distanceAtOdoStart: number;
  /** `rawIntegratedMeters` at the same moment, for the same reason. */
  rawAtOdoStart: number;
  /** Previous speed sample in km/h, needed for the trapezoid. */
  prevSpeedKmh: number | null;
  /** Timestamp of the previous speed sample, in milliseconds. */
  prevSampleMs: number | null;
  /**
   * Sticky: a sample gap was discarded, so the distance is known to be under-counted.
   * It is never cleared, because the lost metres are never recovered and a reading that
   * silently became trustworthy again would be a lie.
   */
  degraded: boolean;
}

export function createReckoningState(): ReckoningState {
  return {
    distanceMeters: 0,
    rawIntegratedMeters: 0,
    k: 1,
    isCalibrated: false,
    calibrationRejected: false,
    residualMeters: 0,
    odoPrevRaw: null,
    odoTotalMeters: 0,
    distanceAtOdoStart: 0,
    rawAtOdoStart: 0,
    prevSpeedKmh: null,
    prevSampleMs: null,
    degraded: false,
  };
}

const KMH_TO_MS = 1000 / 3600;

/**
 * Corrects for the truncation in PID 010D, but only while the car is actually moving.
 * Adding the bias to a reported zero would creep the cursor forward at a standstill,
 * which is both wrong and highly visible - a parked car whose marker drifts down the road.
 */
function debiasedSpeedKmh(speedKmh: number): number {
  return speedKmh > 0 ? speedKmh + SPEED_QUANTIZATION_BIAS_KMH : 0;
}

/**
 * How much of the outstanding residual to apply this sample. Exponential for residuals
 * small enough to ease away quickly, rate-capped above that so the marker never outruns
 * a plausible speed. A stationary car covers no natural distance, so the cap is zero and
 * no correction is applied at all until it moves again - which is correct: a cursor that
 * slid forward while parked would be worse than a stale one.
 */
function bleedMeters(residualMeters: number, dtSeconds: number, naturalMeters: number): number {
  if (residualMeters === 0 || naturalMeters <= 0) return 0;
  const eased = residualMeters * (1 - Math.exp(-dtSeconds / RESIDUAL_TIME_CONSTANT_SECONDS));
  const cap = naturalMeters * MAX_BLEED_FRACTION;
  return Math.sign(eased) * Math.min(Math.abs(eased), cap);
}

/**
 * Folds one speed sample into the state. Integration is trapezoidal over the measured
 * interval rather than an assumed one: ELM327 round trips on a clone adapter are
 * irregular, so assuming a fixed period would scale every distance by whatever the real
 * jitter happened to be. The trapezoid itself removes the bias a zero-order hold leaves
 * on every acceleration and braking event, which in stop-go traffic does not cancel out.
 */
export function applySpeedSample(
  state: ReckoningState,
  speedKmh: number,
  timestampMs: number,
): ReckoningState {
  if (!Number.isFinite(speedKmh) || !Number.isFinite(timestampMs) || speedKmh < 0) return state;

  // The first sample establishes a baseline; there is no interval to integrate yet.
  if (state.prevSpeedKmh === null || state.prevSampleMs === null) {
    return { ...state, prevSpeedKmh: speedKmh, prevSampleMs: timestampMs };
  }

  const dtSeconds = (timestampMs - state.prevSampleMs) / 1000;

  // Non-monotonic clock: re-baseline rather than integrate backwards.
  if (dtSeconds <= 0) return { ...state, prevSpeedKmh: speedKmh, prevSampleMs: timestampMs };

  // A stall contributes nothing. The interval is dropped whole, and the session is
  // marked degraded so the shortfall is reported rather than hidden.
  if (dtSeconds > DT_MAX_SECONDS) {
    return { ...state, prevSpeedKmh: speedKmh, prevSampleMs: timestampMs, degraded: true };
  }

  const meanKmh = (debiasedSpeedKmh(state.prevSpeedKmh) + debiasedSpeedKmh(speedKmh)) / 2;
  const rawMeters = meanKmh * KMH_TO_MS * dtSeconds;
  const naturalMeters = rawMeters * state.k;
  const bleed = bleedMeters(state.residualMeters, dtSeconds, naturalMeters);

  return {
    ...state,
    distanceMeters: state.distanceMeters + naturalMeters + bleed,
    rawIntegratedMeters: state.rawIntegratedMeters + rawMeters,
    residualMeters: state.residualMeters - bleed,
    prevSpeedKmh: speedKmh,
    prevSampleMs: timestampMs,
  };
}

/**
 * Folds one odometer reading into the state, in the PID's own 0.1 km units.
 *
 * Two things happen here. The reading re-anchors the cursor, by setting the residual to
 * the gap between what the odometer says was driven and what the integrator believed.
 * And the ratio of the two, measured cumulatively rather than over a window, is exactly
 * the calibration factor - so `k` is learned without the driver ever measuring anything,
 * and the estimate sharpens as the drive lengthens instead of staying as noisy as its
 * first sample. If the odometer later stops answering, the speed integration carries on
 * already scale-corrected.
 */
export function applyOdometerSample(state: ReckoningState, odoRaw: number): ReckoningState {
  if (!Number.isFinite(odoRaw) || odoRaw < 0) return state;

  // The first reading is an origin, not a delta: how far the car had gone before it is
  // unknowable, so both accumulators are pinned to the current belief instead.
  if (state.odoPrevRaw === null) {
    return {
      ...state,
      odoPrevRaw: odoRaw,
      distanceAtOdoStart: state.distanceMeters,
      rawAtOdoStart: state.rawIntegratedMeters,
    };
  }

  // A reading that went backwards is a rollover or a bad decode. Never trust it: the
  // alternative is a negative correction that drags the cursor back down the route.
  if (odoRaw <= state.odoPrevRaw) return state;

  const odoTotalMeters =
    state.odoTotalMeters + (odoRaw - state.odoPrevRaw) * ODOMETER_UNIT_METERS;
  const rawSinceStart = state.rawIntegratedMeters - state.rawAtOdoStart;

  let k = state.k;
  let isCalibrated = state.isCalibrated;
  let calibrationRejected = state.calibrationRejected;

  if (rawSinceStart >= CALIBRATION_MIN_METERS) {
    const observed = odoTotalMeters / rawSinceStart;
    const clamped = Math.min(Math.max(observed, CALIBRATION_MIN), CALIBRATION_MAX);
    if (clamped !== observed) calibrationRejected = true;
    k = clamped;
    isCalibrated = true;
  }

  // Truth minus belief, sharing the origin pinned on the first reading. Previously
  // applied corrections are already inside `distanceMeters`, so they cannot double-count.
  const truth = state.distanceAtOdoStart + odoTotalMeters;

  return {
    ...state,
    odoPrevRaw: odoRaw,
    odoTotalMeters,
    k,
    isCalibrated,
    calibrationRejected,
    residualMeters: truth - state.distanceMeters,
  };
}
