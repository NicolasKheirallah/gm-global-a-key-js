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
};
