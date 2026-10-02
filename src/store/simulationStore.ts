import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { fetchDrivingRoute, MAX_ROUTE_POINTS } from '../lib/directions';
import {
  searchPlaces,
  type BoundingBox,
  type GeocodeResult,
} from '../lib/geocoding';
import {
  bearingAtDistance,
  buildRouteGeometry,
  projectOntoRoute,
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
import { userFacingMessage } from '../lib/errors';
import {
  fetchSpeedCameras,
  shouldFetchCameras,
  type SpeedCamera,
} from '../lib/cameras';
import {
  fetchTrafficIncidents,
  INCIDENT_BBOX_PADDING,
  INCIDENT_REFRESH_MS,
  padBbox,
  resolveTrafficKey,
  routeBbox,
  routeKey,
  shouldFetchIncidents,
  type TrafficIncident,
} from '../lib/traffic';
import { createElm327, type Elm327Client } from '../lib/obd/elm327';
import {
  buildMode01Request,
  decodeDistanceKm,
  decodeOdometerRaw,
  decodeSpeedKmh,
  DISTANCE_UNIT_METERS,
  PID_DISTANCE,
  PID_ODOMETER,
  PID_SPEED,
} from '../lib/obd/pids';
import { runObdDiagnostics } from '../lib/obd/diagnostics';
import { ODOMETER_UNIT_METERS } from '../lib/obd/reckoning';
import type { CounterKind } from '../lib/obd/elm327';
import {
  applyExternalCalibration,
  applyOdometerSample,
  applySpeedSample,
  createReckoningState,
  type ReckoningState,
} from '../lib/obd/reckoning';
import {
  applyGpsSample,
  createGpsAnchorState,
  type GpsAnchorState,
} from '../lib/obd/gpsAnchor';
import {
  createWebBluetoothTransport,
  isWebBluetoothAvailable,
  type ObdTransport,
} from '../lib/obd/transport';
import {
  isGeolocationAvailable,
  requestCompassAccess,
  startWatchingLocation,
  type LocationWatcher,
  type UserLocation,
} from '../lib/geolocation';
import { clearToken, persistToken, resolveMapboxToken } from '../lib/token';
import type {
  CoordinateTuple,
  ObdState,
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

/**
 * Bounds on the speed increment. Below 1 km/h a press does nothing visible, and above
 * 50 two presses cross most of the usable range, which makes the buttons unusable for
 * the fine adjustment they exist to provide.
 */
export const MIN_SPEED_STEP_KMH = 1;
export const MAX_SPEED_STEP_KMH = 50;
export const SPEED_STEP_PRESETS_KMH = [5, 10, 20];

/** Speed poll period. A clone sustains roughly 4-10 responses a second in total. */
export const OBD_POLL_INTERVAL_MS = 250;
/** Odometer is polled every Nth cycle: it only ticks every 100 m, so 1 Hz is generous. */
export const OBD_ODOMETER_EVERY_NTH = 4;

/**
 * Swappable so the headless suites can drive a scripted adapter. Production never calls
 * the setter, and `createWebBluetoothTransport` is the only thing that touches the radio.
 */
let obdTransportFactory: () => ObdTransport = createWebBluetoothTransport;
/** What the UI needs about the two overlays. The request policy lives in lib/traffic. */
export interface TrafficState {
  isCongestionOn: boolean;
  isIncidentsOn: boolean;
  incidents: TrafficIncident[];
  /** `unavailable` means no TomTom key was built in, so no incident control renders. */
  status: 'unavailable' | 'idle' | 'loading' | 'error';
  error: string | null;
  /** Identifies the route geometry the cached incidents were fetched for. */
  fetchedRouteKey: string | null;
  fetchedAt: number | null;

  /**
   * Speed cameras from OpenStreetMap. Kept in this slice because they are the same kind
   * of thing to the driver, but they need no key and never expire, so they carry their
   * own cache key and no timestamp.
   */
  isCamerasOn: boolean;
  cameras: SpeedCamera[];
  isLoadingCameras: boolean;
  camerasRouteKey: string | null;
}

/**
 * Swappable so the headless suites can script incident responses without a network.
 * Production never calls the setter.
 */
let incidentsFetcher = fetchTrafficIncidents;

export function setIncidentsFetcher(fetcher: typeof fetchTrafficIncidents): void {
  incidentsFetcher = fetcher;
}

let camerasFetcher = fetchSpeedCameras;

export function setCamerasFetcher(fetcher: typeof fetchSpeedCameras): void {
  camerasFetcher = fetcher;
}

let pendingCameraRequest: AbortController | null = null;

/**
 * Held outside React with the other long-lived handles. The interval runs only while a
 * route is locked, which is the only time incidents are worth re-asking for: it is
 * started by the same lock that triggers the first fetch and cleared on release.
 */
let incidentRefreshTimer: ReturnType<typeof setInterval> | null = null;
let pendingIncidentRequest: AbortController | null = null;

function stopIncidentRefreshTimer(): void {
  if (incidentRefreshTimer !== null) clearInterval(incidentRefreshTimer);
  incidentRefreshTimer = null;
}

/**
 * The single entry point for both ways of committing to a route - the lock button and
 * Play, which locks as a side effect. Declared here rather than inlined twice so the
 * two cannot drift, which is exactly how `play` came to set `isRouteLocked` directly.
 */
function startIncidentsForDrive(): void {
  void useSimulationStore.getState().refreshIncidents();
  void useSimulationStore.getState().refreshCameras();
  if (incidentRefreshTimer !== null) return;
  incidentRefreshTimer = setInterval(() => {
    const state = useSimulationStore.getState();
    if (!state.isRouteLocked || !state.traffic.isIncidentsOn) {
      stopIncidentRefreshTimer();
      return;
    }
    void state.refreshIncidents();
  }, INCIDENT_REFRESH_MS);
  // A half-hour timer is long enough to outlive whatever started it. Unreferenced so it
  // can never be the reason a process stays alive - which is exactly what it did to the
  // headless suites, where a locked route left node hanging for the full interval.
  (incidentRefreshTimer as { unref?: () => void }).unref?.();
}

export function setObdTransportFactory(factory: () => ObdTransport): void {
  obdTransportFactory = factory;
}

/**
 * Swappable so the headless suites can drive a scripted fix stream. Production never
 * calls the setter; `startWatchingLocation` is the only thing that touches the radio.
 */
let locationWatcherFactory = startWatchingLocation;
export function setLocationWatcherFactory(factory: typeof startWatchingLocation): void {
  locationWatcherFactory = factory;
}

/** Monotonic where available: a wall clock that steps backwards would invent distance. */
function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

const DISCONNECTED_OBD: ObdState = {
  status: 'disconnected',
  adapterName: null,
  odometerSupported: false,
  isCalibrated: false,
  calibration: 1,
  degraded: false,
  lastSpeedKmh: null,
  error: null,
};

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
  speedStepUpKmh: 10,
  speedStepDownKmh: 5,
  unitSystem: 'metric',
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
  /** Current map zoom, which gates the incident overlay (MIN_INCIDENT_ZOOM). */
  viewportZoom: number | null;

  traffic: TrafficState;
  /** Incremented to ask the map to frame the whole route once. */
  fitRequestId: number;
  /** Incremented to ask the map to rotate back to north. */
  northRequestId: number;
  /**
   * Asks the map to step its zoom while staying on the vehicle. Carries a direction,
   * so unlike the fit and north requests the id alone is not enough.
   */
  zoomRequest: { id: number; delta: number };
  /**
   * Asks the map to fly to one coordinate. Raised only by the location seed: adding a
   * stop deliberately never moves the camera, but a point the user cannot see is not
   * useful confirmation that the fix landed where they are.
   */
  focusRequest: { id: number; coordinate: CoordinateTuple | null };

  routePoints: RoutePoint[];
  geometry: RouteGeometry | null;
  activeRoute: RouteMetadata | null;
  isRouting: boolean;

  config: SimulationConfig;
  /** Adapter status for the UI. The reckoning arithmetic is held outside the store. */
  obd: ObdState;
  /** A location fix is in flight, so the button can show it rather than look dead. */
  isLocating: boolean;
  /** True while the device's position is being watched. */
  isLocationOn: boolean;
  /**
   * Where the device actually is, shown as its own marker. Deliberately separate from
   * `telemetry.currentCoordinate`, which is a simulated position along a planned route
   * rather than a report of where the phone is - conflating the two would mean the app
   * could not show you standing somewhere off the route.
   */
  userLocation: UserLocation | null;
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
  /** Saves or clears the TomTom key, and re-gates the incident surface on the result. */
  setTomtomKey: (key: string | null) => void;
  openSettings: (open: boolean) => void;
  openHistory: (open: boolean) => void;
  openPlan: (open: boolean) => void;
  openMenu: (open: boolean) => void;
  setDrawArmed: (armed: boolean) => void;
  setRouteLocked: (locked: boolean) => void;
  resetNorth: () => void;
  requestZoom: (delta: number) => void;
  applyStroke: (stroke: CoordinateTuple[]) => Promise<void>;
  setViewport: (viewport: BoundingBox, zoom?: number) => void;
  toggleCongestionOverlay: () => void;
  toggleIncidentsOverlay: () => void;
  /**
   * Fetches incidents for the current route. Called when the route is locked or played,
   * every half hour while driving, and by the manual refresh; `force` is the manual
   * path and is the only one that ignores the cache.
   */
  refreshIncidents: (force?: boolean) => Promise<void>;
  toggleCamerasOverlay: () => void;
  /** Fetches speed cameras along the current route. Silent on failure by design. */
  refreshCameras: (force?: boolean) => Promise<void>;
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
  /** Moves the speed by the increment configured for that direction. */
  adjustSpeed: (direction: StepDirection) => void;
  setSpeedStep: (direction: StepDirection, kmh: number) => void;
  setUnitSystem: (system: SimulationConfig['unitSystem']) => void;
  /**
   * Turns the location marker on or off. It shows where the device is and nothing more:
   * it places no stops and does not drive the cursor. Deliberately not named `use...`:
   * a store action with that prefix trips the rules-of-hooks lint at every call site,
   * which reads as a real error and is not one.
   */
  toggleUserLocation: () => Promise<void>;
  setCameraTracking: (enabled: boolean) => void;

  connectObd: () => Promise<void>;
  disconnectObd: () => Promise<void>;
  /** One round of the poll cycle. Exposed so tests drive it instead of a timer. */
  pollObdOnce: () => Promise<void>;
  /**
   * Asks the car everything worth asking about distance and prints it. Runs once at
   * connect and again on demand, because the answers change with engine state: a PID
   * that reads zero on a parked car is only informative once it has been read moving.
   */
  runObdProbes: () => Promise<void>;
  /**
   * Resolves once the connect-time sweep has finished. It is started unawaited so the
   * connect button does not hang on it, which leaves a test no way to tell the sweep's
   * commands from the poll cycle's. This is that way.
   */
  obdProbesSettled: () => Promise<void>;
  applyObdSpeed: (speedKmh: number, timestampMs: number) => void;
  applyObdOdometer: (odometerRaw: number) => void;

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

/**
 * OBD session state. Held here rather than in the store for the same reason
 * `stepAnimation` is: it changes several times a second and nothing renders from it
 * directly, so putting it in React state would be re-rendering the tree for arithmetic.
 */
let obdTransport: ObdTransport | null = null;
let obdClient: Elm327Client | null = null;
let reckoning: ReckoningState = createReckoningState();
let obdPollTimer: ReturnType<typeof setInterval> | null = null;
let obdPollCycle = 0;
/**
 * The absolute distance counter this session anchors to, chosen at connect. Held out
 * here with the rest of the session state because it is read on every poll.
 */
let obdCounter: CounterKind = 'none';
/** The connect-time sweep, kept so `obdProbesSettled` can be awaited. */
let obdProbeRun: Promise<void> = Promise.resolve();
let gpsAnchor: GpsAnchorState = createGpsAnchorState();
/** AC-614: the arrival toast fires once per arrival, not once per sample. */
let routeEndAnnounced = false;

/**
 * Poll diagnostics, console only (D-93).
 *
 * The first few exchanges are printed raw, because what the adapter actually sends back
 * is the one thing no amount of reading the code will tell you, and then a tally every
 * few seconds so a session can be watched without flooding the log. Bounded on purpose:
 * this runs several times a second for the length of a drive.
 */
let pollReports = 0;
const pollTally = { ok: 0, undecodable: 0, failed: 0 };
const POLL_RAW_SAMPLES = 6;
const POLL_TALLY_EVERY = 40;

function reportPoll(outcome: 'ok' | 'undecodable' | 'failed', lines: string[]): void {
  pollTally[outcome] += 1;
  pollReports += 1;
  if (pollReports <= POLL_RAW_SAMPLES) {
    console.info(`[obd] poll ${pollReports} ${outcome}: ${JSON.stringify(lines)}`);
    return;
  }
  if (pollReports % POLL_TALLY_EVERY === 0) {
    console.info(
      `[obd] polls ${pollReports}: ok=${pollTally.ok} ` +
        `undecodable=${pollTally.undecodable} failed=${pollTally.failed} | ` +
        `reckoned=${reckoning.distanceMeters.toFixed(0)} m ` +
        `raw=${reckoning.rawIntegratedMeters.toFixed(0)} m ` +
        `k=${reckoning.k.toFixed(4)}${reckoning.isCalibrated ? '' : ' (assumed)'} ` +
        `residual=${reckoning.residualMeters.toFixed(1)} m ` +
        `degraded=${reckoning.degraded} | ` +
        `counter=${obdCounter} odo=${lastCounterCount ?? '-'} | ` +
        `gps windows=${gpsAnchor.acceptedWindows} rejected=${gpsAnchor.rejectedFixes} ` +
        `last=${gpsAnchor.lastVerdict ?? 'no fix yet'}`,
    );
  }
}

/**
 * Last absolute counter reading seen, so a reading that has not moved can be logged as
 * silence rather than repeated. A counter that never advances is the failure this whole
 * sweep is looking for, and it is only visible as an absence.
 */
let lastCounterCount: number | null = null;

/**
 * Prints a counter reply only when the count actually changes.
 *
 * At one reading a second an unfiltered log buries the drive in identical lines, and the
 * useful events are the transitions: the first reading, every increment, and a decrease,
 * which means a rollover or a codes-clear and is refused by the reckoner.
 */
function reportCounter(pid: number, lines: string[], count: number | null): void {
  const label = `01${pid.toString(16).toUpperCase().padStart(2, '0')}`;
  if (count === null) {
    console.info(`[obd] counter ${label}: undecodable ${JSON.stringify(lines)}`);
    return;
  }
  if (lastCounterCount === null) {
    console.info(`[obd] counter ${label}: first reading ${count}`);
  } else if (count !== lastCounterCount) {
    const step = count - lastCounterCount;
    console.info(
      `[obd] counter ${label}: ${lastCounterCount} -> ${count} (${step > 0 ? '+' : ''}${step})` +
        (step < 0 ? ' - went backwards, the reckoner will refuse it' : ''),
    );
  }
  lastCounterCount = count;
}

/** Reset per session, so a reconnect prints fresh samples rather than staying quiet. */
function resetPollDiagnostics(): void {
  pollReports = 0;
  pollTally.ok = 0;
  pollTally.undecodable = 0;
  pollTally.failed = 0;
  lastCounterCount = null;
}
/** Held outside React: it is a subscription handle, not something anything renders. */
let locationWatcher: LocationWatcher | null = null;

/**
 * Offers one fix to the calibration anchor.
 *
 * Only ever runs while the OBD link is live, because the anchor measures GPS *against*
 * integrated wheel speed and has nothing to compare against without it. The fix is
 * projected onto the route first: that converts a two-dimensional position into a
 * distance along the road and discards lateral error in the process, since an error
 * perpendicular to the direction of travel barely moves the along-route figure.
 *
 * Everything that decides whether the fix is believed lives in `gpsAnchor`, pure and
 * tested. This function only gathers the inputs and applies the outcome.
 */
function feedGpsAnchor(location: UserLocation): void {
  const state = useSimulationStore.getState();
  if (state.obd.status !== 'connected') return;
  const geometry = state.geometry;
  if (!geometry) return;

  const projected = projectOntoRoute(geometry.line, location.coordinate);
  if (!projected) return;

  const outcome = applyGpsSample(
    gpsAnchor,
    {
      routeDistanceMeters: projected.distanceMeters,
      offRouteMeters: metersBetween(location.coordinate, projected.coordinate),
      accuracyMeters: location.accuracyMeters,
      timestampMs: nowMs(),
      reckonedMeters: reckoning.rawIntegratedMeters,
    },
    reckoning.k,
  );
  gpsAnchor = outcome.state;

  if (outcome.calibration === null) return;

  const previous = reckoning;
  reckoning = applyExternalCalibration(previous, outcome.calibration);
  if (reckoning.k === previous.k) return;

  // Persisted like the counter-derived factor: it describes the car, not the trip.
  settingsRepository.update({ obdCalibration: reckoning.k });
  useSimulationStore.setState({
    obd: {
      ...useSimulationStore.getState().obd,
      calibration: reckoning.k,
      isCalibrated: reckoning.isCalibrated,
    },
  });
  console.info(
    `[obd] GPS calibration committed: k=${reckoning.k.toFixed(4)} ` +
      `after ${gpsAnchor.acceptedWindows} windows, ${gpsAnchor.rejectedFixes} fixes rejected`,
  );
}

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
        // Cameras cost nothing per use and are on by default, so they follow the route
        // as soon as it exists rather than waiting for a lock that may never come.
        // `refreshCameras` is itself gated on the layer being on and on the route having
        // actually changed, so this is a no-op when either is false.
        void get().refreshCameras();
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const message = userFacingMessage(error, 'Route calculation failed.');
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
            userFacingMessage(error, 'Address search failed.'),
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
      viewportZoom: null,

      traffic: {
        // Mirrors the D-24 OBD gate: with no key the whole surface reports
        // `unavailable` and no incident control is rendered at all.
        isCongestionOn: settingsRepository.read().congestionOverlay,
        isIncidentsOn: resolveTrafficKey() !== null && settingsRepository.read().incidentsOverlay,
        incidents: [],
        status: resolveTrafficKey() === null ? 'unavailable' : 'idle',
        error: null,
        fetchedRouteKey: null,
        fetchedAt: null,

        // No key to gate on: OSM is open, so this is offered wherever the app runs.
        isCamerasOn: settingsRepository.read().camerasOverlay,
        cameras: [],
        isLoadingCameras: false,
        camerasRouteKey: null,
      },
      fitRequestId: 0,
      northRequestId: 0,
      zoomRequest: { id: 0, delta: 0 },
      focusRequest: { id: 0, coordinate: null },

      routePoints: [],
      geometry: null,
      activeRoute: null,
      isRouting: false,

      // The handedness preference is the only config field that survives a reload.
      config: { ...DEFAULT_CONFIG, controlsMirrored: settingsRepository.read().controlsMirrored },
      telemetry: { ...EMPTY_TELEMETRY, currentSpeedKmh: DEFAULT_CONFIG.speedKmh },
      displayTelemetry: { ...EMPTY_TELEMETRY, currentSpeedKmh: DEFAULT_CONFIG.speedKmh },

      // D-24: with no Web Bluetooth the status is `unavailable`, and every OBD control
      // checks that before rendering, so the existing PWA is untouched.
      obd: {
        ...DISCONNECTED_OBD,
        status: isWebBluetoothAvailable() ? 'disconnected' : 'unavailable',
        calibration: settingsRepository.read().obdCalibration,
      },

      isLocating: false,
      isLocationOn: false,
      userLocation: null,

      savedRoutes: routeRepository.list(),
      toasts: [],
      undoStack: [],

      setToken: (token) => {
        persistToken(token);
        set({ mapboxToken: token.trim(), isSettingsOpen: false });
      },

      setTomtomKey: (key) => {
        settingsRepository.update({ tomtomApiKey: key === null ? null : key.trim() });
        // `status` was decided at store creation from whatever key existed then, so it
        // has to be re-derived here or saving a key would leave the incident surface
        // reporting `unavailable` until the next reload.
        const hasKey = resolveTrafficKey() !== null;
        const traffic = get().traffic;
        if (hasKey) {
          set({ traffic: { ...traffic, status: traffic.status === 'unavailable' ? 'idle' : traffic.status } });
          return;
        }
        // The key went away, so the layer goes with it rather than being left on with
        // nothing behind it.
        pendingIncidentRequest?.abort();
        pendingIncidentRequest = null;
        stopIncidentRefreshTimer();
        settingsRepository.update({ incidentsOverlay: false });
        set({
          traffic: {
            ...traffic,
            status: 'unavailable',
            isIncidentsOn: false,
            incidents: [],
            error: null,
            fetchedRouteKey: null,
            fetchedAt: null,
          },
        });
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
        // Locking is the commitment to drive this route, and the only moment traffic
        // data is worth paying for. Releasing it stops the half-hour refresh; the
        // incidents already fetched stay on the map until the route actually changes.
        if (locked) startIncidentsForDrive();
        else stopIncidentRefreshTimer();
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

      setViewport: (viewport, zoom) => {
        // Publishes bounds for search biasing only. Panning deliberately triggers no
        // traffic request: incidents follow the route, not the view.
        set({ viewport, viewportZoom: zoom ?? get().viewportZoom });
      },

      toggleCongestionOverlay: () => {
        const next = !get().traffic.isCongestionOn;
        set({ traffic: { ...get().traffic, isCongestionOn: next } });
        settingsRepository.update({ congestionOverlay: next });
      },

      toggleIncidentsOverlay: () => {
        const traffic = get().traffic;
        if (traffic.status === 'unavailable') return;
        const next = !traffic.isIncidentsOn;
        settingsRepository.update({ incidentsOverlay: next });

        if (!next) {
          pendingIncidentRequest?.abort();
          pendingIncidentRequest = null;
          stopIncidentRefreshTimer();
          set({
            traffic: {
              ...traffic,
              isIncidentsOn: false,
              incidents: [],
              status: 'idle',
              error: null,
              fetchedRouteKey: null,
              fetchedAt: null,
            },
          });
          return;
        }

        set({ traffic: { ...traffic, isIncidentsOn: true, error: null } });
        // Switching the layer on mid-drive should show something rather than wait for
        // the next lock, so an already-locked route fetches immediately.
        if (get().isRouteLocked) startIncidentsForDrive();
      },

      refreshIncidents: async (force = false) => {
        const state = get();
        const key = resolveTrafficKey();
        const geometry = state.geometry;
        const currentRouteKey = routeKey(
          geometry?.coordinates,
          geometry?.totalDistanceMeters ?? 0,
        );

        if (
          !shouldFetchIncidents({
            enabled: state.traffic.isIncidentsOn,
            hasKey: key !== null,
            routeKey: currentRouteKey,
            cache: {
              routeKey: state.traffic.fetchedRouteKey,
              fetchedAt: state.traffic.fetchedAt,
            },
            now: Date.now(),
            force,
          })
        ) {
          return;
        }

        const bounds = routeBbox(geometry?.coordinates);
        // Guarded although `routeKey` already implies geometry: the two derive from the
        // same source, and a silent undefined here would become a malformed query.
        if (!bounds || !key) return;
        const bbox = padBbox(bounds, INCIDENT_BBOX_PADDING);

        pendingIncidentRequest?.abort();
        const controller = new AbortController();
        pendingIncidentRequest = controller;

        set({ traffic: { ...get().traffic, status: 'loading', error: null } });

        try {
          const incidents = await incidentsFetcher(bbox, key, controller.signal);
          if (pendingIncidentRequest !== controller) return;
          pendingIncidentRequest = null;
          // A toggle-off that landed mid-flight wins: do not repopulate a hidden layer.
          if (!get().traffic.isIncidentsOn) return;
          set({
            traffic: {
              ...get().traffic,
              incidents,
              status: 'idle',
              error: null,
              fetchedRouteKey: currentRouteKey,
              fetchedAt: Date.now(),
            },
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          if (pendingIncidentRequest !== controller) return;
          pendingIncidentRequest = null;
          const message = userFacingMessage(error, 'Could not load traffic incidents.');
          set({
            traffic: {
              ...get().traffic,
              status: 'error',
              error: message,
              // The cache is left empty so the next lock retries rather than trusting a
              // fetch that never landed.
              fetchedRouteKey: null,
              fetchedAt: null,
            },
          });
          // Surfaced rather than left in the corner of the menu: the driver asked for
          // hazards and is not getting them.
          get().pushToast('error', message);
        }
      },

      toggleCamerasOverlay: () => {
        const next = !get().traffic.isCamerasOn;
        settingsRepository.update({ camerasOverlay: next });

        if (!next) {
          pendingCameraRequest?.abort();
          pendingCameraRequest = null;
          set({
            traffic: {
              ...get().traffic,
              isCamerasOn: false,
              cameras: [],
              isLoadingCameras: false,
              camerasRouteKey: null,
            },
          });
          return;
        }

        set({ traffic: { ...get().traffic, isCamerasOn: true } });
        // Cameras are static, so showing them does not have to wait for a lock: if a
        // route already exists there is nothing to gain by withholding them.
        void get().refreshCameras();
      },

      refreshCameras: async (force = false) => {
        const state = get();
        const geometry = state.geometry;
        const currentRouteKey = routeKey(
          geometry?.coordinates,
          geometry?.totalDistanceMeters ?? 0,
        );

        if (
          !shouldFetchCameras({
            enabled: state.traffic.isCamerasOn,
            routeKey: currentRouteKey,
            cachedRouteKey: state.traffic.camerasRouteKey,
            force,
          })
        ) {
          return;
        }
        if (!geometry) return;

        pendingCameraRequest?.abort();
        const controller = new AbortController();
        pendingCameraRequest = controller;
        set({ traffic: { ...get().traffic, isLoadingCameras: true } });

        let cameras: SpeedCamera[] = [];
        try {
          cameras = await camerasFetcher(geometry.coordinates, controller.signal);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          // Overpass being down is routine, not an incident worth a toast. The layer
          // stays empty and the next lock tries again.
          cameras = [];
        }
        if (pendingCameraRequest !== controller) return;
        pendingCameraRequest = null;
        if (!get().traffic.isCamerasOn) return;

        set({
          traffic: {
            ...get().traffic,
            cameras,
            isLoadingCameras: false,
            // Only a successful fetch claims the route, so an empty result from a
            // throttled Overpass is retried rather than cached as "no cameras here".
            camerasRouteKey: cameras.length > 0 ? currentRouteKey : null,
          },
        });
      },

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
        // D-21: while connected the adapter writes this, and the slider is a readout.
        // Guarding the action as well as disabling the input means a stray programmatic
        // call cannot silently desync the displayed speed from the measured one.
        if (get().obd.status === 'connected') return;
        const clamped = Math.min(Math.max(kmh, 0), MAX_SPEED_KMH);
        const { geometry, telemetry } = get();
        set({
          config: { ...get().config, speedKmh: clamped },
          telemetry: buildTelemetry(geometry, telemetry.currentDistanceMeters, clamped),
        });
        get().syncDisplayTelemetry();
      },

      /**
       * Routed through `setSpeed` rather than writing the config directly, so the
       * guard that stops a connected adapter's reading being overwritten lives in
       * exactly one place and cannot be bypassed by pressing a button instead.
       */
      adjustSpeed: (direction) => {
        const { speedKmh, speedStepUpKmh, speedStepDownKmh } = get().config;
        const step = direction === 1 ? speedStepUpKmh : speedStepDownKmh;
        get().setSpeed(speedKmh + direction * step);
      },

      setSpeedStep: (direction, kmh) => {
        const clamped = Math.min(
          Math.max(Math.round(kmh), MIN_SPEED_STEP_KMH),
          MAX_SPEED_STEP_KMH,
        );
        const key = direction === 1 ? 'speedStepUpKmh' : 'speedStepDownKmh';
        set({ config: { ...get().config, [key]: clamped } });
      },

      setUnitSystem: (system) => set({ config: { ...get().config, unitSystem: system } }),

      /**
       * Drops the start pin on wherever the device says it is. Offered only while the
       * route is empty (AC-616), because it seeds a route rather than navigating one -
       * GPS does not drive the cursor, and this does not make it start.
       */
      toggleUserLocation: async () => {
        if (get().isLocationOn) {
          locationWatcher?.stop();
          locationWatcher = null;
          set({ isLocationOn: false, userLocation: null, isLocating: false });
          return;
        }

        if (!isGeolocationAvailable()) {
          get().pushToast('error', 'This browser cannot report a location.');
          return;
        }

        set({ isLocating: true });
        // Asked for from inside the press, because iOS gates the compass behind a
        // prompt that only a user gesture may raise. A refusal is not a failure: the
        // arrow falls back to GPS course alone and simply disappears at a standstill.
        await requestCompassAccess();

        let hasFlown = false;
        locationWatcher = locationWatcherFactory({
          onUpdate: (location) => {
            set({ userLocation: location, isLocating: false, isLocationOn: true });
            // One flight, on the first fix. After that the camera is the user's, and
            // the marker moves within whatever view they have chosen - following it
            // would fight both manual panning and the vehicle tracking.
            if (!hasFlown) {
              hasFlown = true;
              set({
                focusRequest: { id: get().focusRequest.id + 1, coordinate: location.coordinate },
              });
            }
            feedGpsAnchor(location);
          },
          onError: (message) => {
            locationWatcher?.stop();
            locationWatcher = null;
            set({ isLocationOn: false, userLocation: null, isLocating: false });
            get().pushToast('error', message);
          },
        });
        set({ isLocationOn: true });
      },

      connectObd: async () => {
        const { status } = get().obd;
        if (status === 'unavailable' || status === 'connecting' || status === 'connected') return;

        set({ obd: { ...get().obd, status: 'connecting', error: null } });
        try {
          const transport = obdTransportFactory();
          await transport.connect();
          const client = createElm327(transport);
          const init = await client.initialize();
          /*
            Console only, like the GATT discovery it follows (D-93). Discovery alone says
            the adapter was reached; this says what the car then answered, which is the
            half that decides whether distance can be trusted. Without it, a paste of the
            console shows a successful connection and nothing about the outcome.
          */
          console.info(
            [
              `[obd] adapter: ${init.identity ?? '(no identity reported)'}`,
              `[obd] bus answered 0100: ${init.respondedToSupportProbe}`,
              `[obd] odometer: ${init.odometerSupported} (decided by ${init.odometerSource})`,
              `[obd] distance counter: ${init.counter} (found by ${init.counterSource})`,
            ].join('\n'),
          );

          obdTransport = transport;
          obdClient = client;
          obdPollCycle = 0;
          obdCounter = init.counter;
          gpsAnchor = createGpsAnchorState();
          routeEndAnnounced = false;
          resetPollDiagnostics();
          // D-23: the stored calibration describes this car, so a session starts already
          // corrected. `isCalibrated` stays false until the odometer confirms it here.
          reckoning = {
            ...createReckoningState(),
            k: settingsRepository.read().obdCalibration,
          };

          transport.onDisconnect(() => {
            if (get().obd.status !== 'connected') return;
            get().pushToast('error', 'The OBD adapter disconnected.');
            void get().disconnectObd();
          });

          set({
            obd: {
              status: 'connected',
              adapterName: init.identity,
              odometerSupported: init.odometerSupported,
              isCalibrated: false,
              calibration: reckoning.k,
              degraded: false,
              lastSpeedKmh: null,
              error: null,
            },
          });

          if (!init.odometerSupported) {
            // Not a failure: plenty of cars never answer 01A6. It changes how far the
            // distance can be trusted, so it is said once rather than hidden.
            get().pushToast('info', 'No odometer on this car - distance will drift over a long drive.');
          }

          obdPollTimer = setInterval(() => void get().pollObdOnce(), OBD_POLL_INTERVAL_MS);

          /*
            Unawaited on purpose. The sweep is around twenty round trips, which on a
            clone adapter is long enough that awaiting it would leave the connect button
            spinning for most of a minute. The command queue is strictly serial, so the
            sweep and the speed polls interleave safely rather than racing; the only
            cost is that the first few seconds of polling run at a lower rate.
          */
          obdProbeRun = get().runObdProbes();
        } catch (error) {
          // Gated on type, not on truthiness: a DOMException from the Bluetooth stack
          // and a TypeError from a bug are both `Error`, and both carry code detail.
          const message = userFacingMessage(error, 'Could not reach the adapter.');
          set({ obd: { ...get().obd, status: 'disconnected', error: message } });
          get().pushToast('error', message);
        }
      },

      disconnectObd: async () => {
        if (obdPollTimer !== null) {
          clearInterval(obdPollTimer);
          obdPollTimer = null;
        }
        obdClient?.dispose();
        const transport = obdTransport;
        obdClient = null;
        obdTransport = null;
        // AC-612: the last measured speed stays on the slider, which becomes writable
        // again. Zeroing it would be a worse lie than a stale reading.
        set({
          obd: {
            ...DISCONNECTED_OBD,
            status: isWebBluetoothAvailable() ? 'disconnected' : 'unavailable',
            calibration: reckoning.k,
          },
        });
        await transport?.disconnect();
      },

      obdProbesSettled: () => obdProbeRun,

      runObdProbes: async () => {
        const client = obdClient;
        if (!client) {
          console.info('[obd] no adapter connected, nothing to probe');
          return;
        }
        // `runObdDiagnostics` already swallows everything it can; this guard covers the
        // case of the client itself disappearing between the check above and the call.
        try {
          await runObdDiagnostics((command, timeoutMs) => client.send(command, timeoutMs));
        } catch {
          console.info('[obd] diagnostic sweep could not run');
        }
      },

      pollObdOnce: async () => {
        const client = obdClient;
        if (!client || get().obd.status !== 'connected') return;

        try {
          const lines = await client.send(buildMode01Request(PID_SPEED));
          const speed = decodeSpeedKmh(lines);
          // Console only. A swallowed failure and a genuinely stationary car produce
          // the same zero on the dial, and there was no way to tell them apart.
          reportPoll(speed === null ? 'undecodable' : 'ok', lines);
          if (speed !== null) get().applyObdSpeed(speed, nowMs());

          obdPollCycle += 1;
          if (obdCounter !== 'none' && obdPollCycle % OBD_ODOMETER_EVERY_NTH === 0) {
            // Whichever counter this car turned out to have. The reckoner takes the unit
            // alongside the count, so the two PIDs share one anchoring path.
            const pid = obdCounter === 'odometer' ? PID_ODOMETER : PID_DISTANCE;
            const reply = await client.send(buildMode01Request(pid));
            const count =
              obdCounter === 'odometer' ? decodeOdometerRaw(reply) : decodeDistanceKm(reply);
            reportCounter(pid, reply, count);
            if (count !== null) get().applyObdOdometer(count);
          }
        } catch (error) {
          // A dropped reply is routine on a clone adapter. The gap guard in the
          // reckoner already accounts for the lost interval, so the next tick just
          // carries on rather than tearing the session down over one timeout.
          reportPoll('failed', [userFacingMessage(error, 'no reply')]);
        }
      },

      applyObdSpeed: (speedKmh, timestampMs) => {
        const previous = reckoning;
        reckoning = applySpeedSample(previous, speedKmh, timestampMs);
        const advanceMeters = reckoning.distanceMeters - previous.distanceMeters;

        const measured = Math.min(Math.max(speedKmh, 0), MAX_SPEED_KMH);
        set({
          config: { ...get().config, speedKmh: measured },
          obd: { ...get().obd, lastSpeedKmh: speedKmh, degraded: reckoning.degraded },
        });

        const { geometry, config, telemetry } = get();
        // The cursor follows the car only once Play has been pressed (D-21). Before
        // that the speed is shown but the marker stays where the planning left it.
        if (!geometry || !config.isPlaying) {
          get().syncDisplayTelemetry();
          return;
        }

        if (advanceMeters !== 0) {
          applyDistance(telemetry.currentDistanceMeters + advanceMeters, { pauseAtEnd: true });
        }

        const reachedEnd =
          get().telemetry.currentDistanceMeters >= geometry.totalDistanceMeters - 0.001;
        if (reachedEnd && !routeEndAnnounced) {
          routeEndAnnounced = true;
          get().pushToast('info', 'Route complete.');
        } else if (!reachedEnd) {
          routeEndAnnounced = false;
        }
        get().syncDisplayTelemetry();
      },

      applyObdOdometer: (odometerRaw) => {
        const previous = reckoning;
        reckoning = applyOdometerSample(
          previous,
          odometerRaw,
          obdCounter === 'distance' ? DISTANCE_UNIT_METERS : ODOMETER_UNIT_METERS,
        );
        if (reckoning.k === previous.k && reckoning.isCalibrated === previous.isCalibrated) return;

        // D-23: the only thing about a drive worth keeping, because it describes the car.
        settingsRepository.update({ obdCalibration: reckoning.k });
        set({
          obd: {
            ...get().obd,
            calibration: reckoning.k,
            isCalibrated: reckoning.isCalibrated,
          },
        });
      },

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
        // Play locks the route without going through `setRouteLocked`, so it has to ask
        // for traffic itself or pressing Play would drive an empty hazard layer.
        startIncidentsForDrive();
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
        const { geometry, config, telemetry, obd } = get();
        if (!geometry || !config.isPlaying) return;

        // Exactly one source may move the cursor. With an adapter connected the car
        // does, through `applyObdSpeed`, which integrates the measured speed over the
        // interval it was actually measured across. Integrating `config.speedKmh` here
        // as well would advance the same second of driving twice: the dial would read
        // correctly while the marker ran at double the real speed.
        if (obd.status === 'connected') return;

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
