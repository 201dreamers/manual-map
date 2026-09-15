import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { DirectionsError, fetchDrivingRoute, MAX_ROUTE_POINTS } from '../lib/directions';
import {
  GeocodingError,
  searchPlaces,
  type BoundingBox,
  type GeocodeResult,
} from '../lib/geocoding';
import {
  bearingAtDistance,
  buildRouteGeometry,
  clampDistance,
  coordinateAtDistance,
  type RouteGeometry,
} from '../lib/geo';
import {
  metersBetween,
  MIN_STROKE_LENGTH_METERS,
  MIN_WAYPOINT_SEPARATION_METERS,
  planSplice,
  planStrokeRoute,
  strokeLengthMeters,
} from '../lib/splice';
import { routeRepository, settingsRepository } from '../lib/storage';
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

/** How many route-changing operations can be reverted. */
export const UNDO_DEPTH = 10;

/** Glide bounds: below the floor a step reads as a teleport, above the ceiling it drags. */
export const MIN_STEP_ANIMATION_MS = 100;
export const MAX_STEP_ANIMATION_MS = 3000;

/** Drawer edits coalesce for this long so a burst of reorders costs one request. */
export const RECALC_DEBOUNCE_MS = 400;

/** Idle time before a typed query is sent. */
export const SEARCH_DEBOUNCE_MS = 300;
/** Shorter queries match too much to be useful. */
export const MIN_SEARCH_LENGTH = 3;

/** Where a chosen search result is placed in the stop list. */
export type SearchRole = 'start' | 'via' | 'end';

/** An in-flight step glide. Held outside the store so it never re-renders React. */
interface StepAnimation {
  fromMeters: number;
  toMeters: number;
  elapsedMs: number;
  /** Taken from the config for the direction the step was fired in. */
  durationMs: number;
  /** The geometry the step was aimed at; a route change abandons the glide. */
  geometry: RouteGeometry;
}

/** A revertible snapshot of everything a route-changing operation touches. */
interface RouteSnapshot {
  routePoints: RoutePoint[];
  geometry: RouteGeometry | null;
  activeRoute: RouteMetadata | null;
  distanceMeters: number;
}

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
  stepForwardAnimationMs: 700,
  stepBackAnimationMs: 700,
  speedKmh: 60,
  speedUnit: 'kmh',
  isPlaying: false,
  cameraTrackingEnabled: true,
  controlsMirrored: false,
};

export interface SimulationState {
  mapboxToken: string | null;
  isSettingsOpen: boolean;
  isHistoryOpen: boolean;
  isPlanOpen: boolean;
  /** The top-left action menu. Shared so the controls beneath it can stand down. */
  isMenuOpen: boolean;
  /** True while the pen is armed and the next drag draws instead of panning. */
  isDrawArmed: boolean;
  /**
   * D-3: while locked the route cannot be edited from the map, so a stray thumb
   * cannot drop a stop mid-drive. Session-only; never persisted.
   */
  isRouteLocked: boolean;

  searchQuery: string;
  searchResults: GeocodeResult[];
  isSearching: boolean;
  searchError: string | null;
  /** Current map bounds, used to bias search towards what the user is looking at. */
  viewport: BoundingBox | null;
  /** Incremented to ask the map to frame the whole route once. */
  fitRequestId: number;
  /** Incremented to ask the map to rotate back to north. */
  northRequestId: number;
  /**
   * Asks the map to step its zoom while staying on the vehicle. Carries a direction,
   * so unlike the fit and north requests the id alone is not enough.
   */
  zoomRequest: { id: number; delta: number };

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
  /** Most recent snapshot last. Capped at UNDO_DEPTH. */
  undoStack: RouteSnapshot[];

  setToken: (token: string) => void;
  removeToken: () => void;
  openSettings: (open: boolean) => void;
  openHistory: (open: boolean) => void;
  openPlan: (open: boolean) => void;
  openMenu: (open: boolean) => void;
  setDrawArmed: (armed: boolean) => void;
  setRouteLocked: (locked: boolean) => void;
  resetNorth: () => void;
  requestZoom: (delta: number) => void;
  applyStroke: (stroke: CoordinateTuple[]) => Promise<void>;
  setViewport: (viewport: BoundingBox) => void;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;
  applySearchResult: (result: GeocodeResult, role: SearchRole) => Promise<void>;

  addRoutePoint: (coordinate: CoordinateTuple) => Promise<void>;
  moveRoutePoint: (id: string, direction: StepDirection) => void;
  removeRoutePoint: (id: string) => void;
  undo: () => void;
  clearRoute: () => void;
  reverseRoute: () => Promise<void>;

  loadSavedRoute: (id: string) => void;
  deleteSavedRoute: (id: string) => void;
  clearSavedRoutes: () => void;

  setStepDistance: (direction: StepDirection, meters: number) => void;
  setStepAnimationMs: (direction: StepDirection, milliseconds: number) => void;
  setControlsMirrored: (mirrored: boolean) => void;
  setSpeed: (kmh: number) => void;
  setSpeedUnit: (unit: SimulationConfig['speedUnit']) => void;
  setCameraTracking: (enabled: boolean) => void;

  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  resetToStart: () => void;
  step: (direction: StepDirection) => void;
  moveCursorTo: (distanceMeters: number) => void;

  /** Advances the simulation by a frame delta. Called from the rAF loop only. */
  advance: (deltaSeconds: number) => void;
  /**
   * Drives an in-flight step glide by a frame delta. Called from the rAF loop only;
   * returns true while a glide is still running.
   */
  advanceStepAnimation: (deltaSeconds: number) => boolean;
  /** Copies the live telemetry into the throttled slice that React subscribes to. */
  syncDisplayTelemetry: () => void;

  pushToast: (kind: ToastKind, text: string) => void;
  dismissToast: (id: string) => void;
}

/** Decelerating glide: fast off the mark, settling gently onto the target. */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
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

/**
 * A splice returns bare coordinates, so stops that survived it are matched back to
 * the originals. Without this a searched "Boryspil Airport" would come back as an
 * anonymous dropped pin.
 */
function adoptExistingStops(
  coordinates: CoordinateTuple[],
  previous: RoutePoint[],
): RoutePoint[] {
  const adopted: RoutePoint[] = coordinates.map((coordinate) => ({ id: createId(), coordinate }));
  if (previous.length === 0 || coordinates.length === 0) return adopted;

  const lastIndex = coordinates.length - 1;
  const claim = (index: number, point: RoutePoint) => {
    if (metersBetween(point.coordinate, coordinates[index]) < MIN_WAYPOINT_SEPARATION_METERS) {
      adopted[index] = { ...point, coordinate: coordinates[index] };
    }
  };

  // The start and end are pinned by the splice, so they are matched by position.
  // Matching them by proximity instead lets a stroke that projects onto the route
  // end steal the destination's identity.
  claim(0, previous[0]);
  if (lastIndex > 0) claim(lastIndex, previous[previous.length - 1]);

  // Surviving vias are matched by proximity among the remaining originals only.
  const unclaimed = previous.slice(1, -1);
  for (let index = 1; index < lastIndex; index++) {
    const match = unclaimed.findIndex(
      (point) =>
        metersBetween(point.coordinate, coordinates[index]) < MIN_WAYPOINT_SEPARATION_METERS,
    );
    if (match === -1) continue;
    const [claimed] = unclaimed.splice(match, 1);
    adopted[index] = { ...claimed, coordinate: coordinates[index] };
  }

  return adopted;
}

function pointLabel(point: RoutePoint): string {
  if (point.label) return point.label;
  const [lng, lat] = point.coordinate;
  return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
}

function buildRouteTitle(points: RoutePoint[]): string {
  if (points.length === 0) return 'Untitled route';
  return `${pointLabel(points[0])} → ${pointLabel(points[points.length - 1])}`;
}

/** In-flight Directions request, aborted whenever a newer one supersedes it. */
let pendingRouteRequest: AbortController | null = null;

/** In-flight geocoding request, aborted whenever a newer query supersedes it. */
let pendingSearchRequest: AbortController | null = null;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
/** Guards against a slow earlier query overwriting a later one's results. */
let searchSequence = 0;

/** Coalesces a burst of drawer edits into a single recalculation. */
let recalcTimer: ReturnType<typeof setTimeout> | null = null;
/** State from before the first edit of the current burst, for undo and rollback. */
let pendingEdit: { previous: RoutePoint[]; snapshot: RouteSnapshot } | null = null;

/** The step glide currently in flight, if any. */
let stepAnimation: StepAnimation | null = null;

export const useSimulationStore = create<SimulationState>()(
  subscribeWithSelector((set, get) => {
    const cancelPendingEdit = () => {
      if (recalcTimer) clearTimeout(recalcTimer);
      recalcTimer = null;
      pendingEdit = null;
    };

    const captureSnapshot = (): RouteSnapshot => {
      const { routePoints, geometry, activeRoute, telemetry } = get();
      return {
        routePoints,
        geometry,
        activeRoute,
        distanceMeters: telemetry.currentDistanceMeters,
      };
    };

    const pushUndo = (snapshot: RouteSnapshot) => {
      const next = [...get().undoStack, snapshot];
      set({ undoStack: next.slice(-UNDO_DEPTH) });
    };

    /**
     * Recalculates road geometry for the given tap points. On failure the invalid
     * segment is dropped (FR-1.3) and the previous state is restored.
     */
    const recalculateRoute = async (
      points: RoutePoint[],
      previous: RoutePoint[],
      presetSnapshot?: RouteSnapshot,
    ) => {
      const snapshot = presetSnapshot ?? captureSnapshot();
      const token = get().mapboxToken;
      if (!token) {
        set({ routePoints: previous, ...lockStateFor(previous) });
        get().pushToast('error', 'Add a Mapbox public token in Settings first.');
        return;
      }

      if (points.length < 2) {
        set({
          routePoints: points,
          ...lockStateFor(points),
          geometry: null,
          activeRoute: null,
          telemetry: { ...EMPTY_TELEMETRY, currentSpeedKmh: get().config.speedKmh },
          displayTelemetry: { ...EMPTY_TELEMETRY, currentSpeedKmh: get().config.speedKmh },
          config: { ...get().config, isPlaying: false },
        });
        pushUndo(snapshot);
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
        // Edits keep the same identity, so committing updates one history row
        // instead of appending a near-duplicate for every recalculation.
        const previousRoute = get().activeRoute;
        const route: RouteMetadata = {
          id: previousRoute?.id ?? createId(),
          title: buildRouteTitle(points),
          createdAt: previousRoute?.createdAt ?? new Date().toISOString(),
          updatedAt: previousRoute?.updatedAt,
          totalDistanceMeters: geometry.totalDistanceMeters,
          coordinates: geometry.coordinates,
          waypoints: points.map((point) => ({
            coordinate: point.coordinate,
            label: point.label,
          })),
        };

        const telemetry = buildTelemetry(geometry, 0, get().config.speedKmh);
        set({
          geometry,
          activeRoute: route,
          isRouting: false,
          telemetry,
          displayTelemetry: telemetry,
          config: { ...get().config, cameraTrackingEnabled: false },
        });
        pushUndo(snapshot);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const message =
          error instanceof DirectionsError ? error.message : 'Route calculation failed.';
        set({ routePoints: previous, ...lockStateFor(previous), isRouting: false });
        get().pushToast('error', message);
      } finally {
        if (pendingRouteRequest === controller) pendingRouteRequest = null;
      }
    };

    const runSearch = async (query: string) => {
      const token = get().mapboxToken;
      if (!token) {
        set({ isSearching: false, searchError: 'Add a Mapbox public token in Settings first.' });
        return;
      }

      pendingSearchRequest?.abort();
      const controller = new AbortController();
      pendingSearchRequest = controller;
      const sequence = ++searchSequence;

      try {
        const results = await searchPlaces(query, token, {
          viewport: get().viewport ?? undefined,
          signal: controller.signal,
        });
        // A slower earlier query must never clobber a newer one's results.
        if (sequence !== searchSequence) return;
        set({ searchResults: results, isSearching: false, searchError: null });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (sequence !== searchSequence) return;
        set({
          searchResults: [],
          isSearching: false,
          searchError:
            error instanceof GeocodingError ? error.message : 'Address search failed.',
        });
      } finally {
        if (pendingSearchRequest === controller) pendingSearchRequest = null;
      }
    };

    /**
     * Applies a stop-list edit immediately so the drawer stays responsive, then
     * recalculates once the user stops editing.
     */
    /**
     * The lock guards a route; below two stops there is no route left to guard. The
     * lock button is disabled at that point, so a lock left standing here would be
     * impossible to release and would strand the UI in the Drive layout.
     */
    const lockStateFor = (points: RoutePoint[]) => (points.length < 2 ? { isRouteLocked: false } : {});

    const scheduleRecalculate = (points: RoutePoint[]) => {
      if (!pendingEdit) {
        pendingEdit = { previous: get().routePoints, snapshot: captureSnapshot() };
      }

      // Reordering mid-drive would leave the marker at a meaningless offset.
      set({
        routePoints: points,
        ...lockStateFor(points),
        config: { ...get().config, isPlaying: false },
      });

      if (recalcTimer) clearTimeout(recalcTimer);
      recalcTimer = setTimeout(() => {
        recalcTimer = null;
        const edit = pendingEdit;
        pendingEdit = null;
        if (!edit) return;
        void recalculateRoute(get().routePoints, edit.previous, edit.snapshot);
      }, RECALC_DEBOUNCE_MS);
    };

    /** D-4: history is written on commit (the first Play press), not on every edit. */
    const commitActiveRoute = () => {
      const activeRoute = get().activeRoute;
      if (!activeRoute) return;
      const committed: RouteMetadata = { ...activeRoute, updatedAt: new Date().toISOString() };
      set({ activeRoute: committed, savedRoutes: routeRepository.save(committed) });
    };

    /**
     * D-3: the lock exists to stop accidental edits, so every route mutation runs
     * through here. It reports rather than swallowing, otherwise a refused tap
     * looks identical to a broken one.
     */
    const refuseWhenLocked = (): boolean => {
      if (!get().isRouteLocked) return false;
      get().pushToast('info', 'Route is locked. Unlock to edit it.');
      return true;
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
      isPlanOpen: false,
      isMenuOpen: false,
      isDrawArmed: false,
      isRouteLocked: false,

      searchQuery: '',
      searchResults: [],
      isSearching: false,
      searchError: null,
      viewport: null,
      fitRequestId: 0,
      northRequestId: 0,
      zoomRequest: { id: 0, delta: 0 },

      routePoints: [],
      geometry: null,
      activeRoute: null,
      isRouting: false,

      // The handedness preference is the only config field that survives a reload.
      config: { ...DEFAULT_CONFIG, controlsMirrored: settingsRepository.read().controlsMirrored },
      telemetry: { ...EMPTY_TELEMETRY, currentSpeedKmh: DEFAULT_CONFIG.speedKmh },
      displayTelemetry: { ...EMPTY_TELEMETRY, currentSpeedKmh: DEFAULT_CONFIG.speedKmh },

      savedRoutes: routeRepository.list(),
      toasts: [],
      undoStack: [],

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

      openPlan: (open) => set({ isPlanOpen: open }),

      openMenu: (open) => set({ isMenuOpen: open }),

      setDrawArmed: (armed) => {
        if (armed && refuseWhenLocked()) return;
        set({ isDrawArmed: armed });
      },

      /** A route needs both ends before there is anything worth protecting. */
      setRouteLocked: (locked) => {
        if (locked && get().routePoints.length < 2) return;
        set({ isRouteLocked: locked });
      },

      /**
       * D-7: steps the zoom without touching camera tracking, so the road ahead can
       * be widened mid-drive. The map clamps the result; the store only asks.
       */
      requestZoom: (delta) =>
        set({ zoomRequest: { id: get().zoomRequest.id + 1, delta } }),

      /**
       * Rotates the map back to north. Heading-up tracking is released at the same
       * time, otherwise the next playback frame would immediately rotate it away.
       */
      resetNorth: () =>
        set({
          northRequestId: get().northRequestId + 1,
          config: { ...get().config, cameraTrackingEnabled: false },
        }),

      /**
       * D-1: a stroke reshapes the span it covers, or builds a fresh route when the
       * map is empty. Short strokes are taps and are ignored without complaint.
       */
      applyStroke: async (stroke) => {
        if (refuseWhenLocked()) return;
        set({ isDrawArmed: false });
        if (strokeLengthMeters(stroke) < MIN_STROKE_LENGTH_METERS) return;

        const previous = get().routePoints;
        const geometry = get().geometry;
        const outcome =
          geometry && previous.length >= 2
            ? planSplice(geometry, previous.map((point) => point.coordinate), stroke)
            : planStrokeRoute(stroke);

        if (!outcome.ok) {
          get().pushToast('error', outcome.reason);
          return;
        }

        await recalculateRoute(adoptExistingStops(outcome.waypoints, previous), previous);
      },

      setViewport: (viewport) => set({ viewport }),

      setSearchQuery: (query) => {
        set({ searchQuery: query, searchError: null });

        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = null;

        if (query.trim().length < MIN_SEARCH_LENGTH) {
          pendingSearchRequest?.abort();
          pendingSearchRequest = null;
          searchSequence++;
          set({ searchResults: [], isSearching: false });
          return;
        }

        set({ isSearching: true });
        searchTimer = setTimeout(() => {
          searchTimer = null;
          void runSearch(query);
        }, SEARCH_DEBOUNCE_MS);
      },

      clearSearch: () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = null;
        pendingSearchRequest?.abort();
        pendingSearchRequest = null;
        searchSequence++;
        set({ searchQuery: '', searchResults: [], isSearching: false, searchError: null });
      },

      // D-3: the caller decides whether a result becomes the start, a via or the end.
      applySearchResult: async (result, role) => {
        const points = get().routePoints;
        const point: RoutePoint = {
          id: createId(),
          coordinate: result.coordinate,
          label: result.name,
        };

        let next: RoutePoint[];
        if (role === 'start') {
          next = points.length === 0 ? [point] : [point, ...points.slice(1)];
        } else if (role === 'end') {
          next = points.length <= 1 ? [...points, point] : [...points.slice(0, -1), point];
        } else {
          next =
            points.length <= 1
              ? [...points, point]
              : [...points.slice(0, -1), point, points[points.length - 1]];
        }

        get().clearSearch();
        await recalculateRoute(next, points);
      },

      addRoutePoint: async (coordinate) => {
        if (refuseWhenLocked()) return;
        const previous = get().routePoints;
        if (previous.length >= MAX_ROUTE_POINTS) {
          get().pushToast('error', `A route can use at most ${MAX_ROUTE_POINTS} points.`);
          return;
        }
        const next = [...previous, { id: createId(), coordinate }];
        await recalculateRoute(next, previous);
      },

      undo: () => {
        if (refuseWhenLocked()) return;
        const stack = get().undoStack;
        if (stack.length === 0) return;

        cancelPendingEdit();
        pendingRouteRequest?.abort();
        pendingRouteRequest = null;

        const snapshot = stack[stack.length - 1];
        const telemetry = buildTelemetry(
          snapshot.geometry,
          snapshot.distanceMeters,
          get().config.speedKmh,
        );
        set({
          undoStack: stack.slice(0, -1),
          routePoints: snapshot.routePoints,
          ...lockStateFor(snapshot.routePoints),
          geometry: snapshot.geometry,
          activeRoute: snapshot.activeRoute,
          isRouting: false,
          telemetry,
          displayTelemetry: telemetry,
          config: { ...get().config, isPlaying: false },
        });
      },

      moveRoutePoint: (id, direction) => {
        const points = get().routePoints;
        const index = points.findIndex((point) => point.id === id);
        if (index === -1) return;

        const target = index + direction;
        if (target < 0 || target >= points.length) return;

        const next = [...points];
        [next[index], next[target]] = [next[target], next[index]];
        scheduleRecalculate(next);
      },

      removeRoutePoint: (id) => {
        const points = get().routePoints;
        if (!points.some((point) => point.id === id)) return;
        scheduleRecalculate(points.filter((point) => point.id !== id));
      },

      clearRoute: () => {
        if (refuseWhenLocked()) return;
        const snapshot = captureSnapshot();
        cancelPendingEdit();
        pendingRouteRequest?.abort();
        pendingRouteRequest = null;
        const telemetry = { ...EMPTY_TELEMETRY, currentSpeedKmh: get().config.speedKmh };
        set({
          routePoints: [],
          isRouteLocked: false,
          geometry: null,
          activeRoute: null,
          isRouting: false,
          telemetry,
          displayTelemetry: telemetry,
          config: { ...get().config, isPlaying: false, cameraTrackingEnabled: false },
        });
        pushUndo(snapshot);
      },

      // FR-1.4: swap start and destination, recalculate geometry, reset to 0 m.
      reverseRoute: async () => {
        if (refuseWhenLocked()) return;
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

        const snapshot = captureSnapshot();
        try {
          const geometry = buildRouteGeometry(route.coordinates);
          const telemetry = buildTelemetry(geometry, 0, get().config.speedKmh);
          const saved = route.waypoints;
          const restored: RoutePoint[] =
            saved && saved.length >= 2
              ? saved.map((waypoint) => ({
                  id: createId(),
                  coordinate: waypoint.coordinate,
                  label: waypoint.label,
                }))
              : [
                  { id: createId(), coordinate: geometry.coordinates[0] },
                  {
                    id: createId(),
                    coordinate: geometry.coordinates[geometry.coordinates.length - 1],
                  },
                ];
          set({
            geometry,
            activeRoute: route,
            routePoints: restored,
            telemetry,
            displayTelemetry: telemetry,
            isHistoryOpen: false,
            isRouteLocked: false,
            fitRequestId: get().fitRequestId + 1,
            config: { ...get().config, isPlaying: false, cameraTrackingEnabled: false },
          });
          pushUndo(snapshot);
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

      setStepAnimationMs: (direction, milliseconds) => {
        const clamped = Math.min(
          Math.max(Math.round(milliseconds), MIN_STEP_ANIMATION_MS),
          MAX_STEP_ANIMATION_MS,
        );
        const key = direction === 1 ? 'stepForwardAnimationMs' : 'stepBackAnimationMs';
        set({ config: { ...get().config, [key]: clamped } });
      },

      setControlsMirrored: (mirrored) => {
        settingsRepository.update({ controlsMirrored: mirrored });
        set({ config: { ...get().config, controlsMirrored: mirrored } });
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
        commitActiveRoute();
        stepAnimation = null;
        // D-2: driving is when the accidental taps happen, so Play locks the route.
        set({
          isRouteLocked: true,
          config: { ...get().config, isPlaying: true, cameraTrackingEnabled: true },
        });
      },

      pause: () => {
        stepAnimation = null;
        set({ config: { ...get().config, isPlaying: false } });
      },

      togglePlay: () => (get().config.isPlaying ? get().pause() : get().play()),

      /**
       * D-4: a tap near the route while locked repositions the marker. The move glides
       * on the same easing as a step rather than teleporting, so the eye can follow
       * where the marker went. D-5 leaves playback running; unlike `step`, this never
       * pauses. Any glide already in flight is replaced.
       */
      moveCursorTo: (distanceMeters) => {
        const { geometry, telemetry, config } = get();
        if (!geometry) return;

        const target = clampDistance(geometry, distanceMeters);
        if (target === telemetry.currentDistanceMeters) {
          stepAnimation = null;
          applyDistance(target);
          get().syncDisplayTelemetry();
          return;
        }

        stepAnimation = {
          fromMeters: telemetry.currentDistanceMeters,
          toMeters: target,
          elapsedMs: 0,
          durationMs:
            target > telemetry.currentDistanceMeters
              ? config.stepForwardAnimationMs
              : config.stepBackAnimationMs,
          geometry,
        };
      },

      resetToStart: () => {
        stepAnimation = null;
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
        // Tapping again mid-glide stacks onto the pending target rather than the
        // position the marker happens to have reached.
        const base = stepAnimation ? stepAnimation.toMeters : telemetry.currentDistanceMeters;
        const target = clampDistance(geometry, base + direction * stepMeters);

        set({ config: { ...config, isPlaying: false } });
        if (target === telemetry.currentDistanceMeters) {
          stepAnimation = null;
          applyDistance(target);
          get().syncDisplayTelemetry();
          return;
        }

        stepAnimation = {
          fromMeters: telemetry.currentDistanceMeters,
          toMeters: target,
          elapsedMs: 0,
          durationMs:
            direction === 1 ? config.stepForwardAnimationMs : config.stepBackAnimationMs,
          geometry,
        };
      },

      advanceStepAnimation: (deltaSeconds) => {
        if (!stepAnimation) return false;
        // A recalculation, undo or reload replaces the geometry the step was aimed at.
        if (get().geometry !== stepAnimation.geometry) {
          stepAnimation = null;
          return false;
        }

        stepAnimation.elapsedMs += deltaSeconds * 1000;
        const progress = Math.min(stepAnimation.elapsedMs / stepAnimation.durationMs, 1);
        const { fromMeters, toMeters } = stepAnimation;
        applyDistance(fromMeters + (toMeters - fromMeters) * easeOutCubic(progress));

        if (progress < 1) return true;
        stepAnimation = null;
        // The throttled slice would otherwise miss the final frame and read short.
        get().syncDisplayTelemetry();
        return false;
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
