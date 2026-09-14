export type CoordinateTuple = [number, number]; // [longitude, latitude]

export interface RouteMetadata {
  id: string;
  title: string;
  createdAt: string; // ISO timestamp
  totalDistanceMeters: number;
  coordinates: CoordinateTuple[];
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
}

export interface AppSettings {
  mapboxAccessToken: string | null;
}

/** A point the user tapped on the map, used as input for the Directions API. */
export interface RoutePoint {
  id: string;
  coordinate: CoordinateTuple;
}

export type ToastKind = 'error' | 'info' | 'success';

export interface ToastMessage {
  id: string;
  kind: ToastKind;
  text: string;
}
