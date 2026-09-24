export type CoordinateTuple = [number, number]; // [longitude, latitude]

/** One switch for every unit the UI shows, rather than a separate toggle per quantity. */
export type UnitSystem = 'metric' | 'imperial';

export interface RouteMetadata {
  id: string;
  title: string;
  createdAt: string; // ISO timestamp
  updatedAt?: string; // ISO timestamp of the last commit; absent until first driven
  totalDistanceMeters: number;
  coordinates: CoordinateTuple[];
  /**
   * The user-placed stops this route was built from, so a loaded route stays
   * editable. Absent on routes saved before waypoint persistence existed.
   */
  waypoints?: SavedWaypoint[];
}

/** A stop as persisted in route history. */
export interface SavedWaypoint {
  coordinate: CoordinateTuple;
  label?: string;
}

export interface TelemetryState {
  currentDistanceMeters: number;
  currentSpeedKmh: number;
  remainingDistanceMeters: number;
  etaSeconds: number;
  currentCoordinate: CoordinateTuple | null;
  bearingDegrees: number;
}

export interface SimulationConfig {
  stepForwardMeters: number; // default 500
  stepBackMeters: number;
  /** How long the marker takes to glide through a step, per direction. */
  stepForwardAnimationMs: number;
  stepBackAnimationMs: number; // default 500
  speedKmh: number; // range 0 - 180
  /**
   * How much one press of the speed buttons moves the speed, per direction and always
   * stored in km/h. Asymmetric by default: getting back down to a safe speed wants
   * finer control than winding up to a cruising one.
   */
  speedStepUpKmh: number;
  speedStepDownKmh: number;
  /** Drives both the speed readout and every distance shown. Metric by default. */
  unitSystem: UnitSystem;
  isPlaying: boolean;
  cameraTrackingEnabled: boolean;
  /** Swaps the bottom-left playback cluster with the bottom-right step cluster. */
  controlsMirrored: boolean;
}

export interface AppSettings {
  mapboxAccessToken: string | null;
  /**
   * TomTom key for the incident overlay, entered in Settings. Optional in every sense:
   * the app runs without one, and it is only ever read to decide whether to offer the
   * incident layer at all.
   */
  tomtomApiKey: string | null;
  /** Mirrors the bottom control clusters for left-handed use. */
  controlsMirrored: boolean;
  /**
   * The two traffic overlays, remembered separately. They have different costs - the
   * congestion tileset is bundled with the map tiles, incidents are a metered third
   * party call - so a driver who wants one is not made to pay for the other.
   */
  congestionOverlay: boolean;
  incidentsOverlay: boolean;
  /** Speed cameras from OpenStreetMap. Needs no key, so it is offered everywhere. */
  camerasOverlay: boolean;
  /**
   * Calibration scale learned from the odometer (D-23). It describes the car's wheel
   * circumference rather than any one trip, so unlike everything else about a drive it
   * is worth keeping: the next drive starts already corrected instead of spending its
   * first two kilometres re-learning the same number.
   */
  obdCalibration: number;
}

/** What the UI needs to know about the adapter. The arithmetic lives outside the store. */
export interface ObdState {
  /** `unavailable` is the D-24 gate: no Web Bluetooth, so no OBD surface renders at all. */
  status: 'unavailable' | 'disconnected' | 'connecting' | 'connected';
  adapterName: string | null;
  /** D-18: probed from the 01A0 bitmap at connect, never assumed. */
  odometerSupported: boolean;
  /** True once the odometer has actually moved `k` off its stored value. */
  isCalibrated: boolean;
  calibration: number;
  /** A sample gap was discarded, so the distance is known to be under-counted. */
  degraded: boolean;
  /** Last measured speed, kept separate from `config.speedKmh` for display honesty. */
  lastSpeedKmh: number | null;
  error: string | null;
}

/** A stop the user placed on the map, used as input for the Directions API. */
export interface RoutePoint {
  id: string;
  coordinate: CoordinateTuple;
  /** Human-readable name, e.g. from address search. Absent for map-tapped pins. */
  label?: string;
}

export type ToastKind = 'error' | 'info' | 'success';

export interface ToastMessage {
  id: string;
  kind: ToastKind;
  text: string;
}
