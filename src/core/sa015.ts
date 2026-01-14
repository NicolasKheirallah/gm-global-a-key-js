import { CryptoShim } from "./crypto-shim";
import { PASSWORD_MAP } from "./sa015_data";

/**
 * Valid prefix types for SA015 password blobs
 */
export const SA015_PREFIX = {
  STANDARD: "01",
  ALTERNATE: "02",
  EXTENDED: "03",
} as const;

export type SA015Prefix = (typeof SA015_PREFIX)[keyof typeof SA015_PREFIX];

/**
 * Custom error class for SA015-specific errors
 */
export class SA015Error extends Error {
  constructor(
    message: string,
    public readonly code:
      | "ALGO_NOT_FOUND"
      | "INVALID_PREFIX"
      | "INVALID_PAYLOAD"
      | "BLOB_DIGEST_MISMATCH"
      | "ALGO_MISMATCH"
      | "INVALID_SEED"
      | "SEED_FORBIDDEN"
      | "BASE64_DECODE_ERROR"
      | "HASH_ERROR",
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "SA015Error";
  }
}

/**
 * Progress callback for long-running hash operations
 */
export type SA015ProgressCallback = (current: number, total: number) => void;

/**
 * Options for SA015 key derivation
 */
export interface SA015Options {
  /** Optional progress callback for iteration updates */
  onProgress?: SA015ProgressCallback;
  /** Progress update interval (default: every 10 iterations) */
  progressInterval?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Result of SA015 key derivation
 */
export interface SA015Result {
  /** 5-byte MAC (key) */
  mac: Uint8Array;
  /** Number of SHA-256 iterations performed */
  iterations: number;
  /** Prefix type used */
  prefix: string;
  /** Algorithm ID from blob (for verification) */
  blobAlgoId: number;
}

/**
 * Cross-platform Base64 decoder with error handling
 */
function safeBase64Decode(base64: string, algo: number): Uint8Array {
  try {
    // Check for valid Base64 characters
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      throw new SA015Error(
        `Invalid Base64 characters in blob for algorithm ${algo}`,
        "BASE64_DECODE_ERROR",
        { algo, invalidChars: base64.match(/[^A-Za-z0-9+/=]/g) }
      );
    }

    // Use atob for browser, handle potential errors
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (e) {
    if (e instanceof SA015Error) throw e;
    throw new SA015Error(
      `Failed to decode Base64 for algorithm ${algo}: ${
        e instanceof Error ? e.message : String(e)
      }`,
      "BASE64_DECODE_ERROR",
      { algo, originalError: e }
    );
  }
}

export class SA015Engine {
  /**
   * Get list of supported algorithm IDs
   */
  static getSupportedAlgorithms(): number[] {
    return Object.keys(PASSWORD_MAP)
      .map(Number)
      .sort((a, b) => a - b);
  }

  /**
   * Check if an algorithm is supported
   */
  static isAlgorithmSupported(algo: number): boolean {
    return algo in PASSWORD_MAP;
  }

  /**
   * Derive key from seed and algorithm ID
   * @param algo - Algorithm ID (0-255)
   * @param seed - 5-byte seed value
   * @param options - Optional configuration
   * @returns Key derivation result
   * @throws SA015Error on invalid input or processing errors
   */
  static async deriveKey(
    algo: number,
    seed: Uint8Array,
    options: SA015Options = {}
  ): Promise<SA015Result> {
    // Validate algorithm
    if (!Number.isInteger(algo) || algo < 0 || algo > 0xffff) {
      throw new SA015Error(
        `Invalid algorithm ID: must be integer 0-65535, got ${algo}`,
        "ALGO_NOT_FOUND",
        { algo }
      );
    }

    const blob = PASSWORD_MAP[algo];
    if (!blob) {
      throw new SA015Error(
        `Algorithm ${algo} (0x${algo
          .toString(16)
          .toUpperCase()}) not found in password map`,
        "ALGO_NOT_FOUND",
        { algo, supportedCount: Object.keys(PASSWORD_MAP).length }
      );
    }

    return this.deriveKeyFromBlob(blob, seed, algo, options);
  }

  /**
   * Internal key derivation from password blob
   */
  private static async deriveKeyFromBlob(
    blob: string,
    seed: Uint8Array,
    algo: number,
    options: SA015Options = {}
  ): Promise<SA015Result> {
    const { onProgress, progressInterval = 10, debug = false } = options;

    // Validate seed
    if (!(seed instanceof Uint8Array)) {
      throw new SA015Error(
        `Seed must be Uint8Array, got ${typeof seed}`,
        "INVALID_SEED",
        { seedType: typeof seed }
      );
    }

    if (seed.length !== 5) {
      throw new SA015Error(
        `Seed must be exactly 5 bytes, got ${seed.length}`,
        "INVALID_SEED",
        { seedLength: seed.length }
      );
    }

    // Parse prefix
    if (blob.length < 2) {
      throw new SA015Error(
        `Blob too short for algorithm ${algo}`,
        "INVALID_PAYLOAD",
        { algo, blobLength: blob.length }
      );
    }

    const prefix = blob.substring(0, 2);

    // Validate prefix - support all known variants
    const validPrefixes = Object.values(SA015_PREFIX);
    if (!validPrefixes.includes(prefix as SA015Prefix)) {
      throw new SA015Error(
        `Invalid prefix '${prefix}' for algorithm ${algo}. Expected one of: ${validPrefixes.join(
          ", "
        )}`,
        "INVALID_PREFIX",
        { algo, prefix, validPrefixes }
      );
    }

    if (debug) {
      console.log(`[SA015] Processing algo ${algo} with prefix ${prefix}`);
    }

    // Decode payload
    const payload = blob.substring(2);
    if (payload.length !== 60) {
      throw new SA015Error(
        `Invalid payload length for algorithm ${algo}: expected 60 chars, got ${payload.length}`,
        "INVALID_PAYLOAD",
        { algo, expectedLength: 60, actualLength: payload.length }
      );
    }
    const rawPayload = safeBase64Decode(payload, algo);

    // Validate payload length
    if (rawPayload.length !== 44) {
      throw new SA015Error(
        `Invalid payload length for algorithm ${algo}: expected 44 bytes, got ${rawPayload.length}`,
        "INVALID_PAYLOAD",
        { algo, expectedLength: 44, actualLength: rawPayload.length }
      );
    }

    // Validate blob digest (first 36 bytes hashed, compare to trailing 8 bytes)
    const expectedDigest = rawPayload.slice(36, 44);
    const actualDigest = (await CryptoShim.sha256(rawPayload.slice(0, 36))).slice(
      0,
      8
    );
    for (let i = 0; i < 8; i++) {
      if (expectedDigest[i] !== actualDigest[i]) {
        throw new SA015Error(
          `Blob digest mismatch for algorithm ${algo}`,
          "BLOB_DIGEST_MISMATCH",
          {
            algo,
            expected: Array.from(expectedDigest),
            actual: Array.from(actualDigest),
          }
        );
      }
    }

    // Extract components
    const secret = rawPayload.slice(0, 32);
    const minSeed = (rawPayload[32] << 8) | rawPayload[33];
    const algoId = (rawPayload[34] << 8) | rawPayload[35];

    if (debug) {
      console.log(`[SA015] Blob algoId: ${algoId}, minSeed: ${minSeed}`);
    }

    // Validate algorithm ID match
    if (algo !== algoId) {
      throw new SA015Error(
        `Algorithm ID mismatch: requested ${algo} but blob contains ${algoId}`,
        "ALGO_MISMATCH",
        { requestedAlgo: algo, blobAlgo: algoId }
      );
    }

    // Calculate iteration count
    const seedTail = seed[4];
    const maxSeed = 255 - seedTail;

    if (minSeed > maxSeed) {
      throw new SA015Error(
        `Seed forbidden: minSeed (${minSeed}) > maxSeed (${maxSeed}) for seed tail 0x${seedTail
          .toString(16)
          .toUpperCase()}`,
        "SEED_FORBIDDEN",
        { minSeed, maxSeed, seedTail }
      );
    }

    const iterations = maxSeed - minSeed;

    if (debug) {
      console.log(`[SA015] Performing ${iterations} hash iterations`);
    }

    // Hash chain with progress reporting
    let digestBuf = new Uint8Array(secret);
    try {
      for (let i = 0; i < iterations; i++) {
        digestBuf = await CryptoShim.sha256(digestBuf);

        // Report progress
        if (onProgress && i % progressInterval === 0) {
          onProgress(i, iterations);
        }
      }

      // Final progress update
      if (onProgress && iterations > 0) {
        onProgress(iterations, iterations);
      }
    } catch (e) {
      throw new SA015Error(
        `Hash chain failed at iteration: ${
          e instanceof Error ? e.message : String(e)
        }`,
        "HASH_ERROR",
        { algo, originalError: e }
      );
    }

    const aesKey = digestBuf.slice(0, 16);

    // Build encryption block: 16 bytes of 0xFF, seed at positions 11-15
    const block = new Uint8Array(16).fill(0xff);
    block.set(seed, 11);

    const encrypted = await CryptoShim.aesEncryptBlock(aesKey, block);

    return {
      mac: encrypted.slice(0, 5),
      iterations,
      prefix,
      blobAlgoId: algoId,
    };
  }

  /**
   * Format key result as hex string
   */
  static formatKey(result: SA015Result): string {
    return Array.from(result.mac)
      .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
      .join("");
  }
}
