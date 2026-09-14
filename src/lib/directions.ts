import type { CoordinateTuple } from '../types/domain';

const DIRECTIONS_ENDPOINT = 'https://api.mapbox.com/directions/v5/mapbox/driving';
/** Mapbox Directions accepts at most 25 coordinates per request. */
export const MAX_ROUTE_POINTS = 25;

export class DirectionsError extends Error {}

export const NO_ROUTE_MESSAGE = 'Unable to calculate road route between selected points';

interface DirectionsResponse {
  code?: string;
  message?: string;
  routes?: Array<{
    distance: number;
    geometry: { coordinates: CoordinateTuple[] };
  }>;
}

export interface DirectionsResult {
  coordinates: CoordinateTuple[];
  distanceMeters: number;
}

/**
 * FR-1.2: resolves real road geometry for the tapped waypoints via the Mapbox
 * Directions API (`driving` profile). Throws DirectionsError with a user-facing
 * message when no drivable road path exists (FR-1.3).
 */
export async function fetchDrivingRoute(
  points: CoordinateTuple[],
  accessToken: string,
  signal?: AbortSignal,
): Promise<DirectionsResult> {
  if (points.length < 2) {
    throw new DirectionsError('At least a start and a destination point are required.');
  }
  if (points.length > MAX_ROUTE_POINTS) {
    throw new DirectionsError(`A route can use at most ${MAX_ROUTE_POINTS} points.`);
  }

  const path = points.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const query = new URLSearchParams({
    geometries: 'geojson',
    overview: 'full',
    steps: 'false',
    access_token: accessToken,
  });

  let response: Response;
  try {
    response = await fetch(`${DIRECTIONS_ENDPOINT}/${path}?${query.toString()}`, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new DirectionsError('Network error while contacting the Mapbox Directions API.');
  }

  if (response.status === 401 || response.status === 403) {
    throw new DirectionsError('Mapbox rejected the access token. Check it in Settings.');
  }
  if (response.status === 429) {
    throw new DirectionsError('Mapbox rate limit reached. Try again in a moment.');
  }

  const payload = (await response.json().catch(() => null)) as DirectionsResponse | null;
  if (!response.ok || !payload) {
    throw new DirectionsError('The Mapbox Directions API request failed.');
  }

  const route = payload.routes?.[0];
  if (payload.code !== 'Ok' || !route || route.geometry.coordinates.length < 2) {
    throw new DirectionsError(NO_ROUTE_MESSAGE);
  }

  return { coordinates: route.geometry.coordinates, distanceMeters: route.distance };
}
