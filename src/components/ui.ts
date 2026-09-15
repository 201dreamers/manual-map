/**
 * Shared look for every control floating over the map: a translucent dark pane that
 * keeps the map readable underneath while staying legible against bright tiles.
 */
export const GLASS_SURFACE =
  'bg-slate-900/85 shadow-lg shadow-slate-950/50 ring-1 ring-slate-700 backdrop-blur';

export const GLASS_BUTTON =
  `pointer-events-auto flex items-center justify-center rounded-2xl text-slate-100 transition ` +
  `active:scale-95 active:bg-slate-800 disabled:opacity-40 disabled:active:scale-100 ${GLASS_SURFACE}`;

/**
 * Touch targets for the bottom cluster. The Drive layout (D-1, locked) aims at a
 * thumb that is not looking at the screen, so it is larger than the planning layout.
 * Both are spelled out in full: Tailwind only sees literal class strings.
 */
export const NORMAL_TARGET = 'min-h-[72px] min-w-[72px]';
export const DRIVE_TARGET = 'min-h-[88px] min-w-[88px]';

/**
 * The look-ahead zoom pair is smaller than the playback targets: it is adjusted
 * a few times a drive, not several times a minute, and a full-size pair would push
 * the whole cluster too far up the screen.
 */
export const NORMAL_ZOOM_TARGET = 'min-h-[44px] min-w-[44px]';
export const DRIVE_ZOOM_TARGET = 'min-h-[56px] min-w-[56px]';
