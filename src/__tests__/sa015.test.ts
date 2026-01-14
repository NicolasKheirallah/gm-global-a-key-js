import { describe, it, expect } from "vitest";
import { createHash, createCipheriv } from "crypto";
import { SA015Engine, PASSWORD_MAP } from "../core";

function deriveKeyNode(algo: number, seed: Uint8Array): Uint8Array {
  const blob = PASSWORD_MAP[algo];
  if (!blob) {
    throw new Error(`Missing blob for algo ${algo}`);
  }

  const payload = blob.substring(2);
  const raw = Buffer.from(payload, "base64");
  if (raw.length !== 44) {
    throw new Error("Invalid payload length");
  }

  const secret = raw.slice(0, 32);
  const minSeed = (raw[32] << 8) | raw[33];

  const seedTail = seed[4];
  const maxSeed = 255 - seedTail;
  if (minSeed > maxSeed) {
    throw new Error("Seed forbidden");
  }

  const iterations = maxSeed - minSeed;

  let digest = Buffer.from(secret);
  for (let i = 0; i < iterations; i++) {
    digest = createHash("sha256").update(digest).digest();
  }

  const aesKey = digest.subarray(0, 16);
  const block = Buffer.alloc(16, 0xff);
  Buffer.from(seed).copy(block, 11);

  const cipher = createCipheriv("aes-128-ecb", aesKey, null);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(block), cipher.final()]);
  return encrypted.subarray(0, 5);
}

describe("SA015Engine", () => {
  it("matches Node crypto reference for known seed/algo", async () => {
    const seed = new Uint8Array([0x8c, 0xe7, 0xd1, 0xfd, 0x06]);
    const algo = 0x00;
    const expected = deriveKeyNode(algo, seed);
    const result = await SA015Engine.deriveKey(algo, seed);
    expect(result.mac).toEqual(new Uint8Array(expected));
  });

  it("matches Node crypto reference for second algorithm", async () => {
    const seed = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x00]);
    const algo = 0x01;
    const expected = deriveKeyNode(algo, seed);
    const result = await SA015Engine.deriveKey(algo, seed);
    expect(result.mac).toEqual(new Uint8Array(expected));
  });
});
