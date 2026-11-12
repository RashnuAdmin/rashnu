import { describe, expect, it } from "vitest";
import { windowStart } from "../lib/rate-limit";

describe("windowStart", () => {
  it("floors a timestamp to the start of its fixed window", () => {
    const now = new Date("2026-11-12T10:15:47.123Z");
    expect(windowStart(now, 60_000).toISOString()).toBe("2026-11-12T10:15:00.000Z");
  });

  it("maps every timestamp in the same window to the same start", () => {
    const start = windowStart(new Date("2026-11-12T10:15:00.000Z"), 60_000);
    const end = windowStart(new Date("2026-11-12T10:15:59.999Z"), 60_000);
    expect(start).toEqual(end);
  });

  it("maps timestamps in adjacent windows to different starts", () => {
    const a = windowStart(new Date("2026-11-12T10:15:59.999Z"), 60_000);
    const b = windowStart(new Date("2026-11-12T10:16:00.000Z"), 60_000);
    expect(a.getTime()).not.toBe(b.getTime());
  });
});
