import type { CoordinateTuple } from '../types/domain';

const GEOCODE_ENDPOINT = 'https://api.mapbox.com/search/geocode/v6/forward';

/** [minLng, minLat, maxLng, maxLat] */
export type BoundingBox = [number, number, number, number];

/** Mapbox caps `limit` at 10. */
const RESULTS_PER_QUERY = 8;
/** Merged local+global list length. */
export const MAX_SEARCH_RESULTS = 8;
/**
 * Above this viewport span the "local" query stops being local and starts
 * returning noise, so the viewport is not used as a bbox at all.
 */
const MAX_LOCAL_SPAN_DEGREES = 2;
/** How far beyond the viewport the second query reaches. */
const REGIONAL_EXPANSION = 8;
/** Ceiling on the expanded box, roughly a large country. */
const MAX_REGIONAL_SPAN_DEGREES = 6;

export class GeocodingError extends Error {}

export interface GeocodeResult {
  id: string;
  /** Short name, used as the stop label. */
  name: string;
  /** Fuller address line for disambiguation in the results list. */
  address: string;
  coordinate: CoordinateTuple;
}

interface GeocodeFeature {
  geometry?: { coordinates?: number[] };
  properties?: {
    mapbox_id?: string;
    name?: string;
    name_preferred?: string;
    place_formatted?: string;
    full_address?: string;
    coordinates?: {
      longitude?: number;
      latitude?: number;
      routable_points?: Array<{ longitude?: number; latitude?: number }>;
    };
  };
}

/**
 * Prefers the feature's routable point: for an address that is the point on the
 * road network, which is what the Directions API should be given.
 */
function resolveCoordinate(feature: GeocodeFeature): CoordinateTuple | null {
  const routable = feature.properties?.coordinates?.routable_points?.[0];
  if (typeof routable?.longitude === 'number' && typeof routable?.latitude === 'number') {
    return [routable.longitude, routable.latitude];
  }

  const coords = feature.properties?.coordinates;
  if (typeof coords?.longitude === 'number' && typeof coords?.latitude === 'number') {
    return [coords.longitude, coords.latitude];
  }

  const geometry = feature.geometry?.coordinates;
  if (Array.isArray(geometry) && typeof geometry[0] === 'number' && typeof geometry[1] === 'number') {
    return [geometry[0], geometry[1]];
  }

  return null;
}

function toResult(feature: GeocodeFeature, index: number): GeocodeResult | null {
  const coordinate = resolveCoordinate(feature);
  if (!coordinate) return null;

  const properties = feature.properties ?? {};
  const name = properties.name_preferred || properties.name || properties.full_address;
  if (!name) return null;

  return {
    id: properties.mapbox_id ?? `${name}-${index}`,
    name,
    address: properties.full_address ?? properties.place_formatted ?? '',
    coordinate,
  };
}

function isUsableBbox(bbox: BoundingBox | undefined): bbox is BoundingBox {
  if (!bbox) return false;
  const [minLng, minLat, maxLng, maxLat] = bbox;
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return false;
  // A viewport crossing the antimeridian cannot be expressed as a single box.
  if (minLng >= maxLng || minLat >= maxLat) return false;
  return maxLng - minLng <= MAX_LOCAL_SPAN_DEGREES && maxLat - minLat <= MAX_LOCAL_SPAN_DEGREES;
}

/**
 * Grows a viewport box around its centre so the second query can reach places
 * just off-screen (a nearby airport, the next town) without going worldwide.
 */
function expandBbox(bbox: BoundingBox): BoundingBox | null {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const centreLng = (minLng + maxLng) / 2;
  const centreLat = (minLat + maxLat) / 2;

  const halfWidth = Math.min(
    ((maxLng - minLng) / 2) * REGIONAL_EXPANSION,
    MAX_REGIONAL_SPAN_DEGREES / 2,
  );
  const halfHeight = Math.min(
    ((maxLat - minLat) / 2) * REGIONAL_EXPANSION,
    MAX_REGIONAL_SPAN_DEGREES / 2,
  );

  const expanded: BoundingBox = [
    Math.max(centreLng - halfWidth, -180),
    Math.max(centreLat - halfHeight, -85),
    Math.min(centreLng + halfWidth, 180),
    Math.min(centreLat + halfHeight, 85),
  ];

  // Nothing gained if the viewport is already at or beyond the regional cap.
  const grew = expanded[2] - expanded[0] > maxLng - minLng + 1e-9;
  return grew ? expanded : null;
}

async function queryOnce(
  query: string,
  accessToken: string,
  bbox: BoundingBox | undefined,
  signal: AbortSignal | undefined,
): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(RESULTS_PER_QUERY),
    access_token: accessToken,
  });
  if (bbox) params.set('bbox', bbox.map((value) => value.toFixed(5)).join(','));

  let response: Response;
  try {
    response = await fetch(`${GEOCODE_ENDPOINT}?${params.toString()}`, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new GeocodingError('Network error while searching. Check your connection.');
  }

  if (response.status === 401 || response.status === 403) {
    throw new GeocodingError('Mapbox rejected the access token. Check it in Settings.');
  }
  if (response.status === 429) {
    throw new GeocodingError('Search rate limit reached. Try again in a moment.');
  }
  if (!response.ok) {
    throw new GeocodingError('Address search failed.');
  }

  const payload = (await response.json().catch(() => null)) as { features?: GeocodeFeature[] } | null;
  if (!payload) throw new GeocodingError('Address search returned an unreadable response.');

  return (payload.features ?? [])
    .map(toResult)
    .filter((result): result is GeocodeResult => result !== null);
}

/**
 * Searches addresses, biasing towards the current viewport.
 *
 * Measured against the live API: Mapbox's `proximity` parameter does not rank
 * nearby matches first (a Kyiv-centred search for "Khreshchatyk 1" still returns
 * Cherkasy), and an unbiased query is worse still - "Boryspil International
 * Airport" returns a street in Tennessee. Only `bbox` ranks correctly, but it
 * *restricts* rather than biases. So two bbox queries run together - the viewport
 * itself, and a regionally expanded box - merged nearest-first.
 *
 * The consequence is deliberate: search is regional, not global. To find somewhere
 * far away, pan the map there first.
 */
export async function searchPlaces(
  query: string,
  accessToken: string,
  options: { viewport?: BoundingBox; signal?: AbortSignal } = {},
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const bbox = isUsableBbox(options.viewport) ? options.viewport : undefined;
  if (!bbox) return (await queryOnce(trimmed, accessToken, undefined, options.signal)).slice(0, MAX_SEARCH_RESULTS);

  const regional = expandBbox(bbox);
  const outcomes = await Promise.allSettled(
    [bbox, regional]
      .filter((box): box is BoundingBox => box !== null)
      .map((box) => queryOnce(trimmed, accessToken, box, options.signal)),
  );

  // An abort is a deliberate cancellation, never an error to surface.
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected' && outcome.reason instanceof DOMException) {
      throw outcome.reason;
    }
  }
  if (outcomes.every((outcome) => outcome.status === 'rejected')) {
    throw (outcomes[0] as PromiseRejectedResult).reason;
  }

  const merged: GeocodeResult[] = [];
  const seen = new Set<string>();
  for (const outcome of outcomes) {
    if (outcome.status !== 'fulfilled') continue;
    for (const result of outcome.value) {
      if (seen.has(result.id)) continue;
      seen.add(result.id);
      merged.push(result);
    }
  }

  return merged.slice(0, MAX_SEARCH_RESULTS);
}
