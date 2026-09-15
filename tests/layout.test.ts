import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { check, installStorageStub, report, stubDirections } from './harness';

installStorageStub();

const ROUTE_COORDS: [number, number][] = [
  [30.5, 50.45],
  [30.5, 50.459],
  [30.5, 50.468],
];
stubDirections(ROUTE_COORDS, 2000);

const { useSimulationStore } = await import('../src/store/simulationStore');
const { ControlPanel } = await import('../src/components/ControlPanel');
const { TopBar } = await import('../src/components/TopBar');
const { ZoomControls } = await import('../src/components/ZoomControls');
const { MenuButton } = await import('../src/components/MenuButton');
const { DRIVE_ZOOM_TARGET, NORMAL_ZOOM_TARGET } = await import('../src/components/ui');

const s = () => useSimulationStore.getState();

s().setToken('pk.' + 'a'.repeat(60));
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
check('fixture: route built', s().geometry !== null);

/**
 * Zustand v5 hands `getInitialState()` to `useSyncExternalStore` during a server
 * render (zustand/esm/react.mjs), so `setState` is invisible to
 * `renderToStaticMarkup`. Rendering a chosen state therefore means writing it onto
 * that initial snapshot, which is the object the components actually read here.
 */
const initialSnapshot = useSimulationStore.getInitialState() as unknown as Record<string, unknown>;

const renderWith = (isRouteLocked: boolean) => {
  Object.assign(initialSnapshot, useSimulationStore.getState(), { isRouteLocked });
  return (
    renderToStaticMarkup(createElement(ControlPanel)) +
    renderToStaticMarkup(createElement(TopBar)) +
    renderToStaticMarkup(createElement(ZoomControls))
  );
};

// Proves the override reaches the components at all, so a silent no-op cannot pass
// the layout checks below by rendering the same markup twice.
check('fixture: the two layouts differ', renderWith(false) !== renderWith(true));

/** Counts how many elements carry a given minimum touch size. */
const countTargets = (markup: string, size: string) =>
  markup.split(`min-h-[${size}px]`).length - 1;

// ---------- AC-505: normal layout ----------
const normal = renderWith(false);

check('AC-505 play and both steps are at least 72px', countTargets(normal, '72') === 3,
  `${countTargets(normal, '72')} targets`);
check('AC-505 nothing is left at the old 60px play size', !normal.includes('min-h-[60px]'));
check('AC-505 telemetry is present', normal.includes('Distance') && normal.includes('ETA'));
check('AC-505 reset to start is present', normal.includes('Reset to start'));
check('AC-505 the lock is offered from the top row', normal.includes('Lock route'));
check('AC-505 speed slider is present', normal.includes('Simulation speed'));
check('AC-510 zoom pair is present while planning',
  normal.includes('Zoom in') && normal.includes('Zoom out to see the road ahead'));
check('AC-510 the zoom pair is stacked vertically', normal.includes('flex w-fit flex-col'));
check('AC-510 the zoom pair has left the bottom cluster',
  normal.indexOf('Zoom in') > normal.indexOf('Simulation speed'));
check('AC-510 the planning zoom pair still clears the 44px floor',
  normal.includes(NORMAL_ZOOM_TARGET));
check('AC-505 stop list stays reachable', normal.includes('Show stops') || normal.includes('Hide stops'));

// ---------- AC-504: Drive layout ----------
const drive = renderWith(true);

check('AC-504 play and both steps are at least 88px', countTargets(drive, '88') === 3,
  `${countTargets(drive, '88')} targets`);
check('AC-504 no target is left at the normal 72px size', countTargets(drive, '72') === 0);
check('AC-504 [revised] distance and ETA stay visible while driving',
  drive.includes('Distance') && drive.includes('ETA'));
check('AC-504 reset to start is hidden', !drive.includes('Reset to start'));
check('AC-504 speed slider stays visible (D-6)', drive.includes('Simulation speed'));
check('AC-510 zoom pair survives into the Drive layout',
  drive.includes('Zoom in') && drive.includes('Zoom out to see the road ahead'));
check('AC-510 the drive zoom pair grows with the layout',
  drive.includes(DRIVE_ZOOM_TARGET));
check('AC-504 menu stays reachable (D-8)', drive.includes('aria-label="Menu"'));
check('AC-504 stop list stays reachable', drive.includes('Show stops') || drive.includes('Hide stops'));
check('AC-504 the lock reads as pressed', drive.includes('Unlock route'));
check('AC-504 [revised] the lock sits in the top row, not the thumb cluster',
  drive.split('Unlock route').length - 1 === 1 && !drive.includes('Lock route'));

// The status pill is a planning hint, so it must not survive into the Drive layout.
s().setRouteLocked(false);
s().clearRoute();
check('status pill shows while planning',
  renderWith(false).includes('Tap the map to set a start point'));
check('AC-504 the status pill is hidden in the Drive layout',
  !renderWith(true).includes('Tap the map to set a start point'));

// ---------- AC-506 [revised]: Recenter is laid out, not offset ----------
// The button now sits inside the control panel, centred above the speed slider, so
// there is no cluster height left to guess and no way for the two to overlap.
// The status-pill check above cleared the route, and Recenter needs one to return to.
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
s().setCameraTracking(false);
const panned = renderWith(false);
check('AC-506 [revised] recenter appears once the camera is released',
  panned.includes('Recenter'));
check('AC-506 [revised] recenter is at least 56px tall', panned.includes('min-h-[56px]'));
check('AC-506 [revised] recenter sits above the speed slider',
  panned.indexOf('Recenter') < panned.indexOf('Simulation speed'));
check('AC-506 [revised] recenter is centred, not pinned to a corner',
  panned.includes('left-1/2') && panned.includes('-translate-x-1/2'));
// The play button must not move when Recenter appears, so Recenter cannot be in flow.
check('AC-506 [revised] recenter is out of flow, so nothing below it shifts',
  /absolute[^"]*left-1\/2|left-1\/2[^"]*absolute/.test(panned));
// A bare `bottom:` would mean it is pinned again; `padding-bottom` on the panel root
// is the safe-area inset and must not be mistaken for one.
check('AC-506 [revised] nothing positions it by a hardcoded bottom offset',
  !/[;"]\s*bottom:/.test(panned));

s().setCameraTracking(true);
const tracking = renderWith(false);
check('AC-506 [revised] recenter disappears once tracking is back',
  !tracking.includes('Recenter'));
// Same proof from the other side: everything from the zoom pair down to the speed row
// is byte-identical with and without Recenter, so its arrival cannot move the play
// button. Recenter renders ahead of the zoom pair, outside this slice, only because it
// is out of flow - put it back in flow, between the button row and the speed row, and
// it lands inside this slice and diverges.
const thumbCluster = (markup: string) =>
  markup.slice(markup.indexOf('Play simulation'), markup.indexOf('Simulation speed'));
check('AC-506 [revised] the thumb cluster is unchanged by Recenter appearing',
  thumbCluster(panned) === thumbCluster(tracking));
check('AC-506 [revised] the slice being compared is the real cluster',
  thumbCluster(panned).includes('Play simulation') && thumbCluster(panned).length > 100,
  `${thumbCluster(panned).length} chars`);

// ---------- the menu and the zoom stack share the top-left corner ----------
const renderCorner = (isMenuOpen: boolean) => {
  Object.assign(initialSnapshot, useSimulationStore.getState(), { isMenuOpen });
  return (
    renderToStaticMarkup(createElement(MenuButton)) +
    renderToStaticMarkup(createElement(ZoomControls))
  );
};

const closed = renderCorner(false);
const opened = renderCorner(true);

check('the zoom stack is there while the menu is closed', closed.includes('Zoom in'));
check('the menu is not drawn while closed', !closed.includes('Face north'));
check('the menu opens into the corner', opened.includes('Face north'));
check('the zoom stack yields the corner to the open menu', !opened.includes('Zoom in'));
check('nothing can be tapped through to the zoom stack',
  !opened.includes('Zoom out to see the road ahead'));
check('the open menu also outranks anything painted after it',
  /role="menu"[^>]*class="[^"]*z-20|class="[^"]*z-20[^"]*"[^>]*role="menu"/.test(opened) ||
    opened.includes('z-20'));

// ---------- the lock is always releasable ----------
// It is disabled below two stops so it cannot be engaged pointlessly, but a lock that
// is already on must stay pressable or the Drive layout has no exit.
Object.assign(initialSnapshot, useSimulationStore.getState(), {
  isRouteLocked: true,
  routePoints: [],
});
/**
 * Whether one button, found by its label, is actually disabled. Two traps here: React
 * emits `disabled` before `aria-label`, so a regex anchored on the label cannot see
 * it; and the shared button classes contain `disabled:opacity-40`, so a substring
 * search matches the class list on every button. The rendered attribute is the only
 * honest signal. Null means the button was not in the markup at all.
 */
const isDisabled = (markup: string, label: string): boolean | null => {
  const at = markup.indexOf(`aria-label="${label}"`);
  if (at === -1) return null;
  return markup.slice(markup.lastIndexOf('<button', at), at).includes('disabled=""');
};

const lockedWithoutRoute = renderToStaticMarkup(createElement(TopBar));
check('fixture: the lock button is found by label',
  isDisabled(lockedWithoutRoute, 'Unlock route') !== null);
check('a standing lock stays pressable even with no stops left',
  isDisabled(lockedWithoutRoute, 'Unlock route') === false);

Object.assign(initialSnapshot, useSimulationStore.getState(), {
  isRouteLocked: false,
  routePoints: [],
});
const unlockedWithoutRoute = renderToStaticMarkup(createElement(TopBar));
check('an unlocked empty route still cannot be locked',
  isDisabled(unlockedWithoutRoute, 'Lock route') === true);

report('layout');
