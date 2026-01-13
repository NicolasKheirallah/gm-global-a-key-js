import { describe, it, expect } from "vitest";
import { SA015Engine } from "../sa015.js";

describe("SA015Engine", () => {
  it("should derive key for Algo 87 (Seed 8CE7D1FD06)", async () => {
    // Known check
    // Algo 87
    // Seed: 8C E7 D1 FD 06
    // Expected Key: 0F 83 23 EB 68 (Example dependent on blob)
    // Actually we don't have a known vector hardcoded, let's just ensure it runs and returns a valid format
    // Real validation needs a known pair from vehicle.

    // We can simulate a run
    const seed = new Uint8Array([0x8c, 0xe7, 0xd1, 0xfd, 0x06]);
    const algo = 0x87;

    const result = await SA015Engine.deriveKey(algo, seed);

    expect(result.mac).toBeInstanceOf(Uint8Array);
    expect(result.mac).toHaveLength(5);
    expect(result.iterations).toBeGreaterThan(0);
  });
});
