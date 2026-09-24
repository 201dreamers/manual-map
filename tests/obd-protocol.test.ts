import { check, createFakeObdTransport, obdSupportBitmap, report } from './harness';
import {
  INIT_COMMANDS,
  createAssembler,
  createElm327,
  feedAssembler,
} from '../src/lib/obd/elm327';
import {
  buildMode01Request,
  decodeOdometerRaw,
  decodeSpeedKmh,
  decodeSupportBitmap,
  isNonDataLine,
  isPidSupported,
  parseHexBytes,
  PID_ODOMETER,
  PID_SPEED,
  PID_SUPPORT_BASE_A0,
} from '../src/lib/obd/pids';

/* ---------------- AC-601: chunked responses assemble ---------------- */
// One response, every possible way BLE could have fragmented it into three notifications.
{
  const RESPONSE = '41 0D 3C\r\r>';
  let permutations = 0;
  let wrong = 0;

  for (let i = 0; i <= RESPONSE.length; i++) {
    for (let j = i; j <= RESPONSE.length; j++) {
      const parts = [RESPONSE.slice(0, i), RESPONSE.slice(i, j), RESPONSE.slice(j)];
      let state = createAssembler();
      const lines: string[] = [];
      let prompted = false;
      for (const part of parts) {
        const fed = feedAssembler(state, part);
        state = fed.state;
        lines.push(...fed.lines);
        prompted = prompted || fed.prompted;
      }
      permutations++;
      if (lines.length !== 1 || lines[0] !== '41 0D 3C' || !prompted) wrong++;
    }
  }

  check(
    'AC-601 every three-way split assembles identically',
    wrong === 0,
    `${permutations} permutations, ${wrong} wrong`,
  );
}

// The same through the real client, so the queue and the decoder agree with it.
{
  const transport = createFakeObdTransport(() => ['41 0', 'D 3C\r', '\r>']);
  const client = createElm327(transport);
  const lines = await client.send(buildMode01Request(PID_SPEED));

  check('AC-601 exactly one line survives reassembly', lines.length === 1, JSON.stringify(lines));
  check('AC-601 speed decodes to 60 km/h', decodeSpeedKmh(lines) === 60, String(decodeSpeedKmh(lines)));
  check('AC-601 the request carried a response count', transport.sent[0] === '010D1', transport.sent[0]);
  client.dispose();
}

// A response arriving as single characters is the pathological case and must still work.
{
  let state = createAssembler();
  const lines: string[] = [];
  for (const character of '41 0D 4B\r\r>') {
    const fed = feedAssembler(state, character);
    state = fed.state;
    lines.push(...fed.lines);
  }
  check('AC-601 byte-at-a-time delivery yields one line', lines.length === 1);
  check('AC-601 and still decodes', decodeSpeedKmh(lines) === 75, String(decodeSpeedKmh(lines)));
}

/* ---------------- AC-602: odometer support is probed, never assumed ---------------- */
{
  // A6 bit clear: the car does not offer an odometer.
  const transport = createFakeObdTransport((command) => {
    if (command.startsWith('AT')) return ['OK\r\r>'];
    if (command.startsWith('0100')) return [`${obdSupportBitmap(0x00, [0x0d])}\r\r>`];
    if (command.startsWith('01A0')) return [`${obdSupportBitmap(0xa0, [0xa1])}\r\r>`];
    return ['NO DATA\r\r>'];
  });
  const client = createElm327(transport);
  const result = await client.initialize();

  check('AC-602 unsupported odometer is reported as unsupported', !result.odometerSupported);
  check(
    'AC-602 01A6 is never sent when the bitmap says it is absent',
    !client.commandLog.some((command) => command.toUpperCase().startsWith('01A6')),
    client.commandLog.join(' '),
  );
  check('AC-602 the support probe itself was answered', result.respondedToSupportProbe);
  client.dispose();
}

{
  // A6 bit set: the odometer is available.
  const transport = createFakeObdTransport((command) => {
    if (command.startsWith('AT')) return ['OK\r\r>'];
    if (command.startsWith('0100')) return [`${obdSupportBitmap(0x00, [0x0d])}\r\r>`];
    if (command.startsWith('01A0')) return [`${obdSupportBitmap(0xa0, [0xa6])}\r\r>`];
    return ['NO DATA\r\r>'];
  });
  const client = createElm327(transport);
  const result = await client.initialize();
  check('AC-602 a set A6 bit is detected', result.odometerSupported);
  client.dispose();
}

{
  // A car that ignores the probe entirely must not be read as "supported".
  const transport = createFakeObdTransport((command) =>
    command.startsWith('AT') ? ['OK\r\r>'] : ['NO DATA\r\r>'],
  );
  const client = createElm327(transport);
  const result = await client.initialize();
  check('AC-602 NO DATA is not mistaken for support', !result.odometerSupported);
  check('AC-602 an unanswered probe is reported', !result.respondedToSupportProbe);
  client.dispose();
}

/* ---------------- AC-603: init sequence and echo suppression ---------------- */
{
  const transport = createFakeObdTransport((command) => {
    // Before ATE0 lands the adapter echoes. ATZ is sent while echo is still on.
    if (command === 'ATZ') return [`ATZ\r`, 'ELM327 v1.5\r\r>'];
    if (command.startsWith('AT')) return ['OK\r\r>'];
    if (command.startsWith('0100')) return [`${obdSupportBitmap(0x00, [0x0d])}\r\r>`];
    if (command.startsWith('01A0')) return [`${obdSupportBitmap(0xa0, [0xa6])}\r\r>`];
    return ['NO DATA\r\r>'];
  });
  const client = createElm327(transport);
  const result = await client.initialize();
  const log = client.commandLog;

  check(
    'AC-603 the init sequence is sent in the specified order',
    INIT_COMMANDS.every((command, index) => log[index] === command),
    log.slice(0, INIT_COMMANDS.length).join(' '),
  );

  const firstPidIndex = log.findIndex((command) => command.startsWith('01'));
  const lastAtIndex = log.map((c) => c.startsWith('AT')).lastIndexOf(true);
  check(
    'AC-603 every AT command precedes every PID request',
    lastAtIndex < firstPidIndex,
    `last AT at ${lastAtIndex}, first PID at ${firstPidIndex}`,
  );

  check('AC-603 the echoed command is not treated as a response', result.identity === 'ELM327 v1.5', String(result.identity));
  client.dispose();
}

/* ---------------- Queue and failure behaviour ---------------- */
{
  // Strictly one command in flight: the adapter cannot answer two at once.
  const order: string[] = [];
  const transport = createFakeObdTransport((command) => {
    order.push(`sent:${command}`);
    return ['41 0D 10\r\r>'];
  });
  const client = createElm327(transport);
  const results = await Promise.all([
    client.send('010D1'),
    client.send('010C1'),
    client.send('01051'),
  ]);
  check('queue serialises commands in order', order.join(',') === 'sent:010D1,sent:010C1,sent:01051', order.join(','));
  check('every queued command resolved', results.length === 3 && results.every((r) => r.length === 1));
  client.dispose();
}

{
  // A command that never answers must time out rather than wedge the queue behind it.
  const transport = createFakeObdTransport((command) => (command === 'SILENT' ? [] : ['41 0D 3C\r\r>']));
  const client = createElm327(transport);
  let timedOut = false;
  await client.send('SILENT', 40).catch(() => {
    timedOut = true;
  });
  const after = await client.send('010D1');
  check('an unanswered command times out', timedOut);
  check('the queue keeps working afterwards', decodeSpeedKmh(after) === 60);
  client.dispose();
}

{
  // A mid-command disconnect must reject rather than hang forever.
  const transport = createFakeObdTransport(() => []);
  const client = createElm327(transport);
  const pending = client.send('010D1', 5000);
  setTimeout(() => transport.dropLink(), 0);
  let rejected = false;
  await pending.catch(() => {
    rejected = true;
  });
  check('a dropped link rejects the in-flight command', rejected);
  client.dispose();
}

/* ---------------- Decoders ---------------- */
{
  check('speed decodes from a clean reply', decodeSpeedKmh(['41 0D 5A']) === 90);
  check('speed ignores a reply for another PID', decodeSpeedKmh(['41 0C 1A F8']) === null);
  check('speed survives surrounding noise', decodeSpeedKmh(['SEARCHING...', '41 0D 00']) === 0);

  // 0x000186A0 = 100000 counts of 0.1 km, i.e. 10 000 km on the clock.
  check('odometer decodes 32-bit big-endian', decodeOdometerRaw(['41 A6 00 01 86 A0']) === 100_000);
  // Bit 31 set would go negative under a signed shift; it must not.
  check('odometer stays unsigned at the top bit', decodeOdometerRaw(['41 A6 FF FF FF FF']) === 4_294_967_295);
  check('odometer rejects a short reply', decodeOdometerRaw(['41 A6 00 01']) === null);

  check('NO DATA is recognised as non-data', isNonDataLine('NO DATA'));
  check('a hex line is not non-data', !isNonDataLine('41 0D 3C'));
  check('odd-length hex is rejected', parseHexBytes('41 0D 3') === null);
  check('non-hex is rejected', parseHexBytes('ELM327 v1.5') === null);

  const bitmap = decodeSupportBitmap([obdSupportBitmap(0xa0, [0xa6])], PID_SUPPORT_BASE_A0);
  check('bitmap decodes to four bytes', bitmap !== null && bitmap.length === 4);
  check('A6 reads as supported', bitmap !== null && isPidSupported(bitmap, PID_SUPPORT_BASE_A0, PID_ODOMETER));
  check('a neighbouring PID is not confused with A6', bitmap !== null && !isPidSupported(bitmap, PID_SUPPORT_BASE_A0, 0xa5));
  check('out-of-range PIDs are not claimed', bitmap !== null && !isPidSupported(bitmap, PID_SUPPORT_BASE_A0, 0xd0));

  check('request builder appends the response count', buildMode01Request(PID_SPEED) === '010D1');
  check('request builder pads single-digit PIDs', buildMode01Request(0x05) === '01051');
}

/* ---------------- the serial channel: read and write ends ---------------- */

{
  const { findSerialChannel } = await import('../src/lib/obd/transport');
  const make = (uuid: string, notify: boolean, write: boolean, writeNo: boolean) =>
    ({ uuid, properties: { notify, write, writeWithoutResponse: writeNo } }) as never;

  // Nordic UART, and the shape that was being rejected: neither end has both.
  const nus = [
    make('6e400002-b5a3-f393-e0a9-e50e24dcca9e', false, true, true),
    make('6e400003-b5a3-f393-e0a9-e50e24dcca9e', true, false, false),
  ];
  const nusChannel = findSerialChannel(nus);
  check('AC-780 Nordic UART is accepted, split across two characteristics',
    nusChannel !== null);
  check('AC-780 notify comes from the TX characteristic',
    nusChannel?.notify.uuid.startsWith('6e400003') === true, nusChannel?.notify.uuid);
  check('AC-780 and write from the RX characteristic',
    nusChannel?.write.uuid.startsWith('6e400002') === true, nusChannel?.write.uuid);

  // The same split in the 16-bit vendor range most ELM327 clones copy.
  const vendor = [
    make('0000fff1-0000-1000-8000-00805f9b34fb', true, false, false),
    make('0000fff2-0000-1000-8000-00805f9b34fb', false, false, true),
  ];
  check('AC-780 a split 16-bit vendor service is accepted', findSerialChannel(vendor) !== null);

  // A combined characteristic still wins, so a control characteristic is not paired by
  // mistake when the adapter offers a proper bridge.
  const combined = [
    make('0000ffe2-0000-1000-8000-00805f9b34fb', true, false, false),
    make('0000ffe1-0000-1000-8000-00805f9b34fb', true, true, false),
  ];
  const combinedChannel = findSerialChannel(combined);
  check('AC-781 a combined characteristic is preferred',
    combinedChannel?.notify.uuid === combinedChannel?.write.uuid &&
      combinedChannel?.write.uuid.startsWith('0000ffe1') === true,
    combinedChannel?.write.uuid);

  check('AC-782 notify with no writable sibling is rejected',
    findSerialChannel([make('0000fff1-0000-1000-8000-00805f9b34fb', true, false, false)]) === null);
  check('AC-782 a writable characteristic with no notify is rejected',
    findSerialChannel([make('0000fff2-0000-1000-8000-00805f9b34fb', false, true, false)]) === null);
  check('AC-782 an empty service is rejected', findSerialChannel([]) === null);
  check('AC-782 read-only characteristics are rejected',
    findSerialChannel([make('0000fff3-0000-1000-8000-00805f9b34fb', false, false, false)]) === null);
}

report('obd-protocol');
