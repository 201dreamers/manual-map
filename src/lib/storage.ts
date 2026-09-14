import type { AppSettings, RouteMetadata } from '../types/domain';

const ROUTES_KEY = 'manual-map:routes';
const SETTINGS_KEY = 'manual-map:settings';

const DEFAULT_SETTINGS: AppSettings = { mapboxAccessToken: null };

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
    route.coordinates.every(isCoordinateTuple)
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

export const settingsRepository = {
  read(): AppSettings {
    const parsed = readJson<Partial<AppSettings>>(SETTINGS_KEY, DEFAULT_SETTINGS);
    const token = parsed.mapboxAccessToken;
    return { mapboxAccessToken: typeof token === 'string' && token ? token : null };
  },

  write(settings: AppSettings): void {
    writeJson(SETTINGS_KEY, settings);
  },
};
