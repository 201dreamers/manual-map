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
(globalThis as any).fetch = async () => ({
  ok: true, status: 200,
  json: async () => ({ code: 'Ok', routes: [{ distance: 2000, geometry: { coordinates: COORDS } }] }),
});

const { useSimulationStore, RECALC_DEBOUNCE_MS } = await import('../src/store/simulationStore');

const s = () => useSimulationStore.getState();
const tracking = () => s().config.cameraTrackingEnabled;
const settle = () => new Promise((r) => globalThis.setTimeout(r, RECALC_DEBOUNCE_MS + 120));

s().setToken('pk.' + 'a'.repeat(60));

// Building a route must never take the camera with it.
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
check('camera does not follow after building a route', !tracking());
check('recenter is therefore offered', !tracking() && s().geometry !== null);

// Re-enable, then confirm each kind of edit releases the camera again.
s().setCameraTracking(true);
await s().addRoutePoint([30.5, 50.46]);
check('adding a stop releases the camera', !tracking());

s().setCameraTracking(true);
s().moveRoutePoint(s().routePoints[2].id, -1);
await settle();
check('reordering releases the camera', !tracking());

s().setCameraTracking(true);
s().removeRoutePoint(s().routePoints[1].id);
await settle();
check('removing a stop releases the camera', !tracking());

s().setCameraTracking(true);
await s().reverseRoute();
check('reversing releases the camera', !tracking());

// FR-4.2: starting a drive puts the camera back on the vehicle.
check('camera released before play', !tracking());
s().play();
check('play re-engages camera tracking', tracking());
check('play still starts the simulation', s().config.isPlaying);

// FR-4.3: a manual gesture during playback releases it again.
s().setCameraTracking(false);
check('manual pan releases the camera mid-drive', !tracking());
check('playback continues after a pan', s().config.isPlaying);
s().setCameraTracking(true);
check('recenter re-engages tracking', tracking());

// Loading from history asks for exactly one framing, without live following.
s().pause();
s().play();
const saved = s().savedRoutes[0];
const fitsBefore = s().fitRequestId;
// D-2 locked the route on play; editing again is what pressing the lock button undoes.
s().setRouteLocked(false);
s().clearRoute();
check('clearing releases the camera', !tracking());
s().loadSavedRoute(saved.id);
check('loading a saved route requests one fit', s().fitRequestId === fitsBefore + 1,
  `${fitsBefore} -> ${s().fitRequestId}`);
check('loading does not turn on live following', !tracking());

// Building a fresh route must not request a fit.
const fitsAfterLoad = s().fitRequestId;
s().clearRoute();
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
check('building a route requests no fit', s().fitRequestId === fitsAfterLoad,
  `${s().fitRequestId}`);


// ---------- compass: north reset ----------
{
  const before = s().northRequestId;
  s().setCameraTracking(true);
  s().resetNorth();
  check('compass requests a north rotation', s().northRequestId === before + 1,
    `${before} -> ${s().northRequestId}`);
  // Heading-up following would re-rotate the map on the very next frame.
  check('compass releases heading-up tracking', !tracking());
  check('compass offers recenter afterwards', !tracking() && s().geometry !== null);

  s().resetNorth();
  check('repeated compass presses each request a rotation',
    s().northRequestId === before + 2, `${s().northRequestId}`);

  // The compass must not disturb the route or playback state.
  const stops = s().routePoints.length;
  s().play();
  const playingBefore = s().config.isPlaying;
  s().resetNorth();
  check('compass leaves the stop list alone', s().routePoints.length === stops);
  check('compass does not stop playback', s().config.isPlaying === playingBefore);
  check('compass during playback still releases tracking', !tracking());
  s().pause();
}

report('camera');
