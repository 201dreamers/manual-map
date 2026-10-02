import { check, report } from './harness';
import {
  AT_PROBES,
  PID_PROBES,
  SUPPORT_BLOCKS,
  describeSupportedPids,
  interpret,
  runObdDiagnostics,
} from '../src/lib/obd/diagnostics';
import { PID_DISTANCE, PID_ODOMETER, PID_SPEED } from '../src/lib/obd/pids';

/** Captures the sweep instead of printing it, and records what was asked. */
function recorder(reply: (command: string) => string[] | Promise<string[]>) {
  const lines: string[] = [];
  const asked: string[] = [];
  return {
    lines,
    asked,
    emit: (line: string) => lines.push(line),
    send: async (command: string) => {
      asked.push(command);
      return reply(command);
    },
  };
}

const joined = (lines: string[]) => lines.join('\n');

/* ---------------- AC-840: the sweep cannot break the drive it is diagnosing ---------------- */

{
  // Every single command throws. This is the transport dying mid-drive.
  const r = recorder(() => {
    throw new Error('GATT operation failed for unknown reason at 0x8004');
  });
  let threw = false;
  let summary = null as Awaited<ReturnType<typeof runObdDiagnostics>> | null;
  try {
    summary = await runObdDiagnostics(r.send, r.emit);
  } catch {
    threw = true;
  }
  check('AC-840 a sweep against a dead transport does not throw', !threw);
  check('AC-840 and still resolves with a summary', summary !== null);
  check('AC-840 with everything recorded as silent',
    summary !== null && summary.answered.length === 0 && summary.silent.length === PID_PROBES.length,
    `${summary?.silent.length} of ${PID_PROBES.length}`);
  check('AC-840 and it asked every probe rather than stopping at the first failure',
    r.asked.length === AT_PROBES.length + SUPPORT_BLOCKS.length + PID_PROBES.length,
    `${r.asked.length}`);
  check('AC-840 no thrown message reaches the log',
    !joined(r.lines).includes('0x8004'));
}

{
  // A rejected promise rather than a synchronous throw: the real timeout path.
  const r = recorder(() => Promise.reject(new Error('timeout')));
  let threw = false;
  try {
    await runObdDiagnostics(r.send, r.emit);
  } catch {
    threw = true;
  }
  check('AC-840 a rejecting adapter does not throw either', !threw);
}

{
  // Garbage that is neither hex nor a known status line.
  const r = recorder(() => ['\u0000ÿ???', 'BUFFER FULL', '41']);
  let threw = false;
  try {
    await runObdDiagnostics(r.send, r.emit);
  } catch {
    threw = true;
  }
  check('AC-840 malformed replies do not throw', !threw);
}

/* ---------------- AC-841: a real car is reported accurately ---------------- */

{
  /*
    Models the vehicle this was written for: it advertises 0D and 31, answers both, and
    answers A6 despite never advertising it. That last case is the one a bitmap-only
    check gets wrong, and the reason the summary separates the two lists.
  */
  const r = recorder((command) => {
    if (command.startsWith('AT')) return ['ELM327 v1.5'];
    if (command.startsWith('0100')) return ['41 00 00 08 00 00']; // 0D only
    if (command.startsWith('0120')) return ['41 20 80 00 00 00']; // 21 only
    if (command.startsWith('010D')) return ['41 0D 3C'];
    if (command.startsWith('0131')) return ['41 31 00 7B'];
    if (command.startsWith('01A6')) return ['41 A6 00 01 86 A0'];
    return ['NO DATA'];
  });
  const summary = await runObdDiagnostics(r.send, r.emit);
  const text = joined(r.lines);

  check('AC-841 an advertised PID is listed', summary.advertised.includes('0D'),
    summary.advertised.join(' '));
  check('AC-841 a PID that answers is listed', summary.answered.includes('31'),
    summary.answered.join(' '));
  check('AC-841 a PID that declines is listed as silent', summary.silent.includes('1F'),
    summary.silent.join(' '));
  check('AC-841 an undeclared but answering PID is called out',
    text.includes('answered but not advertised') && /answered but not advertised:.*A6/.test(text),
    text.slice(text.indexOf('answered but not advertised'), text.indexOf('answered but not advertised') + 60));
  check('AC-841 raw replies are printed verbatim', text.includes('41 A6 00 01 86 A0'));
  check('AC-841 alongside a readable decode', text.includes('10000.0 km'), text.slice(0, 80));
  check('AC-841 speed is decoded', text.includes('60 km/h'));
  check('AC-841 the distance counter is decoded', text.includes('123 km'));
}

/* ---------------- AC-842: the sweep asks nothing that identifies the car ---------------- */

{
  const r = recorder(() => ['NO DATA']);
  await runObdDiagnostics(r.send, r.emit);
  // Mode 09 carries the VIN, which identifies the vehicle and so its owner. A sweep is
  // written to be pasted into a chat window, so it must not collect one.
  check('AC-842 no mode 09 request is made',
    !r.asked.some((command) => command.toUpperCase().startsWith('09')),
    r.asked.join(' '));
}

/* ---------------- The bitmap description ---------------- */

{
  // 0x80 in the first byte is the highest bit, which describes basePid + 1.
  check('the first bit describes the PID after the base',
    describeSupportedPids([0x80, 0, 0, 0], 0x00).join(' ') === '01');
  // Bit 3 of the first byte is the fifth from the top, so it describes basePid + 5.
  check('a mid-byte bit maps to the right offset',
    describeSupportedPids([0x08, 0, 0, 0], 0x00).join(' ') === '05');
  // 0D lives at offset 13, which is bit 3 of the second byte.
  check('0D decodes out of the second byte',
    describeSupportedPids([0x00, 0x08, 0, 0], 0x00).join(' ') === '0D',
    describeSupportedPids([0x00, 0x08, 0, 0], 0x00).join(' '));
  check('A6 sits at offset 6 of the A0 block',
    describeSupportedPids([0x04, 0, 0, 0], 0xa0).join(' ') === 'A6',
    describeSupportedPids([0x04, 0, 0, 0], 0xa0).join(' '));
  check('a short bitmap is not read past its end',
    describeSupportedPids([0xff], 0x00).length === 8);
  check('an empty bitmap claims nothing',
    describeSupportedPids([], 0x00).length === 0);
}

/* ---------------- Interpretation ---------------- */

{
  check('speed reads in km/h', interpret(PID_SPEED, ['41 0D 3C']) === '60 km/h');
  check('the odometer reads in km with the raw count kept',
    interpret(PID_ODOMETER, ['41 A6 00 01 86 A0']) === '10000.0 km (raw 100000)');
  check('the distance counter reads in km', interpret(PID_DISTANCE, ['41 31 00 7B']) === '123 km');
  check('run time reads in seconds and minutes',
    interpret(0x1f, ['41 1F 00 78']) === '120 s (2.0 min)');
  check('an unknown PID still shows its data bytes',
    interpret(0x42, ['41 42 33 44']) === 'data 33 44');
  check('a missing reply interprets as nothing', interpret(PID_SPEED, ['NO DATA']) === null);
  check('a reply for a different PID is not borrowed',
    interpret(PID_ODOMETER, ['41 31 00 7B']) === null);
}

report('obd-diagnostics');
