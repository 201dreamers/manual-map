import type { AppSettings, RouteMetadata, SavedWaypoint } from '../types/domain';

const ROUTES_KEY = 'manual-map:routes';
const SETTINGS_KEY = 'manual-map:settings';

const DEFAULT_SETTINGS: AppSettings = {
  mapboxAccessToken: null,
  controlsMirrored: false,
  // A layer is on by default when showing it costs nothing per use. Congestion rides
  // the map tiles that are already being fetched, and cameras come from keyless OSM, so
  // both start on. TomTom incidents are metered against a daily quota, so that one stays
  // off until it is asked for.
  congestionOverlay: true,
  incidentsOverlay: false,
  camerasOverlay: true,
  obdCalibration: 1,
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // Corrupted or unavailable storage must never break app boot.
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or private-mode storage denial: ignore silently.
  }
}

function isCoordinateTuple(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

function isSavedWaypoint(value: unknown): value is SavedWaypoint {
  if (typeof value !== 'object' || value === null) return false;
  const waypoint = value as Partial<SavedWaypoint>;
  return (
    isCoordinateTuple(waypoint.coordinate) &&
    (waypoint.label === undefined || typeof waypoint.label === 'string')
  );
}

function isRouteMetadata(value: unknown): value is RouteMetadata {
  if (typeof value !== 'object' || value === null) return false;
  const route = value as Partial<RouteMetadata>;
  return (
    typeof route.id === 'string' &&
    typeof route.title === 'string' &&
    typeof route.createdAt === 'string' &&
    typeof route.totalDistanceMeters === 'number' &&
    Array.isArray(route.coordinates) &&
    route.coordinates.length >= 2 &&
    route.coordinates.every(isCoordinateTuple) &&
    // Both fields are optional so routes saved before they existed still load.
    (route.updatedAt === undefined || typeof route.updatedAt === 'string') &&
    (route.waypoints === undefined ||
      (Array.isArray(route.waypoints) && route.waypoints.every(isSavedWaypoint)))
  );
}

export const routeRepository = {
  list(): RouteMetadata[] {
    const parsed = readJson<unknown>(ROUTES_KEY, []);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRouteMetadata);
  },

  save(route: RouteMetadata): RouteMetadata[] {
    const next = [route, ...routeRepository.list().filter((r) => r.id !== route.id)];
    writeJson(ROUTES_KEY, next);
    return next;
  },

  remove(id: string): RouteMetadata[] {
    const next = routeRepository.list().filter((route) => route.id !== id);
    writeJson(ROUTES_KEY, next);
    return next;
  },

  clear(): RouteMetadata[] {
    writeJson(ROUTES_KEY, []);
    return [];
  },
};

/** Mirrors the bounds the reckoning module enforces, so the two can never disagree. */
function clampCalibration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.min(Math.max(value, 0.8), 1.2);
}

/** A stored boolean wins; anything else (absent, corrupted) falls back to the default. */
function readFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export const settingsRepository = {
  read(): AppSettings {
    const parsed = readJson<Partial<AppSettings>>(SETTINGS_KEY, DEFAULT_SETTINGS);
    const token = parsed.mapboxAccessToken;
    return {
      mapboxAccessToken: typeof token === 'string' && token ? token : null,
      controlsMirrored: parsed.controlsMirrored === true,
      // Read against the default rather than against `=== true`, so that a settings
      // blob written before these keys existed - or by a build that did not have them -
      // picks up the default instead of being silently forced off. An explicit stored
      // `false` is still a choice and is honoured.
      congestionOverlay: readFlag(parsed.congestionOverlay, DEFAULT_SETTINGS.congestionOverlay),
      incidentsOverlay: readFlag(parsed.incidentsOverlay, DEFAULT_SETTINGS.incidentsOverlay),
      camerasOverlay: readFlag(parsed.camerasOverlay, DEFAULT_SETTINGS.camerasOverlay),
      // Bounded on read as well as on write: a hand-edited or corrupted value would
      // otherwise scale every distance the app reports for the life of the install.
      obdCalibration: clampCalibration(parsed.obdCalibration),
    };
  },

  write(settings: AppSettings): void {
    writeJson(SETTINGS_KEY, settings);
  },

  /** Merges one field so writing a token never drops the other preferences. */
  update(patch: Partial<AppSettings>): AppSettings {
    const next = { ...settingsRepository.read(), ...patch };
    writeJson(SETTINGS_KEY, next);
    return next;
  },
};
