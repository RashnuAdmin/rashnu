import { describe, expect, it } from "vitest";
import { validateCreateDrawInput } from "../lib/validate-draw-input";

const VALID = {
  ticketPriceUsdc: "5000000",
  minTicketsThreshold: 2,
  cutoffAt: "2026-12-01T00:00:00",
  depositAddress: "0x6ea19632bb85c74264ab3340004a16717396643d",
};

describe("validateCreateDrawInput", () => {
  it("accepts valid input and applies RNG defaults", () => {
    const result = validateCreateDrawInput(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ticketPriceUsdc).toBe(5_000_000n);
      expect(result.rngN).toBe(3);
      expect(result.confirmationsRequired).toBe(6);
    }
  });

  it("accepts explicit rngN/confirmationsRequired overrides", () => {
    const result = validateCreateDrawInput({ ...VALID, rngN: 1, confirmationsRequired: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rngN).toBe(1);
      expect(result.confirmationsRequired).toBe(1);
    }
  });

  it("rejects a malformed deposit address instead of silently creating a broken draw", () => {
    const result = validateCreateDrawInput({ ...VALID, depositAddress: "not-an-address" });
    expect(result).toEqual({ ok: false, error: "depositAddress must be a valid Ethereum address" });
  });

  it("rejects a missing/unparseable cutoffAt", () => {
    expect(validateCreateDrawInput({ ...VALID, cutoffAt: "not-a-date" }).ok).toBe(false);
    expect(validateCreateDrawInput({ ...VALID, cutoffAt: undefined }).ok).toBe(false);
  });

  it("rejects a non-numeric ticketPriceUsdc instead of throwing on BigInt()", () => {
    const result = validateCreateDrawInput({ ...VALID, ticketPriceUsdc: "not-a-number" });
    expect(result.ok).toBe(false);
  });

  it("rejects a zero or negative ticketPriceUsdc", () => {
    expect(validateCreateDrawInput({ ...VALID, ticketPriceUsdc: "0" }).ok).toBe(false);
    expect(validateCreateDrawInput({ ...VALID, ticketPriceUsdc: "-5" }).ok).toBe(false);
  });

  it("rejects a non-positive minTicketsThreshold", () => {
    expect(validateCreateDrawInput({ ...VALID, minTicketsThreshold: 0 }).ok).toBe(false);
    expect(validateCreateDrawInput({ ...VALID, minTicketsThreshold: 1.5 }).ok).toBe(false);
  });

  it("rejects a non-positive rngN or confirmationsRequired", () => {
    expect(validateCreateDrawInput({ ...VALID, rngN: 0 }).ok).toBe(false);
    expect(validateCreateDrawInput({ ...VALID, confirmationsRequired: -1 }).ok).toBe(false);
  });
});
