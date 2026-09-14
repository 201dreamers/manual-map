/**
 * Shared look for every control floating over the map: a translucent dark pane that
 * keeps the map readable underneath while staying legible against bright tiles.
 */
export const GLASS_SURFACE =
  'bg-slate-900/85 shadow-lg shadow-slate-950/50 ring-1 ring-slate-700 backdrop-blur';

export const GLASS_BUTTON =
  `pointer-events-auto flex items-center justify-center rounded-2xl text-slate-100 transition ` +
  `active:scale-95 active:bg-slate-800 disabled:opacity-40 disabled:active:scale-100 ${GLASS_SURFACE}`;
