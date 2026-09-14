import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { DirectionsError, fetchDrivingRoute, MAX_ROUTE_POINTS } from '../lib/directions';
import {
  bearingAtDistance,
  buildRouteGeometry,
  clampDistance,
  coordinateAtDistance,
  type RouteGeometry,
} from '../lib/geo';
import { routeRepository } from '../lib/storage';
import { clearToken, persistToken, resolveMapboxToken } from '../lib/token';
import type {
  CoordinateTuple,
  RouteMetadata,
  RoutePoint,
  SimulationConfig,
  TelemetryState,
  ToastKind,
  ToastMessage,
} from '../types/domain';

export const MIN_STEP_METERS = 10;
export const MAX_STEP_METERS = 100000;
export const MAX_SPEED_KMH = 180;

/** Forward (+1) and backward (-1) travel along the route. */
export type StepDirection = 1 | -1;

const EMPTY_TELEMETRY: TelemetryState = {
  currentDistanceMeters: 0,
  currentSpeedKmh: 0,
  remainingDistanceMeters: 0,
  etaSeconds: Number.POSITIVE_INFINITY,
  currentCoordinate: null,
  bearingDegrees: 0,
};

const DEFAULT_CONFIG: SimulationConfig = {
  stepForwardMeters: 250,
  stepBackMeters: 125,
  speedKmh: 60,
  speedUnit: 'kmh',
  isPlaying: false,
  cameraTrackingEnabled: true,
};

export interface SimulationState {
  mapboxToken: string | null;
  isSettingsOpen: boolean;
  isHistoryOpen: boolean;

  routePoints: RoutePoint[];
  geometry: RouteGeometry | null;
  activeRoute: RouteMetadata | null;
  isRouting: boolean;

  config: SimulationConfig;
  /** Updated every animation frame; consumed imperatively by the map renderer. */
  telemetry: TelemetryState;
  /** Throttled mirror of `telemetry` used by React components to avoid 60 FPS re-renders. */
  displayTelemetry: TelemetryState;

  savedRoutes: RouteMetadata[];
  toasts: ToastMessage[];

  setToken: (token: string) => void;
  removeToken: () => void;
  openSettings: (open: boolean) => void;
  openHistory: (open: boolean) => void;

  addRoutePoint: (coordinate: CoordinateTuple) => Promise<void>;
  undoLastPoint: () => Promise<void>;
  clearRoute: () => void;
  reverseRoute: () => Promise<void>;

  loadSavedRoute: (id: string) => void;
  deleteSavedRoute: (id: string) => void;
  clearSavedRoutes: () => void;

  setStepDistance: (direction: StepDirection, meters: number) => void;
  setSpeed: (kmh: number) => void;
  setSpeedUnit: (unit: SimulationConfig['speedUnit']) => void;
  setCameraTracking: (enabled: boolean) => void;

  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  resetToStart: () => void;
  step: (direction: StepDirection) => void;

  /** Advances the simulation by a frame delta. Called from the rAF loop only. */
  advance: (deltaSeconds: number) => void;
  /** Copies the live telemetry into the throttled slice that React subscribes to. */
  syncDisplayTelemetry: () => void;

  pushToast: (kind: ToastKind, text: string) => void;
  dismissToast: (id: string) => void;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildTelemetry(
  geometry: RouteGeometry | null,
  distanceMeters: number,
  speedKmh: number,
): TelemetryState {
  if (!geometry) return { ...EMPTY_TELEMETRY, currentSpeedKmh: speedKmh };

  const current = clampDistance(geometry, distanceMeters);
  const remaining = geometry.totalDistanceMeters - current;
  const speedMetersPerSecond = speedKmh / 3.6;

  return {
    currentDistanceMeters: current,
    currentSpeedKmh: speedKmh,
    remainingDistanceMeters: remaining,
    etaSeconds: speedMetersPerSecond > 0 ? remaining / speedMetersPerSecond : Number.POSITIVE_INFINITY,
    currentCoordinate: coordinateAtDistance(geometry, current),
    bearingDegrees: bearingAtDistance(geometry, current),
  };
}

function routeTitle(coordinates: CoordinateTuple[]): string {
  const [startLng, startLat] = coordinates[0];
  const [endLng, endLat] = coordinates[coordinates.length - 1];
  return `${startLat.toFixed(3)}, ${startLng.toFixed(3)} → ${endLat.toFixed(3)}, ${endLng.toFixed(3)}`;
}

/** In-flight Directions request, aborted whenever a newer one supersedes it. */
let pendingRouteRequest: AbortController | null = null;

export const useSimulationStore = create<SimulationState>()(
  subscribeWithSelector((set, get) => {
    /**
     * Recalculates road geometry for the given tap points. On failure the invalid
     * segment is dropped (FR-1.3) and the previous state is restored.
     */
    const recalculateRoute = async (points: RoutePoint[], previous: RoutePoint[]) => {
      const token = get().mapboxToken;
      if (!token) {
        set({ routePoints: previous });
        get().pushToast('error', 'Add a Mapbox public token in Settings first.');
        return;
      }

      if (points.length < 2) {
        set({
          routePoints: points,
          geometry: null,
          activeRoute: null,
          telemetry: { ...EMPTY_TELEMETRY, currentSpeedKmh: get().config.speedKmh },
          displayTelemetry: { ...EMPTY_TELEMETRY, currentSpeedKmh: get().config.speedKmh },
          config: { ...get().config, isPlaying: false },
        });
        return;
      }

      pendingRouteRequest?.abort();
      const controller = new AbortController();
      pendingRouteRequest = controller;

      set({ routePoints: points, isRouting: true, config: { ...get().config, isPlaying: false } });

      try {
        const result = await fetchDrivingRoute(
          points.map((point) => point.coordinate),
          token,
          controller.signal,
        );
        const geometry = buildRouteGeometry(result.coordinates);
        const route: RouteMetadata = {
          id: createId(),
          title: routeTitle(result.coordinates),
          createdAt: new Date().toISOString(),
          totalDistanceMeters: geometry.totalDistanceMeters,
          coordinates: geometry.coordinates,
        };

        const telemetry = buildTelemetry(geometry, 0, get().config.speedKmh);
        set({
          geometry,
          activeRoute: route,
          isRouting: false,
          telemetry,
          displayTelemetry: telemetry,
          savedRoutes: routeRepository.save(route),
          config: { ...get().config, cameraTrackingEnabled: true },
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const message =
          error instanceof DirectionsError ? error.message : 'Route calculation failed.';
        set({ routePoints: previous, isRouting: false });
        get().pushToast('error', message);
      } finally {
        if (pendingRouteRequest === controller) pendingRouteRequest = null;
      }
    };

    const applyDistance = (distanceMeters: number, options: { pauseAtEnd?: boolean } = {}) => {
      const { geometry, config } = get();
      if (!geometry) return;

      const clamped = clampDistance(geometry, distanceMeters);
      const reachedEnd = clamped >= geometry.totalDistanceMeters;
      const telemetry = buildTelemetry(geometry, clamped, config.speedKmh);

      set({
        telemetry,
        config:
          options.pauseAtEnd && reachedEnd && config.isPlaying
            ? { ...config, isPlaying: false }
            : config,
      });
    };

    return {
      mapboxToken: resolveMapboxToken(),
      isSettingsOpen: false,
      isHistoryOpen: false,

      routePoints: [],
      geometry: null,
      activeRoute: null,
      isRouting: false,

      config: DEFAULT_CONFIG,
      telemetry: { ...EMPTY_TELEMETRY, currentSpeedKmh: DEFAULT_CONFIG.speedKmh },
      displayTelemetry: { ...EMPTY_TELEMETRY, currentSpeedKmh: DEFAULT_CONFIG.speedKmh },

      savedRoutes: routeRepository.list(),
      toasts: [],

      setToken: (token) => {
        persistToken(token);
        set({ mapboxToken: token.trim(), isSettingsOpen: false });
      },

      removeToken: () => {
        clearToken();
        set({ mapboxToken: resolveMapboxToken() });
      },

      openSettings: (open) => set({ isSettingsOpen: open }),
      openHistory: (open) => set({ isHistoryOpen: open }),

      addRoutePoint: async (coordinate) => {
        const previous = get().routePoints;
        if (previous.length >= MAX_ROUTE_POINTS) {
          get().pushToast('error', `A route can use at most ${MAX_ROUTE_POINTS} points.`);
          return;
        }
        const next = [...previous, { id: createId(), coordinate }];
        await recalculateRoute(next, previous);
      },

      undoLastPoint: async () => {
        const previous = get().routePoints;
        if (previous.length === 0) return;
        await recalculateRoute(previous.slice(0, -1), previous);
      },

      clearRoute: () => {
        pendingRouteRequest?.abort();
        pendingRouteRequest = null;
        const telemetry = { ...EMPTY_TELEMETRY, currentSpeedKmh: get().config.speedKmh };
        set({
          routePoints: [],
          geometry: null,
          activeRoute: null,
          isRouting: false,
          telemetry,
          displayTelemetry: telemetry,
          config: { ...get().config, isPlaying: false, cameraTrackingEnabled: true },
        });
      },

      // FR-1.4: swap start and destination, recalculate geometry, reset to 0 m.
      reverseRoute: async () => {
        const previous = get().routePoints;
        if (previous.length < 2) {
          get().pushToast('info', 'Add a start and a destination point first.');
          return;
        }
        await recalculateRoute([...previous].reverse(), previous);
      },

      loadSavedRoute: (id) => {
        const route = get().savedRoutes.find((entry) => entry.id === id);
        if (!route) return;

        try {
          const geometry = buildRouteGeometry(route.coordinates);
          const telemetry = buildTelemetry(geometry, 0, get().config.speedKmh);
          const endpoints: RoutePoint[] = [
            { id: createId(), coordinate: geometry.coordinates[0] },
            { id: createId(), coordinate: geometry.coordinates[geometry.coordinates.length - 1] },
          ];
          set({
            geometry,
            activeRoute: route,
            routePoints: endpoints,
            telemetry,
            displayTelemetry: telemetry,
            isHistoryOpen: false,
            config: { ...get().config, isPlaying: false, cameraTrackingEnabled: true },
          });
        } catch {
          get().pushToast('error', 'That saved route is corrupted and cannot be loaded.');
        }
      },

      deleteSavedRoute: (id) => {
        const savedRoutes = routeRepository.remove(id);
        set({ savedRoutes });
        if (get().activeRoute?.id === id) set({ activeRoute: null });
      },

      clearSavedRoutes: () => set({ savedRoutes: routeRepository.clear(), activeRoute: null }),

      setStepDistance: (direction, meters) => {
        const clamped = Math.min(Math.max(Math.round(meters), MIN_STEP_METERS), MAX_STEP_METERS);
        const key = direction === 1 ? 'stepForwardMeters' : 'stepBackMeters';
        set({ config: { ...get().config, [key]: clamped } });
      },

      setSpeed: (kmh) => {
        const clamped = Math.min(Math.max(kmh, 0), MAX_SPEED_KMH);
        const { geometry, telemetry } = get();
        set({
          config: { ...get().config, speedKmh: clamped },
          telemetry: buildTelemetry(geometry, telemetry.currentDistanceMeters, clamped),
        });
        get().syncDisplayTelemetry();
      },

      setSpeedUnit: (unit) => set({ config: { ...get().config, speedUnit: unit } }),

      setCameraTracking: (enabled) =>
        set({ config: { ...get().config, cameraTrackingEnabled: enabled } }),

      play: () => {
        const { geometry, telemetry } = get();
        if (!geometry) {
          get().pushToast('info', 'Tap the map to build a route before playing.');
          return;
        }
        // Restart from the beginning when play is pressed at the route end.
        if (telemetry.currentDistanceMeters >= geometry.totalDistanceMeters) {
          applyDistance(0);
        }
        set({ config: { ...get().config, isPlaying: true } });
      },

      pause: () => set({ config: { ...get().config, isPlaying: false } }),

      togglePlay: () => (get().config.isPlaying ? get().pause() : get().play()),

      resetToStart: () => {
        set({ config: { ...get().config, isPlaying: false } });
        applyDistance(0);
        get().syncDisplayTelemetry();
      },

      // FR-2.4 / FR-2.5: stepping clamps hard at both route boundaries.
      step: (direction) => {
        const { geometry, config, telemetry } = get();
        if (!geometry) return;

        const stepMeters =
          direction === 1 ? config.stepForwardMeters : config.stepBackMeters;
        const target = telemetry.currentDistanceMeters + direction * stepMeters;
        set({ config: { ...config, isPlaying: false } });
        applyDistance(target);
        get().syncDisplayTelemetry();
      },

      advance: (deltaSeconds) => {
        const { geometry, config, telemetry } = get();
        if (!geometry || !config.isPlaying) return;

        const distanceDelta = (config.speedKmh / 3.6) * deltaSeconds;
        applyDistance(telemetry.currentDistanceMeters + distanceDelta, { pauseAtEnd: true });
      },

      syncDisplayTelemetry: () => set({ displayTelemetry: get().telemetry }),

      pushToast: (kind, text) => {
        const toast: ToastMessage = { id: createId(), kind, text };
        set({ toasts: [...get().toasts, toast] });
        window.setTimeout(() => get().dismissToast(toast.id), 5000);
      },

      dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
    };
  }),
);
