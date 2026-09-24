/**
 * ELM327 client: line assembly, a strictly serial command queue, and the startup
 * handshake. Pure apart from the transport handed in, so the whole of it runs headless
 * against a scripted fake.
 */

import type { ObdTransport } from './transport';
import {
  PID_ODOMETER,
  PID_SUPPORT_BASE_00,
  PID_SUPPORT_BASE_A0,
  buildMode01Request,
  decodeSupportBitmap,
  isPidSupported,
} from './pids';

/**
 * The adapter answers with carriage-return separated lines and then a bare `>` prompt
 * meaning "ready for the next command". BLE hands those bytes over in roughly 20-byte
 * notifications that cut wherever they like - mid-line, mid-byte-pair, or exactly on
 * the prompt - so reassembly cannot assume a notification is a line.
 */
export interface AssemblerState {
  buffer: string;
}

export interface AssembledResult {
  state: AssemblerState;
  lines: string[];
  /** True when the prompt arrived, meaning the adapter has finished answering. */
  prompted: boolean;
}

export function createAssembler(): AssemblerState {
  return { buffer: '' };
}

export function feedAssembler(state: AssemblerState, chunk: string): AssembledResult {
  let buffer = state.buffer;
  const lines: string[] = [];
  let prompted = false;

  for (const character of chunk) {
    if (character === '\r' || character === '\n') {
      const line = buffer.trim();
      // Blank lines are structural: a reply is terminated by \r and the prompt is
      // preceded by another. Emitting them would be emitting a partial response.
      if (line) lines.push(line);
      buffer = '';
    } else if (character === '>') {
      const line = buffer.trim();
      if (line) lines.push(line);
      buffer = '';
      prompted = true;
    } else {
      buffer += character;
    }
  }

  return { state: { buffer }, lines, prompted };
}

/** Commands sent before any PID request, in this order. AC-603 asserts exactly this. */
export const INIT_COMMANDS = [
  // Reset. Everything below is undone by a power cycle, so it has to be re-sent anyway.
  'ATZ',
  // Echo off. Without it every reply is prefixed by the command that caused it, which
  // doubles the bytes over a link where bytes are the bottleneck.
  'ATE0',
  // Linefeeds off: carriage returns alone are enough to frame a line.
  'ATL0',
  // Headers off. The ECU address adds three bytes to every single response and nothing
  // here needs to know which controller answered.
  'ATH0',
  // Automatic protocol detection, so the same code works across CAN and the older buses.
  'ATSP0',
  // Adaptive timing: the adapter shortens its own wait once it learns how fast the car
  // replies, instead of always burning its worst-case timeout.
  'ATAT1',
] as const;

/** Reset can take a second or more on a clone, so it gets its own allowance. */
export const RESET_TIMEOUT_MS = 5000;
/** Everything else should answer well inside this, and a stall must not block the queue. */
export const COMMAND_TIMEOUT_MS = 1000;

export interface InitResult {
  /** Whatever the adapter called itself after reset, e.g. `ELM327 v1.5`. */
  identity: string | null;
  /** D-18: probed from the 01A0 bitmap, never assumed. */
  odometerSupported: boolean;
  /** Present when the car answered the 0100 probe at all. */
  respondedToSupportProbe: boolean;
}

export interface Elm327Client {
  send(command: string, timeoutMs?: number): Promise<string[]>;
  initialize(): Promise<InitResult>;
  /** Every command written, in order. Exists so AC-602 and AC-603 can assert on it. */
  readonly commandLog: readonly string[];
  dispose(): void;
}

interface PendingCommand {
  command: string;
  lines: string[];
  resolve: (lines: string[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Before `ATE0` lands the adapter echoes what it was sent; that is not a response. */
function isEcho(line: string, command: string): boolean {
  return line.replace(/\s+/g, '').toUpperCase() === command.replace(/\s+/g, '').toUpperCase();
}

export function createElm327(transport: ObdTransport): Elm327Client {
  let assembler = createAssembler();
  let pending: PendingCommand | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const commandLog: string[] = [];

  const settle = (pendingCommand: PendingCommand) => {
    clearTimeout(pendingCommand.timer);
    pending = null;
  };

  const unsubscribe = transport.onData((chunk) => {
    const fed = feedAssembler(assembler, chunk);
    assembler = fed.state;
    if (!pending) return;

    for (const line of fed.lines) {
      if (!isEcho(line, pending.command)) pending.lines.push(line);
    }

    if (fed.prompted) {
      const finished = pending;
      settle(finished);
      finished.resolve(finished.lines);
    }
  });

  const unsubscribeDrop = transport.onDisconnect(() => {
    if (!pending) return;
    const dropped = pending;
    settle(dropped);
    dropped.reject(new Error('The adapter disconnected mid-command.'));
  });

  function send(command: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<string[]> {
    const run = () =>
      new Promise<string[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending = null;
          reject(new Error(`No reply to ${command} within ${timeoutMs} ms.`));
        }, timeoutMs);

        pending = { command, lines: [], resolve, reject, timer };
        commandLog.push(command);
        transport.write(command).catch((error: unknown) => {
          settle(pending!);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });

    // Both arms run the next command: the adapter is strictly one-in-flight, so a
    // failure must not wedge everything queued behind it.
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  }

  async function initialize(): Promise<InitResult> {
    let identity: string | null = null;

    for (const command of INIT_COMMANDS) {
      const timeout = command === 'ATZ' ? RESET_TIMEOUT_MS : COMMAND_TIMEOUT_MS;
      const lines = await send(command, timeout);
      if (command === 'ATZ') {
        identity = lines.find((line) => /ELM|OBD/i.test(line)) ?? null;
      }
    }

    // 0100 first: it is the universally supported probe, so a car that ignores it is
    // telling us the bus is not talking at all, which is worth knowing before A0.
    const baseLines = await send(buildMode01Request(PID_SUPPORT_BASE_00));
    const respondedToSupportProbe = decodeSupportBitmap(baseLines, PID_SUPPORT_BASE_00) !== null;

    // D-18 and AC-602: the odometer block is probed, and 01A6 is never sent unless this
    // says it exists. Treating a NO DATA as zero would anchor the cursor to the start.
    const odometerLines = await send(buildMode01Request(PID_SUPPORT_BASE_A0));
    const odometerBitmap = decodeSupportBitmap(odometerLines, PID_SUPPORT_BASE_A0);
    const odometerSupported =
      odometerBitmap !== null && isPidSupported(odometerBitmap, PID_SUPPORT_BASE_A0, PID_ODOMETER);

    return { identity, odometerSupported, respondedToSupportProbe };
  }

  return {
    send,
    initialize,
    get commandLog() {
      return commandLog;
    },
    dispose() {
      unsubscribe();
      unsubscribeDrop();
      if (pending) {
        clearTimeout(pending.timer);
        pending = null;
      }
    },
  };
}
