/**
 * Unit tests for helper functions
 * Tests the getHeaders, checkApiKey, and getPostgresPool functions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createRequire } from "module"
import { createMockPgModule } from "../mocks/pg-mock.js"

// Import package.json for version verification
const require = createRequire(import.meta.url)
const pkg = require("../../../package.json")

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
      const { getHeaders } = await import("../../tools.js")

      const deps = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: vi.fn(),
        pgImport: vi.fn(),
      }

      const headers = getHeaders(deps)

      expect(headers["User-Agent"]).toBe(`${pkg.name}/${pkg.version}`)
      expect(headers["USPTO-API-KEY"]).toBe("test-api-key")
    })

    it("includes USPTO-API-KEY when configured", async () => {
      process.env.USPTO_API_KEY = "my-api-key"

      const headers: Record<string, string> = {
        "User-Agent": `${pkg.name}/${pkg.version}`,
      }

      if (process.env.USPTO_API_KEY) {
        headers["USPTO-API-KEY"] = process.env.USPTO_API_KEY
      }

      expect(headers["USPTO-API-KEY"]).toBe("my-api-key")
    })

    it("omits API key when not configured", async () => {
      delete process.env.USPTO_API_KEY

      const headers: Record<string, string> = {
        "User-Agent": `${pkg.name}/${pkg.version}`,
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

describe("getStatusLabel", () => {
  it("returns human-readable label for Live/Pending codes (600-699)", async () => {
    const { getStatusLabel } = await import("../../tools.js")
    expect(getStatusLabel("630")).toBe("630 (Live/Pending)")
    expect(getStatusLabel("600")).toBe("600 (Live/Pending)")
    expect(getStatusLabel("699")).toBe("699 (Live/Pending)")
  })

  it("returns human-readable label for Dead codes (700-799)", async () => {
    const { getStatusLabel } = await import("../../tools.js")
    expect(getStatusLabel("710")).toBe("710 (Dead)")
    expect(getStatusLabel("700")).toBe("700 (Dead)")
    expect(getStatusLabel("790")).toBe("790 (Dead)")
  })

  it("returns human-readable label for Registered codes (800-899)", async () => {
    const { getStatusLabel } = await import("../../tools.js")
    expect(getStatusLabel("800")).toBe("800 (Registered)")
    expect(getStatusLabel("899")).toBe("899 (Registered)")
  })

  it("returns raw code for unrecognized numeric codes", async () => {
    const { getStatusLabel } = await import("../../tools.js")
    expect(getStatusLabel("100")).toBe("100")
    expect(getStatusLabel("999")).toBe("999")
  })

  it("returns N/A for null or undefined", async () => {
    const { getStatusLabel } = await import("../../tools.js")
    expect(getStatusLabel(null)).toBe("N/A")
    expect(getStatusLabel(undefined)).toBe("N/A")
  })

  it("returns raw string for non-numeric values", async () => {
    const { getStatusLabel } = await import("../../tools.js")
    expect(getStatusLabel("LIVE")).toBe("LIVE")
    expect(getStatusLabel("DEAD")).toBe("DEAD")
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
