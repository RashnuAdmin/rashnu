import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // M1 hasn't landed real tests yet (TDD against Bitcoin golden fixtures) -
    // zero tests is the honest state right now, not a failure to paper over.
    passWithNoTests: true,
    // Integration tests hit the real mempool.space API - excluded from the default,
    // CI-run suite (no live network dependency there). Run via `pnpm test:integration`.
    exclude: ["**/node_modules/**", "**/test/integration/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**"],
    },
  },
});
