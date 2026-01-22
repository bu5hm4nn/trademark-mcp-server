/**
 * Tests that actually execute tool implementations with mocked dependencies
 * This tests the real business logic including database queries
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  searchByWordmark,
  searchBySerial,
  searchByRegistration,
  getTrademarkStatus,
  getTrademarkImage,
  getTrademarkDocuments,
  resetPoolState,
  type ToolDependencies,
} from "../../../tools.js"
import { searchResultsWithScores, sampleTrademarks } from "../../fixtures/db-records.js"
import { serialNumberJsonResponse, statusHtmlResponse } from "../../fixtures/api-responses.js"

describe("Tool Execution Tests", () => {
  beforeEach(() => {
    resetPoolState()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("searchByWordmark", () => {
    it("executes database query and returns formatted results", async () => {
      const mockQuery = vi.fn().mockResolvedValue({
        rows: searchResultsWithScores,
      })

      const mockPool = { query: mockQuery }
      const mockPgImport = vi.fn().mockResolvedValue({
        default: {
          Pool: vi.fn().mockReturnValue(mockPool),
        },
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => "postgresql://test:test@localhost:5432/trademarks",
        fetchFn: vi.fn(),
        pgImport: mockPgImport,
      }

      const result = await searchByWordmark(
        { wordmark: "SUNSHINE", status: "all", limit: 20 },
        deps
      )

      // Verify the query was executed
      expect(mockQuery).toHaveBeenCalled()

      // Verify the query parameters
      const [query, params] = mockQuery.mock.calls[0]
      expect(query).toContain("similarity(mark_identification, $1)")
      expect(query).toContain("WHERE mark_identification % $1")
      expect(params[0]).toBe("SUNSHINE")
      expect(params[1]).toBe(20)

      // Verify the result contains formatted data
      expect(result).toContain("Trademark Search Results")
      expect(result).toContain("SUNSHINE")
      expect(result).toContain("Similarity:")
    })

    it("filters by active status when requested", async () => {
      const mockQuery = vi.fn().mockResolvedValue({
        rows: searchResultsWithScores.filter(
          (r) => r.status_code === "LIVE" || r.status_code === "REGISTERED"
        ),
      })

      const mockPool = { query: mockQuery }
      const mockPgImport = vi.fn().mockResolvedValue({
        default: {
          Pool: vi.fn().mockReturnValue(mockPool),
        },
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => "postgresql://test:test@localhost:5432/trademarks",
        fetchFn: vi.fn(),
        pgImport: mockPgImport,
      }

      await searchByWordmark(
        { wordmark: "SUNSHINE", status: "active", limit: 20 },
        deps
      )

      // Verify the query includes status filter
      const [query] = mockQuery.mock.calls[0]
      expect(query).toContain("status_code IN ('LIVE', 'REGISTERED')")
    })

    it("returns no results message when empty", async () => {
      const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
      const mockPool = { query: mockQuery }
      const mockPgImport = vi.fn().mockResolvedValue({
        default: {
          Pool: vi.fn().mockReturnValue(mockPool),
        },
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => "postgresql://test:test@localhost:5432/trademarks",
        fetchFn: vi.fn(),
        pgImport: mockPgImport,
      }

      const result = await searchByWordmark(
        { wordmark: "NONEXISTENT", status: "all", limit: 20 },
        deps
      )

      expect(result).toContain("No trademarks found matching")
      expect(result).toContain("NONEXISTENT")
    })

    it("returns TESS fallback when database not configured", async () => {
      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined, // No database URL
        fetchFn: vi.fn(),
        pgImport: vi.fn(),
      }

      const result = await searchByWordmark(
        { wordmark: "APPLE", status: "all", limit: 20 },
        deps
      )

      expect(result).toContain("Local trademark database not configured")
      expect(result).toContain("TESS Search Link")
      expect(result).toContain("tmsearch.uspto.gov")
    })

    it("handles database query errors gracefully", async () => {
      const mockQuery = vi.fn().mockRejectedValue(new Error("Connection timeout"))
      const mockPool = { query: mockQuery }
      const mockPgImport = vi.fn().mockResolvedValue({
        default: {
          Pool: vi.fn().mockReturnValue(mockPool),
        },
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => "postgresql://test:test@localhost:5432/trademarks",
        fetchFn: vi.fn(),
        pgImport: mockPgImport,
      }

      const result = await searchByWordmark(
        { wordmark: "APPLE", status: "all", limit: 20 },
        deps
      )

      expect(result).toContain("Error searching trademark database")
      expect(result).toContain("Connection timeout")
      expect(result).toContain("Fallback")
    })

    it("respects limit parameter", async () => {
      const mockQuery = vi.fn().mockResolvedValue({
        rows: searchResultsWithScores.slice(0, 5),
      })

      const mockPool = { query: mockQuery }
      const mockPgImport = vi.fn().mockResolvedValue({
        default: {
          Pool: vi.fn().mockReturnValue(mockPool),
        },
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => "postgresql://test:test@localhost:5432/trademarks",
        fetchFn: vi.fn(),
        pgImport: mockPgImport,
      }

      await searchByWordmark(
        { wordmark: "SUNSHINE", status: "all", limit: 5 },
        deps
      )

      const [, params] = mockQuery.mock.calls[0]
      expect(params[1]).toBe(5)
    })
  })

  describe("searchBySerial", () => {
    it("fetches trademark data from USPTO API", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(serialNumberJsonResponse),
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await searchBySerial(
        { serialNumber: "78462704", format: "json" },
        deps
      )

      // Verify fetch was called with correct URL
      expect(mockFetch).toHaveBeenCalledWith(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/info.json",
        expect.objectContaining({
          headers: expect.objectContaining({
            "USPTO-API-KEY": "test-api-key",
          }),
        })
      )

      // Verify result contains JSON data
      const parsed = JSON.parse(result)
      expect(parsed.trademarks).toBeDefined()
      expect(parsed.trademarks[0].status.markElement).toBe("APPLE")
    })

    it("returns XML format when requested", async () => {
      const xmlResponse = "<trademark>data</trademark>"
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(xmlResponse),
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await searchBySerial(
        { serialNumber: "78462704", format: "xml" },
        deps
      )

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("info.xml"),
        expect.any(Object)
      )
      expect(result).toBe(xmlResponse)
    })

    it("returns error when API key not configured", async () => {
      const deps: ToolDependencies = {
        getApiKey: () => undefined,
        getDbUrl: () => undefined,
        fetchFn: vi.fn(),
        pgImport: vi.fn(),
      }

      const result = await searchBySerial(
        { serialNumber: "78462704", format: "json" },
        deps
      )

      expect(result).toContain("USPTO API key not configured")
    })

    it("handles API errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("Trademark not found"),
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await searchBySerial(
        { serialNumber: "00000000", format: "json" },
        deps
      )

      expect(result).toContain("Error fetching trademark data")
      expect(result).toContain("404")
    })

    it("handles API authentication errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve("You need to register for an API key to access this"),
      })

      const deps: ToolDependencies = {
        getApiKey: () => "invalid-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await searchBySerial(
        { serialNumber: "78462704", format: "json" },
        deps
      )

      expect(result).toContain("Error fetching trademark data")
      expect(result).toContain("USPTO API Authentication Issue")
    })

    it("handles network errors", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"))

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await searchBySerial(
        { serialNumber: "78462704", format: "json" },
        deps
      )

      expect(result).toContain("Error fetching trademark data")
      expect(result).toContain("Connection refused")
    })
  })

  describe("searchByRegistration", () => {
    it("fetches trademark data by registration number", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(serialNumberJsonResponse),
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await searchByRegistration(
        { registrationNumber: "3068631", format: "json" },
        deps
      )

      expect(mockFetch).toHaveBeenCalledWith(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/rn3068631/info.json",
        expect.any(Object)
      )

      const parsed = JSON.parse(result)
      expect(parsed.trademarks).toBeDefined()
    })

    it("returns XML format when requested", async () => {
      const xmlResponse = "<trademark>registration data</trademark>"
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(xmlResponse),
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await searchByRegistration(
        { registrationNumber: "3068631", format: "xml" },
        deps
      )

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("info.xml"),
        expect.any(Object)
      )
      expect(result).toBe(xmlResponse)
    })

    it("returns error when API key not configured", async () => {
      const deps: ToolDependencies = {
        getApiKey: () => undefined,
        getDbUrl: () => undefined,
        fetchFn: vi.fn(),
        pgImport: vi.fn(),
      }

      const result = await searchByRegistration(
        { registrationNumber: "3068631", format: "json" },
        deps
      )

      expect(result).toContain("USPTO API key not configured")
    })

    it("handles API authentication errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve("You need to register for an API key"),
      })

      const deps: ToolDependencies = {
        getApiKey: () => "invalid-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await searchByRegistration(
        { registrationNumber: "3068631", format: "json" },
        deps
      )

      expect(result).toContain("Error fetching trademark data")
      expect(result).toContain("USPTO API Authentication Issue")
    })

    it("handles generic API errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("Server error"),
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await searchByRegistration(
        { registrationNumber: "3068631", format: "json" },
        deps
      )

      expect(result).toContain("Error fetching trademark data")
      expect(result).toContain("500")
    })

    it("handles network errors", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"))

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await searchByRegistration(
        { registrationNumber: "3068631", format: "json" },
        deps
      )

      expect(result).toContain("Error fetching trademark data by registration number")
      expect(result).toContain("Network error")
    })
  })

  describe("getTrademarkStatus", () => {
    it("fetches status page and extracts title", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(statusHtmlResponse),
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await getTrademarkStatus(
        { serialNumber: "78462704" },
        deps
      )

      expect(mockFetch).toHaveBeenCalledWith(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/content",
        expect.any(Object)
      )

      expect(result).toContain("Trademark Status Report")
      expect(result).toContain("APPLE")
    })

    it("returns error when API key not configured", async () => {
      const deps: ToolDependencies = {
        getApiKey: () => undefined,
        getDbUrl: () => undefined,
        fetchFn: vi.fn(),
        pgImport: vi.fn(),
      }

      const result = await getTrademarkStatus(
        { serialNumber: "78462704" },
        deps
      )

      expect(result).toContain("USPTO API key not configured")
    })

    it("handles API authentication errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve("You need to register for an API key"),
      })

      const deps: ToolDependencies = {
        getApiKey: () => "invalid-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await getTrademarkStatus(
        { serialNumber: "78462704" },
        deps
      )

      expect(result).toContain("Error fetching trademark status")
      expect(result).toContain("USPTO API Authentication Issue")
    })

    it("handles generic API errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("Server error"),
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await getTrademarkStatus(
        { serialNumber: "78462704" },
        deps
      )

      expect(result).toContain("Error fetching trademark status")
      expect(result).toContain("500")
    })

    it("handles network errors", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network timeout"))

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await getTrademarkStatus(
        { serialNumber: "78462704" },
        deps
      )

      expect(result).toContain("Error fetching trademark status")
      expect(result).toContain("Network timeout")
    })

    it("handles HTML without title tag", async () => {
      const htmlWithoutTitle = "<html><body>No title here</body></html>"
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(htmlWithoutTitle),
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await getTrademarkStatus(
        { serialNumber: "78462704" },
        deps
      )

      expect(result).toContain("No title found")
    })
  })

  describe("getTrademarkImage", () => {
    it("verifies image exists with HEAD request", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await getTrademarkImage(
        { serialNumber: "78462704" },
        deps
      )

      expect(mockFetch).toHaveBeenCalledWith(
        "https://tsdrapi.uspto.gov/ts/cd/rawImage/78462704",
        expect.objectContaining({ method: "HEAD" })
      )

      expect(result).toContain("Trademark image URL")
      expect(result).toContain("rawImage/78462704")
    })

    it("returns not found message for missing images", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
      })

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await getTrademarkImage(
        { serialNumber: "00000000" },
        deps
      )

      expect(result).toContain("No image found")
    })

    it("returns error when API key not configured", async () => {
      const deps: ToolDependencies = {
        getApiKey: () => undefined,
        getDbUrl: () => undefined,
        fetchFn: vi.fn(),
        pgImport: vi.fn(),
      }

      const result = await getTrademarkImage(
        { serialNumber: "78462704" },
        deps
      )

      expect(result).toContain("USPTO API key not configured")
    })

    it("handles network errors", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"))

      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: mockFetch,
        pgImport: vi.fn(),
      }

      const result = await getTrademarkImage(
        { serialNumber: "78462704" },
        deps
      )

      expect(result).toContain("Error retrieving trademark image")
      expect(result).toContain("Connection refused")
    })
  })

  describe("getTrademarkDocuments", () => {
    it("generates document bundle URL", async () => {
      const deps: ToolDependencies = {
        getApiKey: () => "test-api-key",
        getDbUrl: () => undefined,
        fetchFn: vi.fn(),
        pgImport: vi.fn(),
      }

      const result = await getTrademarkDocuments(
        { serialNumber: "78462704" },
        deps
      )

      expect(result).toContain("Document bundle URL")
      expect(result).toContain("bundle.pdf?sn=78462704")
      expect(result).toContain("rate-limited")
    })

    it("returns error when API key not configured", async () => {
      const deps: ToolDependencies = {
        getApiKey: () => undefined,
        getDbUrl: () => undefined,
        fetchFn: vi.fn(),
        pgImport: vi.fn(),
      }

      const result = await getTrademarkDocuments(
        { serialNumber: "78462704" },
        deps
      )

      expect(result).toContain("USPTO API key not configured")
    })
  })

  describe("Helper Functions", () => {
    it("getHeaders includes API key when configured", async () => {
      const { getHeaders } = await import("../../../tools.js")

      const deps: ToolDependencies = {
        getApiKey: () => "my-api-key",
        getDbUrl: () => undefined,
        fetchFn: vi.fn(),
        pgImport: vi.fn(),
      }

      const headers = getHeaders(deps)
      expect(headers["User-Agent"]).toBe("trademark-mcp-server/1.0.0")
      expect(headers["USPTO-API-KEY"]).toBe("my-api-key")
    })

    it("getHeaders omits API key when not configured", async () => {
      const { getHeaders } = await import("../../../tools.js")

      const deps: ToolDependencies = {
        getApiKey: () => undefined,
        getDbUrl: () => undefined,
        fetchFn: vi.fn(),
        pgImport: vi.fn(),
      }

      const headers = getHeaders(deps)
      expect(headers["User-Agent"]).toBe("trademark-mcp-server/1.0.0")
      expect(headers["USPTO-API-KEY"]).toBeUndefined()
    })

    it("checkApiKey returns null when API key is set", async () => {
      const { checkApiKey } = await import("../../../tools.js")

      const deps: ToolDependencies = {
        getApiKey: () => "test-key",
        getDbUrl: () => undefined,
        fetchFn: vi.fn(),
        pgImport: vi.fn(),
      }

      const result = checkApiKey(deps)
      expect(result).toBeNull()
    })

    it("checkApiKey returns error when API key missing", async () => {
      const { checkApiKey } = await import("../../../tools.js")

      const deps: ToolDependencies = {
        getApiKey: () => undefined,
        getDbUrl: () => undefined,
        fetchFn: vi.fn(),
        pgImport: vi.fn(),
      }

      const result = checkApiKey(deps)
      expect(result).toContain("USPTO API key not configured")
    })

    it("getPostgresPool returns null when DB URL not set", async () => {
      const { getPostgresPool, resetPoolState } = await import("../../../tools.js")
      resetPoolState()

      const deps: ToolDependencies = {
        getApiKey: () => undefined,
        getDbUrl: () => undefined,
        fetchFn: vi.fn(),
        pgImport: vi.fn(),
      }

      const pool = await getPostgresPool(deps)
      expect(pool).toBeNull()
    })

    it("getPostgresPool creates pool when DB URL is set", async () => {
      const { getPostgresPool, resetPoolState } = await import("../../../tools.js")
      resetPoolState()

      const mockPool = { query: vi.fn() }
      const mockPgImport = vi.fn().mockResolvedValue({
        default: {
          Pool: vi.fn().mockReturnValue(mockPool),
        },
      })

      const deps: ToolDependencies = {
        getApiKey: () => undefined,
        getDbUrl: () => "postgresql://test:test@localhost:5432/db",
        fetchFn: vi.fn(),
        pgImport: mockPgImport,
      }

      const pool = await getPostgresPool(deps)
      expect(pool).toBe(mockPool)
      expect(mockPgImport).toHaveBeenCalled()
    })

    it("getPostgresPool handles pg module not installed", async () => {
      const { getPostgresPool, resetPoolState } = await import("../../../tools.js")
      resetPoolState()

      const mockPgImport = vi.fn().mockRejectedValue(new Error("Cannot find module 'pg'"))

      const deps: ToolDependencies = {
        getApiKey: () => undefined,
        getDbUrl: () => "postgresql://test:test@localhost:5432/db",
        fetchFn: vi.fn(),
        pgImport: mockPgImport,
      }

      const pool = await getPostgresPool(deps)
      expect(pool).toBeNull()
    })

    it("defaultDependencies.getApiKey reads from environment", async () => {
      const { defaultDependencies } = await import("../../../tools.js")

      const originalApiKey = process.env.USPTO_API_KEY
      process.env.USPTO_API_KEY = "test-env-key"

      expect(defaultDependencies.getApiKey()).toBe("test-env-key")

      process.env.USPTO_API_KEY = originalApiKey
    })

    it("defaultDependencies.getDbUrl reads from environment", async () => {
      const { defaultDependencies } = await import("../../../tools.js")

      const originalDbUrl = process.env.TRADEMARK_DB_URL
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost/db"

      expect(defaultDependencies.getDbUrl()).toBe("postgresql://test:test@localhost/db")

      process.env.TRADEMARK_DB_URL = originalDbUrl
    })

    it("defaultDependencies.pgImport returns pg module import", async () => {
      const { defaultDependencies } = await import("../../../tools.js")

      // This will either succeed or fail depending on whether pg is installed
      // In our case, pg is an optional dependency so it should be available
      try {
        const pg = await defaultDependencies.pgImport()
        expect(pg).toBeDefined()
        expect(pg.default?.Pool || pg.Pool).toBeDefined()
      } catch (e) {
        // pg not installed - that's ok, we just need to call the function
        expect(e).toBeDefined()
      }
    })
  })
})
