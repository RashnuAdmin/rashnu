import { randomBytes, createHash } from "node:crypto";
import { Address } from "@ton/core";
import { signVerify } from "@ton/crypto";

export interface TonProofDomain {
  lengthBytes: number;
  value: string;
}

export interface TonProofReply {
  timestamp: number;
  domain: TonProofDomain;
  payload: string;
  /** Base64-encoded Ed25519 signature, as returned by the wallet. */
  signature: string;
}

export interface TonProofAccount {
  /** Raw `<workchain>:<hex>` form, exactly as TonConnect's `Account.address`. */
  address: string;
  /**
   * Hex-encoded Ed25519 public key advertised by the wallet at connect time.
   *
   * KNOWN SIMPLIFICATION (v1, documented on purpose - see docs/ton-pool.md):
   * @tonconnect/sdk's own type definitions mark this field as "not
   * authoritative" and say to re-derive the key from `Account.walletStateInit`
   * or by calling `get_public_key()` on the wallet contract on-chain instead.
   * Both of those are the "correct" approach but non-trivial (StateInit layout
   * differs per wallet version; there is no verified helper that extracts a
   * public key from an arbitrary StateInit cell in @ton/ton as of this
   * writing). For v1 we trust this field directly and rely on TonConnect's
   * bridge/session security instead. Revisit before mainnet.
   */
  publicKey: string;
}

export type VerifyTonProofResult =
  | { ok: true; address: string }
  | { ok: false; error: string };

export function generateTonProofPayload(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Verifies a TonConnect `ton_proof` reply per the Connect spec's address-proof
 * signature algorithm (github.com/ton-blockchain/ton-connect, spec/connect.md
 * #address-proof-signature-ton_proof):
 *
 *   message = "ton-proof-item-v2/" ++ workchain(4B BE) ++ addressHash(32B)
 *              ++ domainLen(4B LE) ++ domainUTF8 ++ timestamp(8B LE) ++ payloadUTF8
 *   digest  = sha256(0xffff ++ "ton-connect" ++ sha256(message))
 *
 * `domainLen` is always recomputed from the actual byte length of
 * `proof.domain.value` here, never taken from `proof.domain.lengthBytes` as
 * supplied - a caller-supplied length that didn't match what the wallet
 * actually signed would just make the signature fail to verify, which is the
 * safe outcome, so trusting the supplied field buys nothing.
 */
export function verifyTonProof(
  account: TonProofAccount,
  proof: TonProofReply,
  expectedPayload: string,
  expectedDomain: string,
  options: { maxAgeSeconds?: number } = {},
): VerifyTonProofResult {
  if (proof.payload !== expectedPayload) {
    return { ok: false, error: "payload does not match the one this server issued" };
  }

  if (proof.domain.value !== expectedDomain) {
    return { ok: false, error: `unexpected domain: ${proof.domain.value}` };
  }

  const maxAgeSeconds = options.maxAgeSeconds ?? 300;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - proof.timestamp > maxAgeSeconds) {
    return { ok: false, error: "proof expired" };
  }

  let address: Address;
  try {
    address = Address.parseRaw(account.address);
  } catch {
    return { ok: false, error: "malformed account address" };
  }

  const domainBuffer = Buffer.from(proof.domain.value, "utf8");
  const payloadBuffer = Buffer.from(proof.payload, "utf8");

  const workchainBuffer = Buffer.alloc(4);
  workchainBuffer.writeInt32BE(address.workChain);

  const domainLenBuffer = Buffer.alloc(4);
  domainLenBuffer.writeUInt32LE(domainBuffer.byteLength);

  const timestampBuffer = Buffer.alloc(8);
  timestampBuffer.writeBigUInt64LE(BigInt(proof.timestamp));

  const message = Buffer.concat([
    Buffer.from("ton-proof-item-v2/"),
    workchainBuffer,
    address.hash,
    domainLenBuffer,
    domainBuffer,
    timestampBuffer,
    payloadBuffer,
  ]);

  const digest = createHash("sha256")
    .update(Buffer.concat([Buffer.from([0xff, 0xff]), Buffer.from("ton-connect"), createHash("sha256").update(message).digest()]))
    .digest();

  let signature: Buffer;
  let publicKey: Buffer;
  try {
    signature = Buffer.from(proof.signature, "base64");
    publicKey = Buffer.from(account.publicKey, "hex");
  } catch {
    return { ok: false, error: "malformed signature or public key" };
  }

  if (publicKey.byteLength !== 32 || !signVerify(digest, signature, publicKey)) {
    return { ok: false, error: "signature verification failed" };
  }

  return { ok: true, address: account.address };
}
