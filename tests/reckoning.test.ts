import { check, report } from './harness';
import {
  applyOdometerSample,
  applySpeedSample,
  createReckoningState,
  CALIBRATION_MAX,
  DT_MAX_SECONDS,
  MAX_BLEED_FRACTION,
  ODOMETER_UNIT_METERS,
  SPEED_QUANTIZATION_BIAS_KMH,
  type ReckoningState,
} from '../src/lib/obd/reckoning';

const KMH_TO_MS = 1000 / 3600;

/** Feeds a speed profile at a fixed period and returns the final state. */
function drive(
  state: ReckoningState,
  speedAt: (sampleIndex: number) => number,
  samples: number,
  periodMs: number,
  startMs = 0,
): ReckoningState {
  let next = state;
  for (let i = 0; i <= samples; i++) {
    next = applySpeedSample(next, speedAt(i), startMs + i * periodMs);
  }
  return next;
}

/* ---------------- AC-604: constant speed integrates exactly ---------------- */
// 100 km/h for 60 s at 250 ms. The bias is a real part of the integrator rather than a
// test knob, so the analytic target carries it: 100.5 km/h for 60 s.
{
  const state = drive(createReckoningState(), () => 100, 240, 250);
  const expected = (100 + SPEED_QUANTIZATION_BIAS_KMH) * KMH_TO_MS * 60;
  check(
    'AC-604 constant 100 km/h for 60 s integrates exactly',
    Math.abs(state.distanceMeters - expected) < 0.1,
    `${state.distanceMeters.toFixed(3)} m vs ${expected.toFixed(3)} m`,
  );
  check('AC-604 no gap was discarded', !state.degraded);
}

/* ---------------- AC-605: trapezoid beats a zero-order hold ---------------- */
// Linear 0 to 100 km/h over 10 s. Trapezoidal integration of a linear profile is exact,
// so the only error left is the bias discontinuity at t=0.
{
  const ramp = (i: number) => i * 2.5; // 40 samples of 250 ms reach 100 km/h
  const state = drive(createReckoningState(), ramp, 40, 250);

  // Analytic integral of the biased profile (10t + 0.5) km/h over [0, 10] s.
  const analytic = (5 * 100 + 0.5 * 10) * KMH_TO_MS;

  // Zero-order hold: each sample held across the interval that preceded it.
  let rectangle = 0;
  for (let i = 1; i <= 40; i++) rectangle += (ramp(i) + SPEED_QUANTIZATION_BIAS_KMH) * KMH_TO_MS * 0.25;

  const trapezoidError = Math.abs(state.distanceMeters - analytic);
  const rectangleError = Math.abs(rectangle - analytic);
  check(
    'AC-605 trapezoid lands on the analytic ramp distance',
    trapezoidError < 0.05,
    `error ${trapezoidError.toFixed(4)} m of ${analytic.toFixed(3)} m`,
  );
  check(
    'AC-605 zero-order hold is strictly worse',
    rectangleError > trapezoidError,
    `rectangle off by ${rectangleError.toFixed(3)} m`,
  );
}

/* ---------------- AC-606: k converges on a mis-scaled speedometer ---------------- */
// True speed 100 km/h, reported 5% low, odometer truthful. Reported 95 plus the 0.5
// bias integrates 95.5, so the honest target is 100 / 95.5 = 1.0471.
{
  const TRUE_KMH = 100;
  const REPORTED_KMH = 95;
  const PERIOD_MS = 250;
  const TOTAL_METERS = 10_000;

  let state = createReckoningState();
  let trueMeters = 0;
  let lastOdoTickSecond = -1;
  let calibratedBefore = 0;

  const totalSamples = Math.ceil(TOTAL_METERS / (TRUE_KMH * KMH_TO_MS) / (PERIOD_MS / 1000));
  for (let i = 0; i <= totalSamples; i++) {
    const t = i * (PERIOD_MS / 1000);
    state = applySpeedSample(state, REPORTED_KMH, i * PERIOD_MS);
    if (i > 0) trueMeters = TRUE_KMH * KMH_TO_MS * t;

    // Odometer answers about once a second, in whole 0.1 km counts.
    const second = Math.floor(t);
    if (second !== lastOdoTickSecond) {
      lastOdoTickSecond = second;
      if (!state.isCalibrated) calibratedBefore = state.rawIntegratedMeters;
      state = applyOdometerSample(state, Math.floor(trueMeters / ODOMETER_UNIT_METERS));
    }
  }

  check(
    'AC-606 k converges on the real scale error',
    state.k >= 1.045 && state.k <= 1.055,
    `k = ${state.k.toFixed(4)}`,
  );
  check('AC-606 calibration is marked derived, not assumed', state.isCalibrated);
  check('AC-606 a plausible correction is not flagged as rejected', !state.calibrationRejected);
  check(
    'AC-606 k is not moved before 2 km of integration',
    calibratedBefore >= 2000,
    `first calibration at ${calibratedBefore.toFixed(0)} m integrated`,
  );

  const errorFraction = Math.abs(state.distanceMeters - trueMeters) / trueMeters;
  check(
    'AC-606 cumulative distance error falls below 0.5%',
    errorFraction < 0.005,
    `${(errorFraction * 100).toFixed(3)}% over ${(trueMeters / 1000).toFixed(1)} km`,
  );
}

/* ---------------- AC-607: k rejects nonsense ---------------- */
// An odometer implying a 40% scale error is a bad decode, not a tire.
{
  let state = drive(createReckoningState(), () => 100, 200, 250);
  state = applyOdometerSample(state, 0);
  // Long enough that the 2 km calibration gate actually opens: at 100 km/h this leg
  // integrates about 2.8 km, measured from the origin the first reading pinned.
  state = drive(state, () => 100, 400, 250, 50_000);
  const rawSinceStart = state.rawIntegratedMeters - state.rawAtOdoStart;
  // Claim 40% more distance than was integrated over that same stretch.
  const inflated = Math.round((rawSinceStart * 1.4) / ODOMETER_UNIT_METERS);
  state = applyOdometerSample(state, inflated);

  check(
    'AC-607 the calibration gate did open',
    rawSinceStart >= 2000,
    `${rawSinceStart.toFixed(0)} m integrated since the odometer origin`,
  );

  check('AC-607 k clamps at the upper bound', state.k === CALIBRATION_MAX, `k = ${state.k}`);
  check('AC-607 the rejection is recorded', state.calibrationRejected);
}

/* ---------------- AC-608: a dropout invents no distance ---------------- */
{
  const before = drive(createReckoningState(), () => 60, 8, 250);
  const gapMs = before.prevSampleMs! + (DT_MAX_SECONDS + 7) * 1000;
  const afterGap = applySpeedSample(before, 60, gapMs);

  check(
    'AC-608 the stalled interval contributes nothing',
    Math.abs(afterGap.distanceMeters - before.distanceMeters) <= 0.2,
    `${(afterGap.distanceMeters - before.distanceMeters).toFixed(4)} m attributed`,
  );
  check('AC-608 the session is marked degraded', afterGap.degraded);
  check('AC-608 degraded is sticky once set', drive(afterGap, () => 60, 8, 250, gapMs).degraded);

  // The boundary itself must still integrate: 3 s exactly is a slow link, not a stall.
  const atLimit = applySpeedSample(before, 60, before.prevSampleMs! + DT_MAX_SECONDS * 1000);
  check('AC-608 a gap exactly at the limit still counts', !atLimit.degraded);
}

/* ---------------- AC-609 [revised]: corrections bleed, never jump ---------------- */
// Revised from the original spec, which asked for both a 1.5x per-frame ceiling and
// clearance inside 4 s. At 50 km/h an 80 m residual cannot satisfy both: clearing it in
// 4 s needs about 2.4x the natural rate, which is the teleport D-20 forbids. Smoothness
// wins and the convergence window relaxes.
{
  const SPEED_KMH = 50;
  const PERIOD_MS = 250;
  const naturalStep = (SPEED_KMH + SPEED_QUANTIZATION_BIAS_KMH) * KMH_TO_MS * (PERIOD_MS / 1000);

  let state = applySpeedSample(createReckoningState(), SPEED_KMH, 0);
  state = { ...state, residualMeters: 80 };

  let worstStep = 0;
  let secondsToConverge = Infinity;
  for (let i = 1; i <= 80; i++) {
    const previous = state.distanceMeters;
    state = applySpeedSample(state, SPEED_KMH, i * PERIOD_MS);
    worstStep = Math.max(worstStep, state.distanceMeters - previous);
    if (Math.abs(state.residualMeters) < 5 && secondsToConverge === Infinity) {
      secondsToConverge = (i * PERIOD_MS) / 1000;
    }
  }

  check(
    'AC-609 no frame exceeds 1.5x the natural step',
    worstStep <= naturalStep * (1 + MAX_BLEED_FRACTION) + 1e-9,
    `worst ${worstStep.toFixed(3)} m vs ceiling ${(naturalStep * 1.5).toFixed(3)} m`,
  );
  check(
    'AC-609 the residual clears within 12 s',
    secondsToConverge <= 12,
    `cleared at ${secondsToConverge.toFixed(2)} s`,
  );
  check('AC-609 the residual is fully absorbed, not abandoned', Math.abs(state.residualMeters) < 0.5);
}

/* ---------------- AC-609b: a stationary car is never corrected forward ---------------- */
{
  let state = applySpeedSample(createReckoningState(), 0, 0);
  state = { ...state, residualMeters: 60 };
  const parked = drive(state, () => 0, 40, 250, 0);
  check(
    'AC-609b a parked car does not creep while a residual is outstanding',
    parked.distanceMeters === 0,
    `${parked.distanceMeters.toFixed(4)} m moved`,
  );
  check('AC-609b the residual survives the stop', parked.residualMeters === 60);
}

/* ---------------- AC-610: odometer rollback is ignored ---------------- */
{
  let state = drive(createReckoningState(), () => 80, 100, 250);
  state = applyOdometerSample(state, 5000);
  state = drive(state, () => 80, 100, 250, 25_000);
  const anchored = applyOdometerSample(state, 5020);
  const rolledBack = applyOdometerSample(anchored, 4990);

  check('AC-610 a lower reading changes no residual', rolledBack.residualMeters === anchored.residualMeters);
  check('AC-610 a lower reading changes no calibration', rolledBack.k === anchored.k);
  check('AC-610 a lower reading changes no odometer total', rolledBack.odoTotalMeters === anchored.odoTotalMeters);
  check('AC-610 distance never goes backwards', rolledBack.distanceMeters >= anchored.distanceMeters);

  // An identical repeated reading is the common case between 100 m ticks, not an error.
  const repeated = applyOdometerSample(anchored, 5020);
  check('AC-610 a repeated reading is a no-op', repeated.odoTotalMeters === anchored.odoTotalMeters);
}

/* ---------------- Guards on malformed input ---------------- */
{
  const base = drive(createReckoningState(), () => 50, 10, 250);
  check('NaN speed is ignored', applySpeedSample(base, NaN, 9999).distanceMeters === base.distanceMeters);
  check('negative speed is ignored', applySpeedSample(base, -5, 9999).distanceMeters === base.distanceMeters);
  check('NaN odometer is ignored', applyOdometerSample(base, NaN).odoPrevRaw === base.odoPrevRaw);
  const backwards = applySpeedSample(base, 50, base.prevSampleMs! - 1000);
  check('a backwards clock re-baselines instead of integrating', backwards.distanceMeters === base.distanceMeters);
}

report('reckoning');
