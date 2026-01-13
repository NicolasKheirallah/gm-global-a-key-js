import { describe, it, expect } from "vitest";
import {
  UDSMessage,
  UDSNegativeResponseError,
  UDS_SID,
  NRC,
  DIAGNOSTIC_SESSION,
  SECURITY_LEVEL,
} from "../core";

describe("UDS Module", () => {
  describe("UDSMessage.parseResponse", () => {
    it("should parse positive response", () => {
      const response = new Uint8Array([0x67, 0x01, 0xa1, 0xb2]);
      const result = UDSMessage.parseResponse(
        response,
        UDS_SID.SECURITY_ACCESS
      );
      expect(result[0]).toBe(0x67);
    });

    it("should throw UDSNegativeResponseError for negative response", () => {
      const response = new Uint8Array([0x7f, 0x27, NRC.INVALID_KEY]);
      expect(() =>
        UDSMessage.parseResponse(response, UDS_SID.SECURITY_ACCESS)
      ).toThrow(UDSNegativeResponseError);
    });

    it("should throw for unexpected SID", () => {
      const response = new Uint8Array([0x50, 0x03]); // 50 = Session response, wrong SID
      expect(() =>
        UDSMessage.parseResponse(response, UDS_SID.SECURITY_ACCESS)
      ).toThrow("Unexpected response SID");
    });
  });

  describe("UDSMessage.buildSeedRequest", () => {
    it("should build correct seed request", () => {
      const request = UDSMessage.buildSeedRequest(SECURITY_LEVEL.LEVEL_01);
      expect(request).toEqual(new Uint8Array([0x27, 0x01]));
    });
  });

  describe("UDSMessage.buildKeyRequest", () => {
    it("should build correct key request", () => {
      const key = new Uint8Array([0xa1, 0xb2]);
      const request = UDSMessage.buildKeyRequest(SECURITY_LEVEL.LEVEL_01, key);
      expect(request).toEqual(new Uint8Array([0x27, 0x02, 0xa1, 0xb2]));
    });
  });

  describe("UDSMessage.buildSessionRequest", () => {
    it("should build extended session request", () => {
      const request = UDSMessage.buildSessionRequest(
        DIAGNOSTIC_SESSION.EXTENDED
      );
      expect(request).toEqual(new Uint8Array([0x10, 0x03]));
    });
  });

  describe("UDSMessage.parseHex", () => {
    it("should parse hex string to bytes", () => {
      expect(UDSMessage.parseHex("A1B2")).toEqual(new Uint8Array([0xa1, 0xb2]));
      expect(UDSMessage.parseHex("0x27 01")).toEqual(
        new Uint8Array([0x27, 0x01])
      );
    });
  });

  describe("UDSNegativeResponseError", () => {
    it("should identify security errors", () => {
      const error = new UDSNegativeResponseError(0x27, NRC.INVALID_KEY);
      expect(error.isSecurityError()).toBe(true);
      expect(error.isLockedOut()).toBe(false);
    });

    it("should identify lockout", () => {
      const error = new UDSNegativeResponseError(
        0x27,
        NRC.EXCEEDED_NUMBER_OF_ATTEMPTS
      );
      expect(error.isLockedOut()).toBe(true);
    });

    it("should identify retryable errors", () => {
      const error = new UDSNegativeResponseError(0x27, NRC.BUSY_REPEAT_REQUEST);
      expect(error.isRetryable()).toBe(true);
    });
  });
});
