/**
 * Cross-platform cryptographic shim
 * Browser-only implementation using Web Crypto API
 */

export const CryptoShim = {
  /**
   * SHA-256 hash using Web Crypto API
   */
  async sha256(data: Uint8Array): Promise<Uint8Array> {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(hashBuffer);
  },

  /**
   * AES-128-ECB Encryption (Block) using Web Crypto API
   * Note: Web Crypto doesn't strictly support ECB for security reasons,
   * but we can simulate a single block encryption using AES-CBC with zero IV
   * or by importing the raw key and encrypting one block.
   * However, for strict compliance with the legacy algos, we might need a custom implementation
   * if the browser blocks ECB. Let's try to use a safe implementation.
   *
   * Actually, for SA015 it's a specific block encryption.
   * Let's stick to the pure JS implementation for exact bit-compatibility if WebCrypto is tricky for ECB,
   * BUT the requirement is to fix timing attacks.
   *
   * Alternative: Use AES-KW (Key Wrap) or AES-GCM if the protocol allows, but we are implementing
   * a specific reverse-engineered protocol, so we must match the exact algorithm (Rijndael).
   *
   * Detailed check: SA015 uses AES-128 to encrypt a constructed block.
   * We can use AES-CBC with IV=0 for a single block (16 bytes) which is mathematically equivalent to ECB for that block.
   */
  async aesEncryptBlock(
    key: Uint8Array,
    block: Uint8Array
  ): Promise<Uint8Array> {
    // Import key for AES-CBC
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "AES-CBC" },
      false,
      ["encrypt"]
    );

    // IV of 16 zeros
    const iv = new Uint8Array(16);

    // Encrypt
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-CBC", iv },
      cryptoKey,
      block
    );

    // AES-CBC with PKCS#7 padding (default in WebCrypto) might add a block.
    // We only want the first 16 bytes if our input is 16 bytes.
    // Wait, Web Crypto AES-CBC insists on padding usually.
    // If we can't disable padding, we might be stuck.
    // Let's check if 'AES-CTR' is better, but CTR is a stream cipher.
    //
    // Actually, if we pass exactly 16 bytes, CBC usually pads to 32 bytes.
    // The first 16 bytes of CBC with IV=0 ARE (Block XOR IV) Encrypted = Block Encrypted.
    // So yes, taking the first 16 bytes of the result works for ECB simulation of a single block.

    return new Uint8Array(encrypted).slice(0, 16);
  },
};
