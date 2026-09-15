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

const { useSimulationStore } = await import(
  '../src/store/simulationStore'
);

const s = () => useSimulationStore.getState();
const at = () => s().telemetry.currentDistanceMeters;

check('default forward is 250 m', s().config.stepForwardMeters === 250, `${s().config.stepForwardMeters}`);
check('default back is 125 m', s().config.stepBackMeters === 125, `${s().config.stepBackMeters}`);

s().setToken('pk.' + 'a'.repeat(60));
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
const total = s().geometry!.totalDistanceMeters;

s().step(1); settleStepAnimation(s);
check('forward step moves 250 m', Math.abs(at() - 250) < 1e-6, `${at().toFixed(1)}m`);
s().step(-1); settleStepAnimation(s);
check('back step moves 125 m', Math.abs(at() - 125) < 1e-6, `${at().toFixed(1)}m`);

// A fine-grained crawl: forward twice, back once, repeatedly.
s().resetToStart();
for (let i = 0; i < 4; i++) { s().step(1); s().step(1); s().step(-1); }
settleStepAnimation(s);
check('asymmetric crawl nets 375 m per cycle', Math.abs(at() - 1500) < 1e-6, `${at().toFixed(1)}m`);

// Clamps unaffected by the refactor.
for (let i = 0; i < 40; i++) s().step(-1);
settleStepAnimation(s);
check('FR-2.5 lower clamp holds', at() === 0);
for (let i = 0; i < 40; i++) s().step(1);
settleStepAnimation(s);
check('FR-2.4 upper clamp holds', Math.abs(at() - total) < 1e-6, `${at().toFixed(1)}m`);

// Speed slider path still drives telemetry and ETA.
s().resetToStart();
s().setSpeed(90);
check('speed applied', s().config.speedKmh === 90);
check('telemetry speed mirrors config', s().telemetry.currentSpeedKmh === 90);
s().play();
s().advance(2);
check('2 s at 90 km/h advances 50 m', Math.abs(at() - 50) < 1e-6, `${at().toFixed(2)}m`);
check('ETA tracks remaining at 25 m/s',
  Math.abs(s().telemetry.etaSeconds - s().telemetry.remainingDistanceMeters / 25) < 1e-6);

report('defaults');
