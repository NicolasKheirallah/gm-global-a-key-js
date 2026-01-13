import { describe, it, expect } from "vitest";
import { LogParser } from "../logPattern.js";

describe("LogParser", () => {
  it("should extract seed and key from clean hex dump", () => {
    // Simulated successful negotiation
    const log = `
      RX: 67 01 12 34
      TX: 27 02 56 78
    `;
    const result = LogParser.parse(log);
    expect(result).toHaveLength(1);
    expect(result[0].seed).toBe(0x1234);
    expect(result[0].key).toBe(0x5678);
  });

  it("should ignore incomplete sequences", () => {
    const log = `
      RX: 67 01 12 34
      TX: 10 03
    `;
    const result = LogParser.parse(log);
    expect(result).toHaveLength(0);
  });

  it("should handle J2534 timestamped logs", () => {
    // Example format: [Time] ID Len Data...
    const log = `
      [10:00:01] 7E8 04 67 01 AB CD
      [10:00:02] 7E0 04 27 02 99 88
    `;
    const result = LogParser.parse(log);
    expect(result).toHaveLength(1);
    expect(result[0].seed).toBe(0xabcd);
    expect(result[0].key).toBe(0x9988);
  });

  it("should handle multi-line complex logs", () => {
    const log = `
       7E0 10 03
       7E8 50 03
       7E0 27 01
       7E8 67 01 11 22
       7E0 27 02 33 44
       7E8 67 02
     `;
    const result = LogParser.parse(log);
    expect(result).toHaveLength(1);
    expect(result[0].seed).toBe(0x1122);
    expect(result[0].key).toBe(0x3344);
  });
});
