import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Hashing first means both inputs are always 32 bytes, so timingSafeEqual never
 * throws on a length mismatch and the comparison leaks nothing about the real
 * secret's length - a plain `===` would be a per-character timing oracle against
 * a value guarding a public-facing endpoint.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}
