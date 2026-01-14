import type { ConnectionState, SerialEventHandlers } from "./SerialService";

export interface HardwareService {
  state: ConnectionState;
  isConnected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(command: string, timeout?: number): Promise<string>;
  executeSeedRequest(header?: string): Promise<{ seed: string; log: string }>;
  sendKey(key: string): Promise<string>;
  sendKey5Byte(key: string): Promise<string>;
  setHandlers(handlers: SerialEventHandlers): void;
  listDevices?(): Promise<
    Array<{ name: string; vendor: string; dll_path: string }>
  >;
  setDllPath?(path: string): void;
}
