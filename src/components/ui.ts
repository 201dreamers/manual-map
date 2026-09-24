/**
 * Shared look for every control floating over the map: a translucent dark pane that
 * keeps the map readable underneath while staying legible against bright tiles.
 */
/**
 * Approximates the look of a physical pane rather than a blurred rectangle. Three parts
 * do the work, none of them expensive:
 *
 *  - thinner tint with a heavier blur and a saturation lift, so the map's colour reads
 *    through the glass instead of being flattened behind it;
 *  - a specular rim - a bright inset line along the top edge and a dark one along the
 *    bottom - which is the single biggest contributor to reading as glass at all;
 *  - a faint diagonal sheen across the surface.
 *
 * What is deliberately absent is refraction: warping the map behind each pane needs an
 * SVG displacement filter through `backdrop-filter`, which Safari supports only partly
 * and which would composite over a live WebGL canvas on every frame. That cost lands
 * during playback, which is exactly when this app cannot afford dropped frames.
 *
 * The tint stays at 60% rather than going thinner. Legibility over bright map tiles is
 * real work that the opacity was doing, and the speed reading has to survive sunlight.
 */
/**
 * Stacking order for everything floating over the map, written down in one place
 * because it was previously implied by DOM order and a few scattered `z-*` classes -
 * which is how a dropped pin ended up painting over the menu.
 *
 * Map content (pins at 0, the vehicle at 1) stays below all of it by construction.
 */
export const Z_CLUSTER = 'z-10';  // the bottom thumb controls
export const Z_DRAWER = 'z-20';   // the plan drawer
export const Z_TOP = 'z-30';      // the top overlay stack, so its menu clears the drawer
export const Z_HISTORY = 'z-40';
export const Z_MODAL = 'z-50';
export const Z_TOAST = 'z-60';

export const GLASS_SURFACE =
  'bg-slate-900/60 ring-1 ring-white/15 backdrop-blur-xl backdrop-saturate-150 ' +
  '[background-image:linear-gradient(160deg,rgb(255_255_255/0.10),transparent_45%)] ' +
  '[box-shadow:inset_0_1px_0_rgb(255_255_255/0.22),inset_0_-1px_0_rgb(0_0_0/0.35),0_10px_30px_-12px_rgb(2_6_23/0.75)]';

/**
 * The same material as `GLASS_SURFACE`, thicker, for the large panels - Settings, the
 * history drawer, the plan drawer. They carry body text, form fields and lists rather
 * than a single glanceable number, so they need the opacity back: a control can be read
 * from its shape and position, a paragraph cannot. Both sit over a darkening scrim as
 * well, which is what makes 85% enough rather than opaque.
 */
export const GLASS_PANEL =
  'bg-slate-900/85 ring-1 ring-white/12 backdrop-blur-2xl backdrop-saturate-150 ' +
  '[background-image:linear-gradient(160deg,rgb(255_255_255/0.07),transparent_45%)] ' +
  '[box-shadow:inset_0_1px_0_rgb(255_255_255/0.18),inset_0_-1px_0_rgb(0_0_0/0.40),0_24px_60px_-20px_rgb(2_6_23/0.85)]';

/**
 * Carries no rounding of its own. Two utilities setting `border-radius` in one class
 * list resolve by stylesheet order rather than by which was written last, so a caller
 * appending `rounded-full` to a baked-in `rounded-2xl` would be relying on luck. Each
 * call site states its shape.
 */
export const GLASS_BUTTON =
  `pointer-events-auto flex items-center justify-center text-slate-100 transition ` +
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

/**
 * Secondary controls in the thumb columns - currently only reset-to-start, which is a
 * planning action that disappears entirely once the route is locked. Kept to the 44px
 * floor rather than the playback target so a rarely-used control does not push the
 * cluster up the screen; the speed pair, which is pressed while driving, takes the full
 * target size instead.
 */
export const NORMAL_SECONDARY_TARGET = 'min-h-[44px] min-w-[44px]';
export const DRIVE_SECONDARY_TARGET = 'min-h-[56px] min-w-[56px]';

/**
 * The combined speed dial: ring gauge, play/pause and the reading in one circle. Larger
 * than a plain target because it carries three things at once, and it replaces two
 * stacked controls, so the column is shorter than it was despite the bigger button.
 */
export const NORMAL_SPEED_DIAL = 'h-24 w-24';
export const DRIVE_SPEED_DIAL = 'h-28 w-28';

/**
 * Inline error text inside a panel. `text-red-400` at `text-xs` was too thin to read
 * against a translucent panel over a bright map, so this pairs a lighter red with a
 * tinted chip: the block is visible before a word of it is read.
 */
export const INLINE_ERROR =
  'rounded-lg bg-red-500/15 px-2.5 py-1.5 text-xs font-medium leading-snug text-red-200 ' +
  'ring-1 ring-red-500/40';
