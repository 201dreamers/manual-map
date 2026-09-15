import { check, report } from './harness';
import { DirectionsError, fetchDrivingRoute, NO_ROUTE_MESSAGE } from '../src/lib/directions';
import { buildRouteGeometry, bearingAtDistance, coordinateAtDistance } from '../src/lib/geo';
import type { CoordinateTuple } from '../src/types/domain';

const TOKEN = process.env.MB_TOKEN!;

// Real road route through Kyiv.
const route = await fetchDrivingRoute(
  [[30.5234, 50.4501], [30.5634, 50.4701]] as CoordinateTuple[],
  TOKEN,
);
check('live route returned', route.coordinates.length > 2, `${route.coordinates.length} vertices`);
check('live distance plausible', route.distanceMeters > 1000, `${Math.round(route.distanceMeters)} m`);

const geom = buildRouteGeometry(route.coordinates);
check('turf length matches Mapbox distance within 1%',
  Math.abs(geom.totalDistanceMeters - route.distanceMeters) / route.distanceMeters < 0.01,
  `turf=${Math.round(geom.totalDistanceMeters)} mapbox=${Math.round(route.distanceMeters)}`);

// Walk the whole route in 500 m steps the way the UI does.
let bad = 0, lastD = -1;
for (let d = 0; d <= geom.totalDistanceMeters; d += 500) {
  const c = coordinateAtDistance(geom, d);
  const b = bearingAtDistance(geom, d);
  if (!Number.isFinite(c[0]) || !Number.isFinite(c[1]) || !Number.isFinite(b)) bad++;
  if (d <= lastD) bad++;
  lastD = d;
}
check('every 500 m step yields finite coord + bearing', bad === 0, `${Math.ceil(geom.totalDistanceMeters/500)} steps`);

// A 3-waypoint route, as produced by extra map taps.
const multi = await fetchDrivingRoute(
  [[30.5234, 50.4501], [30.5434, 50.4601], [30.5634, 50.4701]] as CoordinateTuple[],
  TOKEN,
);
check('waypoint route returned', multi.coordinates.length > 2, `${Math.round(multi.distanceMeters)} m`);

// FR-1.3 against the live API.
try {
  await fetchDrivingRoute([[-30, 40], [-25, 38]] as CoordinateTuple[], TOKEN);
  check('FR-1.3 no-route rejected', false, 'no error thrown');
} catch (e) {
  check('FR-1.3 no-route rejected with spec message',
    e instanceof DirectionsError && e.message === NO_ROUTE_MESSAGE, (e as Error).message);
}

// Bad token must surface a settings hint, not a generic failure.
try {
  await fetchDrivingRoute([[30.5234, 50.4501], [30.5634, 50.4701]] as CoordinateTuple[], 'pk.invalid');
  check('bad token rejected', false, 'no error thrown');
} catch (e) {
  check('bad token surfaces settings hint',
    e instanceof DirectionsError && /token/i.test(e.message), (e as Error).message);
}


// ---------- AC-305: viewport-biased relevance ----------
const { searchPlaces } = await import('../src/lib/geocoding');

const KYIV_VIEWPORT: [number, number, number, number] = [30.2, 50.2, 30.9, 50.6];

const local = await searchPlaces('Khreshchatyk 1', TOKEN, { viewport: KYIV_VIEWPORT });
const topThree = local.slice(0, 3).map((r) => r.address);
check('AC-305 viewport search returns results', local.length > 0, `${local.length}`);
check('AC-305 a Kyiv match ranks in the top 3',
  topThree.some((address) => /Kyiv|Київ/i.test(address)),
  topThree.join(' | ').slice(0, 90));

// [revised] Reach is regional, not global: the second tier is an expanded bbox
// because an unbiased query returns worldwide noise (Tennessee for a Kyiv airport).
const faraway = await searchPlaces('Boryspil International Airport', TOKEN, {
  viewport: KYIV_VIEWPORT,
});
check('AC-305 off-viewport regional places are findable', faraway.length > 0,
  faraway[0]?.address.slice(0, 60) ?? 'none');
check('AC-305 regional result is in the right region',
  faraway.slice(0, 3).some((r) => /Ukraine|Україн/i.test(r.address)),
  faraway.slice(0, 3).map((r) => r.address).join(' | ').slice(0, 90));

// Results must be usable as route inputs.
check('AC-305 every result carries a usable coordinate',
  local.every((r) => Number.isFinite(r.coordinate[0]) && Number.isFinite(r.coordinate[1])));
check('AC-305 results are deduped', new Set(local.map((r) => r.id)).size === local.length);

// A searched coordinate must actually route.
const searched = await fetchDrivingRoute(
  [local[0].coordinate, faraway[0].coordinate] as CoordinateTuple[],
  TOKEN,
);
check('AC-305 searched points produce a drivable route', searched.coordinates.length > 2,
  `${Math.round(searched.distanceMeters)} m`);


// ---------- AC-402 / AC-403 against real road geometry ----------
const { planSplice, planStrokeRoute, metersBetween } = await import('../src/lib/splice');

// A stroke drawn roughly along Kyiv streets builds a drivable route (AC-402).
const drawn: CoordinateTuple[] = [
  [30.5234, 50.4501], [30.5300, 50.4530], [30.5380, 50.4560], [30.5450, 50.4600],
];
const planned = planStrokeRoute(drawn);
check('AC-402 stroke plans a waypoint list', planned.ok, planned.ok ? '' : planned.reason);
if (planned.ok) {
  const built = await fetchDrivingRoute(planned.waypoints, TOKEN);
  check('AC-402 a drawn stroke yields a real drivable route', built.coordinates.length > 2,
    `${Math.round(built.distanceMeters)} m`);
}

// Splicing a real route keeps its ends and changes the middle (AC-403).
const base = await fetchDrivingRoute(
  [[30.5234, 50.4501], [30.5634, 50.4701]] as CoordinateTuple[], TOKEN);
const baseGeometry = buildRouteGeometry(base.coordinates);
const baseEnds: CoordinateTuple[] = [base.coordinates[0], base.coordinates[base.coordinates.length - 1]];

// Draw a detour bulging north of the existing corridor.
const detour: CoordinateTuple[] = [
  [30.5330, 50.4560], [30.5380, 50.4640], [30.5470, 50.4660], [30.5520, 50.4640],
];
const spliced = planSplice(baseGeometry, baseEnds, detour);
check('AC-403 splice plans against real geometry', spliced.ok, spliced.ok ? '' : spliced.reason);

if (spliced.ok) {
  check('AC-403 start stays pinned',
    metersBetween(spliced.waypoints[0], baseEnds[0]) < 10,
    `${metersBetween(spliced.waypoints[0], baseEnds[0]).toFixed(1)} m`);
  check('AC-403 end stays pinned',
    metersBetween(spliced.waypoints[spliced.waypoints.length - 1], baseEnds[1]) < 10);

  const rerouted = await fetchDrivingRoute(spliced.waypoints, TOKEN);
  check('AC-403 the spliced route is drivable', rerouted.coordinates.length > 2,
    `${Math.round(rerouted.distanceMeters)} m`);
  check('AC-403 the geometry actually changed',
    Math.abs(rerouted.distanceMeters - base.distanceMeters) > 100,
    `${Math.round(base.distanceMeters)} -> ${Math.round(rerouted.distanceMeters)} m`);

  const reroutedEnds = [rerouted.coordinates[0], rerouted.coordinates[rerouted.coordinates.length - 1]];
  check('AC-403 real road ends are unchanged after routing',
    metersBetween(reroutedEnds[0] as CoordinateTuple, baseEnds[0]) < 30
    && metersBetween(reroutedEnds[1] as CoordinateTuple, baseEnds[1]) < 30);
}

report('live');
