import { describe, it, expect } from "vitest";
import { GMLANEngine, GMLANError, GMLAN_OPCODES, table_gmlan } from "../core";

describe("GMLANEngine", () => {
  describe("getKey", () => {
    it("should calculate valid key for known seed/algo pair", () => {
      // Algorithm 0 is special - bitwise NOT
      const seed = 0xd435;
      const key = GMLANEngine.getKey(seed, 0, table_gmlan);
      expect(key).toBe(~seed & 0xffff);
    });

    it("should throw GMLANError for invalid seed", () => {
      expect(() => GMLANEngine.getKey(-1, 1, table_gmlan)).toThrow(GMLANError);
      expect(() => GMLANEngine.getKey(0x10000, 1, table_gmlan)).toThrow(
        GMLANError
      );
    });

    it("should throw GMLANError for invalid algorithm", () => {
      expect(() => GMLANEngine.getKey(0xd435, -1, table_gmlan)).toThrow(
        GMLANError
      );
      expect(() => GMLANEngine.getKey(0xd435, 256, table_gmlan)).toThrow(
        GMLANError
      );
    });

    it("should throw GMLANError for table bounds exceeded", () => {
      const smallTable = new Uint8Array(10);
      expect(() => GMLANEngine.getKey(0xd435, 5, smallTable)).toThrow(
        GMLANError
      );
    });
  });

  describe("bruteForceAll", () => {
    it("should return array of algo/key pairs", () => {
      const results = GMLANEngine.bruteForceAll(0xd435, table_gmlan);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty("algo");
      expect(results[0]).toHaveProperty("key");
    });
  });

  describe("reverseEngineer", () => {
    it("should find algorithm for known seed/key pair", () => {
      // First get a known key
      const seed = 0xd435;
      const algo = 10;
      const key = GMLANEngine.getKey(seed, algo, table_gmlan);

      // Now reverse engineer it
      const result = GMLANEngine.reverseEngineer(seed, key, table_gmlan);
      expect(result.algo).toBe(algo);
    });

    it("should return null for unmatched key", () => {
      const result = GMLANEngine.reverseEngineer(0x1234, 0x0000, table_gmlan);
      expect(result.algo).toBeNull();
    });
  });

  describe("GMLAN_OPCODES", () => {
    it("should have expected opcodes", () => {
      expect(GMLAN_OPCODES.BYTE_SWAP).toBe(0x05);
      expect(GMLAN_OPCODES.ROL).toBe(0x4c);
      expect(GMLAN_OPCODES.ROR).toBe(0x6b);
    });
  });
});
