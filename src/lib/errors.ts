/**
 * The boundary between what went wrong and what the driver is told.
 *
 * Only messages this app wrote itself are ever shown. Anything else - a DOMException
 * from Web Bluetooth, a TypeError from a genuine bug, a vendor SDK's internal text -
 * carries implementation detail: characteristic UUIDs, method names, property paths,
 * sometimes a stack. None of that helps someone holding a phone in a car, and a message
 * like "Cannot read properties of undefined (reading 'server')" is worse than useless.
 *
 * So `userFacingMessage` gates on type, not on content: an error has to descend from
 * `AppError` to have its message repeated. `isUserSafeMessage` is a second line of
 * defence over that, in case an authored message ever grows a template hole that gets
 * filled with something technical - which is exactly how the OBD timeout message came
 * to carry the raw AT command.
 */
export class AppError extends Error {}

/** Patterns that mean a string is describing code rather than a situation. */
const CODE_SHAPED = [
  /\bat\s+\S+\s*\(/i, // stack frame: "at foo (bar.ts:1:2)"
  /\.[jt]sx?:\d+/i, // file:line
  /\b(?:Type|Reference|Syntax|Range|Eval|Internal)Error\b/,
  /\bDOMException\b/,
  /Cannot read propert/i,
  /is not a function|is not defined|undefined is not/i,
  /=>|\bfunction\s*\(|\{\s*\[native code\]/,
  /\[object [A-Z]/,
  /\bnull\b|\bundefined\b|\bNaN\b/,
  /Failed to execute '\w+' on/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, // a UUID
  /\bAT[A-Z]{1,3}\d*\b|\b0[0-9A-F]{3,}\b/, // an ELM327 command or a raw PID
];

/** Long enough for a sentence or two; past that it is a dump, not a message. */
const MAX_MESSAGE_LENGTH = 160;

export function isUserSafeMessage(text: unknown): text is string {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_LENGTH) return false;
  if (trimmed.includes('\n')) return false;
  return !CODE_SHAPED.some((pattern) => pattern.test(trimmed));
}

/**
 * The only way an error should reach the interface. `fallback` must be an authored
 * sentence: it is what the driver sees for everything unexpected, which is most things.
 */
export function userFacingMessage(error: unknown, fallback: string): string {
  if (error instanceof AppError && isUserSafeMessage(error.message)) return error.message;
  return fallback;
}
