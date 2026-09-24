/**
 * OBD-II mode 01 request and response handling.
 *
 * Responses arrive as ASCII hex with the headers stripped (`ATH0`), so a speed reply is
 * literally the text `41 0D 3C`. The 0x41 is mode 0x01 with bit 6 set, the convention
 * for "this is an answer to that request", and everything after the echoed PID is data.
 */

/** Vehicle speed. One byte, whole km/h. Universally supported. */
export const PID_SPEED = 0x0d;

/**
 * Odometer. Four bytes, big-endian, 0.1 km per count, added in SAE J1979-2. Support is
 * manufacturer-dependent and plenty of vehicles simply will not answer, which is why it
 * is probed rather than assumed.
 */
export const PID_ODOMETER = 0xa6;

/**
 * Distance travelled since the diagnostic codes were last cleared. Two bytes, whole
 * kilometres, part of the original OBD-II set rather than a 2021 addition, so it is far
 * more widely supported than the odometer above.
 *
 * It is not an odometer - clearing codes resets it - but for calibration that does not
 * matter: what the reckoner needs is a counter that increases in step with real distance,
 * not one that agrees with the dashboard. A reset looks like a rollover and is already
 * refused by `applyOdometerSample`.
 *
 * Its 1 km resolution is ten times coarser than 01A6, which is why it is the second
 * choice where both exist, and still useful: the calibration gate needs 2 km before it
 * trusts anything, so a usable anchor has arrived by the time it is asked for.
 */
export const PID_DISTANCE = 0x31;

/** PID 0131 counts whole kilometres, so one count is 1000 metres. */
export const DISTANCE_UNIT_METERS = 1000;

/** Mode 01 marks a reply by setting bit 6 of the request mode. */
const MODE_01_REPLY = 0x41;

/**
 * Support bitmap requests. Each answers 32 bits describing the following 32 PIDs, so
 * `0100` covers 0x01-0x20 and `01A0` covers 0xA1-0xC0 - the block the odometer lives in.
 */
export const PID_SUPPORT_BASE_00 = 0x00;
/** Covers 0x21-0x40, the block holding the distance counter at 0x31. */
export const PID_SUPPORT_BASE_20 = 0x20;
export const PID_SUPPORT_BASE_A0 = 0xa0;

/**
 * Lines the ELM327 emits that are not data: protocol hunting, an unparseable command,
 * and the several ways it reports that the car declined to answer. `NO DATA` in
 * particular is a normal reply for an unsupported PID, not a fault.
 */
const NON_DATA_LINES = new Set([
  'SEARCHING...',
  'NO DATA',
  'UNABLE TO CONNECT',
  'STOPPED',
  'BUS INIT',
  'CAN ERROR',
  '?',
  'OK',
]);

export function isNonDataLine(line: string): boolean {
  return NON_DATA_LINES.has(line.trim().toUpperCase());
}

/**
 * Builds a mode 01 request with the expected response count appended - `010D1` rather
 * than `010D`. Without it the adapter waits out its full timeout on every request in
 * case a second ECU replies, which on a clone is the difference between roughly 2 Hz
 * and 5 Hz. The car only has one engine controller answering these.
 */
export function buildMode01Request(pid: number, expectedResponses = 1): string {
  return `01${pid.toString(16).toUpperCase().padStart(2, '0')}${expectedResponses}`;
}

/** Parses a whitespace-separated hex line into bytes. Returns null if anything is not hex. */
export function parseHexBytes(line: string): number[] | null {
  const cleaned = line.replace(/\s+/g, '');
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) return null;
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 2) bytes.push(parseInt(cleaned.slice(i, i + 2), 16));
  return bytes;
}

/**
 * Pulls the data bytes out of a mode 01 reply for one PID. Several lines may arrive -
 * status text, a stray echo, or another ECU answering - so every line is tried and the
 * first that actually matches this PID wins.
 */
export function decodeMode01(lines: string[], pid: number): number[] | null {
  for (const line of lines) {
    if (isNonDataLine(line)) continue;
    const bytes = parseHexBytes(line);
    if (!bytes || bytes.length < 2) continue;
    if (bytes[0] !== MODE_01_REPLY || bytes[1] !== pid) continue;
    return bytes.slice(2);
  }
  return null;
}

/** Vehicle speed in km/h, or null if the reply was missing or malformed. */
export function decodeSpeedKmh(lines: string[]): number | null {
  const data = decodeMode01(lines, PID_SPEED);
  if (!data || data.length < 1) return null;
  return data[0];
}

/**
 * Odometer in its own 0.1 km counts, left unscaled so the reckoning module owns the
 * conversion and there is exactly one place that knows the unit.
 */
export function decodeOdometerRaw(lines: string[]): number | null {
  const data = decodeMode01(lines, PID_ODOMETER);
  if (!data || data.length < 4) return null;
  // Unsigned 32-bit big-endian. Shifting would go negative at bit 31, so multiply.
  return data[0] * 0x1000000 + data[1] * 0x10000 + data[2] * 0x100 + data[3];
}

/**
 * Distance since codes cleared, in whole kilometres. Left unscaled like the odometer, so
 * the reckoner remains the only place that knows what a count is worth.
 */
export function decodeDistanceKm(lines: string[]): number | null {
  const data = decodeMode01(lines, PID_DISTANCE);
  if (!data || data.length < 2) return null;
  return data[0] * 0x100 + data[1];
}

/** The four bitmap bytes for a support block, or null if the car did not answer. */
export function decodeSupportBitmap(lines: string[], basePid: number): number[] | null {
  const data = decodeMode01(lines, basePid);
  if (!data || data.length < 4) return null;
  return data.slice(0, 4);
}

/**
 * Whether a bitmap says a PID is supported. The most significant bit of the first byte
 * describes `basePid + 1`, and it walks down from there across all 32 bits.
 */
export function isPidSupported(bitmap: number[], basePid: number, pid: number): boolean {
  const offset = pid - basePid;
  if (offset < 1 || offset > 32) return false;
  const byteIndex = Math.floor((offset - 1) / 8);
  const bitInByte = 7 - ((offset - 1) % 8);
  if (byteIndex >= bitmap.length) return false;
  return ((bitmap[byteIndex] >> bitInByte) & 1) === 1;
}
