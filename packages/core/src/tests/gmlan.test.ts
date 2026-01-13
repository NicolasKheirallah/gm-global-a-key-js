import { describe, it, expect } from "vitest";
import { GMLANEngine } from "../gmlan.js";
import { table_gmlan } from "../tables.js";

describe("GMLANEngine", () => {
  it("should calculate correct key for known seed/algo (Seed D435, Algo 89)", () => {
    // Known pair: Seed D435, Algo 89 -> Key 3257
    const seed = 0xd435;
    const algo = 0x89;
    const key = GMLANEngine.getKey(seed, algo, table_gmlan);
    expect(key).toBe(0x3257);
  });

  it("should reverse engineer correctly (Seed D435, Key 3257 -> Algo 89)", () => {
    const seed = 0xd435;
    const key = 0x3257;
    const result = GMLANEngine.reverseEngineer(seed, key, table_gmlan);
    expect(result.algo).toBe(0x89);
  });

  it("should handle algo 0 (Bitwise negation)", () => {
    const seed = 0xaaaa;
    const key = GMLANEngine.getKey(seed, 0, table_gmlan);
    // ~0xAAAA = 0x5555
    expect(key).toBe(0x5555);
  });

  it("should throw error for out of bounds algo", () => {
    expect(() => GMLANEngine.getKey(0x1234, 9999, table_gmlan)).toThrow();
  });
});
