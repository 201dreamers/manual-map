import { check, report, settleStepAnimation } from './harness';
const mem = new Map<string, string>();
const ls = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
(globalThis as any).window = { localStorage: ls, setTimeout: () => 0 };
(globalThis as any).localStorage = ls;

const COORDS: [number, number][] = [[30.5, 50.45], [30.5, 50.459], [30.5, 50.468]];
(globalThis as any).fetch = async () => ({
  ok: true, status: 200,
  json: async () => ({ code: 'Ok', routes: [{ distance: 2000, geometry: { coordinates: COORDS } }] }),
});

const { useSimulationStore, MIN_STEP_METERS, MAX_STEP_METERS } = await import(
  '../src/store/simulationStore'
);

const s = () => useSimulationStore.getState();
const at = () => s().telemetry.currentDistanceMeters;

s().setToken('pk.' + 'a'.repeat(60));
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
const total = s().geometry!.totalDistanceMeters;

check('defaults are 250 m forward / 125 m back',
  s().config.stepForwardMeters === 250 && s().config.stepBackMeters === 125);

// Independent configuration: a big forward step and a small back step.
s().setStepDistance(1, 800);
s().setStepDistance(-1, 200);
check('forward distance set independently', s().config.stepForwardMeters === 800);
check('back distance set independently', s().config.stepBackMeters === 200);
check('setting forward left back untouched', s().config.stepBackMeters === 200);

s().step(1); settleStepAnimation(s);
check('forward step uses forward distance', Math.abs(at() - 800) < 1e-6, `${at().toFixed(1)}m`);
s().step(-1); settleStepAnimation(s);
check('back step uses back distance', Math.abs(at() - 600) < 1e-6, `${at().toFixed(1)}m`);
s().step(1); settleStepAnimation(s);
check('asymmetric net movement', Math.abs(at() - 1400) < 1e-6, `${at().toFixed(1)}m`);

// Clamps still hold with asymmetric distances.
s().setStepDistance(-1, 100000);
s().step(-1); settleStepAnimation(s);
check('FR-2.5 lower clamp with large back step', at() === 0, `${at().toFixed(1)}m`);
s().setStepDistance(1, 100000);
s().step(1); settleStepAnimation(s);
check('FR-2.4 upper clamp with large forward step', Math.abs(at() - total) < 1e-6, `${at().toFixed(1)}m`);

// Bounds validation per direction.
s().setStepDistance(1, 0);
check('forward clamped to minimum', s().config.stepForwardMeters === MIN_STEP_METERS);
s().setStepDistance(-1, 9e9);
check('back clamped to maximum', s().config.stepBackMeters === MAX_STEP_METERS);
s().setStepDistance(1, 333.7);
check('fractional input rounded', s().config.stepForwardMeters === 334);

// Stepping still interrupts playback.
s().setStepDistance(1, 500);
s().resetToStart();
s().play();
check('playing before step', s().config.isPlaying);
s().step(1); settleStepAnimation(s);
check('step pauses playback', !s().config.isPlaying);
check('display telemetry synced after step', s().displayTelemetry.currentDistanceMeters === at());

// --- Step glide (the marker eases to the target instead of teleporting) ---
const { MIN_STEP_ANIMATION_MS, MAX_STEP_ANIMATION_MS } = await import(
  '../src/store/simulationStore'
);
const frame = (ms: number) => s().advanceStepAnimation(ms / 1000);
const STEP_ANIMATION_MS = s().config.stepForwardAnimationMs;

check('glide defaults to 700 ms each way',
  s().config.stepForwardAnimationMs === 700 && s().config.stepBackAnimationMs === 700);

s().setStepDistance(1, 250);
s().resetToStart();
s().step(1);
check('a step does not land instantly', at() === 0);
check('no glide is reported before the first frame', s().displayTelemetry.currentDistanceMeters === 0);

const stillRunning = frame(STEP_ANIMATION_MS / 3);
const partial = at();
check('a glide reports itself as running', stillRunning);
check('mid-glide sits strictly between the ends', partial > 0 && partial < 250, `${partial.toFixed(1)}m`);
check('easing front-loads the movement', partial > 250 / 3, `${partial.toFixed(1)}m`);

frame(STEP_ANIMATION_MS / 3);
check('a glide keeps moving forward', at() > partial);
check('a finished glide stops reporting', !frame(STEP_ANIMATION_MS));
check('a glide lands exactly on its target', Math.abs(at() - 250) < 1e-9, `${at().toFixed(3)}m`);
check('the throttled slice is synced on the final frame',
  s().displayTelemetry.currentDistanceMeters === at());
check('a settled glide does not resume', !frame(STEP_ANIMATION_MS));

// A second tap stacks onto the pending target, not onto the position reached so far.
s().resetToStart();
s().step(1);
frame(STEP_ANIMATION_MS / 4);
s().step(1);
settleStepAnimation(s);
check('taps during a glide accumulate', Math.abs(at() - 500) < 1e-9, `${at().toFixed(1)}m`);

// Playback owns the marker, so taking it over abandons any glide in flight.
s().resetToStart();
s().step(1);
frame(STEP_ANIMATION_MS / 4);
const interrupted = at();
s().pause();
check('pause abandons the glide', !frame(STEP_ANIMATION_MS) && at() === interrupted);

s().resetToStart();
s().step(1);
frame(STEP_ANIMATION_MS / 4);
s().play();
check('play abandons the glide', !frame(STEP_ANIMATION_MS));
s().pause();

s().resetToStart();
s().step(1);
frame(STEP_ANIMATION_MS / 4);
s().resetToStart();
check('reset abandons the glide', !frame(STEP_ANIMATION_MS) && at() === 0);

// FR-2.4/2.5: clamping is applied to the target, so a glide never overshoots an end.
s().setStepDistance(1, MAX_STEP_METERS);
s().resetToStart();
s().step(1);
settleStepAnimation(s);
check('a glide clamps at the route end', at() === total, `${at().toFixed(1)}m`);
check('a step already at the end starts no glide', (s().step(1), !frame(STEP_ANIMATION_MS)));
s().setStepDistance(1, 250);


// Each direction carries its own glide length.
s().setStepAnimationMs(1, 200);
s().setStepAnimationMs(-1, 1000);
check('glide durations are set per direction',
  s().config.stepForwardAnimationMs === 200 && s().config.stepBackAnimationMs === 1000);

s().setStepDistance(1, 250);
s().setStepDistance(-1, 250);
s().resetToStart();
s().step(1);
check('a forward glide runs for its own duration', !frame(200) && Math.abs(at() - 250) < 1e-9);
s().step(-1);
check('a back glide is still running at the forward duration', frame(200));
check('a back glide honours its longer duration', !frame(800) && at() === 0, `${at().toFixed(1)}m`);

// A duration change mid-glide does not retime the glide already in flight.
s().resetToStart();
s().step(1);
frame(50);
s().setStepAnimationMs(1, 2000);
check('an in-flight glide keeps the duration it started with', !frame(150));
s().setStepAnimationMs(1, 200);

check('glide clamps to the floor',
  (s().setStepAnimationMs(1, 1), s().config.stepForwardAnimationMs === MIN_STEP_ANIMATION_MS));
check('glide clamps to the ceiling',
  (s().setStepAnimationMs(1, 99999), s().config.stepForwardAnimationMs === MAX_STEP_ANIMATION_MS));
check('fractional glide input is rounded',
  (s().setStepAnimationMs(-1, 333.7), s().config.stepBackAnimationMs === 334));
s().setStepAnimationMs(1, 700);
s().setStepAnimationMs(-1, 700);

report('step');
