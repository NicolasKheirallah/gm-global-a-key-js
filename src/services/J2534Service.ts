import { invoke } from "@tauri-apps/api/core";
import { type HardwareService } from "./HardwareService";
import type { ConnectionState, SerialEventHandlers } from "./SerialService";

interface J2534Message {
  protocol_id: number;
  rx_status: number;
  tx_flags: number;
  timestamp: number;
  data_size: number;
  extra_data_index: number;
  data: number[];
}

export class J2534Service implements HardwareService {
  private _state: ConnectionState = "disconnected";
  private handlers: SerialEventHandlers = {};
  private dllPath: string = "op20pt32.dll"; // Default

  // State for communication
  private currentHeader: number = 0x7e0; // Default ECM
  private baudRate: number = 500000;
  private flags: number = 0;

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
        dllPath: this.dllPath,
        baud: this.baudRate,
        flags: this.flags,
      });

      // Setup filters for standard diagnostic response
      // Filter Flow Control / ISO-TP if needed
      // For now, let's just assert connected

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
    // In a robust implementation, we might update PassThru filters here
    // to listen for the response ID (usually headerId + 8).

    // e.g. if Header=7E0, Expect=7E8
    // await invoke("start_filter", { maskId: 0x7FF, patternId: headerId + 8 });
  }

  async send(command: string, timeout: number = 2000): Promise<string> {
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

    // 2. Handle simple "AT" checks
    if (cmd.startsWith("AT")) {
      return "OK";
    }

    // 3. Send RAW DATA
    // Input: "10 03" or "27 01"
    const hex = cmd.replace(/\s/g, "");
    if (hex.length % 2 !== 0) throw new Error("Invalid hex string");

    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substring(i, i + 2), 16));
    }

    // Use currentHeader
    await invoke("send_can", { id: this.currentHeader, data: bytes });

    // Poll for response (Temporary until Phase 2 Complete)
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      try {
        const msgs = await invoke<J2534Message[]>("read_messages");
        if (msgs && msgs.length > 0) {
          // Find matching response?
          // For now, return first/all
          const msg = msgs[0];
          // We should convert back to hex string
          const respHex = msg.data
            .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
            .join(" ");

          // If expecting ID check:
          // const rxId = (msg.data[0] << 24) | ...
          // But our J2534 logic puts ID in first 4 bytes of data vector for now
          // We need to strip ID from response to match ELM327 behavior?
          // ELM327 usually returns "7E8 03 41 00 ..." if headers on.
          // Let's just return raw data for now.

          return respHex;
        }
      } catch (e) {
        console.error(e);
      }
      // Wait 10ms
      await new Promise((r) => setTimeout(r, 10));
    }

    throw new Error("Timeout waiting for response");
  }

  async executeSeedRequest(
    header: string = "7E0"
  ): Promise<{ seed: string; log: string }> {
    const logEntries: string[] = [];

    // Set Header dynamically
    await this.send(`ATSH ${header}`);
    logEntries.push(`Configured Header: ${header}`);

    // Mode 1: Diagnostic Session (optional but good practice)
    // 10 03 (Extended) or 10 01 (Default)
    // Some modules require 10 03 before Seed Request
    try {
      const resp1 = await this.send("10 03");
      logEntries.push(`TX: 10 03 -> RX: ${resp1}`);
    } catch (e) {
      logEntries.push(`TX: 10 03 -> Error/Timeout (skipping)`);
    }

    // Mode 27: Request Seed
    // 27 01
    const seedResp = await this.send("27 01");
    logEntries.push(`TX: 27 01 -> RX: ${seedResp}`);

    return { seed: seedResp, log: logEntries.join("\n") };
  }

  async sendKey(key: string): Promise<string> {
    const cmd = `27 02 ${key.substring(0, 2)} ${key.substring(2, 4)}`;
    const resp = await this.send(cmd);
    return `TX: ${cmd} -> RX: ${resp}`;
  }

  async sendKey5Byte(key: string): Promise<string> {
    const bytes = [];
    for (let i = 0; i < 10; i += 2) bytes.push(key.substring(i, i + 2));
    const cmd = `27 02 ${bytes.join(" ")}`;
    const resp = await this.send(cmd);
    return `TX: ${cmd} -> RX: ${resp}`;
  }
}
