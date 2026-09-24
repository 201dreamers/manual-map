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

const { useSimulationStore, setLocationWatcherFactory } = await import(
  '../src/store/simulationStore',
);
const { ControlPanel } = await import('../src/components/ControlPanel');
const { TopBar } = await import('../src/components/TopBar');
const { ZoomControls } = await import('../src/components/ZoomControls');
const { MenuButton } = await import('../src/components/MenuButton');
const { PlanDrawer } = await import('../src/components/PlanDrawer');
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

// Four full-size targets: both steps and the speed pair. Play is no longer among them
// because it merged into the speed dial (D-31), which is larger still at 96px.
check('AC-505 both steps and the speed pair are at least 72px',
  countTargets(normal, '72') === 4, `${countTargets(normal, '72')} targets`);
check('AC-505 the speed dial is larger than a plain target', normal.includes('h-24 w-24'));
check('AC-505 nothing is left at the old 60px play size', !normal.includes('min-h-[60px]'));
// ETA has gone: it was the widest thing in a panel that shares a row with three
// buttons, and it is derived from a speed the driver is choosing anyway.
check('AC-505 telemetry is present', normal.includes('Distance'));
check('AC-505 the arrival estimate is gone', !normal.includes('>ETA<'));
check('AC-505 reset to start is present', normal.includes('Reset to start'));
check('AC-505 the lock is offered from the top row', normal.includes('Lock route'));
check('AC-505 speed row is present', normal.includes('Simulation speed'));
check('AC-510 zoom pair is present while planning',
  normal.includes('Zoom in') && normal.includes('Zoom out to see the road ahead'));
check('AC-510 the zoom pair is stacked vertically', normal.includes('w-fit shrink-0 flex-col'));
check('AC-510 the zoom pair has left the bottom cluster',
  normal.indexOf('Zoom in') > normal.indexOf('Simulation speed'));
check('AC-510 the planning zoom pair still clears the 44px floor',
  normal.includes(NORMAL_ZOOM_TARGET));
check('AC-505 stop list stays reachable', normal.includes('Show stops') || normal.includes('Hide stops'));

// ---------- AC-504: Drive layout ----------
const drive = renderWith(true);

check('AC-504 both steps and the speed pair are at least 88px',
  countTargets(drive, '88') === 4, `${countTargets(drive, '88')} targets`);
check('AC-504 the speed dial grows with the Drive layout', drive.includes('h-28 w-28'));
check('AC-504 no target is left at the normal 72px size', countTargets(drive, '72') === 0);
check('AC-504 [revised twice] distance stays visible while driving',
  drive.includes('Distance'));
check('AC-504 and the stop count with it', drive.includes('Show stops') || drive.includes('Hide stops'));
check('AC-504 reset to start is hidden', !drive.includes('Reset to start'));
check('AC-504 speed row stays visible (D-6)', drive.includes('Simulation speed'));
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
  renderWith(false).includes('Tap the map to set the start'));
check('AC-504 the status pill is hidden in the Drive layout',
  !renderWith(true).includes('Tap the map to set the start'));

// ---------- AC-506 [revised]: Recenter is laid out, not offset ----------
// The button now sits inside the control panel, centred above the speed row, so
// there is no cluster height left to guess and no way for the two to overlap.
// The status-pill check above cleared the route, and Recenter needs one to return to.
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);
s().setCameraTracking(false);
const panned = renderWith(false);
check('AC-506 [revised] recenter appears once the camera is released',
  panned.includes('Recenter'));
check('AC-506 [revised] recenter is at least 56px tall', panned.includes('min-h-[56px]'));
check('AC-506 [revised] recenter sits above the speed row',
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
// Anchored on the first control in the column rather than a pair of labels whose
// order can change: the column was reordered to put play lowest, which silently
// inverted the old slice and compared nothing at all.
const thumbCluster = (markup: string) => markup.slice(markup.indexOf('Increase speed by'));
check('AC-506 [revised] the thumb cluster is unchanged by Recenter appearing',
  thumbCluster(panned) === thumbCluster(tracking));
check('AC-506 [revised] the slice being compared is the real cluster',
  thumbCluster(panned).includes('Play simulation') &&
    thumbCluster(panned).includes('Step forward') &&
    thumbCluster(panned).length > 100,
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

/*
 * The plan drawer sits above the control cluster, and the cluster's height changes with
 * the Drive layout, with mirroring and with the safe-area inset. It was pinned at
 * 9.5rem while V3 grew the targets to 72 and 88px, which left the step buttons rendering
 * underneath the drawer - the step column alone is 2 x 88 + 8 = 184px against a 152px
 * offset. It now reads the measured height, and these guard against a literal returning.
 */
Object.assign(initialSnapshot, useSimulationStore.getState(), {
  isPlanOpen: true,
  isRouteLocked: true,
});
const planMarkup = renderToStaticMarkup(createElement(PlanDrawer));

check(
  'the plan drawer clears the cluster by measurement, not a literal',
  planMarkup.includes('var(--control-cluster-height'),
  'PlanDrawer bottom offset',
);
check(
  'the drawer no longer carries a hardcoded rem offset',
  !/bottom:\s*calc\(\d/.test(planMarkup),
);
// Same lesson at the other end: the panel that opens this drawer now lives in the top
// row, so a literal top offset put the two on top of each other.
check(
  'the drawer clears the top row by measurement too',
  planMarkup.includes('var(--top-row-height'),
  'PlanDrawer top offset',
);
check('and not by a literal top offset', !/top:\s*calc\(\d/.test(planMarkup));
check(
  'the drawer does not re-add a safe-area inset already in the measurement',
  !planMarkup.includes('control-cluster-height, 15rem) + 0.5rem + env'),
);

/*
 * The height the drawer has to clear, spelled out so a change to the targets shows up
 * here rather than as an overlap on a phone. Step column is two targets plus gap-2.
 */
const DRIVE_STEP_COLUMN = 88 * 2 + 8;
const NORMAL_STEP_COLUMN = 72 * 2 + 8;
check(
  'the Drive step column alone exceeds the old 9.5rem offset',
  DRIVE_STEP_COLUMN > 152,
  `${DRIVE_STEP_COLUMN}px vs 152px`,
);
check(
  'so did the normal step column, before the speed row is counted',
  NORMAL_STEP_COLUMN >= 152,
  `${NORMAL_STEP_COLUMN}px vs 152px`,
);

/* ---------------- Top row order ---------------- */
// Menu and lock share the left corner; reset and the stop list share the right.
{
  // Set explicitly: an earlier block left the snapshot locked, which hides reset and
  // renames the lock, and this would then assert against the wrong layout.
  Object.assign(initialSnapshot, useSimulationStore.getState(), {
    isRouteLocked: false,
    isPlanOpen: false,
  });
  const topBar = renderToStaticMarkup(createElement(TopBar));
  const at = (label: string) => topBar.indexOf(`aria-label="${label}`);

  // Asserted on button order alone: telemetry renders nothing without a route, so
  // anchoring on its text would compare against -1 and pass or fail by accident.
  const stopsAt = Math.max(at('Show stops'), at('Hide stops'));
  check('every top-row control is present', at('Menu') >= 0 && at('Lock route') >= 0 &&
    at('Reset to start') >= 0 && stopsAt >= 0,
    `menu ${at('Menu')}, lock ${at('Lock route')}, reset ${at('Reset to start')}, stops ${stopsAt}`);
  check('the lock sits immediately after the menu, on the left',
    at('Menu') < at('Lock route'));
  check('reset follows the lock, over on the right',
    at('Lock route') < at('Reset to start'));
  check('reset comes before the stop list', at('Reset to start') < stopsAt);
}

/* ---------------- The location marker ---------------- */
// It reports where the device is. It places no stops and does not drive the cursor -
// those are the vehicle's job, and conflating the two would mean the app could not
// show you standing somewhere off the route.
{
  const fixes: Array<(location: unknown) => void> = [];
  let stopped = 0;
  setLocationWatcherFactory(((handlers: { onUpdate: (l: unknown) => void }) => {
    fixes.push(handlers.onUpdate);
    return { stop: () => { stopped += 1; } };
  }) as never);

  Object.defineProperty(globalThis, 'navigator', {
    value: { geolocation: { watchPosition: () => 1, clearWatch: () => {} } },
    configurable: true,
    writable: true,
  });

  s().clearRoute();
  Object.assign(initialSnapshot, useSimulationStore.getState(), { routePoints: [] });
  const off = renderToStaticMarkup(createElement(TopBar));
  check('AC-616 the control is offered on an empty route',
    off.includes('aria-label="Show my location"'));

  await s().toggleUserLocation();
  fixes[0]?.({ coordinate: [30.52, 50.45], headingDegrees: 41, accuracyMeters: 8 });

  check('AC-616 a fix becomes the marker, not a stop', s().routePoints.length === 0,
    `${s().routePoints.length} stops`);
  check('AC-616 the marker carries the reported position',
    s().userLocation?.coordinate[0] === 30.52 && s().userLocation?.coordinate[1] === 50.45);
  check('AC-616 and its heading', s().userLocation?.headingDegrees === 41);
  check('AC-618 the first fix flies the camera to it', s().focusRequest.id > 0);

  Object.assign(initialSnapshot, useSimulationStore.getState(), { routePoints: [] });
  const on = renderToStaticMarkup(createElement(TopBar));
  check('AC-616 the control reads as pressed once on', on.includes('aria-pressed="true"'));
  check('AC-616 and offers removal as the next press',
    on.includes('aria-label="Hide my location"'));

  // A second fix must not fly the camera again: after the first, the view is the
  // user's and the marker moves within it.
  const focusAfterFirst = s().focusRequest.id;
  fixes[0]?.({ coordinate: [30.53, 50.46], headingDegrees: null, accuracyMeters: 8 });
  check('AC-618 later fixes leave the camera alone', s().focusRequest.id === focusAfterFirst);
  check('a fix with no heading clears the arrow', s().userLocation?.headingDegrees === null);

  await s().toggleUserLocation();
  check('AC-616 toggling off stops the watch', stopped === 1, `${stopped} stops`);
  check('AC-616 and removes the marker', s().userLocation === null);
  check('AC-616 the route is still untouched', s().routePoints.length === 0);

  // Offered mid-route too, as an icon-only circle once the row is busy.
  Object.assign(initialSnapshot, useSimulationStore.getState(), {
    routePoints: [{ id: 'a', coordinate: [30.5, 50.45] as [number, number] }],
  });
  const compact = renderToStaticMarkup(createElement(TopBar));
  check('AC-616 it stays available once a route exists',
    compact.includes('aria-label="Show my location"'));
  const tag = compact.slice(
    compact.lastIndexOf('<button', compact.indexOf('Show my location')),
    compact.indexOf('>', compact.indexOf('Show my location')),
  );
  check('AC-616 and collapses to an icon in a circle',
    tag.includes('aspect-square') && tag.includes('rounded-full'), 'compact shape');
  check('AC-616 dropping its label', !compact.includes('>My location<'));
}

/* ---------------- Units ---------------- */
{
  s().setUnitSystem('imperial');
  Object.assign(initialSnapshot, useSimulationStore.getState());
  const imperial = renderToStaticMarkup(createElement(ControlPanel));
  check('imperial relabels the step buttons', imperial.includes('ft') || imperial.includes('mi'),
    'step labels');
  check('imperial relabels the speed buttons', imperial.includes('mph'));

  s().setUnitSystem('metric');
  Object.assign(initialSnapshot, useSimulationStore.getState());
  const metric = renderToStaticMarkup(createElement(ControlPanel));
  check('metric is the default and restores km/h', metric.includes('km/h'));
  check('and metric distances', metric.includes(' m') || metric.includes('km'));
}

/* ---------------- Square thumb targets ---------------- */
// The left column is as wide as the dial, so a stretched child renders a 96x72
// rectangle rather than a square button.
{
  Object.assign(initialSnapshot, useSimulationStore.getState(), { isRouteLocked: false });
  const cluster = renderToStaticMarkup(createElement(ControlPanel));
  const tagFor = (label: string) => {
    const at = cluster.indexOf(`aria-label="${label}`);
    return cluster.slice(cluster.lastIndexOf('<button', at), cluster.indexOf('>', at));
  };

  for (const label of ['Increase speed by', 'Decrease speed by', 'Step forward', 'Step back']) {
    check(`${label} renders square`, tagFor(label).includes('aspect-square'), label);
  }
  check('the columns centre their children instead of stretching them',
    (cluster.match(/flex flex-col items-center gap-2/g) ?? []).length === 2,
    `${(cluster.match(/flex flex-col items-center gap-2/g) ?? []).length} columns`);
}

/* ---------------- Glass thickness by surface size ---------------- */
// Small floating controls can be thin because they are read from shape and position.
// Panels carry body text, form fields and lists, so they keep the opacity - a
// paragraph cannot be read from its outline.
{
  Object.assign(initialSnapshot, useSimulationStore.getState(), {
    isPlanOpen: true,
    isRouteLocked: false,
  });
  const plan = renderToStaticMarkup(createElement(PlanDrawer));
  const cluster = renderToStaticMarkup(createElement(ControlPanel));

  check('the plan drawer uses the thicker panel glass', plan.includes('bg-slate-900/85'),
    'panel opacity');
  check('the thumb controls stay on the thin glass', cluster.includes('bg-slate-900/60'),
    'control opacity');
  check('both are the same material', plan.includes('backdrop-saturate-150') &&
    cluster.includes('backdrop-saturate-150'));
  check('both carry the specular rim',
    plan.includes('inset_0_1px_0') && cluster.includes('inset_0_1px_0'));
}

/* ---------------- Telemetry has a row to itself ---------------- */
// Its width depends on the route - "15.2/120.5 km" is far wider than "0.0/0.0 km" -
// so it cannot share a row with a fixed set of buttons without eventually colliding.
{
  Object.assign(initialSnapshot, useSimulationStore.getState(), { isRouteLocked: false });
  const topBar = renderToStaticMarkup(createElement(TopBar));
  const headerEnd = topBar.indexOf('</header>');

  // Squares gathered in one corner, panel in the other: the panel's width follows the
  // route while the buttons' does not, so it takes the whole of the remaining width
  // rather than being squeezed between them.
  check('all three square controls share the header with the panel',
    topBar.indexOf('Distance') < headerEnd &&
      topBar.indexOf('aria-label="Menu') < headerEnd &&
      topBar.indexOf('aria-label="Lock route') < headerEnd &&
      topBar.indexOf('aria-label="Reset to start') < headerEnd);
  check('the squares come first, so the panel sits opposite them',
    topBar.indexOf('aria-label="Reset to start') < topBar.indexOf('Distance'),
    'button and panel order');
  check('the panel may shrink rather than push the buttons off the row',
    topBar.includes('flex min-w-0 justify-end'));
  check('the stop list is reached through the panel',
    topBar.indexOf('aria-label="Show stops') > topBar.indexOf('aria-label="Reset to start'));
  check('and there is only one control offering it',
    (topBar.match(/aria-label="(Show|Hide) stops/g) ?? []).length === 1,
    `${(topBar.match(/aria-label="(Show|Hide) stops/g) ?? []).length} controls`);
  check('the count rides along with it', topBar.includes('Distance'));
  check('telemetry labels are legible against thin glass', topBar.includes('text-slate-300'));
  check('the panel carries only distance and the count', !topBar.includes('>ETA<'));
}

/* ---------------- Round thumb and zoom controls ---------------- */
{
  const cluster = renderToStaticMarkup(createElement(ControlPanel));
  const zoom = renderToStaticMarkup(createElement(ZoomControls));
  const topBar = renderToStaticMarkup(createElement(TopBar));
  const tagFor = (markup: string, label: string) => {
    const at = markup.indexOf(`aria-label="${label}`);
    return markup.slice(markup.lastIndexOf('<button', at), markup.indexOf('>', at));
  };

  for (const label of ['Step forward', 'Step back', 'Increase speed by', 'Decrease speed by']) {
    check(`${label} is a circle`, tagFor(cluster, label).includes('rounded-full'), label);
  }
  check('zoom in is a circle', tagFor(zoom, 'Zoom in').includes('rounded-full'));
  check('zoom out is a circle', tagFor(zoom, 'Zoom out').includes('rounded-full'));

  // The top row keeps its rounded rectangles: those carry text and a count badge.
  check('the menu button stays a rounded rectangle',
    tagFor(topBar, 'Menu').includes('rounded-2xl'));
  // Only one border-radius utility per button, since two would resolve by stylesheet
  // order rather than by which was written last.
  const stepTag = tagFor(cluster, 'Step forward');
  check('no button carries two competing radii',
    !(stepTag.includes('rounded-2xl') && stepTag.includes('rounded-full')));
}

/* ---------------- The hint yields to the stop list ---------------- */
// The drawer covers about 306px of a 393px width at this height, so a centred hint
// renders on top of the very list it is explaining how to fill.
{
  Object.assign(initialSnapshot, useSimulationStore.getState(), {
    routePoints: [],
    isRouteLocked: false,
    isPlanOpen: false,
  });
  const closed = renderToStaticMarkup(createElement(TopBar));
  check('the hint shows while the stop list is closed',
    closed.includes('Tap the map to set the start'));

  Object.assign(initialSnapshot, useSimulationStore.getState(), {
    routePoints: [],
    isRouteLocked: false,
    isPlanOpen: true,
  });
  const open = renderToStaticMarkup(createElement(TopBar));
  check('it stands down while the list is open, rather than rendering over it',
    !open.includes('Tap the map to set the start'));
  check('and so does the location control', !open.includes('Show my location'));
  check('the panel that opened the list stays', open.includes('Distance'));

  /*
    The lock hides the hint but must not hide the location button. The hint is about
    editing the route, which the lock forbids; where the device is stays worth knowing
    while driving, which is exactly when the route is locked.
  */
  Object.assign(initialSnapshot, useSimulationStore.getState(), {
    routePoints: [
      { id: 'a', coordinate: [30.5, 50.45] as [number, number] },
      { id: 'b', coordinate: [30.5, 50.47] as [number, number] },
    ],
    isRouteLocked: true,
    isPlanOpen: false,
  });
  const locked = renderToStaticMarkup(createElement(TopBar));
  check('AC-742 the location control survives the route lock',
    locked.includes('Show my location'));
  check('AC-742 while the hint still stands down',
    !locked.includes('Tap the map to set the start'));
}

/* ---------------- Zoom sits directly under the menu ---------------- */
// It used to render after the status line, so the transient hint shunted it down the
// screen as points were added and removed.
{
  Object.assign(initialSnapshot, useSimulationStore.getState(), {
    routePoints: [],
    isRouteLocked: false,
    isPlanOpen: false,
    isMenuOpen: false,
  });
  const withHint = renderToStaticMarkup(createElement(TopBar));
  const headerEnd = withHint.indexOf('</header>');

  check('the zoom pair renders immediately after the header',
    withHint.indexOf('aria-label="Zoom in') > headerEnd);
  check('and ahead of the status hint, so the hint cannot push it down',
    withHint.indexOf('aria-label="Zoom in') < withHint.indexOf('Tap the map to set the start'),
    'zoom before hint');
  check('the hint is still rendered, just below it',
    withHint.includes('Tap the map to set the start'));

  // With a route built there is no hint at all; the pair must not move.
  Object.assign(initialSnapshot, useSimulationStore.getState(), {
    isPlanOpen: false,
    isMenuOpen: false,
  });
  const withoutHint = renderToStaticMarkup(createElement(TopBar));
  check('the zoom pair keeps its place when the hint is absent',
    withoutHint.indexOf('aria-label="Zoom in') > withoutHint.indexOf('</header>'));
}

/* ---------------- Mirroring flips everything, not just the thumb columns ---------------- */
{
  // Each surface is rendered under the state it actually needs - the zoom pair stands
  // down while the menu is open, the menu dropdown only exists while it is - but every
  // one of them keeps the mirrored config. Re-spreading live store state inside the
  // helper was what silently dropped that override the first time.
  const sides = (mirrored: boolean) => {
    const config = { ...useSimulationStore.getState().config, controlsMirrored: mirrored };
    const setup = (overrides: Record<string, unknown>) =>
      Object.assign(initialSnapshot, useSimulationStore.getState(), { config }, overrides);

    setup({ isPlanOpen: true, isMenuOpen: false, isRouteLocked: false });
    const topBar = renderToStaticMarkup(createElement(TopBar));
    const plan = renderToStaticMarkup(createElement(PlanDrawer));
    const cluster = renderToStaticMarkup(createElement(ControlPanel));

    setup({ isPlanOpen: true, isMenuOpen: true, isRouteLocked: false });
    const menu = renderToStaticMarkup(createElement(MenuButton));

    return { topBar, plan, menu, cluster };
  };

  const normal = sides(false);
  const mirrored = sides(true);

  check('the top row reverses', mirrored.topBar.includes('flex-row-reverse') &&
    !normal.topBar.includes('flex-row-reverse'), 'header direction');
  // The band that holds the zoom pair reverses, which carries it to the other corner
  // along with the hint and the location control.
  check('the zoom pair follows the menu across',
    mirrored.topBar.includes('Zoom in') &&
      (mirrored.topBar.match(/flex-row-reverse/g) ?? []).length >
        (normal.topBar.match(/flex-row-reverse/g) ?? []).length,
    'zoom side');
  check('the plan drawer opens from the other edge',
    mirrored.plan.includes('left-3') && normal.plan.includes('right-3'), 'drawer anchor');
  check('the menu opens away from its own edge',
    mirrored.menu.includes('right-0') && normal.menu.includes('left-0'), 'menu anchor');
  check('the thumb columns still trade places',
    mirrored.cluster.includes('flex-row-reverse') && !normal.cluster.includes('flex-row-reverse'));
  check('nothing is anchored to both sides at once',
    !(mirrored.plan.includes('right-3') && mirrored.plan.includes('left-3')));

  Object.assign(initialSnapshot, useSimulationStore.getState(), {
    config: { ...useSimulationStore.getState().config, controlsMirrored: false },
    isPlanOpen: false,
    isMenuOpen: false,
  });
}

/* ---------------- The hint sits level with the zoom pair ---------------- */
// It used to render after the whole zoom stack, leaving a 96px gap below the header.
{
  Object.assign(initialSnapshot, useSimulationStore.getState(), {
    config: { ...useSimulationStore.getState().config, controlsMirrored: false },
    routePoints: [],
    isPlanOpen: false,
    isMenuOpen: false,
    isRouteLocked: false,
  });
  const topBar = renderToStaticMarkup(createElement(TopBar));
  const rowStart = topBar.indexOf('</header>');
  const zoomAt = topBar.indexOf('aria-label="Zoom in');
  const hintAt = topBar.indexOf('Tap the map to set the start');
  const locateAt = topBar.indexOf('Show my location');

  check('the zoom pair leads the band under the header', zoomAt > rowStart);
  check('the hint shares that band rather than following the stack',
    hintAt > zoomAt && topBar.lastIndexOf('items-start', hintAt) > rowStart,
    'hint alignment');
  check('the location control shares it too', locateAt > zoomAt);
  check('the band aligns its children to the top, so they sit level with zoom-in',
    topBar.slice(rowStart, zoomAt).includes('items-start'));
}

/* ---------------- The error toast has to be readable over any map tile ---------------- */

{
  const { ToastStack } = await import('../src/components/ToastStack');

  Object.assign(initialSnapshot, useSimulationStore.getState(), {
    toasts: [
      { id: 't1', kind: 'error' as const, text: 'Could not reach the adapter.' },
      { id: 't2', kind: 'info' as const, text: 'Route complete.' },
    ],
  });
  const markup = renderToStaticMarkup(createElement(ToastStack));

  const errorTag = markup.slice(
    markup.lastIndexOf('<div', markup.indexOf('Could not reach the adapter.')),
    markup.indexOf('Could not reach the adapter.'),
  );
  check('AC-755 the error toast is an opaque fill, not a tint over the map',
    errorTag.includes('bg-red-600') && !errorTag.includes('bg-red-500/15'), errorTag.slice(0, 120));
  check('AC-755 with white text rather than a mid red', errorTag.includes('text-white'));
  check('AC-755 and a shadow to lift it off the map', errorTag.includes('box-shadow'));
  check('AC-755 an error is announced, not merely stated',
    errorTag.includes('role="alert"'), errorTag.slice(0, 80));

  const infoTag = markup.slice(
    markup.lastIndexOf('<div', markup.indexOf('Route complete.')),
    markup.indexOf('Route complete.'),
  );
  check('AC-755 a non-error stays a status', infoTag.includes('role="status"'));
  check('the dismiss control survives', markup.includes('aria-label="Dismiss"'));
}

report('layout');
