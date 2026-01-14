/**
 * Valid GMLAN opcodes for seed/key calculation
 */
export const GMLAN_OPCODES = {
  BYTE_SWAP: 0x05, // Swap high and low bytes
  ADD_HL: 0x14, // Add (HH << 8 | LL)
  COMPLEMENT: 0x2a, // Bitwise NOT with conditional increment
  AND_LH: 0x37, // AND with (LL << 8 | HH)
  ROL: 0x4c, // Rotate left by HH bits
  OR_HL: 0x52, // OR with HH and (LL << 8)
  ROR: 0x6b, // Rotate right by LL bits
  ADD_LH: 0x75, // Add (LL << 8 | HH)
  SWAP_ADD: 0x7e, // Swap then conditional add
  SUB_HL: 0x98, // Subtract (HH << 8 | LL)
  SUB_LH: 0xf8, // Subtract (LL << 8 | HH)
} as const;

/**
 * Custom error class for GMLAN-specific errors
 */
export class GMLANError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_OPCODE"
      | "INVALID_ALGO"
      | "INVALID_SEED"
      | "TABLE_BOUNDS",
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "GMLANError";
  }
}

export class GMLANEngine {
  // Helper for 16-bit truncation
  private static W(val: number): number {
    return val & 0xffff;
  }

  /**
   * Validates seed is within 16-bit range
   */
  private static validateSeed(seed: number): void {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff) {
      throw new GMLANError(
        `Invalid seed: must be integer 0x0000-0xFFFF, got ${seed}`,
        "INVALID_SEED",
        { seed }
      );
    }
  }

  /**
   * Detect table format and return stride/operation count
   * Legacy format: 13-byte stride, 4 operations
   * Extended format: 16-byte stride, 5 operations
   */
  private static getTableFormat(tableLength: number): {
    stride: number;
    opCount: number;
  } {
    // Heuristic: if table is divisible by 16 and large enough, use 16-byte stride
    if (tableLength >= 4096 && tableLength % 16 === 0) {
      return { stride: 16, opCount: 5 };
    }
    return { stride: 13, opCount: 4 };
  }

  /**
   * Validates algorithm ID
   */
  private static validateAlgo(algo: number, tableLength: number): void {
    if (!Number.isInteger(algo) || algo < 0 || algo > 255) {
      throw new GMLANError(
        `Invalid algorithm ID: must be integer 0-255, got ${algo}`,
        "INVALID_ALGO",
        { algo }
      );
    }

    if (algo !== 0) {
      const { stride, opCount } = this.getTableFormat(tableLength);
      const idx = algo * stride;
      if (idx + opCount * 3 > tableLength) {
        throw new GMLANError(
          `Algorithm ${algo} (0x${algo
            .toString(16)
            .toUpperCase()}) out of bounds for table (size ${tableLength})`,
          "TABLE_BOUNDS",
          { algo, tableLength, requiredIndex: idx + opCount * 3 }
        );
      }
    }
  }

  static op_05(val: number): number {
    return this.W((val << 8) | (val >>> 8));
  }

  static op_14(val: number, hh: number, ll: number): number {
    const add_val = (hh << 8) | ll;
    return this.W(val + add_val);
  }

  static op_2a(val: number, hh: number, ll: number): number {
    let new_val = this.W(~val);
    if (hh < ll) {
      new_val = this.W(new_val + 1);
    }
    return new_val;
  }

  static op_37(val: number, hh: number, ll: number): number {
    const and_val = (ll << 8) | hh;
    return this.W(val & and_val);
  }

  static op_4c(val: number, hh: number, _ll: number): number {
    // Normalize shift to 0-15 range for 16-bit rotation
    const shift = hh & 0x0f;
    if (shift === 0) return val;
    // 16-bit rotate left
    return this.W((val << shift) | (val >>> (16 - shift)));
  }

  static op_52(val: number, hh: number, ll: number): number {
    return this.W(val | hh | (ll << 8));
  }

  static op_6b(val: number, _hh: number, ll: number): number {
    // hh unused
    // Normalize shift to 0-15 range for 16-bit rotation
    const shift = ll & 0x0f;
    if (shift === 0) return val;
    // 16-bit rotate right
    return this.W((val >>> shift) | (val << (16 - shift)));
  }

  static op_75(val: number, hh: number, ll: number): number {
    const add_val = (ll << 8) | hh;
    return this.W(val + add_val);
  }

  static op_7e(val: number, hh: number, ll: number): number {
    if (hh >= ll) {
      return this.op_14(this.op_05(val), hh, ll);
    } else {
      return this.op_75(this.op_05(val), hh, ll);
    }
  }

  static op_98(val: number, hh: number, ll: number): number {
    const sub_val = (hh << 8) | ll;
    return this.W(val - sub_val);
  }

  static op_f8(val: number, hh: number, ll: number): number {
    const sub_val = (ll << 8) | hh;
    return this.W(val - sub_val);
  }

  /**
   * Calculate the key for a given seed and algorithm
   * @param seed - 16-bit seed value (0x0000-0xFFFF)
   * @param algo - Algorithm ID (0-255)
   * @param table - Lookup table containing algorithm definitions
   * @returns 16-bit key value
   * @throws GMLANError on invalid input or unknown opcodes
   */
  static getKey(seed: number, algo: number, table: Uint8Array): number {
    // Validate inputs
    this.validateSeed(seed);
    this.validateAlgo(algo, table.length);

    let seed_word = this.W(seed);

    // Algorithm 0 is special: simple bitwise NOT
    if (algo === 0) {
      return this.W(~seed_word);
    }

    const { stride, opCount } = this.getTableFormat(table.length);
    let idx = algo * stride;

    for (let i = 0; i < opCount; i++) {
      const code = table[idx];
      const hh = table[idx + 1];
      const ll = table[idx + 2];

      // Stop early if opcode is 0x00 (NOP/end marker)
      if (code === 0x00) {
        break;
      }

      switch (code) {
        case GMLAN_OPCODES.BYTE_SWAP:
          seed_word = this.op_05(seed_word);
          break;
        case GMLAN_OPCODES.ADD_HL:
          seed_word = this.op_14(seed_word, hh, ll);
          break;
        case GMLAN_OPCODES.COMPLEMENT:
          seed_word = this.op_2a(seed_word, hh, ll);
          break;
        case GMLAN_OPCODES.AND_LH:
          seed_word = this.op_37(seed_word, hh, ll);
          break;
        case GMLAN_OPCODES.ROL:
          seed_word = this.op_4c(seed_word, hh, ll);
          break;
        case GMLAN_OPCODES.OR_HL:
          seed_word = this.op_52(seed_word, hh, ll);
          break;
        case GMLAN_OPCODES.ROR:
          seed_word = this.op_6b(seed_word, hh, ll);
          break;
        case GMLAN_OPCODES.ADD_LH:
          seed_word = this.op_75(seed_word, hh, ll);
          break;
        case GMLAN_OPCODES.SWAP_ADD:
          seed_word = this.op_7e(seed_word, hh, ll);
          break;
        case GMLAN_OPCODES.SUB_HL:
          seed_word = this.op_98(seed_word, hh, ll);
          break;
        case GMLAN_OPCODES.SUB_LH:
          seed_word = this.op_f8(seed_word, hh, ll);
          break;
        default:
          // Unknown opcode: treat as NOP for parity with gmseedcalc
          break;
      }
      idx += 3;
    }

    return seed_word;
  }

  static reverseEngineer(
    seed: number,
    targetKey: number,
    table: Uint8Array,
    maxAlgorithms: number = 256
  ): {
    algo: number | null;
    sequence: Array<{ op: number; hh: number; ll: number }> | null;
  } {
    const { stride, opCount } = this.getTableFormat(table.length);

    for (let algo = 1; algo < maxAlgorithms; algo++) {
      const idx = algo * stride;
      if (idx + opCount * 3 > table.length) break;

      try {
        const res = this.getKey(seed, algo, table);
        if (res === targetKey) {
          // Reconstruct sequence
          const sequence = [];
          for (let step = 0; step < opCount; step++) {
            const s_idx = idx + step * 3;
            const opcode = table[s_idx];
            if (opcode === 0x00) break;
            sequence.push({
              op: opcode,
              hh: table[s_idx + 1],
              ll: table[s_idx + 2],
            });
          }
          return { algo, sequence };
        }
      } catch {
        continue;
      }
    }
    return { algo: null, sequence: null };
  }

  static bruteForceAll(
    seed: number,
    table: Uint8Array
  ): Array<{ algo: number; key: number }> {
    const { stride } = this.getTableFormat(table.length);
    const results = [];
    const limit = Math.floor(table.length / stride);
    for (let algo = 0; algo < limit; algo++) {
      try {
        const key = this.getKey(seed, algo, table);
        results.push({ algo, key });
      } catch {
        continue;
      }
    }
    return results;
  }

  // ============================================================
  // RUST BACKEND METHODS (Source of Truth)
  // These methods call the high-performance Rust implementation
  // via Tauri IPC. They fall back to TypeScript in browser mode.
  // ============================================================

  private static _isTauri: boolean | null = null;

  /**
   * Check if running in Tauri desktop environment
   */
  static isTauriEnvironment(): boolean {
    if (this._isTauri === null) {
      this._isTauri = typeof window !== "undefined" && "__TAURI__" in window;
    }
    return this._isTauri;
  }

  /**
   * Calculate key using Rust backend (source of truth)
   * Falls back to TypeScript implementation in browser mode
   * @param seed - 16-bit seed value
   * @param algo - Algorithm ID (0-255)
   * @param table - Table for fallback (optional if in Tauri)
   */
  static async getKeyAsync(
    seed: number,
    algo: number,
    table?: Uint8Array
  ): Promise<number> {
    if (this.isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<number>("calculate_gmlan_key", { seed, algo });
      } catch (e) {
        console.warn("Rust GMLAN call failed, falling back to TypeScript:", e);
      }
    }

    // Fallback to TypeScript implementation
    if (!table) {
      const { table_gmlan } = await import("./tables");
      return this.getKey(seed, algo, table_gmlan);
    }
    return this.getKey(seed, algo, table);
  }

  /**
   * Reverse engineer algorithm using Rust backend (source of truth)
   * Falls back to TypeScript implementation in browser mode
   * @param seed - 16-bit seed value
   * @param targetKey - Known key to match
   * @param maxAlgorithms - Max algorithms to try
   * @param table - Table for fallback (optional if in Tauri)
   */
  static async reverseEngineerAsync(
    seed: number,
    targetKey: number,
    maxAlgorithms: number = 256,
    table?: Uint8Array
  ): Promise<{
    algo: number | null;
    sequence: Array<{ op: number; hh: number; ll: number }> | null;
  }> {
    if (this.isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<{
          algo: number | null;
          sequence: Array<{ opcode: number; hh: number; ll: number }> | null;
        }>("reverse_engineer_gmlan", {
          seed,
          targetKey,
          maxAlgorithms,
        });

        // Map Rust struct field names to TypeScript convention
        return {
          algo: result.algo,
          sequence:
            result.sequence?.map((s) => ({
              op: s.opcode,
              hh: s.hh,
              ll: s.ll,
            })) ?? null,
        };
      } catch (e) {
        console.warn(
          "Rust reverse engineer failed, falling back to TypeScript:",
          e
        );
      }
    }

    // Fallback to TypeScript implementation
    if (!table) {
      const { table_gmlan } = await import("./tables");
      return this.reverseEngineer(seed, targetKey, table_gmlan, maxAlgorithms);
    }
    return this.reverseEngineer(seed, targetKey, table, maxAlgorithms);
  }

  /**
   * Brute force all algorithms using Rust backend (source of truth)
   * Falls back to TypeScript implementation in browser mode
   * @param seed - 16-bit seed value
   * @param table - Table for fallback (optional if in Tauri)
   */
  static async bruteForceAllAsync(
    seed: number,
    table?: Uint8Array
  ): Promise<Array<{ algo: number; key: number }>> {
    if (this.isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<Array<{ algo: number; key: number }>>(
          "brute_force_all_gmlan",
          { seed }
        );
      } catch (e) {
        console.warn("Rust brute force failed, falling back to TypeScript:", e);
      }
    }

    // Fallback to TypeScript implementation
    if (!table) {
      const { table_gmlan } = await import("./tables");
      return this.bruteForceAll(seed, table_gmlan);
    }
    return this.bruteForceAll(seed, table);
  }

  /**
   * Find matching algorithms for a seed/key pair using Rust backend
   * @param seed - 16-bit seed value
   * @param knownKey - Known key to match
   */
  static async findMatchingAlgorithmsAsync(
    seed: number,
    knownKey: number
  ): Promise<number[]> {
    if (this.isTauriEnvironment()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const hexAlgos = await invoke<string[]>("brute_force_gmlan_key", {
          seed,
          knownKey,
        });
        return hexAlgos.map((h) => parseInt(h, 16));
      } catch (e) {
        console.warn("Rust brute force failed, falling back to TypeScript:", e);
      }
    }

    // Fallback: use TypeScript bruteForceAll and filter
    const { table_gmlan } = await import("./tables");
    const results = this.bruteForceAll(seed, table_gmlan);
    return results.filter((r) => r.key === knownKey).map((r) => r.algo);
  }
}
