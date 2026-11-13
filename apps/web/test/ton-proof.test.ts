import { createHash, randomBytes } from "node:crypto";
import { Address } from "@ton/core";
import { sign, keyPairFromSeed } from "@ton/crypto";
import { describe, expect, it } from "vitest";
import { generateTonProofPayload, verifyTonProof, type TonProofReply } from "../lib/ton-proof";

const DOMAIN = "rashnu.io";

/**
 * Builds a validly-signed ton_proof reply the exact way a real wallet does,
 * per the Connect spec (github.com/ton-blockchain/ton-connect,
 * spec/connect.md#address-proof-signature-ton_proof). There's no official
 * published test vector, so these tests verify the algorithm's own
 * properties: a validly-built proof passes, and tampering with any part of
 * it, or signing with the wrong key, breaks it.
 */
function signProof(params: {
  address: Address;
  secretKey: Buffer;
  payload: string;
  domain?: string;
  timestamp?: number;
}): TonProofReply {
  const domain = params.domain ?? DOMAIN;
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);

  const domainBuffer = Buffer.from(domain, "utf8");
  const payloadBuffer = Buffer.from(params.payload, "utf8");

  const workchainBuffer = Buffer.alloc(4);
  workchainBuffer.writeInt32BE(params.address.workChain);

  const domainLenBuffer = Buffer.alloc(4);
  domainLenBuffer.writeUInt32LE(domainBuffer.byteLength);

  const timestampBuffer = Buffer.alloc(8);
  timestampBuffer.writeBigUInt64LE(BigInt(timestamp));

  const message = Buffer.concat([
    Buffer.from("ton-proof-item-v2/"),
    workchainBuffer,
    params.address.hash,
    domainLenBuffer,
    domainBuffer,
    timestampBuffer,
    payloadBuffer,
  ]);

  const digest = createHash("sha256")
    .update(Buffer.concat([Buffer.from([0xff, 0xff]), Buffer.from("ton-connect"), createHash("sha256").update(message).digest()]))
    .digest();

  const signature = sign(digest, params.secretKey);

  return {
    timestamp,
    domain: { lengthBytes: domainBuffer.byteLength, value: domain },
    payload: params.payload,
    signature: signature.toString("base64"),
  };
}

function freshWallet() {
  const keyPair = keyPairFromSeed(randomBytes(32));
  const address = new Address(0, randomBytes(32));
  return { address, keyPair };
}

describe("verifyTonProof", () => {
  it("accepts a validly-signed proof and returns the account's address", () => {
    const { address, keyPair } = freshWallet();
    const payload = generateTonProofPayload();
    const proof = signProof({ address, secretKey: keyPair.secretKey, payload });

    const result = verifyTonProof(
      { address: address.toRawString(), publicKey: keyPair.publicKey.toString("hex") },
      proof,
      payload,
      DOMAIN,
    );

    expect(result).toEqual({ ok: true, address: address.toRawString() });
  });

  it("rejects a proof whose payload doesn't match the one this server issued", () => {
    const { address, keyPair } = freshWallet();
    const payload = generateTonProofPayload();
    const proof = signProof({ address, secretKey: keyPair.secretKey, payload });

    const result = verifyTonProof(
      { address: address.toRawString(), publicKey: keyPair.publicKey.toString("hex") },
      proof,
      generateTonProofPayload(),
      DOMAIN,
    );

    expect(result.ok).toBe(false);
  });

  it("rejects a proof signed for a different domain", () => {
    const { address, keyPair } = freshWallet();
    const payload = generateTonProofPayload();
    const proof = signProof({ address, secretKey: keyPair.secretKey, payload, domain: "evil.example" });

    const result = verifyTonProof(
      { address: address.toRawString(), publicKey: keyPair.publicKey.toString("hex") },
      proof,
      payload,
      DOMAIN,
    );

    expect(result.ok).toBe(false);
  });

  it("rejects a proof signed by a different keypair than the claimed public key", () => {
    const { address, keyPair } = freshWallet();
    const impostor = keyPairFromSeed(randomBytes(32));
    const payload = generateTonProofPayload();
    const proof = signProof({ address, secretKey: impostor.secretKey, payload });

    const result = verifyTonProof(
      { address: address.toRawString(), publicKey: keyPair.publicKey.toString("hex") },
      proof,
      payload,
      DOMAIN,
    );

    expect(result.ok).toBe(false);
  });

  it("rejects a proof for one address when verified against another address's hash", () => {
    const { address, keyPair } = freshWallet();
    const otherAddress = new Address(0, randomBytes(32));
    const payload = generateTonProofPayload();
    const proof = signProof({ address, secretKey: keyPair.secretKey, payload });

    const result = verifyTonProof(
      { address: otherAddress.toRawString(), publicKey: keyPair.publicKey.toString("hex") },
      proof,
      payload,
      DOMAIN,
    );

    expect(result.ok).toBe(false);
  });

  it("rejects an expired proof", () => {
    const { address, keyPair } = freshWallet();
    const payload = generateTonProofPayload();
    const old = Math.floor(Date.now() / 1000) - 3600;
    const proof = signProof({ address, secretKey: keyPair.secretKey, payload, timestamp: old });

    const result = verifyTonProof(
      { address: address.toRawString(), publicKey: keyPair.publicKey.toString("hex") },
      proof,
      payload,
      DOMAIN,
      { maxAgeSeconds: 300 },
    );

    expect(result.ok).toBe(false);
  });

  it("rejects a proof whose signature byte was tampered with", () => {
    const { address, keyPair } = freshWallet();
    const payload = generateTonProofPayload();
    const proof = signProof({ address, secretKey: keyPair.secretKey, payload });

    const sigBytes = Buffer.from(proof.signature, "base64");
    sigBytes[0] = sigBytes[0] ^ 0xff;
    const tampered = { ...proof, signature: sigBytes.toString("base64") };

    const result = verifyTonProof(
      { address: address.toRawString(), publicKey: keyPair.publicKey.toString("hex") },
      tampered,
      payload,
      DOMAIN,
    );

    expect(result.ok).toBe(false);
  });

  it("generateTonProofPayload produces distinct, non-trivial hex nonces", () => {
    const a = generateTonProofPayload();
    const b = generateTonProofPayload();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
