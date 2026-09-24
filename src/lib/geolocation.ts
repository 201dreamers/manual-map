import type { CoordinateTuple } from '../types/domain';

/**
 * The device's own position, shown as a marker in its own right - separate from the
 * vehicle cursor, which is a simulation of movement along a planned route rather than
 * a report of where the phone actually is.
 */
export interface UserLocation {
  coordinate: CoordinateTuple;
  /** Degrees clockwise from true north, or null when no source can supply one. */
  headingDegrees: number | null;
  accuracyMeters: number | null;
}

/**
 * Below this, a GPS course is noise. A satellite fix derives heading from successive
 * positions, so at a standstill it reports whatever the last jitter happened to be -
 * which is why a parked car's arrow spins without a threshold.
 */
export const MOVING_SPEED_MS = 0.5;

/**
 * Picks which source the arrow follows.
 *
 * GPS course wins whenever the device is actually moving, because it reports the
 * direction of travel and is unaffected by the steel box the phone is sitting in. The
 * compass takes over at rest, where GPS has nothing to derive a course from. Some
 * devices report a heading but no speed at all; those are trusted, since the
 * alternative is never using the better source on that hardware.
 */
export function chooseHeading(
  gpsHeadingDegrees: number | null | undefined,
  gpsSpeedMs: number | null | undefined,
  compassHeadingDegrees: number | null | undefined,
): number | null {
  const gps = Number.isFinite(gpsHeadingDegrees) ? (gpsHeadingDegrees as number) : null;
  const speed = Number.isFinite(gpsSpeedMs) ? (gpsSpeedMs as number) : null;
  const compass = Number.isFinite(compassHeadingDegrees)
    ? (compassHeadingDegrees as number)
    : null;

  if (gps !== null && (speed === null || speed >= MOVING_SPEED_MS)) return normalizeDegrees(gps);
  if (compass !== null) return normalizeDegrees(compass);
  return null;
}

export function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/* --- Everything below touches the browser, and is the only part a test replaces. --- */

export interface LocationWatcher {
  stop(): void;
}

export interface LocationWatchHandlers {
  onUpdate(location: UserLocation): void;
  onError(message: string): void;
}

interface OrientationEventWithCompass extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

interface OrientationPermissionApi {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export function isGeolocationAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/**
 * Asks for the compass. iOS gates `deviceorientation` behind its own prompt, which must
 * be triggered by a user gesture, so this is called from the button handler and never
 * on a timer. A refusal is not a failure: the arrow falls back to GPS course alone.
 */
export async function requestCompassAccess(): Promise<boolean> {
  if (typeof DeviceOrientationEvent === 'undefined') return false;
  const api = DeviceOrientationEvent as unknown as OrientationPermissionApi;
  if (typeof api.requestPermission !== 'function') return true;
  try {
    return (await api.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

export function startWatchingLocation(handlers: LocationWatchHandlers): LocationWatcher {
  let compassHeading: number | null = null;

  const onOrientation = (event: Event) => {
    const orientation = event as OrientationEventWithCompass;
    // iOS reports a true heading directly; elsewhere `alpha` counts anticlockwise from
    // north on an absolute event, so it has to be inverted to match GPS course.
    if (typeof orientation.webkitCompassHeading === 'number') {
      compassHeading = orientation.webkitCompassHeading;
    } else if (orientation.absolute && typeof orientation.alpha === 'number') {
      compassHeading = normalizeDegrees(360 - orientation.alpha);
    }
  };

  window.addEventListener('deviceorientationabsolute', onOrientation);
  window.addEventListener('deviceorientation', onOrientation);

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      handlers.onUpdate({
        coordinate: [position.coords.longitude, position.coords.latitude],
        headingDegrees: chooseHeading(
          position.coords.heading,
          position.coords.speed,
          compassHeading,
        ),
        accuracyMeters: Number.isFinite(position.coords.accuracy)
          ? position.coords.accuracy
          : null,
      });
    },
    (error) => {
      handlers.onError(
        error.code === 1
          ? 'Location permission was declined.'
          : error.code === 3
            ? 'Timed out waiting for a location fix.'
            : 'Could not get a location fix.',
      );
    },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
  );

  return {
    stop() {
      navigator.geolocation.clearWatch(watchId);
      window.removeEventListener('deviceorientationabsolute', onOrientation);
      window.removeEventListener('deviceorientation', onOrientation);
    },
  };
}
