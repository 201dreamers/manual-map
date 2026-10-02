/**
 * A one-shot interrogation of whatever the car is willing to say about distance.
 *
 * The problem this solves is that the only way to learn what a given vehicle supports is
 * to ask it, and asking requires a car, a drive and a laptop. Every round trip is
 * expensive in a way no amount of reading the code makes cheaper, so this asks
 * everything worth asking in one pass and prints the raw reply alongside the decode.
 * The raw line matters as much as the decode: a wrong decode and an unanswered PID look
 * identical once decoded, and only the raw text tells them apart.
 *
 * Two rules govern everything here, because this runs on a live connection during a
 * drive:
 *
 *  - **It never throws.** A probe that times out, a transport that drops, a reply that
 *    is garbage: all are findings, printed and moved past. A diagnostic that can break
 *    the session it is diagnosing is worse than no diagnostic.
 *  - **It never mutates.** Nothing here touches the reckoner, the calibration or the
 *    store. It reads and reports.
 *
 * Mode 09 is deliberately absent. The useful PID there is the VIN, which identifies the
 * vehicle and therefore its owner, and a diagnostic dump is exactly the kind of thing
 * that gets pasted into a chat window.
 */

import {
  PID_DISTANCE,
  PID_ODOMETER,
  PID_SPEED,
  buildMode01Request,
  decodeDistanceKm,
  decodeMode01,
  decodeOdometerRaw,
  decodeSpeedKmh,
  decodeSupportBitmap,
  isNonDataLine,
} from './pids';

/** Where a diagnostic line goes. Injected so tests can capture instead of printing. */
export type DiagnosticSink = (line: string) => void;

/** The narrow slice of the ELM327 client this needs. Keeps the module testable. */
export type DiagnosticSend = (command: string, timeoutMs?: number) => Promise<string[]>;

/**
 * Adapter-level questions, answered by the ELM327 itself rather than the car. Worth
 * asking first: if the adapter cannot describe itself, nothing below will work either,
 * and `ATDP` naming a protocol is the clearest single sign the bus was actually found.
 */
export const AT_PROBES: ReadonlyArray<{ command: string; label: string }> = [
  { command: 'ATI', label: 'adapter identity' },
  { command: 'AT@1', label: 'device description' },
  { command: 'ATDP', label: 'protocol' },
  { command: 'ATRV', label: 'battery voltage' },
];

/**
 * The seven mode 01 support blocks. Each answers 32 bits covering the next 32 PIDs.
 *
 * The standard says to walk them - 0100 tells you whether 0120 is worth asking - but all
 * seven are asked unconditionally here. A block that is not supported answers `NO DATA`
 * in well under a second, and cars have been observed answering blocks they do not
 * advertise, which is precisely the kind of thing this sweep exists to catch. Seven
 * commands once per connection is not a cost worth optimising against a lost finding.
 */
export const SUPPORT_BLOCKS: readonly number[] = [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0];

/**
 * Individual PIDs asked directly, regardless of what the bitmaps claimed.
 *
 * The distance-related ones are the point of the exercise. The rest are cross-checks:
 * `011F` gives engine run time, which combined with a distance counter says whether the
 * counter is moving at a plausible average speed, and `010C`/`010D` prove the bus is
 * live at the moment the sweep ran rather than at connect.
 */
export const PID_PROBES: ReadonlyArray<{ pid: number; label: string }> = [
  { pid: 0x01, label: 'monitor status' },
  { pid: 0x0c, label: 'engine RPM' },
  { pid: PID_SPEED, label: 'vehicle speed' },
  { pid: 0x1f, label: 'run time since start' },
  { pid: 0x21, label: 'distance with MIL on' },
  { pid: PID_DISTANCE, label: 'distance since codes cleared' },
  { pid: 0x4e, label: 'time since codes cleared' },
  { pid: PID_ODOMETER, label: 'odometer' },
];

const hex2 = (value: number): string => value.toString(16).toUpperCase().padStart(2, '0');

/**
 * Turns a support bitmap into the list of PIDs it claims, as `0D 0C 1F` style text.
 *
 * Printed rather than summarised because the list is the finding. "Supports 0131: false"
 * invites a second drive to ask what it does support; the list answers that now.
 */
export function describeSupportedPids(bitmap: number[], basePid: number): string[] {
  const supported: string[] = [];
  for (let offset = 1; offset <= 32; offset += 1) {
    const byteIndex = Math.floor((offset - 1) / 8);
    if (byteIndex >= bitmap.length) break;
    const bitInByte = 7 - ((offset - 1) % 8);
    if (((bitmap[byteIndex] >> bitInByte) & 1) === 1) supported.push(hex2(basePid + offset));
  }
  return supported;
}

/**
 * A human-readable reading for the PIDs where one can be computed, or null.
 *
 * Deliberately separate from the decoders the app actually runs on: those return counts
 * in the PID's own units because the reckoner owns the conversion, and a person reading
 * a log wants kilometres. Where a PID has no dedicated decoder the raw data bytes are
 * shown, which is still more use than nothing.
 */
export function interpret(pid: number, lines: string[]): string | null {
  switch (pid) {
    case PID_SPEED: {
      const speed = decodeSpeedKmh(lines);
      return speed === null ? null : `${speed} km/h`;
    }
    case PID_ODOMETER: {
      const raw = decodeOdometerRaw(lines);
      return raw === null ? null : `${(raw / 10).toFixed(1)} km (raw ${raw})`;
    }
    case PID_DISTANCE: {
      const km = decodeDistanceKm(lines);
      return km === null ? null : `${km} km`;
    }
    case 0x21: {
      const data = decodeMode01(lines, 0x21);
      return data && data.length >= 2 ? `${data[0] * 0x100 + data[1]} km` : null;
    }
    case 0x1f: {
      const data = decodeMode01(lines, 0x1f);
      if (!data || data.length < 2) return null;
      const seconds = data[0] * 0x100 + data[1];
      return `${seconds} s (${(seconds / 60).toFixed(1)} min)`;
    }
    case 0x4e: {
      const data = decodeMode01(lines, 0x4e);
      if (!data || data.length < 2) return null;
      return `${data[0] * 0x100 + data[1]} min`;
    }
    case 0x0c: {
      const data = decodeMode01(lines, 0x0c);
      if (!data || data.length < 2) return null;
      return `${((data[0] * 0x100 + data[1]) / 4).toFixed(0)} rpm`;
    }
    default: {
      const data = decodeMode01(lines, pid);
      return data === null ? null : `data ${data.map(hex2).join(' ')}`;
    }
  }
}

/**
 * Sends one command and reports what came back, swallowing every failure into a printed
 * line. The return value says whether anything usable arrived, so callers can summarise
 * without re-deciding what "usable" means.
 */
async function probe(
  send: DiagnosticSend,
  emit: DiagnosticSink,
  command: string,
  label: string,
): Promise<string[] | null> {
  try {
    const lines = await send(command);
    const answered = lines.some((line) => !isNonDataLine(line));
    emit(`[obd]   ${command} ${label}: ${JSON.stringify(lines)}`);
    return answered ? lines : null;
  } catch {
    // Intentionally opaque: `userFacingMessage` is for people, and this is for a log
    // where the only fact that matters is that the command produced nothing.
    emit(`[obd]   ${command} ${label}: no reply`);
    return null;
  }
}

export interface DiagnosticSummary {
  /** PIDs the bitmaps claimed, across every block that answered. */
  advertised: string[];
  /** PIDs that answered when asked directly, whatever the bitmaps said. */
  answered: string[];
  /** Asked directly and declined, so the absence is measured rather than assumed. */
  silent: string[];
}

/**
 * Runs the whole sweep. Resolves with a summary and never rejects.
 *
 * The summary exists mainly so the two lists can be compared: a PID in `answered` but
 * not `advertised` is a car under-reporting itself, which is the case that made the
 * odometer confirmation probe necessary (D-94) and which a bitmap-only check gets wrong.
 */
export async function runObdDiagnostics(
  send: DiagnosticSend,
  emit: DiagnosticSink = (line) => console.info(line),
): Promise<DiagnosticSummary> {
  const advertised: string[] = [];
  const answered: string[] = [];
  const silent: string[] = [];

  try {
    emit('[obd] --- diagnostic sweep start ---');

    emit('[obd] adapter:');
    for (const { command, label } of AT_PROBES) {
      await probe(send, emit, command, label);
    }

    emit('[obd] support bitmaps:');
    for (const base of SUPPORT_BLOCKS) {
      const lines = await probe(send, emit, buildMode01Request(base), `block ${hex2(base)}`);
      if (lines === null) continue;
      const bitmap = decodeSupportBitmap(lines, base);
      if (bitmap === null) continue;
      const pids = describeSupportedPids(bitmap, base);
      advertised.push(...pids);
      emit(`[obd]     claims: ${pids.length > 0 ? pids.join(' ') : '(none)'}`);
    }

    emit('[obd] direct PID probes:');
    for (const { pid, label } of PID_PROBES) {
      const lines = await probe(send, emit, buildMode01Request(pid), label);
      const reading = lines === null ? null : interpret(pid, lines);
      if (reading === null) {
        silent.push(hex2(pid));
        continue;
      }
      answered.push(hex2(pid));
      emit(`[obd]     ${label} = ${reading}`);
    }

    const undeclared = answered.filter((pid) => !advertised.includes(pid));
    emit(`[obd] advertised: ${advertised.join(' ') || '(none)'}`);
    emit(`[obd] answered:   ${answered.join(' ') || '(none)'}`);
    emit(`[obd] silent:     ${silent.join(' ') || '(none)'}`);
    emit(`[obd] answered but not advertised: ${undeclared.join(' ') || '(none)'}`);
    emit('[obd] --- diagnostic sweep end ---');
  } catch {
    // The loops above already catch per probe, so reaching here means something
    // structural broke - the transport disappearing mid-sweep, most likely. Report the
    // truncation rather than rejecting: a partial sweep is still evidence, and the
    // caller is in the middle of a drive.
    emit('[obd] --- diagnostic sweep aborted, results above are partial ---');
  }

  return { advertised, answered, silent };
}
