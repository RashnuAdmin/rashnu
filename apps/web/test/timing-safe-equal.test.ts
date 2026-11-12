import { describe, expect, it } from "vitest";
import { constantTimeEqual } from "../lib/timing-safe-equal";

describe("constantTimeEqual", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqual("my-secret", "my-secret")).toBe(true);
  });

  it("returns false for different strings, including different lengths", () => {
    expect(constantTimeEqual("my-secret", "wrong")).toBe(false);
    expect(constantTimeEqual("short", "a-much-longer-value")).toBe(false);
  });

  it("returns false for an empty string against a non-empty one", () => {
    expect(constantTimeEqual("", "my-secret")).toBe(false);
  });
});
