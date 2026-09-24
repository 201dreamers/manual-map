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
export const OBD_SERVICE_UUIDS: string[] = [
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ffe5-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000abf0-0000-1000-8000-00805f9b34fb',
  '0000ffff-0000-1000-8000-00805f9b34fb',
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
function findSerialCharacteristic(
  characteristics: GattCharacteristicLike[],
): GattCharacteristicLike | null {
  return (
    characteristics.find(
      (c) => c.properties.notify && (c.properties.write || c.properties.writeWithoutResponse),
    ) ?? null
  );
}

export function createWebBluetoothTransport(): ObdTransport {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const dataHandlers = new Set<(chunk: string) => void>();
  const disconnectHandlers = new Set<() => void>();

  let device: BluetoothDeviceLike | null = null;
  let characteristic: GattCharacteristicLike | null = null;
  let state: TransportState = 'disconnected';

  const handleDisconnect = () => {
    state = 'disconnected';
    characteristic = null;
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
        for (const service of services) {
          const found = findSerialCharacteristic(await service.getCharacteristics());
          if (found) {
            characteristic = found;
            break;
          }
        }
        if (!characteristic) {
          throw new ObdError('This does not look like a supported OBD adapter.');
        }

        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', () => {
          const value = characteristic?.value;
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
      if (!characteristic) throw new ObdError('Not connected.');
      // The ELM327 terminates every command with a carriage return, not a newline.
      const payload = encoder.encode(`${command}\r`);
      if (characteristic.writeValueWithoutResponse) {
        await characteristic.writeValueWithoutResponse(payload);
      } else {
        await characteristic.writeValue(payload);
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
      characteristic = null;
      device = null;
      state = 'disconnected';
    },
  };
}
