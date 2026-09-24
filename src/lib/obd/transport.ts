/**
 * The only file in the OBD stack that touches Web Bluetooth.
 *
 * Everything above this line - line assembly, the command queue, PID decoding, the
 * reckoning arithmetic - is pure and runs under the headless harness. That split is
 * deliberate: there is no browser, no BLE radio and no vehicle in the build
 * environment, so the untestable surface is kept to exactly one seam that a fake can
 * stand in for.
 *
 * Note on naming: section 31 of the spec sketches this interface with `onLine`. The
 * assembler belongs to `elm327.ts` per the same section's file split, so the transport
 * deals in raw chunks and the method is `onData`. BLE notifications arrive in roughly
 * 20-byte fragments that cut across line boundaries, so nothing at this level can
 * honestly claim to hand out lines.
 */

import { AppError } from '../errors';

/**
 * An OBD failure whose message was written for the driver rather than for a log. Only
 * these reach the interface; a DOMException from the Bluetooth stack does not.
 */
export class ObdError extends AppError {}

export type TransportState = 'disconnected' | 'connecting' | 'connected';

export interface ObdTransport {
  connect(): Promise<void>;
  write(command: string): Promise<void>;
  /** Subscribes to raw inbound text. Returns an unsubscribe function. */
  onData(handler: (chunk: string) => void): () => void;
  /** Called when the link drops on its own, rather than by request. */
  onDisconnect(handler: () => void): () => void;
  disconnect(): Promise<void>;
  readonly state: TransportState;
}

/**
 * Service UUIDs seen on ELM327 clones. Web Bluetooth refuses access to any service not
 * declared up front, so the list has to be broad even though a given adapter uses one.
 * D-16: the actual service and characteristic are discovered at runtime rather than
 * hardcoded, because the same product code ships with different firmware.
 */
/**
 * The allowlist, and the single biggest constraint in this file.
 *
 * Web Bluetooth will only ever hand back services named here: `getPrimaryServices()`
 * silently returns an empty array for anything omitted, with no way to enumerate what
 * the device actually offers. A native app has no such restriction, which is why an
 * adapter that works in a native OBD app can still look unsupported here. If an adapter
 * is rejected, the first suspect is this list, not the adapter.
 *
 * Nordic UART is included because a large share of ELM327 clones expose their serial
 * bridge through it rather than through one of the 16-bit vendor ranges.
 */
export const OBD_SERVICE_UUIDS: string[] = [
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ffe5-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000abf0-0000-1000-8000-00805f9b34fb',
  '0000ffff-0000-1000-8000-00805f9b34fb',
  '0000fff1-0000-1000-8000-00805f9b34fb',
  '0000ffb0-0000-1000-8000-00805f9b34fb',
  '0000fd5a-0000-1000-8000-00805f9b34fb',
  // Nordic UART Service, common in BLE serial bridges.
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
];

/* --- Minimal Web Bluetooth surface. Declared here rather than pulled from an @types
   package, because the spec's zero-new-dependency constraint covers dev deps too. --- */

interface GattCharacteristicLike {
  uuid: string;
  properties: { notify: boolean; write: boolean; writeWithoutResponse: boolean };
  value?: DataView | null;
  startNotifications(): Promise<GattCharacteristicLike>;
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  addEventListener(type: string, listener: () => void): void;
}

interface GattServiceLike {
  uuid: string;
  getCharacteristics(): Promise<GattCharacteristicLike[]>;
}

interface GattServerLike {
  connected: boolean;
  connect(): Promise<GattServerLike>;
  disconnect(): void;
  getPrimaryServices(): Promise<GattServiceLike[]>;
}

interface BluetoothDeviceLike {
  name?: string;
  gatt?: GattServerLike;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface BluetoothLike {
  requestDevice(options: {
    acceptAllDevices?: boolean;
    optionalServices?: string[];
  }): Promise<BluetoothDeviceLike>;
  getDevices?(): Promise<BluetoothDeviceLike[]>;
}

/** D-24: the entire OBD surface hides when the API is absent, so this is the gate. */
export function isWebBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

function getBluetooth(): BluetoothLike {
  const bluetooth = (navigator as unknown as { bluetooth?: BluetoothLike }).bluetooth;
  if (!bluetooth) throw new ObdError('Web Bluetooth is unavailable in this browser.');
  return bluetooth;
}

/**
 * Picks the characteristic to talk over: one that can both notify and be written. An
 * ELM327 exposes a single such pipe and it behaves like a serial port. Searching for
 * the capability rather than a known UUID is what lets this work across clones.
 */
/**
 * Prints what the adapter actually exposed. Console only: the on-screen message stays
 * the plain sentence a driver can act on, while the UUIDs a fix needs go somewhere they
 * can be copied out of. Zero services printed here means the allowlist missed, not that
 * the adapter is unsupported - the two look identical from the interface.
 */
async function logDiscovery(
  device: BluetoothDeviceLike,
  services: GattServiceLike[],
): Promise<void> {
  try {
    const lines = [`[obd] device: ${device.name ?? '(unnamed)'}`];
    if (services.length === 0) {
      lines.push(
        '[obd] no services visible. Web Bluetooth only returns services listed in',
        '[obd] OBD_SERVICE_UUIDS, so this adapter almost certainly uses one that is not',
        '[obd] in that list. Read its real UUIDs with a native scanner (nRF Connect).',
      );
    }
    for (const service of services) {
      lines.push(`[obd] service ${service.uuid}`);
      for (const characteristic of await service.getCharacteristics()) {
        const { notify, write, writeWithoutResponse } = characteristic.properties;
        lines.push(
          `[obd]   char ${characteristic.uuid} ` +
            `notify=${notify} write=${write} writeNoResponse=${writeWithoutResponse}`,
        );
      }
    }
    console.info(lines.join('\n'));
  } catch {
    // Diagnostics must never be the reason a connection fails.
  }
}

/** The two ends of the serial bridge. They are often, but not always, one characteristic. */
export interface SerialChannel {
  notify: GattCharacteristicLike;
  write: GattCharacteristicLike;
}

const canWrite = (c: GattCharacteristicLike) =>
  c.properties.write || c.properties.writeWithoutResponse;

/**
 * Finds the read and write ends of the serial bridge.
 *
 * The first version of this demanded a single characteristic carrying both `notify` and
 * a write property, which is the minority arrangement. Nordic UART - and the 16-bit
 * vendor services that most ELM327 clones copy - split the two: one characteristic
 * notifies, a sibling accepts writes, and neither has both. An adapter built that way
 * was rejected as having "no readable data channel" while working perfectly elsewhere.
 *
 * A combined characteristic still wins when one exists, because an adapter offering it
 * means it, and pairing across it could otherwise pick a control characteristic by
 * mistake.
 */
export function findSerialChannel(
  characteristics: GattCharacteristicLike[],
): SerialChannel | null {
  const combined = characteristics.find((c) => c.properties.notify && canWrite(c));
  if (combined) return { notify: combined, write: combined };

  const notify = characteristics.find((c) => c.properties.notify);
  const write = characteristics.find(canWrite);
  return notify && write ? { notify, write } : null;
}

export function createWebBluetoothTransport(): ObdTransport {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const dataHandlers = new Set<(chunk: string) => void>();
  const disconnectHandlers = new Set<() => void>();

  let device: BluetoothDeviceLike | null = null;
  let channel: SerialChannel | null = null;
  let state: TransportState = 'disconnected';

  const handleDisconnect = () => {
    state = 'disconnected';
    channel = null;
    disconnectHandlers.forEach((handler) => handler());
  };

  return {
    get state() {
      return state;
    },

    async connect() {
      state = 'connecting';
      try {
        // requestDevice must be called from a user gesture; the caller owns that.
        device = await getBluetooth().requestDevice({
          acceptAllDevices: true,
          optionalServices: OBD_SERVICE_UUIDS,
        });
        device.addEventListener('gattserverdisconnected', handleDisconnect);

        const server = await device.gatt?.connect();
        if (!server) throw new ObdError('The adapter did not accept the connection.');

        const services = await server.getPrimaryServices();
        // Diagnostics go to the console only, never on screen (D-80). Without this an
        // allowlist miss and a genuinely unsupported adapter are indistinguishable to
        // anyone trying to report the problem.
        logDiscovery(device, services);

        // Per service first, so the two ends come from the same bridge. Only if no one
        // service carries both does it fall back to pairing across all of them, which
        // covers adapters that split the bridge over sibling services.
        const everyCharacteristic: GattCharacteristicLike[] = [];
        for (const service of services) {
          const characteristics = await service.getCharacteristics();
          everyCharacteristic.push(...characteristics);
          const found = findSerialChannel(characteristics);
          if (found) {
            channel = found;
            break;
          }
        }
        if (!channel) channel = findSerialChannel(everyCharacteristic);

        if (!channel) {
          throw new ObdError(
            services.length === 0
              ? 'This adapter uses a Bluetooth service the app does not know about yet.'
              : 'This adapter exposes no readable data channel.',
          );
        }

        await channel.notify.startNotifications();
        channel.notify.addEventListener('characteristicvaluechanged', () => {
          const value = channel?.notify.value;
          if (!value) return;
          const chunk = decoder.decode(value);
          dataHandlers.forEach((handler) => handler(chunk));
        });

        state = 'connected';
      } catch (error) {
        state = 'disconnected';
        throw error;
      }
    },

    async write(command: string) {
      if (!channel) throw new ObdError('Not connected.');
      // The ELM327 terminates every command with a carriage return, not a newline.
      const payload = encoder.encode(`${command}\r`);
      const target = channel.write;
      // Without-response is preferred where the characteristic actually supports it:
      // a bridge that only advertises `write` will reject the other call outright.
      if (target.properties.writeWithoutResponse && target.writeValueWithoutResponse) {
        await target.writeValueWithoutResponse(payload);
      } else {
        await target.writeValue(payload);
      }
    },

    onData(handler) {
      dataHandlers.add(handler);
      return () => dataHandlers.delete(handler);
    },

    onDisconnect(handler) {
      disconnectHandlers.add(handler);
      return () => disconnectHandlers.delete(handler);
    },

    async disconnect() {
      device?.removeEventListener('gattserverdisconnected', handleDisconnect);
      device?.gatt?.disconnect();
      channel = null;
      device = null;
      state = 'disconnected';
    },
  };
}
