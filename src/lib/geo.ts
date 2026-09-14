import { along, bearing, length, lineString, simplify } from '@turf/turf';
import type { Feature, LineString } from 'geojson';
import type { CoordinateTuple } from '../types/domain';

/** Above this vertex count the geometry is downsampled to protect mobile GPU frame rates. */
const SIMPLIFY_VERTEX_THRESHOLD = 1500;
/** Roughly 1.1 metres at the equator: invisible on screen, cheap for the renderer. */
const SIMPLIFY_TOLERANCE_DEGREES = 0.00001;
/** Look-ahead used to derive a stable heading instead of a jittery per-vertex bearing. */
const BEARING_LOOKAHEAD_METERS = 8;

export interface RouteGeometry {
  line: Feature<LineString>;
  coordinates: CoordinateTuple[];
  totalDistanceMeters: number;
}

/**
 * Builds the simulation geometry from raw route coordinates, downsampling large
 * coordinate arrays (FR performance safeguard) before measuring total length.
 */
export function buildRouteGeometry(coordinates: CoordinateTuple[]): RouteGeometry {
  if (coordinates.length < 2) {
    throw new Error('A route needs at least two coordinates.');
  }

  let line = lineString(coordinates);
  if (coordinates.length > SIMPLIFY_VERTEX_THRESHOLD) {
    line = simplify(line, { tolerance: SIMPLIFY_TOLERANCE_DEGREES, highQuality: false });
  }

  const simplified = line.geometry.coordinates as CoordinateTuple[];
  return {
    line,
    coordinates: simplified,
    totalDistanceMeters: length(line, { units: 'meters' }),
  };
}

export function coordinateAtDistance(
  geometry: RouteGeometry,
  distanceMeters: number,
): CoordinateTuple {
  const clamped = clampDistance(geometry, distanceMeters);
  const point = along(geometry.line, clamped, { units: 'meters' });
  return point.geometry.coordinates as CoordinateTuple;
}

/**
 * Heading at a distance offset, measured against a point slightly further along the
 * route so the map rotation stays smooth between closely spaced vertices.
 */
export function bearingAtDistance(geometry: RouteGeometry, distanceMeters: number): number {
  const total = geometry.totalDistanceMeters;
  const clamped = clampDistance(geometry, distanceMeters);
  const from = Math.min(clamped, Math.max(0, total - BEARING_LOOKAHEAD_METERS));
  const to = Math.min(total, from + BEARING_LOOKAHEAD_METERS);
  if (to - from < 1e-6) return 0;

  const start = coordinateAtDistance(geometry, from);
  const end = coordinateAtDistance(geometry, to);
  return normalizeBearing(bearing(start, end));
}

export function clampDistance(geometry: RouteGeometry, distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters)) return 0;
  return Math.min(Math.max(distanceMeters, 0), geometry.totalDistanceMeters);
}

export function normalizeBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** Shortest signed angular delta from `from` to `to`, in the range (-180, 180]. */
export function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

export function lerpBearing(from: number, to: number, factor: number): number {
  return normalizeBearing(from + shortestAngleDelta(from, to) * factor);
}
