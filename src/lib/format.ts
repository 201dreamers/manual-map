import type { UnitSystem } from '../types/domain';

const MPH_PER_KMH = 0.621371;
const FEET_PER_METER = 3.28084;
const METERS_PER_MILE = 1609.344;

/**
 * Where the short form switches from small units to large. A thousand feet is about
 * 0.19 miles, which keeps the crossover at a number a driver can picture, the same way
 * the metric side crosses at a round kilometre.
 */
const FEET_CROSSOVER = 1000;

export function kmhToMph(kmh: number): number {
  return kmh * MPH_PER_KMH;
}

export function mphToKmh(mph: number): number {
  return mph / MPH_PER_KMH;
}

export function speedLabel(system: UnitSystem): string {
  return system === 'metric' ? 'km/h' : 'mph';
}

export function displaySpeed(speedKmh: number, system: UnitSystem): number {
  return system === 'metric' ? speedKmh : kmhToMph(speedKmh);
}

/** Back the other way, for settings that are typed in whatever the user is reading. */
export function speedFromDisplay(value: number, system: UnitSystem): number {
  return system === 'metric' ? value : mphToKmh(value);
}

/** Metres below a kilometre, kilometres above it - and the same shape in imperial. */
export function formatDistance(meters: number, system: UnitSystem = 'metric'): string {
  if (!Number.isFinite(meters)) return '--';
  if (system === 'imperial') {
    const feet = meters * FEET_PER_METER;
    if (feet < FEET_CROSSOVER) return `${Math.round(feet)} ft`;
    return `${(meters / METERS_PER_MILE).toFixed(1)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** The large unit alone, unlabelled, for readouts that print the unit once. */
export function formatDistanceMajor(meters: number, system: UnitSystem = 'metric'): string {
  if (!Number.isFinite(meters)) return '--';
  const divisor = system === 'imperial' ? METERS_PER_MILE : 1000;
  return (meters / divisor).toFixed(1);
}

export function distanceMajorLabel(system: UnitSystem): string {
  return system === 'imperial' ? 'mi' : 'km';
}

/** ETA at the currently selected speed; a stopped vehicle never arrives. */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return seconds === 0 ? '0 min' : '--';

  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 1) return '< 1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}


export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
