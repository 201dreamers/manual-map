import { settingsRepository } from './storage';

export type TokenValidation = { ok: true } | { ok: false; reason: string };

/**
 * Only Mapbox public tokens (pk.*) are accepted. Secret tokens (sk.*) must never
 * be pasted into a browser app, so they are rejected before anything is stored.
 */
export function validatePublicToken(token: string): TokenValidation {
  const trimmed = token.trim();
  if (!trimmed) return { ok: false, reason: 'Token is required.' };
  if (trimmed.startsWith('sk.')) {
    return {
      ok: false,
      reason: 'Secret tokens (sk.*) are not allowed. Use a public token (pk.*).',
    };
  }
  if (!trimmed.startsWith('pk.')) {
    return { ok: false, reason: 'Mapbox public tokens must start with "pk.".' };
  }
  if (trimmed.length < 40) return { ok: false, reason: 'Token looks too short to be valid.' };
  return { ok: true };
}

/**
 * FR-6.1 dual-source resolution:
 *   1. token saved in the in-app Settings modal (localStorage)
 *   2. VITE_MAPBOX_ACCESS_TOKEN from the local .env.local file
 */
export function resolveMapboxToken(): string | null {
  const stored = settingsRepository.read().mapboxAccessToken;
  if (stored && validatePublicToken(stored).ok) return stored.trim();

  const envToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
  if (typeof envToken === 'string' && validatePublicToken(envToken).ok) return envToken.trim();

  return null;
}

export function persistToken(token: string): void {
  settingsRepository.update({ mapboxAccessToken: token.trim() });
}

export function clearToken(): void {
  settingsRepository.update({ mapboxAccessToken: null });
}
