import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/*/test/**/*.test.ts", "apps/hub/hebergement/**/test/**/*.test.ts"],
    pool: "forks",
    testTimeout: 30_000,
  },
});
