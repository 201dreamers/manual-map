import { check, report, settleStepAnimation } from './harness';
// Minimal browser stubs so the store module can be exercised under plain node.
const store = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).window = { localStorage: localStorageStub, setTimeout: () => 0 };
(globalThis as any).localStorage = localStorageStub;

// A synthetic 2 km straight road returned in place of the Mapbox Directions API.
const ROUTE_COORDS: [number, number][] = [
  [30.5, 50.45],
  [30.5, 50.459],
  [30.5, 50.468],
];
(globalThis as any).fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    code: 'Ok',
    routes: [{ distance: 2000, geometry: { coordinates: ROUTE_COORDS } }],
  }),
});

const { useSimulationStore } = await import(
  '../src/store/simulationStore'
);

const s = () => useSimulationStore.getState();

s().setToken('pk.' + 'a'.repeat(60));
check('token accepted', s().mapboxToken !== null);

await s().addRoutePoint([30.5, 50.45]);
check('single point builds no geometry', s().geometry === null);
await s().addRoutePoint([30.5, 50.468]);
check('two points build geometry', s().geometry !== null, `${s().geometry?.totalDistanceMeters.toFixed(0)}m`);
check('D-4 route not saved until committed', s().savedRoutes.length === 0);
check('telemetry starts at 0 m', s().telemetry.currentDistanceMeters === 0);

const total = s().geometry!.totalDistanceMeters;

s().step(1); settleStepAnimation(s);
check('step forward uses configured 250 m', Math.abs(s().telemetry.currentDistanceMeters - 250) < 1e-6,
  `${s().telemetry.currentDistanceMeters.toFixed(1)}m`);
s().step(-1); settleStepAnimation(s);
s().step(-1); settleStepAnimation(s);
check('FR-2.5 lower clamp at 0 m', s().telemetry.currentDistanceMeters === 0);

s().setStepDistance(1, 1000);
s().setStepDistance(-1, 1000);
s().step(1); s().step(1); s().step(1); settleStepAnimation(s);
check('FR-2.4 upper clamp at route end', Math.abs(s().telemetry.currentDistanceMeters - total) < 1e-6,
  `${s().telemetry.currentDistanceMeters.toFixed(1)}m`);
check('remaining distance is 0 at end', Math.abs(s().telemetry.remainingDistanceMeters) < 1e-6);

// Playback restarts from 0 when triggered at the end, then pauses on arrival.
s().play();
check('play from end rewinds to 0 m', s().telemetry.currentDistanceMeters === 0);
check('isPlaying set', s().config.isPlaying);

s().setSpeed(360); // clamped to 180 km/h = 50 m/s
check('speed clamped to 180', s().config.speedKmh === 180);
s().advance(1);
check('1 s at 180 km/h advances 50 m', Math.abs(s().telemetry.currentDistanceMeters - 50) < 1e-6,
  `${s().telemetry.currentDistanceMeters.toFixed(2)}m`);
check('ETA matches remaining/speed',
  Math.abs(s().telemetry.etaSeconds - s().telemetry.remainingDistanceMeters / 50) < 1e-6,
  `${s().telemetry.etaSeconds.toFixed(1)}s`);

s().advance(120); // overshoots the route end
check('FR-2.4 playback pauses at the end', !s().config.isPlaying);
check('distance clamped at total', Math.abs(s().telemetry.currentDistanceMeters - total) < 1e-6);

s().setSpeed(0);
check('ETA is infinite when stopped', s().telemetry.etaSeconds === Number.POSITIVE_INFINITY);

s().resetToStart();
check('reset returns to 0 m', s().telemetry.currentDistanceMeters === 0);
check('display telemetry synced by reset', s().displayTelemetry.currentDistanceMeters === 0);

// D-2 locked the route on play; editing again is what pressing the lock button undoes.
s().setRouteLocked(false);
const before = s().routePoints.map((p) => p.coordinate);
await s().reverseRoute();
const after = s().routePoints.map((p) => p.coordinate);
check('FR-1.4 reverse swaps start and destination',
  JSON.stringify(after) === JSON.stringify([...before].reverse()));
check('reverse resets marker to 0 m', s().telemetry.currentDistanceMeters === 0);

// History management.
const routeId = s().savedRoutes[0].id;
s().loadSavedRoute(routeId);
check('saved route loads geometry', s().geometry !== null && s().activeRoute?.id === routeId);
s().deleteSavedRoute(routeId);
check('route deleted from history', s().savedRoutes.every((r) => r.id !== routeId));
s().clearSavedRoutes();
check('history cleared', s().savedRoutes.length === 0);

// Failure path: Directions returns NoRoute, so the invalid segment is dropped.
const goodPoints = s().routePoints;
(globalThis as any).fetch = async () => ({
  ok: true, status: 200, json: async () => ({ code: 'NoRoute', routes: [] }),
});
await s().addRoutePoint([-40, 20]);
check('FR-1.3 invalid segment is discarded', s().routePoints.length === goodPoints.length);
check('FR-1.3 error surfaced to the user',
  s().toasts.some((t) => t.text.includes('Unable to calculate road route')),
  s().toasts.map((t) => t.text).join(' | '));

report('store');
