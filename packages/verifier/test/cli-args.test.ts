import { describe, expect, it } from "vitest";
import { parseComputeWinnerArgs, parseHashTicketsArgs } from "../src/cli-args";

describe("parseComputeWinnerArgs", () => {
  it("parses all required flags", () => {
    const result = parseComputeWinnerArgs([
      "--cutoff", "1690168628",
      "--rng-n", "3",
      "--confirmations", "6",
      "--tickets", "100",
    ]);

    expect(result).toEqual({
      ok: true,
      cutoffUnixSeconds: 1690168628,
      rngN: 3,
      confirmationsRequired: 6,
      totalTicketsSold: 100,
      source: "mempool-space",
    });
  });

  it("fails when a required flag is missing", () => {
    const result = parseComputeWinnerArgs(["--cutoff", "1", "--rng-n", "3"]);
    expect(result.ok).toBe(false);
  });

  it("fails on an unsupported --source", () => {
    const result = parseComputeWinnerArgs([
      "--cutoff", "1", "--rng-n", "3", "--confirmations", "1", "--tickets", "1",
      "--source", "blockstream",
    ]);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("blockstream") });
  });
});

describe("parseHashTicketsArgs", () => {
  it("parses --file", () => {
    expect(parseHashTicketsArgs(["--file", "/tmp/tickets.json"])).toEqual({
      ok: true,
      file: "/tmp/tickets.json",
    });
  });

  it("fails when --file is missing", () => {
    expect(parseHashTicketsArgs([]).ok).toBe(false);
  });
});
