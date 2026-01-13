export class Utils {
  static normalizeSeed(input: string, lengthBytes: number): Uint8Array {
    // Remove 0x prefix and spaces
    const clean = input.replace(/^(0x|0X)/, "").replace(/\s+/g, "");

    // Check if it's hex
    if (!/^[0-9A-Fa-f]+$/.test(clean)) {
      throw new Error(
        `Invalid seed format: must be hex string (got '${input}')`
      );
    }

    // Pad if necessary (though usually we expect exact length or handled by user)
    // The Python `normalize_seed` logic wasn't fully shown but usually implied hex conversion.
    // If length is odd, prepend 0?
    let hex = clean;
    if (hex.length % 2 !== 0) {
      hex = "0" + hex;
    }

    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }

    if (bytes.length !== lengthBytes) {
      throw new Error(
        `Seed length mismatch: expected ${lengthBytes} bytes, got ${bytes.length}`
      );
    }

    return bytes;
  }

  static bytesToInt(bytes: Uint8Array): number {
    let val = 0;
    for (let i = 0; i < bytes.length; i++) {
      val = (val << 8) | bytes[i];
    }
    return val >>> 0; // Ensure unsigned
  }

  static intToBytes(val: number, length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let i = length - 1; i >= 0; i--) {
      bytes[i] = val & 0xff;
      val = val >>> 8;
    }
    return bytes;
  }
}
