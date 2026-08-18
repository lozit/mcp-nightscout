import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The server talks JSON-RPC on stdout; tests must never inherit a reporter
    // that writes there for machine consumption. Default reporter is fine —
    // this is a note for whoever is tempted to add a stdout-based one.
    environment: "node",
  },
});
