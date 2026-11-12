import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: ["esm"],
  // Only the library entry needs a .d.ts - the CLI is invoked, never imported.
  dts: { entry: { index: "src/index.ts" } },
  clean: true,
  sourcemap: true,
  platform: "node",
  target: "node20",
});
