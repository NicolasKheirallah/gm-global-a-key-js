import { UDSMessage, UDSNegativeResponseError, UDS_SID } from "../core/uds";

// Type alias for the Web Serial API SerialPort
type WebSerialPort = Awaited<ReturnType<typeof navigator.serial.requestPort>>;

/**
 * Serial port connection state
 */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/**
 * ELM327 error types
 */
export type ELMError =
  | "NO_DATA"
  | "CAN_ERROR"
  | "BUFFER_FULL"
  | "BUS_BUSY"
  | "BUS_ERROR"
  | "UNKNOWN_COMMAND"
  | "STOPPED";

/**
 * ELM327 response result
 */
export interface ELMResponse {
  success: boolean;
  data?: string;
  error?: ELMError;
  rawResponse: string;
}

/**
 * Serial command with metadata
 */
interface QueuedCommand {
  command: string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  timeout: number;
  timestamp: number;
}

/**
 * Serial service configuration
 */
export interface SerialConfig {
  /** Baud rate (default: 115200) */
  baudRate?: number;
  /** Command timeout in ms (default: 5000) */
  defaultTimeout?: number;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Delay between retries in ms (default: 500) */
  retryDelay?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Event callbacks for serial service
 */
export interface SerialEventHandlers {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onData?: (data: string) => void;
  onStateChange?: (state: ConnectionState) => void;
}

import type { HardwareService } from "./HardwareService";

/**
 * Robust Serial Service with command queue, timeouts, and reconnection
 */
export class SerialService implements HardwareService {
  private port: WebSerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private writer: WritableStreamDefaultWriter<string> | null = null;
  private buffer = "";
  private commandQueue: QueuedCommand[] = [];
  private isProcessing = false;
  private _state: ConnectionState = "disconnected";
  private config: Required<SerialConfig>;
  private handlers: SerialEventHandlers = {};
  private rawListeners: Set<(data: string) => void> = new Set();
  private readLoopActive = false;
  private reconnectAttempts = 0;
  private currentTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastSeed: Uint8Array | null = null;
  private lastSeedTime = 0;
  private lastSecurityLevel = 0x01;
  private static readonly SEED_TIMEOUT_MS = 10000;

  constructor(config: SerialConfig = {}) {
    this.config = {
      baudRate: config.baudRate ?? 115200,
      defaultTimeout: config.defaultTimeout ?? 5000,
      maxRetries: config.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? 500,
      debug: config.debug ?? false,
    };
  }

  /**
   * Add a listener for raw RX data
   */
  addRawListener(callback: (data: string) => void): void {
    this.rawListeners.add(callback);
  }

  /**
   * Remove a listener for raw RX data
   */
  removeRawListener(callback: (data: string) => void): void {
    this.rawListeners.delete(callback);
  }

  /**
   * Current connection state
   */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Whether the port is connected
   */
  get isConnected(): boolean {
    return this._state === "connected";
  }

  /**
   * Set event handlers
   */
  setHandlers(handlers: SerialEventHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /**
   * Update connection state and notify handlers
   */
  private setState(state: ConnectionState): void {
    const prevState = this._state;
    this._state = state;
    if (prevState !== state) {
      this.handlers.onStateChange?.(state);
      this.log(`State changed: ${prevState} -> ${state}`);
    }
  }

  /**
   * Debug logging
   */
  private log(message: string, data?: unknown): void {
    if (this.config.debug) {
      console.log(`[SerialService] ${message}`, data ?? "");
    }
  }

  /**
   * Connect to a serial port
   */
  async connect(): Promise<void> {
    if (this._state === "connected") {
      this.log("Already connected");
      return;
    }

    this.setState("connecting");

    try {
      // Check for Web Serial API support
      if (!("serial" in navigator)) {
        throw new Error(
          "Web Serial API not supported. Use Chrome/Edge on Desktop."
        );
      }

      this.port = await navigator.serial.requestPort({
        filters: [
          { usbVendorId: 0x0403 }, // FTDI
          { usbVendorId: 0x10c4 }, // Silicon Labs
          { usbVendorId: 0x1a86 }, // CH340
          { usbVendorId: 0x067b }, // Prolific
          { usbVendorId: 0x2341 }, // Arduino
          { usbVendorId: 0x0557 }, // ATEN
          { usbVendorId: 0x1d6b }, // Linux Foundation
          { usbVendorId: 0x04d8 }, // Microchip (many OBD adapters)
        ],
      });

      if (!this.port) {
        throw new Error("No port selected");
      }

      await this.port.open({ baudRate: this.config.baudRate });

      // Setup streams
      const textDecoder = new TextDecoderStream();
      this.port.readable!
        .pipeTo(textDecoder.writable as WritableStream<Uint8Array>)
        .catch((e) => {
        this.log("Readable pipe error", e);
      });
      this.reader = textDecoder.readable.getReader();

      const textEncoder = new TextEncoderStream();
      textEncoder.readable.pipeTo(this.port.writable!).catch((e) => {
        this.log("Writable pipe error", e);
      });
      this.writer = textEncoder.writable.getWriter();

      this.setState("connected");
      this.reconnectAttempts = 0;
      this.handlers.onConnect?.();

      // Start read loop
      this.startReadLoop();
    } catch (e) {
      this.setState("error");
      const error = e instanceof Error ? e : new Error(String(e));
      this.handlers.onError?.(error);
      throw error;
    }
  }

  /**
   * Disconnect from the serial port
   */
  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this.readLoopActive = false;

    // Clear pending commands
    this.commandQueue.forEach((cmd) => {
      cmd.reject(new Error("Disconnected"));
    });
    this.commandQueue = [];

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        /* ignore */
      }
      this.reader = null;
    }

    if (this.writer) {
      try {
        await this.writer.close();
      } catch {
        /* ignore */
      }
      this.writer = null;
    }

    if (this.port) {
      try {
        await this.port.close();
      } catch {
        /* ignore */
      }
      this.port = null;
    }

    this.buffer = "";
    this.setState("disconnected");
    this.handlers.onDisconnect?.();
  }

  /**
   * Attempt to reconnect
   */
  private async attemptReconnect(): Promise<boolean> {
    if (this.reconnectAttempts >= this.config.maxRetries) {
      this.log("Max reconnection attempts reached");
      return false;
    }

    this.reconnectAttempts++;
    this.log(`Reconnection attempt ${this.reconnectAttempts}`);

    await this.delay(this.config.retryDelay);

    try {
      if (this.port) {
        await this.port.open({ baudRate: this.config.baudRate });

        const textDecoder = new TextDecoderStream();
        this.port.readable!.pipeTo(
          textDecoder.writable as WritableStream<Uint8Array>
        );
        this.reader = textDecoder.readable.getReader();

        const textEncoder = new TextEncoderStream();
        textEncoder.readable.pipeTo(this.port.writable!);
        this.writer = textEncoder.writable.getWriter();

        this.setState("connected");
        this.startReadLoop();
        return true;
      }
    } catch (e) {
      this.log("Reconnection failed", e);
    }

    return false;
  }

  /**
   * Continuous read loop with error handling
   */
  private async startReadLoop(): Promise<void> {
    if (this.readLoopActive) return;
    this.readLoopActive = true;

    while (this.readLoopActive && this.reader && this._state === "connected") {
      try {
        const { value, done } = await this.reader.read();

        if (done) {
          this.log("Reader done");
          break;
        }

        if (value) {
          this.buffer += value;
          this.handlers.onData?.(value);
          this.rawListeners.forEach((l) => l(value));

          // Check for ELM327 prompt
          if (this.buffer.includes(">")) {
            this.processBuffer();
          }
        }
      } catch (e) {
        this.log("Read error", e);

        if (this._state === "connected") {
          this.setState("error");

          const reconnected = await this.attemptReconnect();
          if (!reconnected) {
            await this.disconnect();
            this.handlers.onError?.(
              e instanceof Error ? e : new Error(String(e))
            );
            break;
          }
        }
      }
    }

    this.readLoopActive = false;
  }

  /**
   * Parse ELM327 response for errors
   */
  private parseELMResponse(rawResponse: string): ELMResponse {
    const response = rawResponse.trim();

    if (response.includes("NO DATA")) {
      return { success: false, error: "NO_DATA", rawResponse };
    }
    if (response.includes("CAN ERROR") || response.includes("FB ERROR")) {
      return { success: false, error: "CAN_ERROR", rawResponse };
    }
    if (response.includes("BUFFER FULL")) {
      return { success: false, error: "BUFFER_FULL", rawResponse };
    }
    if (response.includes("BUS BUSY")) {
      return { success: false, error: "BUS_BUSY", rawResponse };
    }
    if (response.includes("BUS ERROR") || response.includes("LP ALERT")) {
      return { success: false, error: "BUS_ERROR", rawResponse };
    }
    if (response === "?" || response.includes("?")) {
      return { success: false, error: "UNKNOWN_COMMAND", rawResponse };
    }
    if (response.includes("STOPPED")) {
      return { success: false, error: "STOPPED", rawResponse };
    }

    return { success: true, data: response, rawResponse };
  }

  /**
   * Extract UDS frames from ELM327 response text
   */
  private extractUdsFrames(raw: string): Uint8Array[] {
    const frames: Uint8Array[] = [];
    const lines = raw
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      if (/^(SEARCHING|OK|ELM|ATI|ATZ|BUS INIT)/i.test(line)) continue;
      const hex = line.replace(/[^0-9A-Fa-f]/g, "");
      if (hex.length < 2 || hex.length % 2 !== 0) continue;
      try {
        frames.push(UDSMessage.parseHex(hex));
      } catch {
        continue;
      }
    }

    return frames;
  }

  /**
   * Pick the best UDS response frame (skip NRC 0x78)
   */
  private selectUdsFrame(
    frames: Uint8Array[],
    expectedSid?: number
  ): Uint8Array {
    let pending = false;

    for (const frame of frames) {
      if (UDSMessage.isResponsePending(frame, expectedSid)) {
        pending = true;
        continue;
      }

      if (frame[0] === 0x7f) {
        if (frame.length >= 3) {
          throw new UDSNegativeResponseError(frame[1], frame[2], frame);
        }
        throw new Error("Malformed negative response");
      }

      if (expectedSid === undefined || frame[0] === expectedSid + 0x40) {
        return frame;
      }
    }

    if (pending) {
      throw new Error("Response pending (0x78) - no final response received");
    }

    throw new Error("No valid UDS response received");
  }

  /**
   * Send a UDS request and return parsed response frame
   */
  private async sendUdsRequest(
    request: Uint8Array,
    expectedSid?: number
  ): Promise<Uint8Array> {
    const hexReq = UDSMessage.formatBytes(request).replace(/\s/g, "");
    const response = await this.sendAndParse(hexReq);

    if (!response.success || !response.data) {
      throw new Error(`UDS request failed: ${response.error}`);
    }

    const frames = this.extractUdsFrames(response.data);
    return this.selectUdsFrame(frames, expectedSid);
  }

  /**
   * Process buffer when complete response received
   */
  private processBuffer(): void {
    const response = this.buffer.replace(">", "").trim();
    this.buffer = "";

    // Clear timeout
    if (this.currentTimeoutId) {
      clearTimeout(this.currentTimeoutId);
      this.currentTimeoutId = null;
    }

    // Resolve the current command
    if (this.commandQueue.length > 0 && this.isProcessing) {
      const cmd = this.commandQueue.shift()!;
      this.isProcessing = false;
      cmd.resolve(response);
    }

    // Process next command in queue
    this.processQueue();
  }

  /**
   * Process command queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.commandQueue.length === 0) return;
    if (this._state !== "connected" || !this.writer) return;

    const cmd = this.commandQueue[0];
    this.isProcessing = true;

    try {
      this.log(`TX: ${cmd.command}`);
      await this.writer.write(cmd.command + "\r");

      // Set timeout with ID tracking
      this.currentTimeoutId = setTimeout(() => {
        if (this.isProcessing && this.commandQueue[0] === cmd) {
          this.commandQueue.shift();
          this.isProcessing = false;
          this.currentTimeoutId = null;
          cmd.reject(new Error(`Command timeout: ${cmd.command}`));
          this.processQueue();
        }
      }, cmd.timeout);
    } catch (e) {
      this.commandQueue.shift();
      this.isProcessing = false;
      cmd.reject(e instanceof Error ? e : new Error(String(e)));
      this.processQueue();
    }
  }

  /**
   * Send a command and wait for response
   * @param command - AT or OBD command
   * @param timeout - Optional timeout override
   * @returns Response string
   */
  async send(command: string, timeout?: number): Promise<string> {
    if (this._state !== "connected" || !this.writer) {
      throw new Error("Not connected");
    }

    return new Promise<string>((resolve, reject) => {
      this.commandQueue.push({
        command,
        resolve,
        reject,
        timeout: timeout ?? this.config.defaultTimeout,
        timestamp: Date.now(),
      });

      this.processQueue();
    });
  }

  /**
   * Send command with automatic retry on failure
   */
  async sendWithRetry(
    command: string,
    retries: number = this.config.maxRetries
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let i = 0; i <= retries; i++) {
      try {
        return await this.send(command);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        this.log(`Command failed, retry ${i + 1}/${retries}`, e);

        if (i < retries) {
          await this.delay(this.config.retryDelay);
        }
      }
    }

    throw lastError ?? new Error("Command failed after retries");
  }

  /**
   * Execute full seed request flow for GMLAN
   * @param header - ECU CAN ID header (e.g., "7E0")
   * @returns Seed response and log
   */
  async executeSeedRequest(
    header = "7E0",
    level: number = 0x01
  ): Promise<{ seed: string; log: string; seedBytes?: Uint8Array }> {
    const logEntries: string[] = [];

    const sendLog = async (cmd: string): Promise<string> => {
      const response = await this.send(cmd);
      logEntries.push(`TX: ${cmd} -> RX: ${response}`);
      return response;
    };

    // Initialize ELM327
    await sendLog("ATZ"); // Reset
    await this.delay(500); // Wait for reset
    await sendLog("ATE0"); // Echo off
    await sendLog("ATL0"); // Linefeeds off
    await sendLog("ATS0"); // Spaces off (optional)
    await sendLog("ATSP0"); // Auto protocol

    // Set CAN header
    await sendLog(`ATSH ${header}`);

    // Enter diagnostic session
    await sendLog("10 03"); // Extended diagnostic session

    // Request seed
    const normalizedLevel = UDSMessage.normalizeSeedLevel(level);
    const seedReq = UDSMessage.buildSeedRequest(normalizedLevel);
    const seedReqHex = UDSMessage.formatBytes(seedReq);
    const seedFrame = await this.sendUdsRequest(
      seedReq,
      UDS_SID.SECURITY_ACCESS
    );
    const seedResp = UDSMessage.formatBytes(seedFrame);
    logEntries.push(`TX: ${seedReqHex} -> RX: ${seedResp}`);

    const seedBytes = UDSMessage.parseSecuritySeedResponse(
      seedFrame,
      normalizedLevel
    );
    this.lastSecurityLevel = normalizedLevel;
    this.lastSeedTime = Date.now();
    this.lastSeed = seedBytes;

    return { seed: seedResp, log: logEntries.join("\n"), seedBytes };
  }

  /**
   * Send security access key
   * @param key - 2-byte key as hex string (e.g., "A21A")
   * @returns Response
   */
  async sendKey(key: string, level: number = 0x01): Promise<string> {
    const seedLevel = this.validateKeyRequest(level);
    if (key.length !== 4) {
      throw new Error("Key must be 4 hex characters (2 bytes)");
    }

    const keyBytes = UDSMessage.parseHex(key);
    const req = UDSMessage.buildKeyRequest(seedLevel, keyBytes);
    const reqHex = UDSMessage.formatBytes(req);
    const resp = await this.sendUdsRequest(req, UDS_SID.SECURITY_ACCESS);
    if (!UDSMessage.parseSecurityKeyResponse(resp, seedLevel)) {
      throw new Error("Key rejected or unexpected response");
    }
    const respHex = UDSMessage.formatBytes(resp);
    this.lastSeed = null;
    return `TX: ${reqHex} -> RX: ${respHex}`;
  }

  /**
   * Send 5-byte SA015 key
   * @param key - 5-byte key as hex string (e.g., "0F8323EB68")
   * @returns Response
   */
  async sendKey5Byte(key: string, level: number = 0x01): Promise<string> {
    const seedLevel = this.validateKeyRequest(level);
    if (key.length !== 10) {
      throw new Error("SA015 key must be 10 hex characters (5 bytes)");
    }

    const keyBytes = UDSMessage.parseHex(key);
    const req = UDSMessage.buildKeyRequest(seedLevel, keyBytes);
    const reqHex = UDSMessage.formatBytes(req);
    const resp = await this.sendUdsRequest(req, UDS_SID.SECURITY_ACCESS);
    if (!UDSMessage.parseSecurityKeyResponse(resp, seedLevel)) {
      throw new Error("Key rejected or unexpected response");
    }
    const respHex = UDSMessage.formatBytes(resp);
    this.lastSeed = null;
    return `TX: ${reqHex} -> RX: ${respHex}`;
  }

  /**
   * Clear command queue
   */
  clearQueue(): void {
    this.commandQueue.forEach((cmd) => {
      cmd.reject(new Error("Queue cleared"));
    });
    this.commandQueue = [];
    this.isProcessing = false;
  }

  /**
   * Get queue length
   */
  get queueLength(): number {
    return this.commandQueue.length;
  }

  /**
   * Send command and parse ELM327 response
   * @param command - AT or OBD command
   * @returns Parsed ELM response
   */
  async sendAndParse(command: string): Promise<ELMResponse> {
    const rawResponse = await this.send(command);
    return this.parseELMResponse(rawResponse);
  }

  /**
   * Start Tester Present heartbeat to keep session alive
   * @param intervalMs - Heartbeat interval (default: 2000ms)
   * @param _suppressPositiveResponse - Unused, for interface compatibility
   */
  async startHeartbeat(
    intervalMs: number = 2000,
    _suppressPositiveResponse?: boolean
  ): Promise<void> {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(async () => {
      if (this._state !== "connected" || !this.writer) {
        this.stopHeartbeat();
        return;
      }

      try {
        // 3E 80 = Tester Present with suppressPositiveResponse
        await this.send("3E 80", 1000);
        this.log("Heartbeat sent");
      } catch (e) {
        this.log("Heartbeat failed", e);
        // Don't stop heartbeat on single failure
      }
    }, intervalMs);

    this.log(`Heartbeat started (${intervalMs}ms interval)`);
  }

  /**
   * Stop Tester Present heartbeat
   */
  async stopHeartbeat(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      this.log("Heartbeat stopped");
    }
  }

  /**
   * Check if heartbeat is active
   */
  get isHeartbeatActive(): boolean {
    return this.heartbeatInterval !== null;
  }

  /**
   * Send UDS Seed Request
   * @param level - Security level
   * @returns Seed bytes and raw response
   */
  async requestSeed(
    level: number
  ): Promise<{ seed: Uint8Array; response: string }> {
    const normalizedLevel = UDSMessage.normalizeSeedLevel(level);
    const request = UDSMessage.buildSeedRequest(normalizedLevel);
    const resp = await this.sendUdsRequest(request, UDS_SID.SECURITY_ACCESS);
    const seed = UDSMessage.parseSecuritySeedResponse(resp, normalizedLevel);
    this.lastSecurityLevel = normalizedLevel;
    this.lastSeedTime = Date.now();
    this.lastSeed = seed;
    return { seed, response: UDSMessage.formatBytes(resp) };
  }

  private validateKeyRequest(level?: number): number {
    if (!this.lastSeed) {
      throw new Error(
        "No seed request pending - call executeSeedRequest first"
      );
    }
    if (Date.now() - this.lastSeedTime > SerialService.SEED_TIMEOUT_MS) {
      this.lastSeed = null;
      throw new Error("Seed request expired - request a new seed");
    }
    const seedLevel =
      level !== undefined
        ? UDSMessage.normalizeSeedLevel(level)
        : this.lastSecurityLevel;
    if (seedLevel !== this.lastSecurityLevel) {
      throw new Error(
        "Security level mismatch - request seed for this level first"
      );
    }
    return seedLevel;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
