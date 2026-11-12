import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeWinner, hashTickets, main } from "../src/cli";

describe("cli dispatch and validation (no network/filesystem reached)", () => {
  beforeEach(() => {
    process.exitCode = undefined;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("computeWinner sets exitCode 1 on missing flags without touching the network", async () => {
    await computeWinner([]);
    expect(process.exitCode).toBe(1);
  });

  it("hashTickets sets exitCode 1 on a missing --file without touching the filesystem", async () => {
    await hashTickets([]);
    expect(process.exitCode).toBe(1);
  });

  it("main dispatches an unknown command to usage with exitCode 1", async () => {
    await main(["not-a-real-command"]);
    expect(process.exitCode).toBe(1);
  });

  it("main with no command at all also exits 1", async () => {
    await main([]);
    expect(process.exitCode).toBe(1);
  });
});
