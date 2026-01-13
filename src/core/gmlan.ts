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
  // Valid opcodes set for O(1) lookup
  private static readonly VALID_OPCODES: Set<number> = new Set([
    GMLAN_OPCODES.BYTE_SWAP,
    GMLAN_OPCODES.ADD_HL,
    GMLAN_OPCODES.COMPLEMENT,
    GMLAN_OPCODES.AND_LH,
    GMLAN_OPCODES.ROL,
    GMLAN_OPCODES.OR_HL,
    GMLAN_OPCODES.ROR,
    GMLAN_OPCODES.ADD_LH,
    GMLAN_OPCODES.SWAP_ADD,
    GMLAN_OPCODES.SUB_HL,
    GMLAN_OPCODES.SUB_LH,
  ]);

  // Helper for 16-bit truncation
  private static W(val: number): number {
    return val & 0xffff;
  }

  /**
   * Validates that an opcode is recognized
   */
  private static validateOpcode(
    code: number,
    algo: number,
    step: number
  ): void {
    if (!this.VALID_OPCODES.has(code)) {
      throw new GMLANError(
        `Unknown opcode 0x${code
          .toString(16)
          .toUpperCase()} at step ${step} for algorithm 0x${algo
          .toString(16)
          .toUpperCase()}`,
        "INVALID_OPCODE",
        { opcode: code, algorithm: algo, step }
      );
    }
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
      const idx = algo * 13;
      if (idx + 12 >= tableLength) {
        throw new GMLANError(
          `Algorithm ${algo} (0x${algo
            .toString(16)
            .toUpperCase()}) out of bounds for table (size ${tableLength})`,
          "TABLE_BOUNDS",
          { algo, tableLength, requiredIndex: idx + 12 }
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
    // ll unused
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

    let idx = algo * 13;

    for (let i = 0; i < 4; i++) {
      const code = table[idx];
      const hh = table[idx + 1];
      const ll = table[idx + 2];

      // Validate opcode before processing
      this.validateOpcode(code, algo, i);

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
        // No default needed - validateOpcode already threw if invalid
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
  ): { algo: number | null; sequence: any[] | null } {
    for (let algo = 1; algo < maxAlgorithms; algo++) {
      const idx = algo * 13;
      if (idx + 12 >= table.length) break;

      try {
        const res = this.getKey(seed, algo, table);
        if (res === targetKey) {
          // Reconstruct sequence
          const sequence = [];
          for (let step = 0; step < 4; step++) {
            const s_idx = idx + step * 3;
            sequence.push({
              op: table[s_idx],
              hh: table[s_idx + 1],
              ll: table[s_idx + 2],
            });
          }
          return { algo, sequence };
        }
      } catch (e) {
        continue;
      }
    }
    return { algo: null, sequence: null };
  }

  static bruteForceAll(
    seed: number,
    table: Uint8Array
  ): Array<{ algo: number; key: number }> {
    const results = [];
    const limit = Math.floor(table.length / 13);
    for (let algo = 1; algo < limit; algo++) {
      try {
        const key = this.getKey(seed, algo, table);
        results.push({ algo, key });
      } catch (e) {
        continue;
      }
    }
    return results;
  }
}
