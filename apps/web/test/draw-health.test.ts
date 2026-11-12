import { describe, expect, it } from "vitest";
import { findStaleDraws } from "../lib/draw-health";

const HOUR = 60 * 60 * 1000;

describe("findStaleDraws", () => {
  const now = new Date("2026-11-12T10:00:00Z");

  it("flags a non-terminal draw whose cutoff passed longer ago than the threshold", () => {
    const draws = [{ id: 1, drawNumber: 4, status: "awaiting_block", cutoffAt: new Date("2026-11-12T06:00:00Z") }];
    const result = findStaleDraws(draws, now, 3 * HOUR);
    expect(result).toEqual([
      { id: 1, drawNumber: 4, status: "awaiting_block", hoursSinceCutoff: 4 },
    ]);
  });

  it("does not flag a draw within the threshold", () => {
    const draws = [{ id: 1, drawNumber: 4, status: "awaiting_block", cutoffAt: new Date("2026-11-12T08:00:00Z") }];
    expect(findStaleDraws(draws, now, 3 * HOUR)).toEqual([]);
  });

  it("does not flag selling/scheduled draws, even long past a future cutoff check makes no sense for", () => {
    const draws = [{ id: 1, drawNumber: 4, status: "selling", cutoffAt: new Date("2026-11-12T06:00:00Z") }];
    expect(findStaleDraws(draws, now, 3 * HOUR)).toEqual([]);
  });

  it("does not flag terminal draws (settled, rolled_over)", () => {
    const draws = [
      { id: 1, drawNumber: 2, status: "settled", cutoffAt: new Date("2026-11-11T06:00:00Z") },
      { id: 2, drawNumber: 3, status: "rolled_over", cutoffAt: new Date("2026-11-11T06:00:00Z") },
    ];
    expect(findStaleDraws(draws, now, 3 * HOUR)).toEqual([]);
  });
});
