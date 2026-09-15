import { check, installStorageStub, report, stubDirections } from './harness';

installStorageStub();

// A synthetic 2 km straight road returned in place of the Mapbox Directions API.
const ROUTE_COORDS: [number, number][] = [
  [30.5, 50.45],
  [30.5, 50.459],
  [30.5, 50.468],
];
stubDirections(ROUTE_COORDS, 2000);

const { useSimulationStore } = await import('../src/store/simulationStore');

const s = () => useSimulationStore.getState();
const toastCount = () => s().toasts.length;

s().setToken('pk.' + 'a'.repeat(60));
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
check('fixture: two points build geometry', s().geometry !== null);

// A route needs both ends before there is anything worth protecting.
const stops = s().routePoints.length;
check('lock refused below two stops', stops >= 2);

// --- AC-501: the lock blocks map-tap adds -------------------------------------
s().setRouteLocked(true);
check('AC-501 lock engages', s().isRouteLocked);

const beforeAdd = s().routePoints.length;
const beforeToasts = toastCount();
await s().addRoutePoint([30.51, 50.46]);
check('AC-501 locked tap adds no point', s().routePoints.length === beforeAdd);
check('AC-501 refusal is reported, not swallowed', toastCount() > beforeToasts);

// --- AC-503: the lock gates the other route mutations -------------------------
const pointsBeforeReverse = s().routePoints.map((point) => point.coordinate[1]);
await s().reverseRoute();
check(
  'AC-503 locked reverse is refused',
  s().routePoints.map((point) => point.coordinate[1]).join() === pointsBeforeReverse.join(),
);

const undoDepthBefore = s().undoStack.length;
s().undo();
check('AC-503 locked undo is refused', s().undoStack.length === undoDepthBefore);

s().clearRoute();
check('AC-503 locked clear is refused', s().geometry !== null);

s().setDrawArmed(true);
check('AC-503 locked draw cannot arm', !s().isDrawArmed);

await s().applyStroke([
  [30.5, 50.45],
  [30.505, 50.455],
  [30.5, 50.468],
]);
check('AC-503 locked stroke is refused', s().routePoints.length === beforeAdd);

// --- Unlocking restores every gated action ------------------------------------
s().setRouteLocked(false);
check('unlock clears the flag', !s().isRouteLocked);
s().setDrawArmed(true);
check('unlocked draw arms again', s().isDrawArmed);
s().setDrawArmed(false);

// --- AC-502: Play auto-locks --------------------------------------------------
s().setRouteLocked(false);
s().play();
check('AC-502 play locks the route', s().isRouteLocked);
check('AC-502 play still starts playback', s().config.isPlaying);

// Unlocking mid-drive leaves playback alone (section 24).
s().setRouteLocked(false);
check('unlock while playing keeps playing', s().config.isPlaying && !s().isRouteLocked);
s().pause();

// Play while already locked is a no-op on the lock.
s().setRouteLocked(true);
s().play();
check('play while locked leaves the lock set', s().isRouteLocked);
s().pause();
s().setRouteLocked(false);

// --- Loading a saved route releases the lock ----------------------------------
s().play();
s().pause();
const saved = s().savedRoutes;
check('fixture: play committed the route to history', saved.length === 1);
s().setRouteLocked(true);
s().loadSavedRoute(saved[0].id);
check('loading a route releases the lock', !s().isRouteLocked);

// ---------- a lock must never outlive the route it guards ----------
// Drawer deletes are deliberately not gated (D-3), so a locked route can still be
// emptied from the stop list. The lock button is disabled below two stops, so a lock
// left standing here would strand the UI in the Drive layout with no way out.
s().setRouteLocked(false);
s().clearRoute();
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
s().setRouteLocked(true);
check('fixture: locked with a two-stop route', s().isRouteLocked && s().routePoints.length === 2);

s().removeRoutePoint(s().routePoints[0].id);
check('deleting down to one stop releases the lock', !s().isRouteLocked,
  `${s().routePoints.length} stops left`);

// The same must hold when the list is emptied outright.
await s().addRoutePoint([30.5, 50.45]);
check('fixture: back to two stops', s().routePoints.length === 2);
s().setRouteLocked(true);
check('fixture: locked again', s().isRouteLocked);
for (const point of [...s().routePoints]) s().removeRoutePoint(point.id);
check('deleting every stop releases the lock', !s().isRouteLocked,
  `${s().routePoints.length} stops left`);
check('an empty route cannot be locked again', (s().setRouteLocked(true), !s().isRouteLocked));

report('lock');
