import { describe, it, expect } from "vitest";
import { LogParser, ECU_CAN_IDS, SECURITY_LEVELS } from "../core";

describe("LogParser", () => {
  describe("parse", () => {
    it("should parse GMLAN 2-byte seed/key pair", () => {
      const log = `
        TX: 27 01
        RX: 67 01 A1 B2
        TX: 27 02 C3 D4
      `;
      const results = LogParser.parse(log);
      expect(results.length).toBe(1);
      expect(results[0].protocol).toBe("GMLAN");
      expect(results[0].seedBytes).toEqual(new Uint8Array([0xa1, 0xb2]));
      expect(results[0].keyBytes).toEqual(new Uint8Array([0xc3, 0xd4]));
    });

    it("should parse SA015 5-byte seed/key pair", () => {
      const log = `
        67 01 8C E7 D1 FD 06
        27 02 12 34 56 78 9A
      `;
      const results = LogParser.parse(log);
      expect(results.length).toBe(1);
      expect(results[0].protocol).toBe("SA015");
      expect(results[0].seedBytes.length).toBe(5);
      expect(results[0].keyBytes.length).toBe(5);
    });

    it("should handle empty log", () => {
      const results = LogParser.parse("");
      expect(results).toEqual([]);
    });

    it("should handle log with no seeds", () => {
      const log = "Some random text without any diagnostic data";
      const results = LogParser.parse(log);
      expect(results).toEqual([]);
    });
  });

  describe("detectLogFormat", () => {
    it("should detect J2534 logs", () => {
      const log = "[12:34:56.789] J2534 PassThru message";
      expect(LogParser.detectLogFormat(log)).toBe("J2534");
    });

    it("should detect ELM327 logs", () => {
      const log = "ATZ\nOK\nELM327 v1.5";
      expect(LogParser.detectLogFormat(log)).toBe("ELM327");
    });

    it("should return UNKNOWN for unrecognized format", () => {
      const log = "random text";
      expect(LogParser.detectLogFormat(log)).toBe("UNKNOWN");
    });
  });

  describe("formatSeed/formatKey", () => {
    it("should format GMLAN seed as 4-char hex", () => {
      const entry = {
        seed: 0x00a1,
        key: 0x00b2,
        seedBytes: new Uint8Array([0x00, 0xa1]),
        keyBytes: new Uint8Array([0x00, 0xb2]),
        securityLevel: 1,
        protocol: "GMLAN" as const,
      };
      expect(LogParser.formatSeed(entry)).toBe("00A1");
      expect(LogParser.formatKey(entry)).toBe("00B2");
    });
  });

  describe("ECU_CAN_IDS", () => {
    it("should have ECM defined", () => {
      expect(ECU_CAN_IDS["7E0"]).toContain("ECM");
    });
  });

  describe("SECURITY_LEVELS", () => {
    it("should have standard level defined", () => {
      expect(SECURITY_LEVELS[0x01]).toBeDefined();
    });
  });
});
