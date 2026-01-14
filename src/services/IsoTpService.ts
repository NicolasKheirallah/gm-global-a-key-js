import { SerialService } from "./SerialService";

/**
 * ISO-TP (ISO 15765-2) Frame Types
 */
export enum IsoTpFrameType {
  SingleFrame = 0x00,
  FirstFrame = 0x10,
  ConsecutiveFrame = 0x20,
  FlowControl = 0x30,
}

/**
 * ISO-TP Protocol Configuration
 */
export interface IsoTpConfig {
  /** Block Size (0 = unlimited) */
  blockSize: number;
  /** Separation Time (ms) */
  stMin: number;
  /** Default timeout for multi-frame operations (ms) */
  timeout: number;
  /** Padding byte (usually 0x00 or 0xAA) */
  paddingByte: number;
}

/**
 * ISO-TP Transport Layer Service
 * Handles segmentation and reassembly of CAN messages
 */
export class IsoTpService {
  private serial: SerialService;
  private config: IsoTpConfig;

  constructor(serial: SerialService, config: Partial<IsoTpConfig> = {}) {
    this.serial = serial;
    this.config = {
      blockSize: config.blockSize ?? 0,
      stMin: config.stMin ?? 0,
      timeout: config.timeout ?? 1000,
      paddingByte: config.paddingByte ?? 0x00,
    };
  }

  /**
   * Send data via ISO-TP
   * Automatically handles Single Frame vs Multi-Frame
   */
  async send(data: Uint8Array): Promise<void> {
    if (data.length <= 7) {
      return this.sendSingleFrame(data);
    } else {
      return this.sendMultiFrame(data);
    }
  }

  /**
   * Send a Single Frame (SF)
   */
  private async sendSingleFrame(data: Uint8Array): Promise<void> {
    const frame = new Uint8Array(8).fill(this.config.paddingByte);
    frame[0] = IsoTpFrameType.SingleFrame | data.length;
    frame.set(data, 1);
    await this.sendFrame(frame);
  }

  /**
   * Send a Multi-Frame (MF) message
   */
  private async sendMultiFrame(data: Uint8Array): Promise<void> {
    const totalLength = data.length;
    let offset = 0;
    let sequenceNumber = 1;

    // 1. Send First Frame (FF)
    const ff = new Uint8Array(8).fill(this.config.paddingByte);
    ff[0] = IsoTpFrameType.FirstFrame | ((totalLength >> 8) & 0x0f);
    ff[1] = totalLength & 0xff;
    ff.set(data.slice(0, 6), 2);
    offset += 6;

    console.log("[IsoTp] Sending First Frame (FF)");
    await this.sendFrame(ff);

    // 2. Wait for Flow Control (FC)
    // We expect an FC frame: 30 BS STmin ...
    const fc = await this.waitForFlowControl();

    // Parse FC parameters
    // BS: Block Size (max number of CFs before next FC)
    // STmin: Separation Time (min time between CFs)
    const blockSize = fc.blockSize;
    const stMin = this.decodeStMin(fc.stMin);

    console.log(`[IsoTp] FC Received: BS=${blockSize}, STmin=${stMin}ms`);

    // 3. Send Consecutive Frames (CF)
    let blocksSent = 0;

    while (offset < totalLength) {
      // Check if we need to wait for another FC (if BS > 0 and BS limit reached)
      if (blockSize > 0 && blocksSent === blockSize) {
        console.log("[IsoTp] Block limit reached, waiting for FC...");
        await this.waitForFlowControl();
        blocksSent = 0;
      }

      const chunk = data.slice(offset, offset + 7);
      const cf = new Uint8Array(8).fill(this.config.paddingByte);
      cf[0] = IsoTpFrameType.ConsecutiveFrame | (sequenceNumber & 0x0f);
      cf.set(chunk, 1);

      await this.sendFrame(cf);
      blocksSent++;

      offset += 7;
      sequenceNumber = (sequenceNumber + 1) & 0x0f;

      if (stMin > 0) {
        await new Promise((r) => setTimeout(r, stMin));
      }
    }
  }

  /**
   * Wait for Flow Control frame (0x30)
   * This is tricky with ELM327 in raw mode. We assume the next received frame is FC.
   * In a real app, strict filtering is needed.
   */
  private async waitForFlowControl(): Promise<{
    blockSize: number;
    stMin: number;
  }> {
    return new Promise((resolve, reject) => {
      let resolved = false;

      const cleanup = () => {
        resolved = true;
        clearTimeout(timeout);
        this.serial.removeRawListener(handler);
      };

      const timeout = setTimeout(() => {
        if (!resolved) {
          cleanup();
          reject(new Error("Timeout waiting for Flow Control"));
        }
      }, this.config.timeout);

      const handler = (data: string) => {
        // Look for FC frame: "30 BS ST"
        const clean = data.replace(/\s+/g, "");

        // Simple heuristic: matches "30" followed by 4 hex chars
        const match = clean.match(
          /(?:^|[^0-9A-F])30([0-9A-F]{2})([0-9A-F]{2})/i
        );

        if (match) {
          cleanup();
          resolve({
            blockSize: parseInt(match[1], 16),
            stMin: parseInt(match[2], 16),
          });
        }
      };

      this.serial.addRawListener(handler);
    });
  }

  /**
   * Decode ISO-TP STmin parameter
   * 0x00-0x7F: 0-127ms
   * 0xF1-0xF9: 100-900us
   */
  private decodeStMin(val: number): number {
    if (val <= 0x7f) {
      return val;
    } else if (val >= 0xf1 && val <= 0xf9) {
      // 0xF1 is 100us -> 0.1ms; JS timers are ms resolution, round up to 1ms.
      return 1;
    }
    return 0; // Reserved/standard fallback
  }

  /**
   * Helper to send raw frame via SerialService
   */
  private async sendFrame(frame: Uint8Array): Promise<void> {
    const hex = Array.from(frame)
      .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
      .join("");
    // ELM327 send (assuming AT SH header is set)
    await this.serial.send(hex);
  }

  /**
   * Receive ISO-TP message (reassembly)
   * This would require intercepting all `onData` from SerialService,
   * likely needing a refactor of SerialService to allow "protocol drivers".
   */
  // Placeholder for future RX reassembly
}
