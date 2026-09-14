import { along, length, lineString, nearestPointOnLine, simplify } from '@turf/turf';
import type { Feature, LineString } from 'geojson';
import { MAX_ROUTE_POINTS } from './directions';
import type { RouteGeometry } from './geo';
import type { CoordinateTuple } from '../types/domain';

/** How many drawn points are handed to the Directions API to shape the route. */
export const MAX_STROKE_SAMPLES = 6;
/** Below this a stroke cannot meaningfully reshape anything, so the splice is refused. */
export const MIN_STROKE_SAMPLES = 2;
/** Consecutive waypoints closer than this collapse into one. */
export const MIN_WAYPOINT_SEPARATION_METERS = 10;
/** A stroke shorter than this is a tap, not a gesture. */
export const MIN_STROKE_LENGTH_METERS = 25;
/** Roughly 5 m: removes finger jitter without changing the drawn shape. */
const STROKE_SIMPLIFY_TOLERANCE = 0.00005;

export const TOO_MANY_STOPS_MESSAGE =
  'Too many stops to reshape this route. Remove a stop and try again.';

export type SpliceOutcome =
  | { ok: true; waypoints: CoordinateTuple[] }
  | { ok: false; reason: string };

export function metersBetween(a: CoordinateTuple, b: CoordinateTuple): number {
  return length(lineString([a, b]), { units: 'meters' });
}

/** Drops repeated points so turf never sees a zero-length segment. */
function dedupe(coordinates: CoordinateTuple[]): CoordinateTuple[] {
  return coordinates.filter(
    (coordinate, index) =>
      index === 0 ||
      coordinate[0] !== coordinates[index - 1][0] ||
      coordinate[1] !== coordinates[index - 1][1],
  );
}

export function strokeLengthMeters(stroke: CoordinateTuple[]): number {
  const points = dedupe(stroke);
  if (points.length < 2) return 0;
  return length(lineString(points), { units: 'meters' });
}

/** Distance of a coordinate's projection along the route, in meters. */
function alongDistance(line: Feature<LineString>, coordinate: CoordinateTuple): number {
  const snapped = nearestPointOnLine(line, coordinate, { units: 'meters' });
  return snapped.properties.location ?? 0;
}

function projectOnto(
  line: Feature<LineString>,
  coordinate: CoordinateTuple,
): { coordinate: CoordinateTuple; distance: number } {
  const snapped = nearestPointOnLine(line, coordinate, { units: 'meters' });
  return {
    coordinate: snapped.geometry.coordinates as CoordinateTuple,
    distance: snapped.properties.location ?? 0,
  };
}

/**
 * Reduces a hand-drawn stroke to at most `budget` interior points, spaced evenly by
 * distance. The stroke's own ends are excluded: the caller pins those separately.
 */
export function sampleStroke(stroke: CoordinateTuple[], budget: number): CoordinateTuple[] {
  const points = dedupe(stroke);
  if (points.length < 2 || budget < 1) return [];

  const simplified = simplify(lineString(points), {
    tolerance: STROKE_SIMPLIFY_TOLERANCE,
    highQuality: false,
  });
  const totalMeters = length(simplified, { units: 'meters' });
  if (totalMeters <= 0) return [];

  const samples: CoordinateTuple[] = [];
  for (let i = 1; i <= budget; i++) {
    const offset = (totalMeters * i) / (budget + 1);
    samples.push(along(simplified, offset, { units: 'meters' }).geometry.coordinates as CoordinateTuple);
  }
  return samples;
}

/** Collapses near-coincident neighbours while always keeping the first and last stop. */
export function collapseNeighbours(waypoints: CoordinateTuple[]): CoordinateTuple[] {
  if (waypoints.length <= 2) return waypoints;

  const kept: CoordinateTuple[] = [waypoints[0]];
  for (let i = 1; i < waypoints.length - 1; i++) {
    if (metersBetween(kept[kept.length - 1], waypoints[i]) >= MIN_WAYPOINT_SEPARATION_METERS) {
      kept.push(waypoints[i]);
    }
  }

  const last = waypoints[waypoints.length - 1];
  // The end is never dropped; if it crowds its predecessor, that predecessor goes.
  if (
    kept.length > 1 &&
    metersBetween(kept[kept.length - 1], last) < MIN_WAYPOINT_SEPARATION_METERS
  ) {
    kept.pop();
  }
  kept.push(last);
  return kept;
}

/**
 * Turns a stroke drawn on an empty map into a waypoint list for the Directions API.
 */
export function planStrokeRoute(stroke: CoordinateTuple[]): SpliceOutcome {
  const points = dedupe(stroke);
  if (points.length < 2) return { ok: false, reason: 'Draw a longer line to build a route.' };

  const start = points[0];
  const end = points[points.length - 1];
  const samples = sampleStroke(points, MAX_STROKE_SAMPLES);

  return { ok: true, waypoints: collapseNeighbours([start, ...samples, end]) };
}

/**
 * D-1: replaces only the span of the route the stroke covers, leaving the original
 * start and destination pinned.
 */
export function planSplice(
  geometry: RouteGeometry,
  waypoints: CoordinateTuple[],
  stroke: CoordinateTuple[],
): SpliceOutcome {
  if (waypoints.length < 2) return { ok: false, reason: 'The route needs a start and an end.' };

  const points = dedupe(stroke);
  if (points.length < 2) return { ok: false, reason: 'Draw a longer line to reshape the route.' };

  const line = geometry.line;
  let entry = projectOnto(line, points[0]);
  let exit = projectOnto(line, points[points.length - 1]);
  let ordered = points;

  // Drawn against the direction of travel: flip so entry always precedes exit.
  if (entry.distance > exit.distance) {
    ordered = [...points].reverse();
    [entry, exit] = [exit, entry];
  }

  const start = waypoints[0];
  const end = waypoints[waypoints.length - 1];
  const vias = waypoints.slice(1, -1);

  const keptBefore = vias.filter((via) => alongDistance(line, via) < entry.distance);
  const keptAfter = vias.filter((via) => alongDistance(line, via) > exit.distance);

  // Budget: everything that must survive, plus the two pins, leaves room for the stroke.
  const reserved = 2 + keptBefore.length + keptAfter.length + 2;
  const budget = Math.min(MAX_ROUTE_POINTS - reserved, MAX_STROKE_SAMPLES);
  if (budget < MIN_STROKE_SAMPLES) return { ok: false, reason: TOO_MANY_STOPS_MESSAGE };

  const samples = sampleStroke(ordered, budget);
  const assembled = collapseNeighbours([
    start,
    ...keptBefore,
    entry.coordinate,
    ...samples,
    exit.coordinate,
    ...keptAfter,
    end,
  ]);

  if (assembled.length > MAX_ROUTE_POINTS) return { ok: false, reason: TOO_MANY_STOPS_MESSAGE };
  return { ok: true, waypoints: assembled };
}
