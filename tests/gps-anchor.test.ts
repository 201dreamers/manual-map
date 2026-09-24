import { check, report } from './harness';
import {
  applyGpsSample,
  createGpsAnchorState,
  FROZEN_RECKONED_METERS,
  MAX_ACCURACY_METERS,
  MAX_CALIBRATION_STEP,
  MAX_OFFROUTE_METERS,
  type GpsAnchorState,
  type GpsSample,
} from '../src/lib/obd/gpsAnchor';
import { CALIBRATION_MIN_METERS } from '../src/lib/obd/reckoning';

const K = 1;

const fix = (over: Partial<GpsSample> = {}): GpsSample => ({
  routeDistanceMeters: 0,
  offRouteMeters: 3,
  accuracyMeters: 8,
  timestampMs: 0,
  reckonedMeters: 0,
  ...over,
});

/**
 * Drives a straight, honest stretch: GPS and the reckoner both advance, with GPS
 * covering `ratio` times the reckoned distance.
 */
function drive(
  state: GpsAnchorState,
  meters: number,
  ratio: number,
  startAt: { route: number; reckoned: number; time: number },
): { state: GpsAnchorState; calibration: number | null; at: typeof startAt } {
  let current = state;
  let calibration: number | null = null;
  const stepMeters = 100;
  const at = { ...startAt };
  for (let done = 0; done < meters; done += stepMeters) {
    at.reckoned += stepMeters;
    at.route += stepMeters * ratio;
    // 100 m at about 50 km/h.
    at.time += 7200;
    const outcome = applyGpsSample(
      current,
      fix({
        routeDistanceMeters: at.route,
        reckonedMeters: at.reckoned,
        timestampMs: at.time,
      }),
      K,
    );
    current = outcome.state;
    if (outcome.calibration !== null) calibration = outcome.calibration;
  }
  return { state: current, calibration, at };
}

/* ---------------- the per-fix gates ---------------- */

{
  const fresh = createGpsAnchorState();

  check('AC-810 an off-route fix is rejected',
    applyGpsSample(fresh, fix({ offRouteMeters: MAX_OFFROUTE_METERS + 1 }), K).state.lastVerdict ===
      'rejected-offroute');
  check('AC-810 a fix that will not project is rejected',
    applyGpsSample(fresh, fix({ routeDistanceMeters: null }), K).state.lastVerdict ===
      'rejected-offroute');
  check('AC-811 a low-accuracy fix is rejected',
    applyGpsSample(fresh, fix({ accuracyMeters: MAX_ACCURACY_METERS + 1 }), K).state.lastVerdict ===
      'rejected-accuracy');
  check('AC-811 an unreported accuracy is still usable',
    applyGpsSample(fresh, fix({ accuracyMeters: null }), K).state.lastVerdict === 'accepted');
  check('the first usable fix opens a window rather than measuring',
    applyGpsSample(fresh, fix(), K).calibration === null);
}

/* ---------------- the jump to Lima ---------------- */

{
  let state = applyGpsSample(createGpsAnchorState(), fix(), K).state;
  // Roughly 10,000 km in one second.
  const teleported = applyGpsSample(
    state,
    fix({ routeDistanceMeters: 10_000_000, reckonedMeters: 14, timestampMs: 1000 }),
    K,
  );
  check('AC-812 a continental jump is rejected',
    teleported.state.lastVerdict === 'rejected-teleport');
  check('AC-812 and it commits nothing', teleported.calibration === null);
  check('AC-812 and it voids the open window', teleported.state.window === null);

  // A subtler one: plausible speed, but disagreeing with the wheels.
  state = applyGpsSample(createGpsAnchorState(), fix(), K).state;
  const drifted = applyGpsSample(
    state,
    fix({ routeDistanceMeters: 900, reckonedMeters: 100, timestampMs: 20_000 }),
    K,
  );
  check('AC-813 a fix disagreeing with the wheels is rejected',
    drifted.state.lastVerdict === 'rejected-teleport', String(drifted.state.lastVerdict));
}

/* ---------------- the frozen receiver ---------------- */

{
  let state = applyGpsSample(createGpsAnchorState(), fix(), K).state;
  let reckoned = 0;
  let time = 0;
  let verdict = state.lastVerdict;

  // GPS pinned at zero while the wheels keep turning.
  for (let step = 0; step < 10; step += 1) {
    reckoned += 40;
    time += 3000;
    const outcome = applyGpsSample(
      state,
      fix({ routeDistanceMeters: 0, reckonedMeters: reckoned, timestampMs: time }),
      K,
    );
    state = outcome.state;
    verdict = outcome.state.lastVerdict;
    if (verdict === 'rejected-frozen') break;
  }
  check('AC-814 a receiver stuck while the car moves is caught',
    verdict === 'rejected-frozen', String(verdict));
  check('AC-814 and it took real reckoned movement to decide',
    reckoned > FROZEN_RECKONED_METERS, `${reckoned} m`);
}

{
  // The case that must NOT be called frozen: the car is genuinely stopped.
  let state = applyGpsSample(createGpsAnchorState(), fix(), K).state;
  let time = 0;
  for (let step = 0; step < 40; step += 1) {
    time += 3000;
    // Neither GPS nor the wheels move: a red light.
    state = applyGpsSample(
      state,
      fix({ routeDistanceMeters: 0, reckonedMeters: 0, timestampMs: time }),
      K,
    ).state;
  }
  check('AC-815 sitting at a red light is not a frozen receiver',
    state.lastVerdict === 'accepted', String(state.lastVerdict));
}

/* ---------------- windows, corroboration and the bounded step ---------------- */

{
  // One good window alone commits nothing: it has nothing to corroborate against.
  const first = drive(createGpsAnchorState(), CALIBRATION_MIN_METERS + 400, 1.05, {
    route: 0,
    reckoned: 0,
    time: 0,
  });
  check('AC-816 one window alone commits nothing', first.calibration === null);
  check('AC-816 but it is remembered as a candidate', first.state.pendingRatio !== null);
  check('AC-816 and the window closed', first.state.acceptedWindows >= 1,
    `${first.state.acceptedWindows}`);

  // A second, agreeing window commits.
  const second = drive(first.state, CALIBRATION_MIN_METERS + 400, 1.05, first.at);
  check('AC-817 two agreeing windows commit a calibration', second.calibration !== null,
    String(second.calibration));
  check('AC-817 moving toward the observed ratio', (second.calibration ?? 0) > K);
  check('AC-818 by no more than one bounded step',
    Math.abs((second.calibration ?? 0) - K) <= MAX_CALIBRATION_STEP + 1e-9,
    `${((second.calibration ?? 0) - K).toFixed(4)}`);
}

{
  // Two windows that disagree commit nothing: that is noise, not drift.
  const first = drive(createGpsAnchorState(), CALIBRATION_MIN_METERS + 400, 1.02, {
    route: 0,
    reckoned: 0,
    time: 0,
  });
  const second = drive(first.state, CALIBRATION_MIN_METERS + 400, 1.15, first.at);
  check('AC-819 disagreeing windows commit nothing', second.calibration === null);
}

{
  // A window whose ratio lands outside the band is rejected outright, never clamped -
  // clamping would bake in the largest error the band allows.
  const out = drive(createGpsAnchorState(), CALIBRATION_MIN_METERS + 400, 1.6, {
    route: 0,
    reckoned: 0,
    time: 0,
  });
  check('AC-820 an out-of-band window commits nothing', out.calibration === null);
  check('AC-820 and is rejected rather than clamped to the edge',
    out.state.pendingRatio === null, String(out.state.pendingRatio));
}

{
  // A spoof in the middle must not let the windows either side vouch for each other.
  const first = drive(createGpsAnchorState(), CALIBRATION_MIN_METERS + 400, 1.05, {
    route: 0,
    reckoned: 0,
    time: 0,
  });
  check('a candidate is pending', first.state.pendingRatio !== null);
  const spoofed = applyGpsSample(
    first.state,
    fix({ routeDistanceMeters: 9_000_000, reckonedMeters: first.at.reckoned + 20, timestampMs: first.at.time + 1000 }),
    K,
  );
  check('AC-821 a spoof voids the pending candidate', spoofed.state.pendingRatio === null);
  const after = drive(spoofed.state, CALIBRATION_MIN_METERS + 400, 1.05, {
    route: 0,
    reckoned: 0,
    time: first.at.time + 10_000,
  });
  check('AC-821 so the window after it cannot commit on its own', after.calibration === null);
}

/* ---------------- the governing asymmetry ---------------- */

check('AC-822 rejections are counted, so silence is explicable', (() => {
  const outcome = applyGpsSample(createGpsAnchorState(), fix({ offRouteMeters: 500 }), K);
  return outcome.state.rejectedFixes === 1;
})());

report('gps-anchor');
