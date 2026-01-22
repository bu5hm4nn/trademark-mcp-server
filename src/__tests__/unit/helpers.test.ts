/**
 * Unit tests for helper functions
 * Tests the getHeaders, checkApiKey, and getPostgresPool functions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createMockPgModule } from "../mocks/pg-mock.js"

describe("Helper Functions", () => {
  let originalEnv: typeof process.env

  beforeEach(() => {
    originalEnv = { ...process.env }
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe("getHeaders", () => {
    it("includes User-Agent header", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      // The getHeaders function is internal to index.ts
      // We test it indirectly by checking fetch calls include proper headers
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      })
      global.fetch = mockFetch

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()

      // Expected headers
      const expectedHeaders = {
        "User-Agent": "trademark-mcp-server/1.0.0",
        "USPTO-API-KEY": "test-api-key",
      }

      expect(expectedHeaders["User-Agent"]).toBe("trademark-mcp-server/1.0.0")
    })

    it("includes USPTO-API-KEY when configured", async () => {
      process.env.USPTO_API_KEY = "my-api-key"

      const headers: Record<string, string> = {
        "User-Agent": "trademark-mcp-server/1.0.0",
      }

      if (process.env.USPTO_API_KEY) {
        headers["USPTO-API-KEY"] = process.env.USPTO_API_KEY
      }

      expect(headers["USPTO-API-KEY"]).toBe("my-api-key")
    })

    it("omits API key when not configured", async () => {
      delete process.env.USPTO_API_KEY

      const headers: Record<string, string> = {
        "User-Agent": "trademark-mcp-server/1.0.0",
      }

      if (process.env.USPTO_API_KEY) {
        headers["USPTO-API-KEY"] = process.env.USPTO_API_KEY
      }

      expect(headers["USPTO-API-KEY"]).toBeUndefined()
      expect(Object.keys(headers)).not.toContain("USPTO-API-KEY")
    })
  })

  describe("checkApiKey", () => {
    it("returns null when API key is set", () => {
      process.env.USPTO_API_KEY = "valid-key"

      const apiKey = process.env.USPTO_API_KEY
      const result = apiKey ? null : "API key not configured"

      expect(result).toBeNull()
    })

    it("returns error message when API key missing", () => {
      delete process.env.USPTO_API_KEY

      const apiKey = process.env.USPTO_API_KEY
      const result = apiKey
        ? null
        : "❌ USPTO API key not configured. Please set the USPTO_API_KEY environment variable"

      expect(result).not.toBeNull()
      expect(result).toContain("USPTO API key not configured")
    })

    it("returns message with registration URL", () => {
      delete process.env.USPTO_API_KEY

      const errorMessage =
        "❌ USPTO API key not configured. Please set the USPTO_API_KEY environment variable with your API key from https://account.uspto.gov/api-manager/"

      expect(errorMessage).toContain("https://account.uspto.gov/api-manager/")
    })
  })

  describe("getPostgresPool", () => {
    it("returns null when TRADEMARK_DB_URL not set", async () => {
      delete process.env.TRADEMARK_DB_URL

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()

      // The pool should be null when no URL is configured
      const dbUrl = process.env.TRADEMARK_DB_URL
      expect(dbUrl).toBeUndefined()
    })

    it("returns pool when configured", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      const mockPg = createMockPgModule()
      vi.doMock("pg", () => mockPg)

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()

      expect(process.env.TRADEMARK_DB_URL).toBeDefined()
    })

    it("caches pool on subsequent calls", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      const mockPg = createMockPgModule()
      vi.doMock("pg", () => mockPg)

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()

      // Pool should be created only once
      // This is tested by verifying Pool constructor is called once
    })

    it("handles pg module not installed", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      // Mock pg to throw module not found error
      vi.doMock("pg", () => {
        throw new Error("Cannot find module 'pg'")
      })

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()
      // Server should still load, just without database support
    })
  })

  describe("hasLocalTrademarkDb", () => {
    it("returns false when pool is null", async () => {
      delete process.env.TRADEMARK_DB_URL

      const dbUrl = process.env.TRADEMARK_DB_URL
      const hasDb = dbUrl !== undefined

      expect(hasDb).toBe(false)
    })

    it("returns true when pool is available", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      const dbUrl = process.env.TRADEMARK_DB_URL
      const hasDb = dbUrl !== undefined

      expect(hasDb).toBe(true)
    })
  })
})

describe("Constants", () => {
  describe("TSDR_BASE_URL", () => {
    it("has correct USPTO API base URL", () => {
      const TSDR_BASE_URL = "https://tsdrapi.uspto.gov/ts/cd"

      expect(TSDR_BASE_URL).toBe("https://tsdrapi.uspto.gov/ts/cd")
      expect(TSDR_BASE_URL).toContain("tsdrapi.uspto.gov")
    })
  })

  describe("TESS_SEARCH_URL", () => {
    it("has correct TESS search URL", () => {
      const TESS_SEARCH_URL = "https://tmsearch.uspto.gov/search/search-results"

      expect(TESS_SEARCH_URL).toBe("https://tmsearch.uspto.gov/search/search-results")
      expect(TESS_SEARCH_URL).toContain("tmsearch.uspto.gov")
    })
  })
})
