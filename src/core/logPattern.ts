/**
 * Parsed log entry representing a Seed/Key exchange
 */
export interface LogEntry {
  /** Seed value as integer */
  seed: number;
  /** Key value as integer */
  key: number;
  /** Raw seed bytes */
  seedBytes: Uint8Array;
  /** Raw key bytes */
  keyBytes: Uint8Array;
  /** Security level (e.g., 0x01, 0x03, 0x05) */
  securityLevel: number;
  /** Detected protocol type */
  protocol: "GMLAN" | "SA015" | "UNKNOWN";
  /** CAN ID if detected */
  canId?: string;
  /** Module name if identified */
  moduleName?: string;
  /** Timestamp if present in log */
  timestamp?: string;
  /** Line number in source log */
  lineNumber?: number;
  /** Inferred or known algorithm ID */
  algo?: number;
}

/**
 * Parser configuration options
 */
export interface LogParserOptions {
  /** Enable strict mode - only return fully matched pairs */
  strict?: boolean;
  /** Include raw hex data in results */
  includeRaw?: boolean;
  /** Enable debug output */
  debug?: boolean;
}

/**
 * Known ECU CAN IDs and their module names
 */
export const ECU_CAN_IDS: Record<string, string> = {
  "7E0": "ECM (Engine Control Module)",
  "7E8": "ECM Response",
  "7E1": "TCM (Transmission Control Module)",
  "7E9": "TCM Response",
  "7E2": "FPCM (Fuel Pump Control Module)",
  "7EA": "FPCM Response",
  "241": "BCM (Body Control Module)",
  "641": "BCM Response",
  "244": "EBCM (Electronic Brake Control Module)",
  "644": "EBCM Response",
  "24A": "SDM (Sensing Diagnostic Module)",
  "64A": "SDM Response",
  "248": "IPC (Instrument Panel Cluster)",
  "648": "IPC Response",
  "240": "HVAC (Climate Control)",
  "640": "HVAC Response",
};

/**
 * Security level descriptions
 */
export const SECURITY_LEVELS: Record<number, string> = {
  0x01: "Standard Security Access",
  0x03: "Extended Security Access",
  0x05: "Supplier Security Access",
  0x07: "Engineering Security Access",
  0x11: "Programming Security Access",
  0x13: "End-of-Line Security Access",
  0x61: "Service Security Access",
  0x63: "Tool Security Access",
};

export class LogParser {
  /**
   * Parses text content for diagnostic Seed/Key exchanges.
   * Supports multiple formats including GMLAN (2-byte) and SA015 (5-byte).
   *
   * @param text - Raw log text content
   * @param options - Parser configuration
   * @returns Array of parsed log entries
   */
  static parse(text: string, options: LogParserOptions = {}): LogEntry[] {
    const { strict = false, debug = false } = options;
    const lines = text.split(/\r?\n/);
    const results: LogEntry[] = [];

    // State machine tracking
    let pendingSeed: {
      value: number;
      bytes: Uint8Array;
      level: number;
      canId?: string;
      timestamp?: string;
      lineNumber: number;
      protocol: "GMLAN" | "SA015" | "UNKNOWN";
    } | null = null;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const lineNumber = lineIdx + 1;

      // Extract timestamp if present
      const timestampMatch = /\[(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]/.exec(line);
      const timestamp = timestampMatch ? timestampMatch[1] : undefined;

      // Extract CAN ID if present (3-character hex)
      const canIdMatch = /\b([0-7][A-Fa-f0-9]{2})\b/.exec(line);
      const canId = canIdMatch ? canIdMatch[1].toUpperCase() : undefined;

      // Normalize line for hex pattern matching
      let hexLine = line.replace(/[^0-9A-Fa-f]/g, " ").trim();

      // Check for multi-line continuation (simple heuristic: previous line ended with typical byte, this line starts with bytes)
      // For J2534 logs, sometimes frames are split.
      // A more robust approach: Accumulate all hex content and try to find patterns in the stream,
      // but that loses line numbers.
      // For now, let's try to peek ahead if the current line looks like a partial frame. (Not easy).

      // Alternative: Just join the whole file and run regex, but we want line numbers.
      // Let's stick to single line processing for now as J2534 logs usually have one frame per line
      // or explicit headers. If we see a very short line followed by another short line, maybe merge?

      // Attempt to merge with next line if this line ends with a hex byte and next line starts with one
      if (lineIdx < lines.length - 1) {
        const nextLine = lines[lineIdx + 1];
        // If next line has no timestamp and looks like hex data...
        if (
          !/\[\d+:\d+:\d+\]/.test(nextLine) &&
          /^[0-9A-Fa-f\s]+$/.test(nextLine.trim())
        ) {
          hexLine += " " + nextLine.replace(/[^0-9A-Fa-f]/g, " ").trim();
        }
      }

      // Try to match different seed patterns

      // 1. SA015 5-byte Seed Response (67 01 XX XX XX XX XX)
      const seed5Match =
        /67\s+0([1357])\s+([0-9A-F]{2})\s+([0-9A-F]{2})\s+([0-9A-F]{2})\s+([0-9A-F]{2})\s+([0-9A-F]{2})/i.exec(
          hexLine
        );

      if (seed5Match) {
        const level = parseInt(seed5Match[1], 16);
        const bytes = new Uint8Array([
          parseInt(seed5Match[2], 16),
          parseInt(seed5Match[3], 16),
          parseInt(seed5Match[4], 16),
          parseInt(seed5Match[5], 16),
          parseInt(seed5Match[6], 16),
        ]);

        const seedValue = bytes.reduce(
          (acc, b, i) => acc + (b << ((4 - i) * 8)),
          0
        );

        pendingSeed = {
          value: seedValue,
          bytes,
          level,
          canId,
          timestamp,
          lineNumber,
          protocol: "SA015",
        };

        if (debug) {
          console.log(
            `[LogParser] Found 5-byte seed at line ${lineNumber}: ${Array.from(
              bytes
            )
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(" ")}`
          );
        }
        continue;
      }

      // 2. GMLAN 2-byte Seed Response (67 01 XX XX)
      const seed2Match =
        /67\s+0([1357])\s+([0-9A-F]{2})\s+([0-9A-F]{2})(?:\s|$)/i.exec(hexLine);

      if (seed2Match) {
        const level = parseInt(seed2Match[1], 16);
        const s1 = parseInt(seed2Match[2], 16);
        const s2 = parseInt(seed2Match[3], 16);
        const bytes = new Uint8Array([s1, s2]);

        pendingSeed = {
          value: (s1 << 8) | s2,
          bytes,
          level,
          canId,
          timestamp,
          lineNumber,
          protocol: "GMLAN",
        };

        if (debug) {
          console.log(
            `[LogParser] Found 2-byte seed at line ${lineNumber}: ${s1.toString(
              16
            )}${s2.toString(16)}`
          );
        }
        continue;
      }

      // 3. SA015 5-byte Key Send (27 02 XX XX XX XX XX)
      const key5Match =
        /27\s+0([2468])\s+([0-9A-F]{2})\s+([0-9A-F]{2})\s+([0-9A-F]{2})\s+([0-9A-F]{2})\s+([0-9A-F]{2})/i.exec(
          hexLine
        );

      if (key5Match && pendingSeed && pendingSeed.protocol === "SA015") {
        const keyLevel = parseInt(key5Match[1], 16);
        // Key level should be seed level + 1
        if (keyLevel === pendingSeed.level + 1 || !strict) {
          const keyBytes = new Uint8Array([
            parseInt(key5Match[2], 16),
            parseInt(key5Match[3], 16),
            parseInt(key5Match[4], 16),
            parseInt(key5Match[5], 16),
            parseInt(key5Match[6], 16),
          ]);

          const keyValue = keyBytes.reduce(
            (acc, b, i) => acc + (b << ((4 - i) * 8)),
            0
          );

          results.push({
            seed: pendingSeed.value,
            key: keyValue,
            seedBytes: pendingSeed.bytes,
            keyBytes,
            securityLevel: pendingSeed.level,
            protocol: "SA015",
            canId: pendingSeed.canId || canId,
            moduleName: canId ? ECU_CAN_IDS[canId] : undefined,
            timestamp: pendingSeed.timestamp,
            lineNumber: pendingSeed.lineNumber,
          });

          if (debug) {
            console.log(`[LogParser] Matched 5-byte key at line ${lineNumber}`);
          }

          pendingSeed = null;
        }
        continue;
      }

      // 4. GMLAN 2-byte Key Send (27 02 XX XX)
      const key2Match =
        /27\s+0([2468])\s+([0-9A-F]{2})\s+([0-9A-F]{2})(?:\s|$)/i.exec(hexLine);

      if (key2Match && pendingSeed && pendingSeed.protocol === "GMLAN") {
        const keyLevel = parseInt(key2Match[1], 16);
        // Key level should be seed level + 1
        if (keyLevel === pendingSeed.level + 1 || !strict) {
          const k1 = parseInt(key2Match[2], 16);
          const k2 = parseInt(key2Match[3], 16);
          const keyBytes = new Uint8Array([k1, k2]);
          const keyValue = (k1 << 8) | k2;

          results.push({
            seed: pendingSeed.value,
            key: keyValue,
            seedBytes: pendingSeed.bytes,
            keyBytes,
            securityLevel: pendingSeed.level,
            protocol: "GMLAN",
            canId: pendingSeed.canId || canId,
            moduleName: canId ? ECU_CAN_IDS[canId] : undefined,
            timestamp: pendingSeed.timestamp,
            lineNumber: pendingSeed.lineNumber,
          });

          if (debug) {
            console.log(`[LogParser] Matched 2-byte key at line ${lineNumber}`);
          }

          pendingSeed = null;
        }
        continue;
      }
    }

    return results;
  }

  /**
   * Format a seed value as hex string based on protocol
   */
  static formatSeed(entry: LogEntry): string {
    if (entry.protocol === "SA015") {
      return Array.from(entry.seedBytes)
        .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
        .join("");
    }
    return entry.seed.toString(16).toUpperCase().padStart(4, "0");
  }

  /**
   * Format a key value as hex string based on protocol
   */
  static formatKey(entry: LogEntry): string {
    if (entry.protocol === "SA015") {
      return Array.from(entry.keyBytes)
        .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
        .join("");
    }
    return entry.key.toString(16).toUpperCase().padStart(4, "0");
  }

  /**
   * Get security level description
   */
  static getSecurityLevelName(level: number): string {
    return SECURITY_LEVELS[level] || `Security Level 0x${level.toString(16)}`;
  }

  /**
   * Get module name from CAN ID
   */
  static getModuleName(canId: string): string | undefined {
    return ECU_CAN_IDS[canId.toUpperCase()];
  }

  /**
   * Detect log format type from content
   */
  static detectLogFormat(
    text: string
  ): "J2534" | "ELM327" | "TECH2WIN" | "GDS2" | "UNKNOWN" {
    const lowerText = text.toLowerCase();

    if (
      lowerText.includes("j2534") ||
      lowerText.includes("passthru") ||
      /\[\d+:\d+:\d+\.\d+\]/.test(text)
    ) {
      return "J2534";
    }

    if (
      lowerText.includes("atz") ||
      lowerText.includes("elm") ||
      lowerText.includes("obdlink")
    ) {
      return "ELM327";
    }

    if (
      lowerText.includes("tech2") ||
      lowerText.includes("candi") ||
      lowerText.includes("vetronix")
    ) {
      return "TECH2WIN";
    }

    if (
      lowerText.includes("gds2") ||
      lowerText.includes("mdi") ||
      lowerText.includes("acdelco")
    ) {
      return "GDS2";
    }

    return "UNKNOWN";
  }

  /**
   * Extract all unique CAN IDs from log
   */
  static extractCanIds(text: string): string[] {
    const matches = text.matchAll(/\b([0-7][A-Fa-f0-9]{2})\b/g);
    const ids = new Set<string>();
    for (const match of matches) {
      ids.add(match[1].toUpperCase());
    }
    return Array.from(ids).sort();
  }

  /**
   * Parse line for any security-related UDS messages
   */
  static parseSecurityMessages(text: string): Array<{
    type:
      | "SEED_REQUEST"
      | "SEED_RESPONSE"
      | "KEY_SEND"
      | "KEY_ACCEPTED"
      | "KEY_REJECTED";
    level: number;
    data?: string;
    lineNumber: number;
  }> {
    const messages: Array<{
      type:
        | "SEED_REQUEST"
        | "SEED_RESPONSE"
        | "KEY_SEND"
        | "KEY_ACCEPTED"
        | "KEY_REJECTED";
      level: number;
      data?: string;
      lineNumber: number;
    }> = [];
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const hexLine = lines[i].replace(/[^0-9A-Fa-f]/g, " ").trim();

      // Seed Request (27 01, 27 03, etc.)
      const seedReqMatch = /27\s+0([1357])(?:\s|$)/i.exec(hexLine);
      if (seedReqMatch) {
        messages.push({
          type: "SEED_REQUEST",
          level: parseInt(seedReqMatch[1], 16),
          lineNumber: i + 1,
        });
      }

      // Seed Response (67 01 XX XX... )
      const seedRespMatch = /67\s+0([1357])\s+([0-9A-F\s]+)/i.exec(hexLine);
      if (seedRespMatch) {
        messages.push({
          type: "SEED_RESPONSE",
          level: parseInt(seedRespMatch[1], 16),
          data: seedRespMatch[2].trim(),
          lineNumber: i + 1,
        });
      }

      // Key Send (27 02 XX XX... )
      const keySendMatch = /27\s+0([2468])\s+([0-9A-F\s]+)/i.exec(hexLine);
      if (keySendMatch) {
        messages.push({
          type: "KEY_SEND",
          level: parseInt(keySendMatch[1], 16) - 1, // Convert back to seed level
          data: keySendMatch[2].trim(),
          lineNumber: i + 1,
        });
      }

      // Key Accepted (67 02, 67 04, etc.)
      const keyAcceptMatch = /67\s+0([2468])(?:\s|$)/i.exec(hexLine);
      if (keyAcceptMatch) {
        messages.push({
          type: "KEY_ACCEPTED",
          level: parseInt(keyAcceptMatch[1], 16) - 1,
          lineNumber: i + 1,
        });
      }

      // Negative Response (7F 27 XX)
      const nrcMatch = /7F\s+27\s+([0-9A-F]{2})/i.exec(hexLine);
      if (nrcMatch) {
        messages.push({
          type: "KEY_REJECTED",
          level: 0, // Unknown level
          data: nrcMatch[1],
          lineNumber: i + 1,
        });
      }
    }

    return messages;
  }
}
