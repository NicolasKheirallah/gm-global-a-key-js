/**
 * ISO 14229 Unified Diagnostic Services (UDS) Protocol Implementation
 *
 * This module provides UDS message types, constants, and utilities for
 * diagnostic communication with automotive ECUs.
 */

/**
 * UDS Service Identifiers (SIDs)
 * ISO 14229-1:2020
 */
export const UDS_SID = {
  // Diagnostic and Communication Management
  DIAGNOSTIC_SESSION_CONTROL: 0x10,
  ECU_RESET: 0x11,
  SECURITY_ACCESS: 0x27,
  COMMUNICATION_CONTROL: 0x28,
  TESTER_PRESENT: 0x3e,
  ACCESS_TIMING_PARAMETER: 0x83,
  SECURED_DATA_TRANSMISSION: 0x84,
  CONTROL_DTC_SETTING: 0x85,
  RESPONSE_ON_EVENT: 0x86,
  LINK_CONTROL: 0x87,

  // Data Transmission
  READ_DATA_BY_IDENTIFIER: 0x22,
  READ_MEMORY_BY_ADDRESS: 0x23,
  READ_SCALING_DATA_BY_IDENTIFIER: 0x24,
  READ_DATA_BY_PERIODIC_IDENTIFIER: 0x2a,
  DYNAMICALLY_DEFINE_DATA_IDENTIFIER: 0x2c,
  WRITE_DATA_BY_IDENTIFIER: 0x2e,
  WRITE_MEMORY_BY_ADDRESS: 0x3d,

  // Stored Data Transmission
  CLEAR_DIAGNOSTIC_INFORMATION: 0x14,
  READ_DTC_INFORMATION: 0x19,

  // Input/Output Control
  INPUT_OUTPUT_CONTROL_BY_IDENTIFIER: 0x2f,

  // Routine Control
  ROUTINE_CONTROL: 0x31,

  // Upload/Download
  REQUEST_DOWNLOAD: 0x34,
  REQUEST_UPLOAD: 0x35,
  TRANSFER_DATA: 0x36,
  REQUEST_TRANSFER_EXIT: 0x37,
  REQUEST_FILE_TRANSFER: 0x38,
} as const;

/**
 * Diagnostic Session Types
 */
export const DIAGNOSTIC_SESSION = {
  DEFAULT: 0x01,
  PROGRAMMING: 0x02,
  EXTENDED: 0x03,
  SAFETY_SYSTEM: 0x04,
  // GM Specific
  GM_DEVELOPMENT: 0x83,
  GM_MANUFACTURING: 0x95,
  GM_SERVICE: 0xfa,
} as const;

/**
 * Security Access Levels
 */
export const SECURITY_LEVEL = {
  LEVEL_01: 0x01, // Standard
  LEVEL_03: 0x03, // Extended
  LEVEL_05: 0x05, // Supplier
  LEVEL_07: 0x07, // Engineering
  LEVEL_11: 0x11, // Programming
  LEVEL_13: 0x13, // End-of-Line
  LEVEL_61: 0x61, // Service (GM)
  LEVEL_63: 0x63, // Tool (GM)
} as const;

/**
 * Negative Response Codes (NRC)
 * ISO 14229-1:2020 Annex A
 */
export const NRC = {
  // General NRC
  POSITIVE_RESPONSE: 0x00,
  GENERAL_REJECT: 0x10,
  SERVICE_NOT_SUPPORTED: 0x11,
  SUB_FUNCTION_NOT_SUPPORTED: 0x12,
  INCORRECT_MESSAGE_LENGTH_OR_INVALID_FORMAT: 0x13,
  RESPONSE_TOO_LONG: 0x14,
  BUSY_REPEAT_REQUEST: 0x21,
  CONDITIONS_NOT_CORRECT: 0x22,
  REQUEST_SEQUENCE_ERROR: 0x24,
  NO_RESPONSE_FROM_SUBNET_COMPONENT: 0x25,
  FAILURE_PREVENTS_EXECUTION: 0x26,
  REQUEST_OUT_OF_RANGE: 0x31,

  // Security Access specific
  SECURITY_ACCESS_DENIED: 0x33,
  INVALID_KEY: 0x35,
  EXCEEDED_NUMBER_OF_ATTEMPTS: 0x36,
  REQUIRED_TIME_DELAY_NOT_EXPIRED: 0x37,

  // Upload/Download specific
  UPLOAD_DOWNLOAD_NOT_ACCEPTED: 0x70,
  TRANSFER_DATA_SUSPENDED: 0x71,
  GENERAL_PROGRAMMING_FAILURE: 0x72,
  WRONG_BLOCK_SEQUENCE_COUNTER: 0x73,
  REQUEST_CORRECTLY_RECEIVED_RESPONSE_PENDING: 0x78,

  // Sub-function specific
  SUB_FUNCTION_NOT_SUPPORTED_IN_ACTIVE_SESSION: 0x7e,
  SERVICE_NOT_SUPPORTED_IN_ACTIVE_SESSION: 0x7f,

  // Voltage specific
  VOLTAGE_TOO_HIGH: 0x92,
  VOLTAGE_TOO_LOW: 0x93,
} as const;

/**
 * NRC Descriptions for user-friendly error messages
 */
export const NRC_DESCRIPTIONS: Record<number, string> = {
  [NRC.GENERAL_REJECT]: "General reject - Request not processed",
  [NRC.SERVICE_NOT_SUPPORTED]: "Service not supported by ECU",
  [NRC.SUB_FUNCTION_NOT_SUPPORTED]: "Sub-function not supported",
  [NRC.INCORRECT_MESSAGE_LENGTH_OR_INVALID_FORMAT]:
    "Incorrect message length or invalid format",
  [NRC.RESPONSE_TOO_LONG]: "Response too long for transport protocol",
  [NRC.BUSY_REPEAT_REQUEST]: "ECU busy, repeat request",
  [NRC.CONDITIONS_NOT_CORRECT]: "Conditions not correct for request",
  [NRC.REQUEST_SEQUENCE_ERROR]: "Request sequence error",
  [NRC.REQUEST_OUT_OF_RANGE]: "Request out of range",
  [NRC.SECURITY_ACCESS_DENIED]: "Security access denied",
  [NRC.INVALID_KEY]: "Invalid security key",
  [NRC.EXCEEDED_NUMBER_OF_ATTEMPTS]:
    "Exceeded number of security access attempts - ECU locked",
  [NRC.REQUIRED_TIME_DELAY_NOT_EXPIRED]:
    "Required time delay not expired - Wait before retry",
  [NRC.REQUEST_CORRECTLY_RECEIVED_RESPONSE_PENDING]:
    "Request received, response pending",
  [NRC.VOLTAGE_TOO_HIGH]: "Voltage too high",
  [NRC.VOLTAGE_TOO_LOW]: "Voltage too low",
};

/**
 * Custom error for UDS negative responses
 */
export class UDSNegativeResponseError extends Error {
  constructor(
    public readonly serviceId: number,
    public readonly nrc: number,
    public readonly rawResponse?: Uint8Array
  ) {
    const nrcName =
      Object.entries(NRC).find(([, v]) => v === nrc)?.[0] ||
      `0x${nrc.toString(16).toUpperCase()}`;
    const description = NRC_DESCRIPTIONS[nrc] || "Unknown error";
    super(
      `UDS Negative Response for SID 0x${serviceId
        .toString(16)
        .toUpperCase()}: ${nrcName} - ${description}`
    );
    this.name = "UDSNegativeResponseError";
  }

  /**
   * Check if this is a security-related NRC
   */
  isSecurityError(): boolean {
    return (
      this.nrc === NRC.SECURITY_ACCESS_DENIED ||
      this.nrc === NRC.INVALID_KEY ||
      this.nrc === NRC.EXCEEDED_NUMBER_OF_ATTEMPTS ||
      this.nrc === NRC.REQUIRED_TIME_DELAY_NOT_EXPIRED
    );
  }

  /**
   * Check if this is a temporary condition that might clear
   */
  isRetryable(): boolean {
    return (
      this.nrc === NRC.BUSY_REPEAT_REQUEST ||
      this.nrc === NRC.REQUEST_CORRECTLY_RECEIVED_RESPONSE_PENDING ||
      this.nrc === NRC.CONDITIONS_NOT_CORRECT
    );
  }

  /**
   * Check if ECU is locked out
   */
  isLockedOut(): boolean {
    return (
      this.nrc === NRC.EXCEEDED_NUMBER_OF_ATTEMPTS ||
      this.nrc === NRC.REQUIRED_TIME_DELAY_NOT_EXPIRED
    );
  }
}

/**
 * Security access state machine
 */
export interface SecurityAccessState {
  /** Current security level (0 = not authenticated) */
  level: number;
  /** Whether security is unlocked for this level */
  unlocked: boolean;
  /** Number of failed attempts */
  failedAttempts: number;
  /** Lockout time remaining in ms (0 = not locked) */
  lockoutRemaining: number;
  /** Last seed received */
  lastSeed?: Uint8Array;
  /** Timestamp of last attempt */
  lastAttemptTime?: number;
}

/**
 * UDS Message utilities
 */
export class UDSMessage {
  /**
   * Parse a response and check for negative response
   * @param response - Raw response bytes
   * @param expectedSid - Expected service ID
   * @throws UDSNegativeResponseError if response is negative
   */
  static parseResponse(response: Uint8Array, expectedSid: number): Uint8Array {
    if (response.length < 1) {
      throw new Error("Empty response");
    }

    // Check for negative response (0x7F)
    if (response[0] === 0x7f) {
      if (response.length >= 3) {
        const errorSid = response[1];
        const nrc = response[2];
        throw new UDSNegativeResponseError(errorSid, nrc, response);
      }
      throw new Error("Malformed negative response");
    }

    // Check for positive response (SID + 0x40)
    const positiveSid = expectedSid + 0x40;
    if (response[0] !== positiveSid) {
      throw new Error(
        `Unexpected response SID: expected 0x${positiveSid.toString(
          16
        )}, got 0x${response[0].toString(16)}`
      );
    }

    return response;
  }

  /**
   * Parse security access seed response
   * @param response - Raw response bytes
   * @param level - Security level requested
   * @returns Seed bytes
   */
  static parseSecuritySeedResponse(
    response: Uint8Array,
    level: number
  ): Uint8Array {
    const parsed = this.parseResponse(response, UDS_SID.SECURITY_ACCESS);

    // Response format: 67 <level> <seed bytes...>
    if (parsed.length < 2) {
      throw new Error("Security seed response too short");
    }

    if (parsed[1] !== level) {
      throw new Error(
        `Security level mismatch: expected ${level}, got ${parsed[1]}`
      );
    }

    // Seed is everything after the level byte
    return parsed.slice(2);
  }

  /**
   * Parse security access key response
   * @param response - Raw response bytes
   * @param level - Security level (odd = seed, even = key response)
   * @returns True if key was accepted
   */
  static parseSecurityKeyResponse(
    response: Uint8Array,
    level: number
  ): boolean {
    const keyLevel = level + 1; // Key level is seed level + 1
    const parsed = this.parseResponse(response, UDS_SID.SECURITY_ACCESS);

    // Response format: 67 <level>
    if (parsed.length >= 2 && parsed[1] === keyLevel) {
      return true;
    }

    return false;
  }

  /**
   * Build security access seed request
   * @param level - Security level
   * @returns Request bytes
   */
  static buildSeedRequest(level: number): Uint8Array {
    return new Uint8Array([UDS_SID.SECURITY_ACCESS, level]);
  }

  /**
   * Build security access key request
   * @param level - Security level (must be odd)
   * @param key - Key bytes
   * @returns Request bytes
   */
  static buildKeyRequest(level: number, key: Uint8Array): Uint8Array {
    const keyLevel = level + 1; // Key level is seed level + 1
    const request = new Uint8Array(2 + key.length);
    request[0] = UDS_SID.SECURITY_ACCESS;
    request[1] = keyLevel;
    request.set(key, 2);
    return request;
  }

  /**
   * Build diagnostic session control request
   * @param session - Session type
   * @returns Request bytes
   */
  static buildSessionRequest(session: number): Uint8Array {
    return new Uint8Array([UDS_SID.DIAGNOSTIC_SESSION_CONTROL, session]);
  }

  /**
   * Build tester present request
   * @param suppressPositiveResponse - Whether to suppress positive response
   * @returns Request bytes
   */
  static buildTesterPresent(
    suppressPositiveResponse: boolean = true
  ): Uint8Array {
    const subFunction = suppressPositiveResponse ? 0x80 : 0x00;
    return new Uint8Array([UDS_SID.TESTER_PRESENT, subFunction]);
  }

  /**
   * Build Read Data By Identifier (0x22) request
   * @param did - Data Identifier to read (e.g. 0xF190 for VIN)
   */
  static buildReadDataByIdentifier(did: number): Uint8Array {
    return new Uint8Array([
      UDS_SID.READ_DATA_BY_IDENTIFIER,
      (did >> 8) & 0xff,
      did & 0xff,
    ]);
  }

  /**
   * Build Routine Control (0x31) request
   * @param subFunction - 0x01 (Start), 0x02 (Stop), 0x03 (Result)
   * @param routineId - Routine Identifier
   * @param optionRecord - Optional data to send with request
   */
  static buildRoutineControl(
    subFunction: number,
    routineId: number,
    optionRecord: Uint8Array = new Uint8Array(0)
  ): Uint8Array {
    const request = new Uint8Array(4 + optionRecord.length);
    request[0] = UDS_SID.ROUTINE_CONTROL;
    request[1] = subFunction;
    request[2] = (routineId >> 8) & 0xff;
    request[3] = routineId & 0xff;
    if (optionRecord.length > 0) {
      request.set(optionRecord, 4);
    }
    return request;
  }

  /**
   * Format bytes for display
   */
  static formatBytes(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
      .join(" ");
  }

  /**
   * Parse hex string to bytes
   */
  static parseHex(hex: string): Uint8Array {
    const clean = hex.replace(/\s+/g, "").replace(/^0x/i, "");
    if (clean.length % 2 !== 0) {
      throw new Error("Invalid hex string length");
    }
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
    }
    return bytes;
  }
}

/**
 * Security access timing parameters (ISO 14229)
 */
export const SECURITY_TIMING = {
  /** Minimum delay between security access requests after rejection (ms) */
  P2_SERVER_MAX: 50,
  /** Extended timing parameter (ms) */
  P2_STAR_SERVER_MAX: 5000,
  /** Typical lockout duration after max attempts (ms) */
  SECURITY_LOCKOUT_DURATION: 10000,
  /** Maximum number of attempts before lockout */
  MAX_ATTEMPTS: 3,
};

/**
 * Security access manager with timing and state tracking
 */
export class SecurityAccessManager {
  private states: Map<number, SecurityAccessState> = new Map();

  /**
   * Get state for a security level
   */
  getState(level: number): SecurityAccessState {
    if (!this.states.has(level)) {
      this.states.set(level, {
        level,
        unlocked: false,
        failedAttempts: 0,
        lockoutRemaining: 0,
      });
    }
    return this.states.get(level)!;
  }

  /**
   * Record a successful unlock
   */
  recordSuccess(level: number): void {
    const state = this.getState(level);
    state.unlocked = true;
    state.failedAttempts = 0;
    state.lockoutRemaining = 0;
  }

  /**
   * Record a failed attempt
   */
  recordFailure(level: number, nrc?: number): void {
    const state = this.getState(level);
    state.failedAttempts++;
    state.lastAttemptTime = Date.now();

    if (nrc === NRC.EXCEEDED_NUMBER_OF_ATTEMPTS) {
      state.lockoutRemaining = SECURITY_TIMING.SECURITY_LOCKOUT_DURATION;
    } else if (nrc === NRC.REQUIRED_TIME_DELAY_NOT_EXPIRED) {
      // ECU provided timing - use extended timing
      state.lockoutRemaining = SECURITY_TIMING.P2_STAR_SERVER_MAX;
    }
  }

  /**
   * Store seed for later key calculation
   */
  storeSeed(level: number, seed: Uint8Array): void {
    const state = this.getState(level);
    state.lastSeed = new Uint8Array(seed);
    state.lastAttemptTime = Date.now();
  }

  /**
   * Check if we can attempt security access
   */
  canAttempt(level: number): { allowed: boolean; waitMs: number } {
    const state = this.getState(level);

    if (state.lockoutRemaining > 0) {
      const elapsed = Date.now() - (state.lastAttemptTime ?? 0);
      const remaining = Math.max(0, state.lockoutRemaining - elapsed);

      if (remaining > 0) {
        return { allowed: false, waitMs: remaining };
      }

      // Lockout expired
      state.lockoutRemaining = 0;
    }

    return { allowed: true, waitMs: 0 };
  }

  /**
   * Reset state for a level
   */
  reset(level: number): void {
    this.states.delete(level);
  }

  /**
   * Reset all states
   */
  resetAll(): void {
    this.states.clear();
  }
}
