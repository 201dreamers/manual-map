import { check, report } from './harness';

const mem = new Map<string, string>();
const ls = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
(globalThis as any).window = { localStorage: ls, setTimeout: () => 0 };
(globalThis as any).localStorage = ls;

const COORDS: [number, number][] = [[30.5, 50.45], [30.5, 50.459], [30.5, 50.468]];
let requests = 0;
(globalThis as any).fetch = async (url: string) => {
  // Directions only. The camera layer is on by default and fetches Overpass whenever a
  // route is built, so an unfiltered counter no longer measures what this suite claims.
  if (url.includes('/directions/')) requests++;
  return {
    ok: true, status: 200,
    json: async () => ({ code: 'Ok', routes: [{ distance: 2000 + url.length, geometry: { coordinates: COORDS } }] }),
  };
};

const { useSimulationStore, RECALC_DEBOUNCE_MS } = await import('../src/store/simulationStore');

const s = () => useSimulationStore.getState();
const settle = () => new Promise((r) => globalThis.setTimeout(r, RECALC_DEBOUNCE_MS + 120));
const ids = () => s().routePoints.map((p) => p.id);

s().setToken('pk.' + 'a'.repeat(60));
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
await s().addRoutePoint([30.5, 50.46]);
check('three stops placed', s().routePoints.length === 3);

// ---------- AC-201: reorder ----------
const before = ids();
requests = 0;
s().moveRoutePoint(before[2], -1);
check('AC-201 list reorders immediately (optimistic)',
  ids()[1] === before[2] && ids()[2] === before[1], ids().join(',').slice(0, 24));
check('AC-201 no request fired yet (debounced)', requests === 0, `${requests}`);
await settle();
check('AC-201 exactly one request after settling', requests === 1, `${requests}`);

// A burst of reorders must still cost one request.
requests = 0;
const burst = ids();
s().moveRoutePoint(burst[2], -1);
s().moveRoutePoint(burst[2], -1);
s().moveRoutePoint(burst[0], 1);
check('AC-201 burst not yet requested', requests === 0);
await settle();
check('AC-201 burst coalesces into one request', requests === 1, `${requests}`);

// Bounds are no-ops.
const bounded = ids();
s().moveRoutePoint(bounded[0], -1);
check('AC-201 moving the first stop up is a no-op',
  JSON.stringify(ids()) === JSON.stringify(bounded));
s().moveRoutePoint(bounded[bounded.length - 1], 1);
check('AC-201 moving the last stop down is a no-op',
  JSON.stringify(ids()) === JSON.stringify(bounded));
s().moveRoutePoint('does-not-exist', 1);
check('AC-201 unknown id is a no-op', JSON.stringify(ids()) === JSON.stringify(bounded));
await settle();

// Reordering while driving pauses playback.
s().play();
check('playing before reorder', s().config.isPlaying);
const driving = ids();
s().moveRoutePoint(driving[2], -1);
check('AC-201 reorder pauses playback', !s().config.isPlaying);
await settle();
check('AC-201 position reset to route start', s().telemetry.currentDistanceMeters === 0);

// D-2 locked the route on play; editing again is what pressing the lock button undoes.
s().setRouteLocked(false);

// ---------- AC-202: delete ----------
check('three stops before delete', s().routePoints.length === 3);
const viaId = ids()[1];
s().removeRoutePoint(viaId);
check('AC-202 stop removed from list', s().routePoints.length === 2);
check('AC-202 removed stop is gone', !ids().includes(viaId));
await settle();
check('AC-202 route still routable with 2 stops', s().geometry !== null);

s().removeRoutePoint(ids()[0]);
await settle();
check('AC-202 one stop left clears geometry', s().geometry === null);
check('AC-202 remaining stop is kept', s().routePoints.length === 1, `${s().routePoints.length}`);
check('AC-202 no error toast for a short route',
  !s().toasts.some((t) => t.kind === 'error'), s().toasts.map((t) => t.text).join('|'));

s().removeRoutePoint('does-not-exist');
check('AC-202 removing unknown id is a no-op', s().routePoints.length === 1);

// ---------- undo covers drawer edits ----------
useSimulationStore.setState({ undoStack: [] });
s().clearRoute();
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
await s().addRoutePoint([30.5, 50.46]);
const preEdit = ids();
s().moveRoutePoint(preEdit[2], -1);
await settle();
check('undo entry recorded for reorder', s().undoStack.length > 0);
s().undo();
check('undo restores pre-reorder order', JSON.stringify(ids()) === JSON.stringify(preEdit),
  ids().join(',').slice(0, 24));

// A pending edit must not fire after the route is cleared.
requests = 0;
s().moveRoutePoint(ids()[2], -1);
s().clearRoute();
await settle();
check('pending edit cancelled by clearRoute', requests === 0, `${requests}`);

report('plan');
