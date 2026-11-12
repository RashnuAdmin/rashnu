import { describe, expect, it } from "vitest";
import { isAdminSecretValid, isAdminWallet } from "../lib/admin-auth";

describe("isAdminSecretValid", () => {
  it("accepts a header matching ADMIN_SECRET exactly", () => {
    process.env.ADMIN_SECRET = "correct-secret";
    expect(isAdminSecretValid("correct-secret")).toBe(true);
  });

  it("rejects a wrong or missing header", () => {
    process.env.ADMIN_SECRET = "correct-secret";
    expect(isAdminSecretValid("wrong-secret")).toBe(false);
    expect(isAdminSecretValid(null)).toBe(false);
  });

  it("throws if ADMIN_SECRET itself isn't configured", () => {
    delete process.env.ADMIN_SECRET;
    expect(() => isAdminSecretValid("anything")).toThrow(/ADMIN_SECRET/);
  });
});

describe("isAdminWallet", () => {
  it("accepts a wallet address on the allowlist, case-insensitively", () => {
    process.env.ADMIN_WALLET_ADDRESSES = "0xAbC1230000000000000000000000000000000000,0xdef0000000000000000000000000000000000000";
    expect(isAdminWallet("0xabc1230000000000000000000000000000000000")).toBe(true);
    expect(isAdminWallet("0xABC1230000000000000000000000000000000000")).toBe(true);
  });

  it("rejects a wallet address not on the allowlist", () => {
    process.env.ADMIN_WALLET_ADDRESSES = "0xabc1230000000000000000000000000000000000";
    expect(isAdminWallet("0x9990000000000000000000000000000000000000")).toBe(false);
  });

  it("rejects undefined/empty input without throwing", () => {
    process.env.ADMIN_WALLET_ADDRESSES = "0xabc1230000000000000000000000000000000000";
    expect(isAdminWallet(undefined)).toBe(false);
    expect(isAdminWallet("")).toBe(false);
  });

  it("returns false (not throw) when ADMIN_WALLET_ADDRESSES isn't configured", () => {
    delete process.env.ADMIN_WALLET_ADDRESSES;
    expect(isAdminWallet("0xabc1230000000000000000000000000000000000")).toBe(false);
  });

  it("ignores whitespace around entries in the allowlist", () => {
    process.env.ADMIN_WALLET_ADDRESSES = " 0xabc1230000000000000000000000000000000000 , 0xdef0000000000000000000000000000000000000 ";
    expect(isAdminWallet("0xabc1230000000000000000000000000000000000")).toBe(true);
    expect(isAdminWallet("0xdef0000000000000000000000000000000000000")).toBe(true);
  });
});
