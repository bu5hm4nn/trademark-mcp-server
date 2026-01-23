import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/__tests__/live/**/*.test.ts"],
    setupFiles: ["./src/__tests__/live/setup.live.ts"],
    // Run sequentially - database tests shouldn't be parallel
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Longer timeout for real database queries
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
