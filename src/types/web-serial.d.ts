/**
 * Web Serial API Type Definitions
 * Based on WICG Web Serial API specification
 * https://wicg.github.io/serial/
 */

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPortRequestOptions {
  filters?: SerialPortFilter[];
}

interface SerialOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  bufferSize?: number;
  flowControl?: "none" | "hardware";
}

interface SerialOutputSignals {
  dataTerminalReady?: boolean;
  requestToSend?: boolean;
  break?: boolean;
}

interface SerialInputSignals {
  dataCarrierDetect: boolean;
  clearToSend: boolean;
  ringIndicator: boolean;
  dataSetReady: boolean;
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;

  getInfo(): SerialPortInfo;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  setSignals(signals: SerialOutputSignals): Promise<void>;
  getSignals(): Promise<SerialInputSignals>;
  forget(): Promise<void>;

  onconnect: ((this: SerialPort, ev: Event) => void) | null;
  ondisconnect: ((this: SerialPort, ev: Event) => void) | null;
}

interface SerialPortEvent extends Event {
  readonly port: SerialPort;
}

interface Serial extends EventTarget {
  getPorts(): Promise<SerialPort[]>;
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;

  onconnect: ((this: Serial, ev: SerialPortEvent) => void) | null;
  ondisconnect: ((this: Serial, ev: SerialPortEvent) => void) | null;
}

// Navigator interface removed to avoid conflict/unused var

// Window interface removed as it is not used directly

// For TypeScript module augmentation
declare global {
  interface Navigator {
    readonly serial: Serial;
  }
}

export {};
