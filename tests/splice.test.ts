import { check, report } from './harness';
import { buildRouteGeometry } from '../src/lib/geo';
import {
  collapseNeighbours,
  MAX_STROKE_SAMPLES,
  MIN_WAYPOINT_SEPARATION_METERS,
  planSplice,
  planStrokeRoute,
  sampleStroke,
  strokeLengthMeters,
  TOO_MANY_STOPS_MESSAGE,
} from '../src/lib/splice';
import { MAX_ROUTE_POINTS } from '../src/lib/directions';
import type { CoordinateTuple } from '../src/types/domain';

// A straight 2 km north-bound route: easy to reason about distances along it.
const ROUTE: CoordinateTuple[] = [[30.5, 50.45], [30.5, 50.459], [30.5, 50.468]];
const geometry = buildRouteGeometry(ROUTE);
const TOTAL = geometry.totalDistanceMeters;

const metres = (a: CoordinateTuple, b: CoordinateTuple) =>
  strokeLengthMeters([a, b]);

// ---------- turf contract: `location` really is in metres ----------
{
  const midpoint: CoordinateTuple = [30.5, 50.4585];
  const bulge: CoordinateTuple[] = [[30.503, 50.4585]];
  const out = planSplice(geometry, [ROUTE[0], ROUTE[2]], [[30.5, 50.4535], ...bulge, [30.5, 50.4635]]);
  check('splice succeeds on a simple route', out.ok, out.ok ? '' : out.reason);
  check('projection maths stay on the route line',
    out.ok && out.waypoints.every((w) => Math.abs(w[0] - 30.5) < 0.01),
    out.ok ? `${out.waypoints.length} stops` : '-');
  void midpoint;
}

// ---------- AC-406: downsampling ----------
{
  const dense: CoordinateTuple[] = Array.from({ length: 300 }, (_, i) => [
    30.5 + i * 0.00002,
    50.4585 + i * 0.000005,
  ]);
  check('AC-406 a 300-point stroke samples to the budget',
    sampleStroke(dense, MAX_STROKE_SAMPLES).length === MAX_STROKE_SAMPLES,
    `${sampleStroke(dense, MAX_STROKE_SAMPLES).length}`);

  const out = planSplice(geometry, [ROUTE[0], ROUTE[2]], dense);
  check('AC-406 spliced route stays within the coordinate ceiling',
    out.ok && out.waypoints.length <= MAX_ROUTE_POINTS,
    out.ok ? `${out.waypoints.length} <= ${MAX_ROUTE_POINTS}` : out.reason);

  // Samples are spread along the stroke, not bunched at one end.
  const samples = sampleStroke(dense, 4);
  const gaps = samples.slice(1).map((p, i) => metres(samples[i], p));
  const spread = Math.max(...gaps) / Math.min(...gaps);
  check('AC-406 samples are evenly spaced', spread < 1.2, `max/min gap = ${spread.toFixed(3)}`);
  check('sampling a degenerate stroke yields nothing', sampleStroke([[30.5, 50.45]], 4).length === 0);
  check('zero budget yields no samples', sampleStroke(dense, 0).length === 0);
}

// ---------- AC-403: ends stay pinned ----------
{
  const stroke: CoordinateTuple[] = [
    [30.5005, 50.4535], [30.504, 50.4570], [30.504, 50.4600], [30.5005, 50.4635],
  ];
  const out = planSplice(geometry, [ROUTE[0], ROUTE[2]], stroke);
  check('AC-403 splice succeeds', out.ok, out.ok ? '' : out.reason);
  if (out.ok) {
    check('AC-403 start is unchanged', metres(out.waypoints[0], ROUTE[0]) < 10,
      `${metres(out.waypoints[0], ROUTE[0]).toFixed(2)} m`);
    check('AC-403 end is unchanged',
      metres(out.waypoints[out.waypoints.length - 1], ROUTE[2]) < 10,
      `${metres(out.waypoints[out.waypoints.length - 1], ROUTE[2]).toFixed(2)} m`);
    check('AC-403 the stroke bulge is represented',
      out.waypoints.some((w) => w[0] > 30.502), out.waypoints.map((w) => w[0].toFixed(4)).join(' '));
  }
}

// ---------- AC-404: direction independence ----------
{
  const forward: CoordinateTuple[] = [
    [30.5005, 50.4535], [30.504, 50.4570], [30.504, 50.4600], [30.5005, 50.4635],
  ];
  const backward = [...forward].reverse();
  const a = planSplice(geometry, [ROUTE[0], ROUTE[2]], forward);
  const b = planSplice(geometry, [ROUTE[0], ROUTE[2]], backward);
  check('AC-404 both directions splice', a.ok && b.ok);
  if (a.ok && b.ok) {
    check('AC-404 same number of stops', a.waypoints.length === b.waypoints.length,
      `${a.waypoints.length} vs ${b.waypoints.length}`);
    const maxDrift = Math.max(...a.waypoints.map((w, i) => metres(w, b.waypoints[i])));
    check('AC-404 a stroke drawn backwards splices identically', maxDrift < 1,
      `max drift ${maxDrift.toFixed(3)} m`);
  }
}

// ---------- vias inside the span are replaced, those outside survive ----------
{
  const before: CoordinateTuple = [30.5, 50.4520];  // ~780 m along
  const inside: CoordinateTuple = [30.5, 50.4585];  // mid-span, should be dropped
  const after: CoordinateTuple = [30.5, 50.4660];   // near the end
  const stroke: CoordinateTuple[] = [
    [30.5005, 50.4550], [30.504, 50.4585], [30.5005, 50.4620],
  ];
  const out = planSplice(geometry, [ROUTE[0], before, inside, after, ROUTE[2]], stroke);
  check('splice with vias succeeds', out.ok, out.ok ? '' : out.reason);
  if (out.ok) {
    check('a via before the span survives',
      out.waypoints.some((w) => metres(w, before) < 15));
    check('a via after the span survives',
      out.waypoints.some((w) => metres(w, after) < 15));
    check('a via inside the span is replaced',
      !out.waypoints.some((w) => metres(w, inside) < 5),
      out.waypoints.map((w) => w[1].toFixed(4)).join(' '));
  }
}

// ---------- AC-405: the 25-coordinate ceiling ----------
{
  // 20 vias packed near the start, with a stroke spanning only the far end so
  // none of them are dropped.
  const vias: CoordinateTuple[] = Array.from({ length: 20 }, (_, i) => [
    30.5, 50.4505 + i * 0.00012,
  ]);
  const stroke: CoordinateTuple[] = [
    [30.5005, 50.4655], [30.502, 50.4662], [30.5005, 50.4670],
  ];
  const out = planSplice(geometry, [ROUTE[0], ...vias, ROUTE[2]], stroke);
  check('AC-405 a 20-via route refuses the splice', !out.ok);
  check('AC-405 refusal names the cause',
    !out.ok && out.reason === TOO_MANY_STOPS_MESSAGE, out.ok ? '-' : out.reason);

  // A smaller route still splices, proving the refusal is about the budget.
  const few: CoordinateTuple[] = Array.from({ length: 3 }, (_, i) => [30.5, 50.4505 + i * 0.0004]);
  const ok = planSplice(geometry, [ROUTE[0], ...few, ROUTE[2]], stroke);
  check('AC-405 a modest route still splices', ok.ok, ok.ok ? `${ok.waypoints.length} stops` : ok.reason);
  check('AC-405 result respects the ceiling',
    ok.ok && ok.waypoints.length <= MAX_ROUTE_POINTS, ok.ok ? `${ok.waypoints.length}` : '-');
}

// ---------- AC-402: a stroke on an empty map ----------
{
  const stroke: CoordinateTuple[] = [
    [30.50, 50.450], [30.505, 50.454], [30.512, 50.458], [30.52, 50.462],
  ];
  const out = planStrokeRoute(stroke);
  check('AC-402 a stroke builds a route', out.ok, out.ok ? '' : out.reason);
  if (out.ok) {
    check('AC-402 route starts at the stroke start',
      metres(out.waypoints[0], stroke[0]) < 1, `${metres(out.waypoints[0], stroke[0]).toFixed(2)} m`);
    check('AC-402 route ends at the stroke end',
      metres(out.waypoints[out.waypoints.length - 1], stroke[3]) < 1);
    check('AC-402 route stays within the ceiling', out.waypoints.length <= MAX_ROUTE_POINTS,
      `${out.waypoints.length}`);
  }
  check('a single point cannot build a route', !planStrokeRoute([[30.5, 50.45]]).ok);
  check('repeated points cannot build a route',
    !planStrokeRoute([[30.5, 50.45], [30.5, 50.45]]).ok);
}

// ---------- neighbour collapsing ----------
{
  const a: CoordinateTuple = [30.5, 50.45];
  const nearA: CoordinateTuple = [30.500005, 50.45]; // well under 10 m
  const b: CoordinateTuple = [30.51, 50.46];
  const collapsed = collapseNeighbours([a, nearA, b]);
  check('near-coincident stops collapse', collapsed.length === 2, `${collapsed.length}`);
  check('the first stop is always kept', metres(collapsed[0], a) < 0.1);
  check('the last stop is always kept', metres(collapsed[collapsed.length - 1], b) < 0.1);

  const crowdedEnd = collapseNeighbours([a, b, [30.510005, 50.46] as CoordinateTuple]);
  check('a stop crowding the end is dropped, not the end', crowdedEnd.length === 2
    && metres(crowdedEnd[1], [30.510005, 50.46]) < 0.1, `${crowdedEnd.length}`);
  check('two stops are never collapsed', collapseNeighbours([a, nearA]).length === 2);
  check('separation threshold is documented', MIN_WAYPOINT_SEPARATION_METERS === 10);
}

// ---------- guards ----------
check('a route with one stop cannot be spliced',
  !planSplice(geometry, [ROUTE[0]], [[30.5, 50.45], [30.51, 50.46]]).ok);
check('a one-point stroke cannot splice',
  !planSplice(geometry, [ROUTE[0], ROUTE[2]], [[30.5, 50.45]]).ok);
check('stroke length is measured in metres', Math.abs(strokeLengthMeters(ROUTE) - TOTAL) < 5,
  `${strokeLengthMeters(ROUTE).toFixed(0)} vs ${TOTAL.toFixed(0)}`);

report('splice');
