import { invoke } from "@tauri-apps/api/core";
import { type HardwareService } from "./HardwareService";
import type { ConnectionState, SerialEventHandlers } from "./SerialService";

interface RxMessage {
  id: number;
  data: number[];
  timestamp: number;
  rx_status: number;
  protocol_id: number;
}

interface ScanResult {
  id: number;
  response: number[];
  protocol: string;
}

export class J2534Service implements HardwareService {
  private _state: ConnectionState = "disconnected";
  private handlers: SerialEventHandlers = {};
  private dllPath: string = "op20pt32.dll"; // Default

  // State for communication
  private currentHeader: number = 0x7e0; // Default ECM
  private requestHeader: number = 0x7e0;
  private addressingMode: "physical" | "functional" = "physical";
  private functionalHeader: number = 0x7df;
  private baudRate: number = 500000;
  private flags: number = 0;
  private transportMode: "can" | "isotp" = "isotp";
  private responseFilters: Array<{ mask: number; pattern: number }> = [];
  private responseIds: number[] | null = null;
  private filtersKey: string = "";

  constructor() {}

  get state(): ConnectionState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === "connected";
  }

  setDllPath(path: string): void {
    this.dllPath = path;
  }

  async listDevices(): Promise<
    Array<{ name: string; vendor: string; dll_path: string }>
  > {
    try {
      return await invoke("list_j2534_devices");
    } catch (e) {
      console.error("Failed to list J2534 devices", e);
      return [];
    }
  }

  setHandlers(handlers: SerialEventHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    this.handlers.onStateChange?.(state);
  }

  async connect(baud: number = 500000): Promise<void> {
    if (this._state === "connected") return;

    this.setState("connecting");
    this.baudRate = baud;

    try {
      // Connect with dynamic baud rate
      await invoke("connect_j2534", {
        dll_path: this.dllPath,
        baud: this.baudRate,
        flags: this.flags,
      });

      await this.setHeader(this.currentHeader);
      await this.setIsoTpConfig({ block_size: 0, st_min: 0, wft_max: 0 });

      this.setState("connected");
      this.handlers.onConnect?.();
    } catch (e) {
      this.setState("error");
      const err = new Error(String(e));
      this.handlers.onError?.(err);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await invoke("disconnect_j2534");
    } catch (e) {
      console.error(e);
    }
    this.setState("disconnected");
    this.handlers.onDisconnect?.();
  }

  /**
   * Set the Target ECU Header (e.g., 0x7E0 for ECM, 0x241 for BCM)
   * This is critical for communicating with different modules.
   */
  async setHeader(headerId: number): Promise<void> {
    this.currentHeader = headerId;
    if (headerId === this.functionalHeader) {
      this.addressingMode = "functional";
      this.requestHeader = this.functionalHeader;
      await this.setFunctionalResponseRange(0x7e8, 0x7f0);
      return;
    }
    const isExtended = headerId > 0x7ff;
    const mask = isExtended ? 0x1fffffff : 0x7ff;
    const responseId = (headerId + 8) & mask;
    if (this.addressingMode === "physical") {
      this.requestHeader = headerId;
      this.responseFilters = [{ mask, pattern: responseId }];
      this.responseIds = [responseId];
      await this.applyFilters();
    }
  }

  async setAddressingMode(mode: "physical" | "functional"): Promise<void> {
    this.addressingMode = mode;
    if (mode === "functional") {
      this.requestHeader = this.functionalHeader;
      await this.setFunctionalResponseRange(0x7e8, 0x7f0);
    } else {
      await this.setHeader(this.currentHeader);
    }
  }

  async send(command: string, timeout: number = 2000): Promise<string> {
    const result = await this.sendInternal(command, timeout, false);
    return result as string;
  }

  async sendAndCollect(
    command: string,
    timeout: number = 2000
  ): Promise<string[]> {
    const result = await this.sendInternal(command, timeout, true);
    return result as string[];
  }

  private async sendInternal(
    command: string,
    timeout: number,
    collectAll: boolean
  ): Promise<string | string[]> {
    // Parser for ELM327-like commands
    const cmd = command.trim().toUpperCase();

    // 1. Handle ATSH (Set Header)
    if (cmd.startsWith("ATSH")) {
      const headerHex = cmd.substring(4).trim();
      const headerId = parseInt(headerHex, 16);
      if (!isNaN(headerId)) {
        await this.setHeader(headerId);
        return "OK";
      }
      return "?";
    }

    // 2. Handle transport mode switching
    if (cmd.startsWith("ATTP")) {
      const mode = cmd.substring(4).trim();
      if (mode === "CAN") {
        this.transportMode = "can";
        return collectAll ? ["OK"] : "OK";
      }
      if (mode === "ISO") {
        this.transportMode = "isotp";
        return collectAll ? ["OK"] : "OK";
      }
      return collectAll ? ["?"] : "?";
    }

    // 3. Handle response filter configuration
    if (cmd.startsWith("ATCRA")) {
      const idHex = cmd.substring(5).trim();
      const id = parseInt(idHex, 16);
      if (!Number.isNaN(id)) {
        const mask = id > 0x7ff ? 0x1fffffff : 0x7ff;
        await this.setResponseFilters([{ mask, pattern: id }], [id]);
        return collectAll ? ["OK"] : "OK";
      }
      return collectAll ? ["?"] : "?";
    }

    // 4. Handle simple "AT" checks
    if (cmd.startsWith("AT")) {
      return collectAll ? ["OK"] : "OK";
    }

    // 5. Send RAW DATA
    // Input: "10 03" or "27 01"
    const hex = cmd.replace(/\s/g, "");
    if (hex.length % 2 !== 0) throw new Error("Invalid hex string");

    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substring(i, i + 2), 16));
    }

    const protocol = await this.transmit(bytes);
    const msgs = await this.pollResponses(protocol, timeout, collectAll);

    const responses = msgs.map((msg) =>
      msg.data.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")
    );

    if (responses.length === 0) {
      throw new Error("Timeout waiting for response");
    }

    return collectAll ? responses : responses[0];
  }

  async executeSeedRequest(
    header: string = "7E0"
  ): Promise<{ seed: string; log: string }> {
    const logEntries: string[] = [];

    const headerId = parseInt(header, 16);
    if (!Number.isNaN(headerId)) {
      await this.setHeader(headerId);
    }

    if (this.addressingMode === "functional") {
      this.requestHeader = this.functionalHeader;
    }

    const targetHeader =
      this.addressingMode === "functional" ? "7DF" : header;
    logEntries.push(`Configured Header: ${targetHeader}`);

    // Mode 1: Diagnostic Session (optional but good practice)
    // 10 03 (Extended) or 10 01 (Default)
    // Some modules require 10 03 before Seed Request
    try {
      const resp1 = await this.withTemporaryRequestHeader(
        this.currentHeader,
        () => this.send("10 03")
      );
      logEntries.push(`TX: 10 03 -> RX: ${resp1}`);
    } catch {
      logEntries.push(`TX: 10 03 -> Error/Timeout (skipping)`);
    }

    // Mode 27: Request Seed
    // 27 01
    const seedResp = await this.withTemporaryRequestHeader(
      this.currentHeader,
      () => this.send("27 01")
    );
    logEntries.push(`TX: 27 01 -> RX: ${seedResp}`);

    return { seed: seedResp, log: logEntries.join("\n") };
  }

  async sendKey(key: string): Promise<string> {
    const cmd = `27 02 ${key.substring(0, 2)} ${key.substring(2, 4)}`;
    const resp = await this.withTemporaryRequestHeader(
      this.currentHeader,
      () => this.send(cmd)
    );
    return `TX: ${cmd} -> RX: ${resp}`;
  }

  async sendKey5Byte(key: string): Promise<string> {
    const bytes = [];
    for (let i = 0; i < 10; i += 2) bytes.push(key.substring(i, i + 2));
    const cmd = `27 02 ${bytes.join(" ")}`;
    const resp = await this.withTemporaryRequestHeader(
      this.currentHeader,
      () => this.send(cmd)
    );
    return `TX: ${cmd} -> RX: ${resp}`;
  }

  async setResponseFilters(
    filters: Array<{ mask: number; pattern: number }>,
    responseIds?: number[]
  ): Promise<void> {
    this.responseFilters = filters;
    if (responseIds) {
      this.responseIds = responseIds;
    } else {
      const exact = filters.every(
        (f) => f.mask === 0x7ff || f.mask === 0x1fffffff
      );
      this.responseIds = exact ? filters.map((f) => f.pattern) : null;
    }
    await this.applyFilters();
  }

  async setFunctionalResponseRange(
    baseId: number = 0x7e8,
    mask: number = 0x7f0
  ): Promise<void> {
    this.responseIds = null;
    this.responseFilters = [{ mask, pattern: baseId }];
    await this.applyFilters();
  }

  async setIsoTpConfig(config: {
    block_size?: number;
    st_min?: number;
    wft_max?: number;
    pad_value?: number;
    params?: Array<{ parameter: number; value: number }>;
  }): Promise<void> {
    try {
      await invoke("set_isotp_config", config);
    } catch (e) {
      console.warn("Failed to set ISO-TP config", e);
    }
  }

  async startHeartbeat(
    intervalMs: number = 2000,
    suppressPositiveResponse: boolean = true
  ): Promise<void> {
    const data = suppressPositiveResponse ? [0x3e, 0x80] : [0x3e, 0x00];
    await invoke("start_heartbeat", {
      protocol: "iso15765",
      id: this.currentHeader,
      data,
      interval_ms: intervalMs,
    });
  }

  async stopHeartbeat(): Promise<void> {
    await invoke("stop_heartbeat");
  }

  async getDeviceInfo(): Promise<{
    api_version: string;
    dll_version: string;
    fw_version: string;
  }> {
    return await invoke("read_j2534_version");
  }

  async getLastError(): Promise<string> {
    return await invoke("get_j2534_last_error");
  }

  async getIsoTpConfig(): Promise<{
    block_size: number;
    st_min: number;
    wft_max: number;
    pad_value: number;
  }> {
    return await invoke("get_isotp_config");
  }

  async scanNetwork(
    moduleIds: number[],
    protocols: Array<"can" | "iso15765"> = ["can", "iso15765"],
    retries: number = 1
  ): Promise<Array<{ id: number; response: string }>> {
    const results = await invoke<ScanResult[]>("scan_modules", {
      module_ids: moduleIds,
      request: [0x3e, 0x00],
      timeout_ms: 300,
      response_offset: 8,
      protocols,
      retries,
    });

    return results.map((r) => ({
      id: r.id,
      response: `${r.protocol.toUpperCase()}: ${r.response
        .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
        .join(" ")}`,
    }));
  }

  async sendAndCollectById(
    command: string,
    timeout: number = 2000
  ): Promise<
    Record<
      string,
      { id: number; responses: string[]; timestamps: number[] }
    >
  > {
    const cmd = command.trim().toUpperCase();
    if (cmd.startsWith("AT")) {
      return {};
    }

    const hex = cmd.replace(/\s/g, "");
    if (hex.length % 2 !== 0) throw new Error("Invalid hex string");

    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substring(i, i + 2), 16));
    }

    const protocol = await this.transmit(bytes);
    const msgs = await this.pollResponses(protocol, timeout, true);

    const grouped: Record<
      string,
      { id: number; responses: string[]; timestamps: number[] }
    > = {};

    for (const msg of msgs) {
      const key = msg.id.toString(16).toUpperCase();
      if (!grouped[key]) {
        grouped[key] = { id: msg.id, responses: [], timestamps: [] };
      }
      grouped[key].responses.push(
        msg.data.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")
      );
      grouped[key].timestamps.push(msg.timestamp);
    }

    return grouped;
  }

  private async transmit(bytes: number[]): Promise<"can" | "iso15765"> {
    const useIsoTp = this.transportMode === "isotp";
    const protocol = useIsoTp ? "iso15765" : "can";
    const txId =
      this.addressingMode === "functional" && bytes[0] === 0x27
        ? this.currentHeader
        : this.requestHeader;

    if (useIsoTp) {
      await invoke("send_isotp", { id: txId, data: bytes });
    } else {
      await invoke("send_can", { id: txId, data: bytes });
    }

    return protocol;
  }

  private async pollResponses(
    protocol: "can" | "iso15765",
    timeout: number,
    collectAll: boolean
  ): Promise<RxMessage[]> {
    const startTime = Date.now();
    const responses: RxMessage[] = [];

    while (Date.now() - startTime < timeout) {
      try {
        const msgs = await invoke<RxMessage[]>("read_messages", {
          protocol,
          max_msgs: 5,
          timeout_ms: 100,
        });
        if (msgs && msgs.length > 0) {
          const filtered = this.responseIds
            ? msgs.filter((m) => this.responseIds?.includes(m.id))
            : msgs;

          for (const msg of filtered) {
            responses.push(msg);
            if (!collectAll) {
              return responses;
            }
          }
        }
      } catch (e) {
        console.error(e);
      }
      await new Promise((r) => setTimeout(r, 10));
    }

    return responses;
  }

  private async applyFilters(): Promise<void> {
    const key = JSON.stringify(this.responseFilters);
    if (key === this.filtersKey) return;
    this.filtersKey = key;

    if (this.responseFilters.length === 0) return;

    try {
      await invoke("set_rx_filters", {
        protocol: "can",
        filters: this.responseFilters.map((f) => ({
          mask_id: f.mask,
          pattern_id: f.pattern,
        })),
      });
      await invoke("set_rx_filters", {
        protocol: "iso15765",
        filters: this.responseFilters.map((f) => ({
          mask_id: f.mask,
          pattern_id: f.pattern,
        })),
      });
    } catch (e) {
      console.warn("Failed to set J2534 filters", e);
    }
  }

  private async withTemporaryRequestHeader<T>(
    header: number,
    fn: () => Promise<T>
  ): Promise<T> {
    const previous = this.requestHeader;
    this.requestHeader = header;
    try {
      return await fn();
    } finally {
      this.requestHeader = previous;
    }
  }
}
