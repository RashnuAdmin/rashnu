import { describe, expect, it } from "vitest";
import { formatStaleDrawAlert } from "../lib/telegram";

describe("formatStaleDrawAlert", () => {
  it("returns null when nothing is stale, so callers know not to send anything", () => {
    expect(formatStaleDrawAlert([])).toBeNull();
  });

  it("formats a single stale draw", () => {
    const message = formatStaleDrawAlert([{ id: 4, drawNumber: 4, status: "awaiting_block", hoursSinceCutoff: 5.2 }]);
    expect(message).toContain("Draw #4");
    expect(message).toContain("awaiting_block");
    expect(message).toContain("5.2h");
  });

  it("formats multiple stale draws, one line each", () => {
    const message = formatStaleDrawAlert([
      { id: 4, drawNumber: 4, status: "awaiting_block", hoursSinceCutoff: 5.2 },
      { id: 5, drawNumber: 5, status: "funded", hoursSinceCutoff: 10 },
    ]);
    expect(message?.split("\n").filter((l) => l.includes("Draw #"))).toHaveLength(2);
  });
});
