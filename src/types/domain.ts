export type CoordinateTuple = [number, number]; // [longitude, latitude]

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
  stepBackMeters: number; // default 500
  speedKmh: number; // range 0 - 180
  speedUnit: 'kmh' | 'mph';
  isPlaying: boolean;
  cameraTrackingEnabled: boolean;
  /** Swaps the bottom-left playback cluster with the bottom-right step cluster. */
  controlsMirrored: boolean;
}

export interface AppSettings {
  mapboxAccessToken: string | null;
  /** Mirrors the bottom control clusters for left-handed use. */
  controlsMirrored: boolean;
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
