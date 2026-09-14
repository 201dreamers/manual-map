import type { CoordinateTuple, SimulationConfig } from '../types/domain';

const MPH_PER_KMH = 0.621371;

export function kmhToMph(kmh: number): number {
  return kmh * MPH_PER_KMH;
}

export function speedLabel(unit: SimulationConfig['speedUnit']): string {
  return unit === 'kmh' ? 'km/h' : 'mph';
}

export function displaySpeed(speedKmh: number, unit: SimulationConfig['speedUnit']): number {
  return unit === 'kmh' ? speedKmh : kmhToMph(speedKmh);
}

/** Metres below 1 km, kilometres with one decimal above it. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '--';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDistanceKm(meters: number): string {
  if (!Number.isFinite(meters)) return '--';
  return (meters / 1000).toFixed(1);
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

export function formatCoordinate(coordinate: CoordinateTuple | null): string {
  if (!coordinate) return '--.----, --.----';
  const [lng, lat] = coordinate;
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
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
