import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { check, installStorageStub, report, stubDirections } from './harness';

installStorageStub();

const ROUTE_COORDS: [number, number][] = [
  [30.5, 50.45],
  [30.5, 50.468],
];
stubDirections(ROUTE_COORDS, 2000);

const {
  useSimulationStore,
  MAX_SPEED_KMH,
  MIN_SPEED_STEP_KMH,
  MAX_SPEED_STEP_KMH,
} = await import('../src/store/simulationStore');
const { ControlPanel } = await import('../src/components/ControlPanel');

const s = () => useSimulationStore.getState();
s().setToken('pk.' + 'a'.repeat(60));
await s().addRoutePoint([30.5, 50.45]);
await s().addRoutePoint([30.5, 50.468]);

const initialSnapshot = useSimulationStore.getInitialState() as unknown as Record<string, unknown>;
const render = (overrides: Record<string, unknown> = {}) => {
  Object.assign(initialSnapshot, useSimulationStore.getState(), overrides);
  return renderToStaticMarkup(createElement(ControlPanel));
};

/* ---------------- The slider is gone ---------------- */
{
  const markup = render();
  check('no range input remains anywhere in the cluster', !markup.includes('type="range"'));
  check('the decrease button is offered', markup.includes('Decrease speed by'));
  check('the increase button is offered', markup.includes('Increase speed by'));
  // Asymmetric by default: winding up wants bigger jumps than coming back down.
  check('the increase button names its own increment', markup.includes('Increase speed by 10 km/h'));
  check('the decrease button names a different one', markup.includes('Decrease speed by 5 km/h'));
}

/* ---------------- Increments ---------------- */
{
  s().setSpeed(60);
  s().adjustSpeed(1);
  check('up uses the up increment', s().config.speedKmh === 70, String(s().config.speedKmh));
  s().adjustSpeed(-1);
  check('down uses the down increment, not the up one', s().config.speedKmh === 65, String(s().config.speedKmh));
  s().adjustSpeed(-1);
  check('and keeps using it', s().config.speedKmh === 60, String(s().config.speedKmh));

  s().setSpeedStep(1, 25);
  s().adjustSpeed(1);
  check('a reconfigured up increment takes effect immediately', s().config.speedKmh === 85, String(s().config.speedKmh));
  check('the up button relabels', render().includes('Increase speed by 25 km/h'));
  check('the down button is untouched by it', render().includes('Decrease speed by 5 km/h'));

  s().setSpeedStep(-1, 20);
  s().adjustSpeed(-1);
  check('a reconfigured down increment applies separately', s().config.speedKmh === 65, String(s().config.speedKmh));
  s().setSpeedStep(1, 10);
  s().setSpeedStep(-1, 5);
}

/* ---------------- Bounds ---------------- */
{
  s().setSpeed(3);
  s().adjustSpeed(-1);
  check('speed cannot go below zero', s().config.speedKmh === 0, String(s().config.speedKmh));

  s().setSpeed(MAX_SPEED_KMH - 5);
  s().adjustSpeed(1);
  check('speed cannot exceed the maximum', s().config.speedKmh === MAX_SPEED_KMH, String(s().config.speedKmh));

  s().setSpeedStep(1, 0);
  check('the increment clamps to its minimum', s().config.speedStepUpKmh === MIN_SPEED_STEP_KMH, String(s().config.speedStepUpKmh));
  s().setSpeedStep(1, 9999);
  check('the increment clamps to its maximum', s().config.speedStepUpKmh === MAX_SPEED_STEP_KMH, String(s().config.speedStepUpKmh));
  s().setSpeedStep(-1, 12.6);
  check('a fractional increment is rounded', s().config.speedStepDownKmh === 13, String(s().config.speedStepDownKmh));
  s().setSpeedStep(1, 10);
  s().setSpeedStep(-1, 5);
}

/* ---------------- The speedometer ---------------- */
{
  s().setSpeed(90);
  const kmh = render();
  check('the speedometer shows the number', kmh.includes('>90<'), 'km/h');
  check('the speedometer is a circle', kmh.includes('rounded-full'));
  check('the unit sits inside it', kmh.includes('km/h'));

  s().setUnitSystem('imperial');
  const mph = render();
  // 90 km/h is 55.9 mph, so the readout must convert rather than relabel.
  check('switching units converts the reading', mph.includes('>56<'), 'mph');
  check('the unit label follows', mph.includes('mph'));
  s().setUnitSystem('metric');
}

/* ---------------- Drive layout keeps the row (D-6) ---------------- */
{
  const drive = render({ isRouteLocked: true });
  check('D-6 the speed row survives the Drive layout', drive.includes('Simulation speed'));
  check('D-6 both nudge buttons survive it', drive.includes('Decrease speed by') && drive.includes('Increase speed by'));
  check('the Drive dial is the larger one', drive.includes('h-28 w-28'));
  check('the normal dial is the smaller one', render({ isRouteLocked: false }).includes('h-24 w-24'));
}

/* ---------------- Column order and separateness ---------------- */
{
  const markup = render();
  const at = (label: string) => markup.indexOf(label);

  // Top to bottom: plus, minus, then the dial. Ordered by how often a thumb reaches for
  // each, with the most-pressed control lowest and largest. Speed and play are one
  // element now, so the dial is found by its play label.
  check(
    'the left column runs plus, minus, dial',
    at('Increase speed by') < at('Decrease speed by') &&
      at('Decrease speed by') < at('Play simulation'),
    'vertical order',
  );
  check(
    'cursor movement stays in the other column, after the speed stack',
    at('Play simulation') < at('Step forward'),
  );
  check(
    'the dial carries both the action and the reading in one label',
    markup.includes('Play simulation. Simulation speed'),
  );

  // Each control carries the glass surface itself rather than sharing one pane, so the
  // column reads as separate targets instead of a single strip.
  // The whole opening tag, because attribute order differs between these buttons -
  // the speedometer carries aria-label before className, so slicing up to the label
  // would find no classes at all and quietly pass or fail for the wrong reason.
  const classesOf = (label: string) => {
    const idx = markup.indexOf(`aria-label="${label}`);
    const open = markup.lastIndexOf('<button', idx);
    return markup.slice(open, markup.indexOf('>', idx));
  };
  const renderWithDrive = render({ isRouteLocked: true });
  const driveClassesOf = (label: string) => {
    const idx = renderWithDrive.indexOf(`aria-label="${label}`);
    const open = renderWithDrive.lastIndexOf('<button', idx);
    return renderWithDrive.slice(open, renderWithDrive.indexOf('>', idx));
  };
  check(
    'the decrease button has its own background',
    classesOf('Decrease speed by').includes('backdrop-blur'),
  );
  check(
    'the dial has its own background',
    classesOf('Play simulation').includes('backdrop-blur'),
  );
  check('the dial draws a ring gauge', markup.includes('stroke-dasharray'));
  check('the ring is a circle, not a bar', markup.includes('<circle'));
  // Read the class list off each button rather than the tree as a whole: reset is
  // legitimately 44px, so a document-wide search proves nothing about the pair.
  check(
    'the decrease button matches the step buttons in size',
    classesOf('Decrease speed by').includes('min-h-[72px]'),
    'normal layout',
  );
  check(
    'the increase button matches the step buttons in size',
    classesOf('Increase speed by').includes('min-h-[72px]'),
  );
  check(
    'and they grow with the Drive layout',
    renderWithDrive.includes('min-h-[88px]') &&
      driveClassesOf('Increase speed by').includes('min-h-[88px]'),
  );
}

report('speed');
