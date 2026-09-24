import { AppError } from './errors';
import type { BoundingBox } from './geocoding';
import type { CoordinateTuple } from '../types/domain';

const INCIDENTS_ENDPOINT = 'https://api.tomtom.com/traffic/services/5/incidentDetails';

export class TrafficError extends AppError {}

/**
 * Incidents are fetched for the route, not for the viewport, and only when the driver
 * commits to driving it - the lock, or Play, which locks as a side effect. Panning
 * around while planning is free, which is what keeps a day of use inside the free
 * tier's 2500 calls: a drive costs one request, plus one per half hour on the road.
 */
export const INCIDENT_REFRESH_MS = 30 * 60_000;

/**
 * The fetched box is padded around the route so an incident just off the corridor - the
 * queue reaching back from a junction the route passes through - is still returned.
 */
export const INCIDENT_BBOX_PADDING = 0.15;

/**
 * TomTom's `iconCategory` enum. Mapped to our own labels rather than used raw, because
 * the numbers are an API detail and the overlay legend is user-facing text.
 */
export const INCIDENT_CATEGORIES: Record<number, string> = {
  0: 'Unknown',
  1: 'Accident',
  2: 'Fog',
  3: 'Dangerous conditions',
  4: 'Rain',
  5: 'Ice',
  6: 'Jam',
  7: 'Lane closed',
  8: 'Road closed',
  9: 'Road works',
  10: 'Wind',
  11: 'Flooding',
  14: 'Broken down vehicle',
};

/**
 * Colour per category, grouped by what a driver has to do about it rather than by the
 * API's own grouping: red means the road is blocked or someone has crashed, amber means
 * it is slow or being worked on, sky means a weather advisory.
 */
export const INCIDENT_COLORS: Record<string, string> = {
  blocking: '#ef4444',
  slow: '#f59e0b',
  weather: '#38bdf8',
  other: '#94a3b8',
};

const BLOCKING = new Set([1, 7, 8, 14]);
const SLOW = new Set([6, 9]);
const WEATHER = new Set([2, 3, 4, 5, 10, 11]);

export function incidentGroup(iconCategory: number): keyof typeof INCIDENT_COLORS {
  if (BLOCKING.has(iconCategory)) return 'blocking';
  if (SLOW.has(iconCategory)) return 'slow';
  if (WEATHER.has(iconCategory)) return 'weather';
  return 'other';
}

export interface TrafficIncident {
  id: string;
  iconCategory: number;
  category: string;
  group: string;
  description: string | null;
  /** Seconds lost against free-flow, when TomTom reports it. */
  delaySeconds: number | null;
  /** 0 unknown, 1 minor, 2 moderate, 3 major, 4 undefined (often a closure). */
  magnitude: number;
  /** Full incident geometry; a point incident collapses to a single coordinate. */
  coordinates: CoordinateTuple[];
  /** One representative coordinate, used to place the symbol. */
  point: CoordinateTuple;
}

/* ----------------------------- pure geometry ----------------------------- */

/**
 * Grows a box by a fraction of its own span on each side, with a floor so that a short
 * route - or one running due north, whose box has no width at all - still asks for an
 * area rather than a line.
 */
export const MIN_BBOX_SPAN_DEGREES = 0.02;

export function padBbox(bbox: BoundingBox, fraction: number): BoundingBox {
  const [west, south, east, north] = bbox;
  const padX = Math.max((east - west) * fraction, MIN_BBOX_SPAN_DEGREES);
  const padY = Math.max((north - south) * fraction, MIN_BBOX_SPAN_DEGREES);
  return [west - padX, Math.max(-90, south - padY), east + padX, Math.min(90, north + padY)];
}

/** Bounding box of a route's geometry, or null when there is no usable route. */
export function routeBbox(coordinates: CoordinateTuple[] | null | undefined): BoundingBox | null {
  if (!coordinates || coordinates.length === 0) return null;
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const [lng, lat] of coordinates) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  if (!Number.isFinite(west) || !Number.isFinite(south)) return null;
  return [west, south, east, north];
}

/** True when `inner` lies entirely inside `outer`. */
export function bboxContains(outer: BoundingBox, inner: BoundingBox): boolean {
  return (
    outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
  );
}

/**
 * Identifies the geometry a cached fetch belongs to. Derived from the shape rather than
 * from a route id, because rebuilding a route by dragging a stop produces new geometry
 * that the same id would hide - and stale incidents on a changed route are worse than
 * none, since they are pinned to roads the driver is no longer taking.
 */
export function routeKey(
  coordinates: CoordinateTuple[] | null | undefined,
  totalDistanceMeters: number,
): string | null {
  if (!coordinates || coordinates.length < 2) return null;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return [
    coordinates.length,
    totalDistanceMeters.toFixed(1),
    first[0].toFixed(5),
    first[1].toFixed(5),
    last[0].toFixed(5),
    last[1].toFixed(5),
  ].join(':');
}

export interface IncidentCache {
  routeKey: string | null;
  fetchedAt: number | null;
}

/**
 * The whole cost control in one predicate, so the rule can be tested without a network,
 * a map or a clock. Panning is absent from it by design: only committing to a route,
 * changing that route, the half-hour refresh, or asking by hand will spend a request.
 */
export function shouldFetchIncidents(input: {
  enabled: boolean;
  hasKey: boolean;
  routeKey: string | null;
  cache: IncidentCache;
  now: number;
  force?: boolean;
}): boolean {
  const { enabled, hasKey, routeKey: key, cache, now, force = false } = input;
  // No key is a no-op, never an error: the rest of the app runs untouched without one.
  if (!hasKey || !enabled || !key) return false;
  if (force) return true;
  if (cache.routeKey === null || cache.fetchedAt === null) return true;
  // A rebuilt route invalidates the cache outright, however recent it is.
  if (cache.routeKey !== key) return true;
  return now - cache.fetchedAt >= INCIDENT_REFRESH_MS;
}

/* ------------------------------ parsing ------------------------------ */

interface TomTomGeometry {
  type?: string;
  coordinates?: unknown;
}

interface TomTomIncident {
  geometry?: TomTomGeometry;
  properties?: {
    id?: string;
    iconCategory?: number;
    magnitudeOfDelay?: number;
    delay?: number;
    events?: Array<{ description?: string }>;
  };
}

function isCoordinate(value: unknown): value is CoordinateTuple {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

/**
 * Flattens Point / LineString / MultiLineString into a coordinate list. TomTom returns
 * whichever fits the incident, and the overlay draws all three the same way.
 */
function readCoordinates(geometry: TomTomGeometry | undefined): CoordinateTuple[] {
  const raw = geometry?.coordinates;
  if (!Array.isArray(raw)) return [];
  if (isCoordinate(raw)) return [[raw[0], raw[1]]];
  const out: CoordinateTuple[] = [];
  for (const entry of raw) {
    if (isCoordinate(entry)) {
      out.push([entry[0], entry[1]]);
    } else if (Array.isArray(entry)) {
      for (const nested of entry) {
        if (isCoordinate(nested)) out.push([nested[0], nested[1]]);
      }
    }
  }
  return out;
}

/**
 * Tolerant by design: a malformed incident is dropped rather than failing the batch.
 * One bad record in a hundred must not blank the whole overlay.
 */
export function parseIncidents(payload: unknown): TrafficIncident[] {
  const incidents = (payload as { incidents?: unknown } | null)?.incidents;
  if (!Array.isArray(incidents)) return [];

  const out: TrafficIncident[] = [];
  for (let index = 0; index < incidents.length; index += 1) {
    const incident = incidents[index] as TomTomIncident;
    const coordinates = readCoordinates(incident?.geometry);
    if (coordinates.length === 0) continue;

    const properties = incident.properties ?? {};
    const iconCategory =
      typeof properties.iconCategory === 'number' ? properties.iconCategory : 0;
    const description = properties.events?.find((event) => event?.description)?.description;

    out.push({
      id: typeof properties.id === 'string' && properties.id ? properties.id : `incident-${index}`,
      iconCategory,
      category: INCIDENT_CATEGORIES[iconCategory] ?? INCIDENT_CATEGORIES[0],
      group: incidentGroup(iconCategory),
      description: description ?? null,
      delaySeconds: typeof properties.delay === 'number' ? properties.delay : null,
      magnitude: typeof properties.magnitudeOfDelay === 'number' ? properties.magnitudeOfDelay : 0,
      coordinates,
      // Midpoint of the geometry, so a long closure gets its symbol on the closure and
      // not at whichever end the encoder happened to start from.
      point: coordinates[Math.floor(coordinates.length / 2)],
    });
  }
  return out;
}

/** Two layers read this: a line for the geometry and a circle for the symbol. */
export function incidentsToGeoJSON(incidents: TrafficIncident[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: incidents.map((incident) => ({
      type: 'Feature',
      id: incident.id,
      geometry:
        incident.coordinates.length > 1
          ? { type: 'LineString', coordinates: incident.coordinates }
          : { type: 'Point', coordinates: incident.coordinates[0] },
      properties: {
        id: incident.id,
        category: incident.category,
        group: incident.group,
        description: incident.description,
        delaySeconds: incident.delaySeconds,
        magnitude: incident.magnitude,
      },
    })),
  };
}

export function incidentPointsToGeoJSON(
  incidents: TrafficIncident[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: incidents.map((incident) => ({
      type: 'Feature',
      id: incident.id,
      geometry: { type: 'Point', coordinates: incident.point },
      properties: {
        id: incident.id,
        category: incident.category,
        group: incident.group,
        description: incident.description,
      },
    })),
  };
}

/* ------------------------------ the request ------------------------------ */

/**
 * The `fields` selector is mandatory on v5 and doubles as the cost control: asking for
 * only what the overlay draws keeps the response small over a phone connection.
 */
const INCIDENT_FIELDS =
  '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,delay,events{description}}}}';

export function buildIncidentsUrl(bbox: BoundingBox, key: string): string {
  const query = new URLSearchParams({
    key,
    // TomTom takes minLon,minLat,maxLon,maxLat - the same order as our BoundingBox.
    bbox: bbox.map((value) => value.toFixed(6)).join(','),
    fields: INCIDENT_FIELDS,
    language: 'en-GB',
    timeValidityFilter: 'present',
  });
  return `${INCIDENTS_ENDPOINT}?${query.toString()}`;
}

/**
 * Resolves the TomTom key. Client-side only, so it is inlined into the bundle exactly
 * like the Mapbox token: it must be a key restricted by referrer in the TomTom console,
 * never an unrestricted one.
 */
let keyOverride: string | null = null;

/**
 * Test seam, matching `setIncidentsFetcher` and the OBD and location factories. The
 * headless suites build with `envDir: 'tests'`, which has no .env by design, so there is
 * otherwise no way to exercise the key-present branch. Production never calls this.
 */
export function setTrafficKey(key: string | null): void {
  keyOverride = key;
}

export function resolveTrafficKey(): string | null {
  if (keyOverride !== null) return keyOverride;
  const key = import.meta.env.VITE_TOMTOM_API_KEY;
  return typeof key === 'string' && key.trim() ? key.trim() : null;
}

export async function fetchTrafficIncidents(
  bbox: BoundingBox,
  key: string,
  signal?: AbortSignal,
): Promise<TrafficIncident[]> {
  let response: Response;
  try {
    response = await fetch(buildIncidentsUrl(bbox, key), { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new TrafficError('Network error while contacting the TomTom Traffic API.');
  }

  if (response.status === 400) {
    throw new TrafficError('TomTom rejected the map area.');
  }
  if (response.status === 403) {
    throw new TrafficError('TomTom rejected the API key.');
  }
  if (response.status === 429) {
    throw new TrafficError('TomTom rate limit reached. Traffic will refresh shortly.');
  }
  if (!response.ok) {
    throw new TrafficError('The TomTom Traffic API request failed.');
  }

  const payload = await response.json().catch(() => null);
  if (!payload) throw new TrafficError('The TomTom Traffic API returned an unreadable response.');

  return parseIncidents(payload);
}
