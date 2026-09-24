import { check, installStorageStub, report, stubDirections } from './harness';
import {
  buildOverpassQuery,
  camerasToGeoJSON,
  MAX_OVERPASS_POINTS,
  parseCameras,
  parseMaxspeed,
  sampleRoute,
  shouldFetchCameras,
  type SpeedCamera,
} from '../src/lib/cameras';
import type { CoordinateTuple } from '../src/types/domain';

installStorageStub();

/* ---------------- sampling ---------------- */

{
  const short: CoordinateTuple[] = [
    [30.5, 50.45],
    [30.5, 50.46],
  ];
  check('a short route passes through untouched', sampleRoute(short).length === 2);
}

{
  const long: CoordinateTuple[] = Array.from(
    { length: 5000 },
    (_, index) => [30.5 + index * 1e-4, 50.45] as CoordinateTuple,
  );
  const sampled = sampleRoute(long);
  check('AC-730 a long route is thinned to the cap',
    sampled.length === MAX_OVERPASS_POINTS, `${sampled.length}`);
  check('AC-730 the start is kept', sampled[0][0] === long[0][0]);
  check('AC-730 and so is the end',
    sampled[sampled.length - 1][0] === long[long.length - 1][0],
    `${sampled[sampled.length - 1][0]} vs ${long[long.length - 1][0]}`);
  // Even coverage is the point: no stretch of corridor may go unsampled.
  const gaps = sampled.slice(1).map((point, index) => point[0] - sampled[index][0]);
  const spread = Math.max(...gaps) - Math.min(...gaps);
  check('AC-730 sampling is even along the route', spread < 1e-4, `${spread.toExponential(2)}`);
}

check('no route samples to nothing', sampleRoute([]).length === 0);
check('a null route samples to nothing', sampleRoute(null).length === 0);
check('non-finite coordinates are dropped',
  sampleRoute([[Number.NaN, 50], [30, 50]]).length === 1);

/* ---------------- the query ---------------- */

{
  const query = buildOverpassQuery([[30.5, 50.45], [30.6, 50.5]], 250);
  check('the query asks for JSON', query !== null && query.startsWith('[out:json]'));
  check('AC-731 both camera tagging conventions are asked for',
    query!.includes('"highway"="speed_camera"') && query!.includes('"enforcement"="maxspeed"'));
  check('AC-732 the corridor is a radius around the route, not a bounding box',
    query!.includes('around:250,'));
  check('AC-732 coordinates are sent lat,lon as Overpass expects',
    query!.includes('50.45000,30.50000'), query!.slice(0, 160));
  check('the query ends with a body request', query!.trimEnd().endsWith('out body;'));
}
check('no route yields no query', buildOverpassQuery([]) === null);

/* ---------------- parsing ---------------- */

const payload = {
  elements: [
    { type: 'node', id: 1, lat: 50.45, lon: 30.5, tags: { highway: 'speed_camera', maxspeed: '50' } },
    { type: 'node', id: 2, lat: 50.46, lon: 30.51, tags: { highway: 'speed_camera' } },
    {
      type: 'node',
      id: 3,
      lat: 50.47,
      lon: 30.52,
      tags: { enforcement: 'maxspeed', maxspeed: '30 mph', direction: 'forward' },
    },
  ],
};

{
  const cameras = parseCameras(payload);
  check('every node parses', cameras.length === 3, `${cameras.length}`);
  check('AC-733 coordinates are converted to lon,lat',
    cameras[0].coordinate[0] === 30.5 && cameras[0].coordinate[1] === 50.45);
  check('the posted limit is read', cameras[0].maxspeedKmh === 50);
  check('AC-734 a camera with no limit is null, not zero', cameras[1].maxspeedKmh === null);
  check('AC-734 an mph limit converts to km/h', cameras[2].maxspeedKmh === 48,
    `${cameras[2].maxspeedKmh}`);
  check('the direction is carried', cameras[2].direction === 'forward');
}

// The two tag queries overlap, so Overpass returns shared nodes twice.
check('AC-735 a node matching both tag queries appears once',
  parseCameras({ elements: [payload.elements[0], payload.elements[0]] }).length === 1);

check('a non-object payload yields nothing', parseCameras(null).length === 0);
check('a payload with no elements yields nothing', parseCameras({}).length === 0);
check('a node with no coordinates is dropped',
  parseCameras({ elements: [{ type: 'node', id: 9, tags: {} }] }).length === 0);
check('a non-finite coordinate is dropped',
  parseCameras({ elements: [{ type: 'node', id: 9, lat: Number.NaN, lon: 30 }] }).length === 0);
check('a node with no tags at all still parses',
  parseCameras({ elements: [{ type: 'node', id: 9, lat: 50, lon: 30 }] }).length === 1);

check('a plain limit parses', parseMaxspeed('50') === 50);
check('a spaced mph limit parses', parseMaxspeed('30 mph') === 48);
check('OSM walk and none values are rejected', parseMaxspeed('walk') === null);
check('a signed value is rejected', parseMaxspeed('RU:urban') === null);
check('an empty value is rejected', parseMaxspeed('') === null);
check('undefined is rejected', parseMaxspeed(undefined) === null);
check('zero is rejected rather than shown', parseMaxspeed('0') === null);

/* ---------------- what the layer receives ---------------- */

{
  const features = camerasToGeoJSON(parseCameras(payload)).features;
  check('every camera becomes a point', features.every((f) => f.geometry.type === 'Point'));
  check('AC-734 a known limit becomes a label', features[0].properties?.maxspeed === '50');
  check('AC-734 an unknown limit becomes an empty label, which the filter drops',
    features[1].properties?.maxspeed === '');
}
check('an empty list yields an empty collection',
  camerasToGeoJSON([] as SpeedCamera[]).features.length === 0);

/* ---------------- the fetch gate ---------------- */

check('AC-736 a new route fetches',
  shouldFetchCameras({ enabled: true, routeKey: 'a', cachedRouteKey: null }));
check('AC-736 the same route does not refetch',
  !shouldFetchCameras({ enabled: true, routeKey: 'a', cachedRouteKey: 'a' }));
check('AC-736 a changed route refetches',
  shouldFetchCameras({ enabled: true, routeKey: 'b', cachedRouteKey: 'a' }));
check('the layer being off never fetches',
  !shouldFetchCameras({ enabled: false, routeKey: 'a', cachedRouteKey: null }));
check('no route never fetches',
  !shouldFetchCameras({ enabled: true, routeKey: null, cachedRouteKey: null }));
check('AC-737 a manual refresh ignores the cache',
  shouldFetchCameras({ enabled: true, routeKey: 'a', cachedRouteKey: 'a', force: true }));

/* ---------------- the store ---------------- */

const ROUTE_COORDS: [number, number][] = [
  [30.5, 50.45],
  [30.5, 50.459],
  [30.5, 50.468],
];
stubDirections(ROUTE_COORDS, 2000);

const { useSimulationStore, setCamerasFetcher } = await import('../src/store/simulationStore');
const s = () => useSimulationStore.getState();
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

let calls = 0;
setCamerasFetcher(async () => {
  calls += 1;
  return parseCameras(payload);
});

// Needing no key and no quota, cameras are shown out of the box.
check('AC-743 cameras are on by default', s().traffic.isCamerasOn);
check('but nothing is fetched before a route exists', calls === 0, `${calls} calls`);

s().setToken('pk.' + 'a'.repeat(60));
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
await settle();
check('the route is built', s().geometry !== null);
check('AC-738 building a route fetches cameras, with no lock and no toggle',
  calls === 1, `${calls} calls`);
check('AC-738 and the cameras land in the store', s().traffic.cameras.length === 3);

s().setRouteLocked(true);
await settle();
check('AC-736 locking an unchanged route spends nothing', calls === 1, `${calls} calls`);

// A rebuilt route invalidates the cache, and refetches as soon as it is rebuilt.
s().setRouteLocked(false);
stubDirections([...ROUTE_COORDS, [30.51, 50.48]], 2600);
await s().addRoutePoint([30.51, 50.48]);
await settle();
check('AC-736 a rebuilt route refetches cameras', calls === 2, `${calls} calls`);
s().setRouteLocked(true);
await settle();
check('AC-736 and locking it afterwards adds nothing', calls === 2, `${calls} calls`);

await s().refreshCameras(true);
await settle();
check('AC-737 the manual refresh fetches despite a warm cache', calls === 3, `${calls} calls`);

{
  // Overpass being down must never surface to the driver or break the app.
  setCamerasFetcher(async () => {
    throw new Error('Overpass timeout');
  });
  const toastsBefore = s().toasts.length;
  await s().refreshCameras(true);
  await settle();
  check('AC-739 an Overpass failure leaves the layer empty', s().traffic.cameras.length === 0);
  check('AC-739 and raises no toast', s().toasts.length === toastsBefore,
    `${s().toasts.length} vs ${toastsBefore}`);
  check('AC-739 and does not disturb the route', s().geometry !== null && s().isRouteLocked);

  // An empty result must not be cached as "no cameras here": Overpass throttles with a
  // 200 and an empty body, which is indistinguishable from a genuinely camera-free road.
  let attempts = 0;
  setCamerasFetcher(async () => {
    attempts += 1;
    return [];
  });
  await s().refreshCameras(true);
  await settle();
  check('AC-740 an empty result is not cached', s().traffic.camerasRouteKey === null);
  s().setRouteLocked(false);
  s().setRouteLocked(true);
  await settle();
  check('AC-740 so the next lock retries it', attempts === 2, `${attempts} attempts`);
}

{
  // Toggling off clears the layer and stops it being repopulated.
  setCamerasFetcher(async () => {
    calls += 1;
    return parseCameras(payload);
  });
  await s().refreshCameras(true);
  await settle();
  check('cameras repopulate', s().traffic.cameras.length === 3);
  s().toggleCamerasOverlay();
  check('AC-741 turning cameras off clears them', s().traffic.cameras.length === 0);
  check('AC-741 and drops the cache', s().traffic.camerasRouteKey === null);

  const before = calls;
  s().setRouteLocked(false);
  s().setRouteLocked(true);
  await settle();
  check('AC-741 locking with the layer off spends nothing', calls === before, `${calls} calls`);
}

/* ---------------- the refresh control is unconditional ---------------- */

{
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MenuButton } = await import('../src/components/MenuButton');

  const initial = useSimulationStore.getInitialState();
  const render = (over: Record<string, unknown>) => {
    Object.assign(initial, useSimulationStore.getState(), {
      isMenuOpen: true,
      traffic: { ...useSimulationStore.getState().traffic, ...(over.traffic ?? {}) },
      ...over,
    });
    return renderToStaticMarkup(createElement(MenuButton));
  };

  check('AC-745 the refresh is offered with both layers off',
    render({ traffic: { isIncidentsOn: false, isCamerasOn: false } }).includes('Refresh traffic'));
  check('AC-745 and with no TomTom key at all',
    render({ traffic: { status: 'unavailable', isIncidentsOn: false } })
      .includes('Refresh traffic'));
  check('AC-745 and while the route is locked',
    render({ isRouteLocked: true }).includes('Refresh traffic'));

  // Nothing to refresh without a route, so it is present but not pressable.
  const noRoute = render({ geometry: null, traffic: {} });
  const tag = noRoute.slice(
    noRoute.lastIndexOf('<button', noRoute.indexOf('Refresh traffic')),
    noRoute.indexOf('Refresh traffic'),
  );
  check('AC-745 but disabled with no route to scope it to', tag.includes('disabled=""'), tag);
}

/* ---------------- default policy and its migration ---------------- */

{
  const { settingsRepository } = await import('../src/lib/storage');

  // An install predating these keys must adopt the new defaults, not be forced off by a
  // `=== true` read. This is the case that silently breaks a default-on rollout.
  globalThis.localStorage.setItem(
    'manual-map:settings',
    JSON.stringify({ mapboxAccessToken: null, controlsMirrored: true }),
  );
  const migrated = settingsRepository.read();
  check('AC-743 an older settings blob adopts the free layers',
    migrated.congestionOverlay && migrated.camerasOverlay);
  check('AC-743 but not the metered one', !migrated.incidentsOverlay);
  check('AC-743 and its own preferences survive', migrated.controlsMirrored);

  // An explicit stored false is a choice and must outlive the default change.
  globalThis.localStorage.setItem(
    'manual-map:settings',
    JSON.stringify({ congestionOverlay: false, camerasOverlay: false }),
  );
  const chosen = settingsRepository.read();
  check('AC-744 a layer switched off by hand stays off',
    !chosen.congestionOverlay && !chosen.camerasOverlay);

  globalThis.localStorage.removeItem('manual-map:settings');
  const fresh = settingsRepository.read();
  check('AC-743 a fresh install shows both free layers',
    fresh.congestionOverlay && fresh.camerasOverlay);
  check('AC-743 and leaves the metered one off', !fresh.incidentsOverlay);
}

report('cameras');
