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

const { useSimulationStore, UNDO_DEPTH } = await import(
  '../src/store/simulationStore'
);
const { routeRepository } = await import(
  '../src/lib/storage'
);

const s = () => useSimulationStore.getState();

s().setToken('pk.' + 'a'.repeat(60));

// ---------- AC-101: history written on commit, not on edit ----------
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
check('AC-101 route built but not played -> history empty',
  routeRepository.list().length === 0, `${routeRepository.list().length} entries`);

s().play();
check('AC-101 first play creates exactly one entry', routeRepository.list().length === 1);
const firstId = routeRepository.list()[0].id;
const firstUpdated = routeRepository.list()[0].updatedAt;
check('AC-101 commit stamps updatedAt', typeof firstUpdated === 'string', String(firstUpdated));

s().pause();
// D-2 locked the route on play; editing again is what pressing the lock button undoes.
s().setRouteLocked(false);
await s().addRoutePoint([30.5, 50.46]);
check('AC-101 editing a committed route does not add an entry',
  routeRepository.list().length === 1, `${routeRepository.list().length} entries`);

await new Promise((r) => globalThis.setTimeout(r, 5));
s().play();
const after = routeRepository.list();
check('AC-101 second play still one entry', after.length === 1, `${after.length} entries`);
check('AC-101 same id reused', after[0].id === firstId);
check('AC-101 updatedAt advanced', after[0].updatedAt !== firstUpdated);
check('AC-101 createdAt preserved', after[0].createdAt === routeRepository.list()[0].createdAt);

// ---------- AC-102: waypoints persist and reload editable ----------
s().pause();
// D-2 locked the route on play; editing again is what pressing the lock button undoes.
s().setRouteLocked(false);
const stops = s().routePoints.map((p) => p.coordinate);
check('AC-102 route has 3 stops before save', stops.length === 3, `${stops.length}`);
const savedRoute = routeRepository.list()[0];
check('AC-102 waypoints persisted', savedRoute.waypoints?.length === 3,
  `${savedRoute.waypoints?.length}`);

s().clearRoute();
check('AC-102 cleared', s().routePoints.length === 0);
s().loadSavedRoute(savedRoute.id);
check('AC-102 loaded route restores all 3 stops', s().routePoints.length === 3,
  `${s().routePoints.length}`);
check('AC-102 stop order preserved',
  JSON.stringify(s().routePoints.map((p) => p.coordinate)) === JSON.stringify(stops));

// labels survive a round trip
s().clearRoute();
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
useSimulationStore.setState({
  routePoints: s().routePoints.map((p, i) => ({ ...p, label: i === 0 ? 'Home' : 'Airport' })),
});
useSimulationStore.setState({
  activeRoute: { ...s().activeRoute!, waypoints: s().routePoints.map((p) => ({ coordinate: p.coordinate, label: p.label })) },
});
s().play(); s().pause();
// D-2 locked the route on play; editing again is what pressing the lock button undoes.
s().setRouteLocked(false);
const labelled = routeRepository.list().find((r) => r.waypoints?.[0]?.label === 'Home');
check('AC-102 labels persisted', labelled !== undefined);
s().clearRoute();
s().loadSavedRoute(labelled!.id);
check('AC-102 labels restored on load',
  s().routePoints[0].label === 'Home' && s().routePoints[1].label === 'Airport',
  s().routePoints.map((p) => p.label).join(','));

// ---------- AC-103: legacy route without waypoints still loads ----------
mem.set('manual-map:routes', JSON.stringify([{
  id: 'legacy-1',
  title: 'Legacy route',
  createdAt: new Date().toISOString(),
  totalDistanceMeters: 2000,
  coordinates: COORDS,
}]));
useSimulationStore.setState({ savedRoutes: routeRepository.list() });
check('AC-103 legacy entry survives validation', routeRepository.list().length === 1);
s().clearRoute();
s().loadSavedRoute('legacy-1');
check('AC-103 legacy route loads without throwing', s().geometry !== null);
check('AC-103 legacy falls back to 2 endpoints', s().routePoints.length === 2,
  `${s().routePoints.length}`);
check('AC-103 legacy route is simulatable', s().geometry!.totalDistanceMeters > 0);
s().step(1); settleStepAnimation(s);
check('AC-103 legacy route steps', s().telemetry.currentDistanceMeters > 0);

// ---------- AC-104: undo restores previous state ----------
mem.clear();
useSimulationStore.setState({ savedRoutes: [], undoStack: [], activeRoute: null });
s().clearRoute();
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
const twoStopGeom = s().geometry!.totalDistanceMeters;
await s().addRoutePoint([30.5, 50.46]);
check('AC-104 three stops before undo', s().routePoints.length === 3);
s().undo();
check('AC-104 undo restores stop list', s().routePoints.length === 2, `${s().routePoints.length}`);
check('AC-104 undo restores geometry',
  Math.abs(s().geometry!.totalDistanceMeters - twoStopGeom) < 1e-9);
s().undo();
check('AC-104 second undo removes the other stop', s().routePoints.length === 1);

// depth cap
useSimulationStore.setState({ undoStack: [] });
s().clearRoute();
await s().addRoutePoint([30.5, 50.45]);
for (let i = 0; i < 14; i++) await s().addRoutePoint([30.5 + i * 0.001, 50.46]);
check('AC-104 undo stack capped at depth', s().undoStack.length === UNDO_DEPTH,
  `${s().undoStack.length} / ${UNDO_DEPTH}`);
let undos = 0;
while (s().undoStack.length > 0) { s().undo(); undos++; if (undos > 50) break; }
check('AC-104 ten operations individually undoable', undos === UNDO_DEPTH, `${undos}`);
check('AC-104 undo on empty stack is a no-op', (() => { const b = s().routePoints.length; s().undo(); return s().routePoints.length === b; })());

report('phase1');
