/**
 * Minimal assertion helpers for the headless suites. Each test file is bundled
 * by `vite.test.config.ts` and executed with plain node, so there is no test
 * framework and no browser - only pure logic and stubbed globals.
 */

let failures = 0;
let passes = 0;

export function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passes++;
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

/** Prints the suite tally and exits non-zero if anything failed. */
export function report(suite: string): void {
  const total = passes + failures;
  if (failures === 0) {
    console.log(`${suite}: ${passes}/${total} passed`);
    return;
  }
  console.log(`${suite}: ${failures} of ${total} FAILED`);
  process.exit(1);
}

/** localStorage backed by a Map, plus the window surface the store touches. */
export function installStorageStub(): Map<string, string> {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  };
  const globals = globalThis as Record<string, unknown>;
  globals.window = { localStorage: storage, setTimeout: () => 0 };
  globals.localStorage = storage;
  return memory;
}

/** Stubs the Directions API with a fixed successful route. */
export function stubDirections(coordinates: [number, number][], distanceMeters: number): void {
  (globalThis as Record<string, unknown>).fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      code: 'Ok',
      routes: [{ distance: distanceMeters, geometry: { coordinates } }],
    }),
  });
}

/**
 * Scripted stand-in for the one impure file in the OBD stack. `respond` returns the
 * chunks the adapter would push back, so a test controls exactly where the BLE
 * fragmentation falls - which is the thing the real transport cannot be trusted about.
 */
export interface FakeObdTransport {
  sent: string[];
  state: 'connected';
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(command: string): Promise<void>;
  onData(handler: (chunk: string) => void): () => void;
  onDisconnect(handler: () => void): () => void;
  /** Simulates the link dropping on its own, rather than by request. */
  dropLink(): void;
}

export function createFakeObdTransport(
  respond: (command: string) => string[],
): FakeObdTransport {
  const dataHandlers = new Set<(chunk: string) => void>();
  const dropHandlers = new Set<() => void>();
  const sent: string[] = [];

  return {
    sent,
    state: 'connected',
    async connect() {},
    async disconnect() {},
    async write(command: string) {
      sent.push(command);
      const chunks = respond(command);
      setTimeout(() => chunks.forEach((chunk) => dataHandlers.forEach((h) => h(chunk))), 0);
    },
    onData(handler) {
      dataHandlers.add(handler);
      return () => dataHandlers.delete(handler);
    },
    onDisconnect(handler) {
      dropHandlers.add(handler);
      return () => dropHandlers.delete(handler);
    },
    dropLink() {
      dropHandlers.forEach((handler) => handler());
    },
  };
}

/** Four bitmap bytes describing base+1 .. base+32, most significant bit first. */
export function obdSupportBitmap(basePid: number, supported: number[]): string {
  const bytes = [0, 0, 0, 0];
  for (const pid of supported) {
    const offset = pid - basePid;
    bytes[Math.floor((offset - 1) / 8)] |= 1 << (7 - ((offset - 1) % 8));
  }
  const hex = bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  return `41 ${basePid.toString(16).toUpperCase().padStart(2, '0')} ${hex}`;
}

/** Runs an in-flight step glide to completion, the way the rAF loop would. */
export function settleStepAnimation(
  getState: () => { advanceStepAnimation: (deltaSeconds: number) => boolean },
): void {
  let frames = 0;
  while (getState().advanceStepAnimation(1 / 60)) {
    if (++frames > 600) throw new Error('step animation never settled');
  }
}
