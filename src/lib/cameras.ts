import type { CoordinateTuple } from '../types/domain';

/**
 * Speed cameras from OpenStreetMap, via Overpass.
 *
 * This is the one hazard layer with real coverage where the app is actually used:
 * TomTom and Mapbox both withdrew live traffic for Ukraine, but OSM's camera nodes are
 * community-mapped and present (28 in central Kyiv at the time of writing).
 *
 * Two things shape every decision here:
 *
 *  - Cameras are static. Unlike incidents they do not expire, so the cache is keyed on
 *    the route alone with no time-based refresh. A route fetched once stays fetched.
 *  - The public Overpass instances are heavily loaded and rate-limit aggressively;
 *    during development they returned HTML error pages as often as JSON. So every
 *    failure here is silent and non-fatal: the layer stays empty, nothing is raised to
 *    the driver, and the next lock tries again. A missing camera layer is a
 *    disappointment, a crashed map is a broken app.
 *
 * The data is ODbL, which is why the source carries an OpenStreetMap attribution.
 */

/** Tried in order; the first that answers with usable JSON wins. */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap</a>';

/** How far off the route a camera can be and still be worth showing. */
export const CAMERA_SEARCH_RADIUS_METERS = 250;

/**
 * Overpass takes the corridor as a literal list of coordinates, so the route has to be
 * thinned or a long drive becomes a request too large to send. 120 points at a 250m
 * radius still covers a continuous corridor for any route this app can build.
 */
export const MAX_OVERPASS_POINTS = 120;

/** Overpass is slow under load; past this it is not going to answer usefully. */
export const OVERPASS_TIMEOUT_MS = 20_000;

export interface SpeedCamera {
  id: string;
  coordinate: CoordinateTuple;
  /** Posted limit in km/h where OSM records one; null is common and not an error. */
  maxspeedKmh: number | null;
  /** `forward`, `backward`, a bearing, or null. Recorded, not yet drawn. */
  direction: string | null;
}

/* ----------------------------- pure ----------------------------- */

/**
 * Evenly thins a route to at most `maxPoints`, always keeping both ends. Even sampling
 * rather than simplification: what matters is that no stretch of the corridor is left
 * unsampled, not that the shape is faithful.
 */
export function sampleRoute(
  coordinates: CoordinateTuple[] | null | undefined,
  maxPoints = MAX_OVERPASS_POINTS,
): CoordinateTuple[] {
  if (!coordinates || coordinates.length === 0) return [];
  const usable = coordinates.filter(
    ([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat),
  );
  if (usable.length <= maxPoints) return usable;

  const out: CoordinateTuple[] = [];
  const stride = (usable.length - 1) / (maxPoints - 1);
  for (let index = 0; index < maxPoints; index += 1) {
    out.push(usable[Math.round(index * stride)]);
  }
  return out;
}

/**
 * Overpass QL. `around` with a coordinate list searches a corridor along the route
 * rather than its bounding box, which for an L-shaped route is a small fraction of the
 * area - and Overpass charges by the work it does.
 *
 * Both tagging conventions are asked for: `highway=speed_camera` is the common one and
 * `enforcement=maxspeed` is used by newer mapping, and Kyiv has a mix.
 */
export function buildOverpassQuery(
  coordinates: CoordinateTuple[],
  radiusMeters = CAMERA_SEARCH_RADIUS_METERS,
): string | null {
  const sampled = sampleRoute(coordinates);
  if (sampled.length === 0) return null;
  // Overpass takes lat,lon; our coordinates are lon,lat.
  const path = sampled.map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(',');
  const around = `around:${Math.round(radiusMeters)},${path}`;
  return (
    `[out:json][timeout:${Math.round(OVERPASS_TIMEOUT_MS / 1000)}];` +
    `(node["highway"="speed_camera"](${around});` +
    `node["enforcement"="maxspeed"](${around}););` +
    'out body;'
  );
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

/**
 * OSM tags are free-form and almost everything is optional, so only the coordinate is
 * required. `maxspeed` is usually "50" but legitimately carries units ("30 mph"), and
 * anything unparseable becomes null rather than a wrong number on screen.
 */
export function parseCameras(payload: unknown): SpeedCamera[] {
  const elements = (payload as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return [];

  const out: SpeedCamera[] = [];
  const seen = new Set<string>();
  for (const raw of elements as OverpassElement[]) {
    const lat = raw?.lat;
    const lon = raw?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const id = `osm-${raw.id ?? `${lat},${lon}`}`;
    // The two tag queries overlap: a node tagged both ways comes back twice.
    if (seen.has(id)) continue;
    seen.add(id);

    out.push({
      id,
      coordinate: [lon, lat],
      maxspeedKmh: parseMaxspeed(raw.tags?.maxspeed),
      direction: raw.tags?.direction ?? null,
    });
  }
  return out;
}

export function parseMaxspeed(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)\s*(mph)?$/i.exec(value.trim());
  if (!match) return null;
  const magnitude = Number.parseFloat(match[1]);
  if (!Number.isFinite(magnitude) || magnitude <= 0) return null;
  return match[2] ? Math.round(magnitude * 1.609344) : magnitude;
}

export function camerasToGeoJSON(cameras: SpeedCamera[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: cameras.map((camera) => ({
      type: 'Feature',
      id: camera.id,
      geometry: { type: 'Point', coordinates: camera.coordinate },
      properties: {
        id: camera.id,
        // Rendered as the label, so the empty string is what "unknown" has to look like.
        maxspeed: camera.maxspeedKmh === null ? '' : String(camera.maxspeedKmh),
      },
    })),
  };
}

/**
 * Cameras do not move or expire, so only a changed route invalidates the cache. There
 * is deliberately no time-based refresh: re-asking Overpass every half hour for a set of
 * fixed posts would spend its goodwill for nothing.
 */
export function shouldFetchCameras(input: {
  enabled: boolean;
  routeKey: string | null;
  cachedRouteKey: string | null;
  force?: boolean;
}): boolean {
  const { enabled, routeKey, cachedRouteKey, force = false } = input;
  if (!enabled || !routeKey) return false;
  if (force) return true;
  return routeKey !== cachedRouteKey;
}

/* ----------------------------- the request ----------------------------- */

/**
 * Walks the mirrors until one answers with JSON. Overpass signals overload with an HTML
 * error page carrying HTTP 200, so a successful status is not enough to go on - the body
 * has to parse and carry `elements`.
 *
 * Never throws for a data or transport problem: an empty list is the failure mode.
 */
export async function fetchSpeedCameras(
  coordinates: CoordinateTuple[],
  signal?: AbortSignal,
  endpoints: string[] = OVERPASS_ENDPOINTS,
): Promise<SpeedCamera[]> {
  const query = buildOverpassQuery(coordinates);
  if (!query) return [];

  for (const endpoint of endpoints) {
    if (signal?.aborted) return [];
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal,
      });
      if (!response.ok) continue;
      const text = await response.text();
      // An overloaded Overpass returns an HTML error page under a 200.
      if (!text.trimStart().startsWith('{')) continue;
      const payload = JSON.parse(text) as { elements?: unknown };
      if (!Array.isArray(payload.elements)) continue;
      return parseCameras(payload);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      // Try the next mirror. A dead endpoint is expected, not exceptional.
    }
  }
  return [];
}
