import type { ConnectionState, SerialEventHandlers } from "./SerialService";

export interface HardwareService {
  state: ConnectionState;
  isConnected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(command: string, timeout?: number): Promise<string>;
  sendAndCollect?(command: string, timeout?: number): Promise<string[]>;
  sendAndCollectById?(
    command: string,
    timeout?: number
  ): Promise<
    Record<string, { id: number; responses: string[]; timestamps: number[] }>
  >;
  executeSeedRequest(header?: string): Promise<{ seed: string; log: string }>;
  sendKey(key: string): Promise<string>;
  sendKey5Byte(key: string): Promise<string>;
  setHandlers(handlers: SerialEventHandlers): void;
  listDevices?(): Promise<
    Array<{ name: string; vendor: string; dll_path: string }>
  >;
  setDllPath?(path: string): void;
  scanNetwork?(
    moduleIds: number[],
    protocols?: Array<"can" | "iso15765">,
    retries?: number
  ): Promise<Array<{ id: number; response: string }>>;
  setResponseFilters?(
    filters: Array<{ mask: number; pattern: number }>,
    responseIds?: number[]
  ): Promise<void>;
  setFunctionalResponseRange?(baseId?: number, mask?: number): Promise<void>;
  setAddressingMode?(mode: "physical" | "functional"): Promise<void>;
  setIsoTpConfig?(config: {
    block_size?: number;
    st_min?: number;
    wft_max?: number;
    pad_value?: number;
    params?: Array<{ parameter: number; value: number }>;
  }): Promise<void>;
  startHeartbeat?(intervalMs?: number, suppressPositiveResponse?: boolean): Promise<void>;
  stopHeartbeat?(): Promise<void>;
  getDeviceInfo?(): Promise<{ api_version: string; dll_version: string; fw_version: string }>;
  getLastError?(): Promise<string>;
  getIsoTpConfig?(): Promise<{
    block_size: number;
    st_min: number;
    wft_max: number;
    pad_value: number;
  }>;
}
