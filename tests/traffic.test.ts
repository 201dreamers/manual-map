import { check, installStorageStub, report, stubDirections } from './harness';
import {
  bboxContains,
  buildIncidentsUrl,
  incidentGroup,
  incidentPointsToGeoJSON,
  incidentsToGeoJSON,
  INCIDENT_REFRESH_MS,
  MIN_BBOX_SPAN_DEGREES,
  padBbox,
  parseIncidents,
  routeBbox,
  routeKey,
  setTrafficKey,
  shouldFetchIncidents,
  type TrafficIncident,
} from '../src/lib/traffic';
import type { BoundingBox } from '../src/lib/geocoding';

installStorageStub();

/* ---------------- padding, route box and identity ---------------- */

const box: BoundingBox = [30, 50, 31, 51];

{
  const padded = padBbox(box, 0.25);
  check('padding grows every side', padded[0] === 29.75 && padded[2] === 31.25, padded.join(','));
  check('padding grows latitude too', padded[1] === 49.75 && padded[3] === 51.25);
  check('a padded box contains the box it came from', bboxContains(padded, box));
}

// A route running due north has zero width; without the floor the query is a line.
{
  const meridian = padBbox([30, 50, 30, 51], 0.15);
  check('AC-713 a zero-width route still asks for an area',
    meridian[2] - meridian[0] >= MIN_BBOX_SPAN_DEGREES * 2 - 1e-9,
    `${(meridian[2] - meridian[0]).toFixed(4)} deg`);
}
check('latitude padding is clamped at the pole', padBbox([0, 89, 1, 90], 1)[3] === 90);
check('and at the south pole', padBbox([0, -90, 1, -89], 1)[1] === -90);

check('a box contains itself', bboxContains(box, box));
check('a box does not contain a wider one', !bboxContains(box, [29, 50, 32, 51]));

{
  const bounds = routeBbox([
    [30.5, 50.45],
    [30.1, 50.9],
    [30.9, 50.2],
  ]);
  check('AC-713 the route box spans every coordinate',
    bounds !== null && bounds.join(',') === '30.1,50.2,30.9,50.9', bounds?.join(','));
}
check('no coordinates yield no box', routeBbox([]) === null);
check('a null route yields no box', routeBbox(null) === null);
check('a non-finite coordinate is skipped rather than poisoning the box',
  routeBbox([[Number.NaN, 50], [30, 50], [31, 51]])?.join(',') === '30,50,31,51');
check('an entirely non-finite route yields no box',
  routeBbox([[Number.NaN, Number.NaN]]) === null);

{
  const a = routeKey([[30, 50], [31, 51]], 2000);
  check('AC-714 the same geometry yields the same key', a === routeKey([[30, 50], [31, 51]], 2000));
  check('AC-714 a moved endpoint changes the key', a !== routeKey([[30, 50], [31, 51.5]], 2000));
  check('AC-714 a different length changes the key', a !== routeKey([[30, 50], [31, 51]], 2500));
  check('AC-714 an inserted waypoint changes the key',
    a !== routeKey([[30, 50], [30.5, 50.5], [31, 51]], 2000));
  check('a route with under two points has no key', routeKey([[30, 50]], 0) === null);
  check('no geometry has no key', routeKey(null, 0) === null);
}

/* ---------------- the fetch gate: this is the whole cost control ---------------- */

const KEY = 'route-a';
const cold = { routeKey: null, fetchedAt: null };
const warm = { routeKey: KEY, fetchedAt: 1_000_000 };
const gate = (over: Partial<Parameters<typeof shouldFetchIncidents>[0]> = {}) =>
  shouldFetchIncidents({
    enabled: true,
    hasKey: true,
    routeKey: KEY,
    cache: cold,
    now: 1_000_000,
    ...over,
  });

check('AC-701 a first lock on a route fetches', gate());
check('AC-715 no TomTom key never fetches', !gate({ hasKey: false }));
check('AC-715 and no key with a forced refresh still never fetches',
  !gate({ hasKey: false, force: true }));
check('AC-701 the overlay being off never fetches', !gate({ enabled: false }));
check('AC-701 no route never fetches', !gate({ routeKey: null }));

check('AC-716 a warm cache on the same route does not refetch', !gate({ cache: warm }));
check('AC-714 a rebuilt route refetches however recent the cache is',
  gate({ cache: warm, routeKey: 'route-b' }));
check('AC-717 the half-hour refresh fires',
  gate({ cache: warm, now: 1_000_000 + INCIDENT_REFRESH_MS }));
check('AC-717 and one millisecond earlier it does not',
  !gate({ cache: warm, now: 1_000_000 + INCIDENT_REFRESH_MS - 1 }));
check('AC-718 a manual refresh ignores a warm cache', gate({ cache: warm, force: true }));
check('AC-718 but still respects the layer being off',
  !gate({ cache: warm, force: true, enabled: false }));
check('the refresh window is half an hour', INCIDENT_REFRESH_MS === 30 * 60_000);

/* ---------------- the request ---------------- */

{
  const url = buildIncidentsUrl([30, 50, 31, 51], 'KEY123');
  check('the request goes to TomTom v5 incidentDetails',
    url.startsWith('https://api.tomtom.com/traffic/services/5/incidentDetails?'));
  check('AC-705 bbox is sent minLon,minLat,maxLon,maxLat',
    decodeURIComponent(url).includes('bbox=30.000000,50.000000,31.000000,51.000000'),
    decodeURIComponent(url));
  check('the key is carried', url.includes('key=KEY123'));
  check('only present incidents are asked for', url.includes('timeValidityFilter=present'));
  check('a fields selector is sent, which v5 requires', url.includes('fields='));
  check('the key is escaped', buildIncidentsUrl(box, 'a&b=c').includes('key=a%26b%3Dc'));
}

/* ---------------- parsing ---------------- */

const payload = {
  incidents: [
    {
      geometry: { type: 'LineString', coordinates: [[30.5, 50.45], [30.5, 50.46], [30.5, 50.47]] },
      properties: {
        id: 'x1',
        iconCategory: 1,
        magnitudeOfDelay: 3,
        delay: 240,
        events: [{ description: 'Accident' }],
      },
    },
    {
      geometry: { type: 'Point', coordinates: [30.5, 50.5] },
      properties: { id: 'x2', iconCategory: 9, events: [{ description: 'Road works' }] },
    },
  ],
};

{
  const incidents = parseIncidents(payload);
  check('both incidents parse', incidents.length === 2, `${incidents.length}`);
  check('AC-706 the category comes from the icon enum', incidents[0].category === 'Accident');
  check('AC-706 an accident groups as blocking', incidents[0].group === 'blocking');
  check('AC-706 road works group as slow', incidents[1].group === 'slow');
  check('the delay is carried', incidents[0].delaySeconds === 240);
  check('a missing delay is null, not zero', incidents[1].delaySeconds === null);
  check('the description is carried', incidents[0].description === 'Accident');
  check('line geometry keeps every coordinate', incidents[0].coordinates.length === 3);
  check('AC-707 the symbol sits at the middle of the geometry',
    incidents[0].point[1] === 50.46, incidents[0].point.join(','));
  check('a point incident collapses to one coordinate', incidents[1].coordinates.length === 1);
}

check('a non-object payload yields nothing', parseIncidents(null).length === 0);
check('a payload with no incidents array yields nothing', parseIncidents({}).length === 0);
check('an incident with no geometry is dropped, not thrown on',
  parseIncidents({ incidents: [{ properties: { id: 'a' } }, payload.incidents[1]] }).length === 1);
check('a NaN coordinate is rejected',
  parseIncidents({
    incidents: [{ geometry: { coordinates: [Number.NaN, 50] }, properties: {} }],
  }).length === 0);
check('an unknown icon category falls back rather than throwing',
  parseIncidents({
    incidents: [{ geometry: { coordinates: [30, 50] }, properties: { iconCategory: 99 } }],
  })[0].category === 'Unknown');
check('an id is synthesised when TomTom omits one',
  parseIncidents({
    incidents: [{ geometry: { coordinates: [30, 50] }, properties: {} }],
  })[0].id === 'incident-0');
check('MultiLineString nesting is flattened',
  parseIncidents({
    incidents: [{
      geometry: { type: 'MultiLineString', coordinates: [[[30, 50], [30.1, 50.1]]] },
      properties: {},
    }],
  })[0].coordinates.length === 2);
check('every mapped category has a group',
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14].every((category) =>
    ['blocking', 'slow', 'weather', 'other'].includes(incidentGroup(category))));

/* ---------------- what the map layers receive ---------------- */

{
  const incidents = parseIncidents(payload);
  const geometry = incidentsToGeoJSON(incidents);
  check('geometry keeps the line as a line', geometry.features[0].geometry.type === 'LineString');
  check('and the point as a point', geometry.features[1].geometry.type === 'Point');
  check('the group travels to the paint expression',
    geometry.features[0].properties?.group === 'blocking');

  const points = incidentPointsToGeoJSON(incidents);
  check('AC-707 every incident gets exactly one symbol, line or not',
    points.features.length === incidents.length &&
      points.features.every((feature) => feature.geometry.type === 'Point'),
    `${points.features.length} of ${incidents.length}`);
}
check('an empty list still yields a valid empty collection',
  incidentsToGeoJSON([] as TrafficIncident[]).features.length === 0);

/* ---------------- the store ---------------- */

const ROUTE_COORDS: [number, number][] = [
  [30.5, 50.45],
  [30.5, 50.459],
  [30.5, 50.468],
];
stubDirections(ROUTE_COORDS, 2000);

setTrafficKey('test-key');
const { useSimulationStore, setIncidentsFetcher } = await import('../src/store/simulationStore');
const s = () => useSimulationStore.getState();

let calls = 0;
let lastBbox: BoundingBox | null = null;
setIncidentsFetcher(async (bbox) => {
  calls += 1;
  lastBbox = bbox;
  return parseIncidents(payload);
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

check('AC-708 a key present means the incident surface is offered',
  s().traffic.status === 'idle', s().traffic.status);
/*
  Default policy: a layer is on out of the box when showing it costs nothing per use.
  Congestion rides the map tiles already being fetched, so it is on; TomTom incidents are
  metered against a daily quota, so they are not.
*/
check('AC-743 congestion is on by default, being free to show', s().traffic.isCongestionOn);
check('AC-743 metered incidents are not', !s().traffic.isIncidentsOn);

// Congestion is a pure layer toggle: no key, no request, no network.
s().toggleCongestionOverlay();
check('AC-709 congestion toggles off', !s().traffic.isCongestionOn);
check('AC-709 and spends no request', calls === 0, `${calls} calls`);
s().toggleCongestionOverlay();
check('AC-709 and back on', s().traffic.isCongestionOn);

// Build a real route, so lock and play have something to commit to.
s().setToken('pk.' + 'a'.repeat(60));
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
await settle();
check('the route is built', s().geometry !== null);

s().toggleIncidentsOverlay();
await settle();
check('AC-701 switching the layer on while unlocked spends nothing', calls === 0, `${calls} calls`);
check('AC-701 and shows no incidents yet', s().traffic.incidents.length === 0);

// Panning is free - the whole reason the policy moved off the viewport.
s().setViewport([29, 49, 32, 52], 14);
s().setViewport([29.5, 49.5, 32.5, 52.5], 12);
await settle();
check('AC-719 panning spends nothing', calls === 0, `${calls} calls`);

s().setRouteLocked(true);
await settle();
check('AC-701 locking the route fetches once', calls === 1, `${calls} calls`);
check('AC-701 and the incidents land in the store', s().traffic.incidents.length === 2);
check('AC-713 the fetch covers the route, not the viewport',
  lastBbox !== null && bboxContains(lastBbox, routeBbox(ROUTE_COORDS) as BoundingBox),
  lastBbox ? (lastBbox as BoundingBox).join(',') : 'null');
check('the cache records the route it was fetched for',
  s().traffic.fetchedRouteKey ===
    routeKey(s().geometry?.coordinates, s().geometry?.totalDistanceMeters ?? 0));

// Locking again on the same, unchanged route must not spend a second request.
s().setRouteLocked(false);
s().setRouteLocked(true);
await settle();
check('AC-716 re-locking an unchanged route spends nothing', calls === 1, `${calls} calls`);

// Play locks as a side effect and must take the same path.
s().setRouteLocked(false);
s().togglePlay();
await settle();
check('AC-720 Play locks the route', s().isRouteLocked);
check('AC-716 and spends nothing while the cache is warm', calls === 1, `${calls} calls`);
s().pause();

// Releasing the lock and rebuilding the route invalidates the cache. The stub has to
// hand back different geometry too: adding a stop against a fixed stub would leave the
// route byte-identical, and then there would be nothing for the key to notice.
s().setRouteLocked(false);
stubDirections([...ROUTE_COORDS, [30.51, 50.48]], 2600);
await s().addRoutePoint([30.51, 50.48]);
await settle();
check('AC-714 a rebuilt route does not fetch until it is locked again',
  calls === 1, `${calls} calls`);
s().setRouteLocked(true);
await settle();
check('AC-714 locking a rebuilt route fetches again', calls === 2, `${calls} calls`);

// The manual button.
await s().refreshIncidents(true);
await settle();
check('AC-718 the manual refresh fetches despite a warm cache', calls === 3, `${calls} calls`);

{
  // Toggling the layer off clears it and stops the drive refresh.
  s().toggleIncidentsOverlay();
  check('AC-711 turning incidents off clears them', s().traffic.incidents.length === 0);
  check('AC-711 and drops the cache', s().traffic.fetchedRouteKey === null);
  const before = calls;
  s().setRouteLocked(false);
  s().setRouteLocked(true);
  await settle();
  check('AC-711 locking with the layer off spends nothing', calls === before, `${calls} calls`);

  // Switching it back on mid-drive should not wait for the next lock.
  s().toggleIncidentsOverlay();
  await settle();
  check('AC-721 switching the layer on while locked fetches immediately',
    calls === before + 1, `${calls} calls`);
}

{
  // A failure surfaces and must not poison the cache.
  const { TrafficError } = await import('../src/lib/traffic');
  setIncidentsFetcher(async () => {
    throw new TrafficError('TomTom rejected the API key.');
  });
  await s().refreshIncidents(true);
  await settle();

  check('AC-712 a failure is recorded', s().traffic.status === 'error', s().traffic.status);
  check('AC-712 with the reason kept', s().traffic.error === 'TomTom rejected the API key.');
  check('AC-712 and is surfaced as a toast',
    s().toasts.some((toast) => toast.text === 'TomTom rejected the API key.'));
  check('AC-712 and leaves no cache behind, so the next lock retries',
    s().traffic.fetchedRouteKey === null);
}

{
  // No key at all: the app keeps working, the layer simply never populates.
  setTrafficKey(null);
  const { resolveTrafficKey } = await import('../src/lib/traffic');
  check('AC-715 no key resolves to null', resolveTrafficKey() === null);

  let attempted = 0;
  setIncidentsFetcher(async () => {
    attempted += 1;
    return [];
  });
  s().setRouteLocked(false);
  s().setRouteLocked(true);
  await s().refreshIncidents(true);
  await settle();
  check('AC-715 locking without a key spends nothing and does not throw',
    attempted === 0, `${attempted} calls`);
  check('AC-715 and the route is still locked, so the app is unaffected', s().isRouteLocked);
  setTrafficKey('test-key');
}

report('traffic');
