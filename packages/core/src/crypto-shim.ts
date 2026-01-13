export const CryptoShim = {
  sha256: async (data: Uint8Array): Promise<Uint8Array> => {
    if (
      typeof window !== "undefined" &&
      window.crypto &&
      window.crypto.subtle
    ) {
      // Browser
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
      return new Uint8Array(hashBuffer);
    } else {
      // Node.js
      try {
        // Dynamically import crypto to avoid browser bundling issues, assume it exists in Node context
        const { createHash } = await import("node:crypto");
        const hash = createHash("sha256").update(data).digest();
        return new Uint8Array(hash);
      } catch (e) {
        // Fallback for older environments or odd bundler configs
        try {
          const { createHash } = await import("crypto");
          const hash = createHash("sha256").update(data).digest();
          return new Uint8Array(hash);
        } catch (e2) {
          throw new Error("SHA-256 not supported in this environment");
        }
      }
    }
  },

  // For AES, we are porting the pure JS implementation from Python because `subtle.encrypt`
  // requires importing keys which is async and complex for custom raw AES ECB without padding.
  // The Python implementation was "AES-128 no padding".
  // SubtleCrypto AES-CBC with 0 IV might work but ECB is not always supported.
  // Porting the pure JS AES is safer for "educational/exact match" goals.
};
