import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["node_modules", "dist", "src/__tests__/live/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        "src/**/*.d.ts",
        "src/bin.ts",
        "src/server.ts",
        "src/index.ts", // Thin wrappers only - actual logic is in tools.ts
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 75,
        statements: 100,
      },
    },
    // Run tests in sequence to avoid module caching issues
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Timeout for long-running tests
    testTimeout: 10000,
    // Hook timeout
    hookTimeout: 10000,
  },
})
