import { check, report } from './harness';
import type { CoordinateTuple } from '../src/types/domain';

const mem = new Map<string, string>();
const ls = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
(globalThis as any).window = { localStorage: ls, setTimeout: () => 0 };
(globalThis as any).localStorage = ls;

const ROUTE: CoordinateTuple[] = [[30.5, 50.45], [30.5, 50.459], [30.5, 50.468]];
let directionsCalls = 0;
let waypointsSent: string[] = [];
let failNextRoute = false;

(globalThis as any).fetch = async (url: string) => {
  // Directions only: cameras are on by default and fetch Overpass on every route build.
  if (!url.includes('/directions/')) {
    return { ok: true, status: 200, json: async () => ({ elements: [] }) };
  }
  directionsCalls++;
  const path = url.split('/driving/')[1]?.split('?')[0] ?? '';
  waypointsSent = path.split(';');
  if (failNextRoute) {
    failNextRoute = false;
    return { ok: true, status: 200, json: async () => ({ code: 'NoRoute', routes: [] }) };
  }
  return { ok: true, status: 200,
    json: async () => ({ code: 'Ok', routes: [{ distance: 2000, geometry: { coordinates: ROUTE } }] }) };
};

const { useSimulationStore } = await import('../src/store/simulationStore');
const { MIN_STROKE_LENGTH_METERS, TOO_MANY_STOPS_MESSAGE } = await import('../src/lib/splice');
const { NO_ROUTE_MESSAGE } = await import('../src/lib/directions');

const s = () => useSimulationStore.getState();
const labels = () => s().routePoints.map((p) => p.label ?? '-');

s().setToken('pk.' + 'a'.repeat(60));

// ---------- pen arming ----------
check('pen starts disarmed', !s().isDrawArmed);
s().setDrawArmed(true);
check('pen can be armed', s().isDrawArmed);

// ---------- a tap is ignored ----------
directionsCalls = 0;
await s().applyStroke([[30.5, 50.45], [30.500005, 50.450005]]);
check('AC-401 a tap-length stroke is ignored', directionsCalls === 0, `${directionsCalls} calls`);
check('AC-401 a completed stroke disarms the pen', !s().isDrawArmed);
check('a tap raises no error', !s().toasts.some((t) => t.kind === 'error'));
check('tap threshold is metric', MIN_STROKE_LENGTH_METERS > 0);

// ---------- AC-402: stroke on an empty map builds a route ----------
directionsCalls = 0;
const freshStroke: CoordinateTuple[] = [
  [30.50, 50.450], [30.504, 50.4535], [30.509, 50.4570], [30.515, 50.4605],
];
await s().applyStroke(freshStroke);
check('AC-402 a stroke on an empty map builds a route', s().geometry !== null);
check('AC-402 one Directions request issued', directionsCalls === 1, `${directionsCalls}`);
check('AC-402 route starts near the stroke start',
  Math.abs(s().routePoints[0].coordinate[0] - 30.50) < 0.001,
  `${s().routePoints[0].coordinate[0]}`);
check('AC-402 route ends near the stroke end',
  Math.abs(s().routePoints[s().routePoints.length - 1].coordinate[0] - 30.515) < 0.001);
check('AC-402 waypoints stay within the API ceiling', waypointsSent.length <= 25,
  `${waypointsSent.length}`);

// ---------- AC-403 / labels: splicing an existing route ----------
s().clearRoute();
await s().applySearchResult(
  { id: 'a', name: 'Home', address: '', coordinate: ROUTE[0] }, 'start');
await s().applySearchResult(
  { id: 'b', name: 'Airport', address: '', coordinate: ROUTE[2] }, 'end');
check('labelled route built', labels().join(',') === 'Home,Airport', labels().join(','));

const beforeStops = s().routePoints.length;
directionsCalls = 0;
await s().applyStroke([
  [30.5008, 50.4535], [30.504, 50.4570], [30.504, 50.4600], [30.5008, 50.4635],
]);
check('AC-403 splice issues one request', directionsCalls === 1, `${directionsCalls}`);
check('AC-403 splice adds shaping stops', s().routePoints.length > beforeStops,
  `${beforeStops} -> ${s().routePoints.length}`);
check('AC-403 searched start label survives the splice',
  s().routePoints[0].label === 'Home', labels().join(','));
check('AC-403 searched end label survives the splice',
  s().routePoints[s().routePoints.length - 1].label === 'Airport', labels().join(','));
check('AC-403 title still uses the searched names',
  s().activeRoute?.title === 'Home → Airport', s().activeRoute?.title ?? '-');

// ---------- D-5: undo reverts a stray stroke ----------
const spliced = s().routePoints.length;
s().undo();
check('D-5 undo reverts the splice', s().routePoints.length === beforeStops,
  `${spliced} -> ${s().routePoints.length}`);
check('D-5 undo restores the original stops', labels().join(',') === 'Home,Airport',
  labels().join(','));

// ---------- far stroke still splices (D-5) ----------
directionsCalls = 0;
await s().applyStroke([[31.8, 50.9], [31.9, 50.95], [32.0, 51.0]]);
check('D-5 a far stroke splices rather than being rejected', directionsCalls === 1,
  `${directionsCalls}`);
check('D-5 ends stay pinned after a far stroke',
  s().routePoints[0].label === 'Home'
  && s().routePoints[s().routePoints.length - 1].label === 'Airport', labels().join(','));
s().undo();

// ---------- AC-405: budget refusal ----------
s().clearRoute();
await s().addRoutePoint(ROUTE[0]);
for (let i = 0; i < 20; i++) await s().addRoutePoint([30.5, 50.4505 + i * 0.00012]);
await s().addRoutePoint(ROUTE[2]);
const crowded = s().routePoints.length;
directionsCalls = 0;
await s().applyStroke([[30.5008, 50.4655], [30.502, 50.4662], [30.5008, 50.4670]]);
check('AC-405 an over-full route refuses the splice', directionsCalls === 0, `${directionsCalls}`);
check('AC-405 refusal is explained to the user',
  s().toasts.some((t) => t.text === TOO_MANY_STOPS_MESSAGE),
  s().toasts.map((t) => t.text).join('|').slice(0, 60));
check('AC-405 the route is left untouched', s().routePoints.length === crowded);

// ---------- failure path: NoRoute after a splice ----------
s().clearRoute();
await s().addRoutePoint(ROUTE[0]);
await s().addRoutePoint(ROUTE[2]);
const stopsBeforeFailure = s().routePoints.length;
useSimulationStore.setState({ toasts: [] });
failNextRoute = true;
await s().applyStroke([
  [30.5008, 50.4535], [30.504, 50.4570], [30.5008, 50.4635],
]);
check('a failed splice restores the previous stops',
  s().routePoints.length === stopsBeforeFailure, `${s().routePoints.length}`);
check('a failed splice reports the routing error',
  s().toasts.some((t) => t.text === NO_ROUTE_MESSAGE),
  s().toasts.map((t) => t.text).join('|').slice(0, 60));
check('a failed splice keeps the earlier geometry', s().geometry !== null);

report('draw');
