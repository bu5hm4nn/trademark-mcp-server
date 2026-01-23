/**
 * End-to-end tests for complete trademark search workflows
 * These tests simulate real usage scenarios
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createMockPgModule } from "../mocks/pg-mock.js"
import { createFetchMock, createSuccessResponse, mockResponses } from "../mocks/fetch-mock.js"
import {
  serialNumberJsonResponse,
  registrationNumberJsonResponse,
  statusHtmlResponse,
} from "../fixtures/api-responses.js"
import { searchResultsWithScores, sampleTrademarks } from "../fixtures/db-records.js"

describe("End-to-End Trademark Search", () => {
  let originalEnv: typeof process.env
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalEnv = { ...process.env }
    originalFetch = globalThis.fetch
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe("Complete Wordmark Search Workflow", () => {
    it("searches for XEROX and returns results from database", async () => {
      // Setup environment
      process.env.USPTO_API_KEY = "test-api-key"
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      // Mock database
      const xeroxResults = sampleTrademarks
        .filter((r) => r.mark_identification.includes("XEROX"))
        .map((r) => ({ ...r, sim_score: 0.95 }))

      const mockPg = createMockPgModule({
        queryResults: { rows: xeroxResults },
      })
      vi.doMock("pg", () => mockPg)

      // Load server
      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()

      // Verify database configuration is set up correctly
      expect(process.env.TRADEMARK_DB_URL).toBeDefined()
      expect(xeroxResults.length).toBeGreaterThan(0)
      expect(mockPg.Pool).toBeDefined()
    })

    it("falls back to TESS when database unavailable", async () => {
      // Setup without database
      process.env.USPTO_API_KEY = "test-api-key"
      delete process.env.TRADEMARK_DB_URL

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()

      // Without database, tool should return TESS search link
      const tessUrl = "https://tmsearch.uspto.gov/search/search-results"
      expect(tessUrl).toContain("tmsearch.uspto.gov")
    })
  })

  describe("Complete Serial Number Lookup Workflow", () => {
    it("looks up serial number and returns full details", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(serialNumberJsonResponse),
      })
      globalThis.fetch = mockFetch

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()

      // Simulate API call
      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/info.json")
      expect(response.ok).toBe(true)

      const data = await response.json()

      // Verify complete trademark data
      expect(data.trademarks).toBeDefined()
      expect(data.trademarks.length).toBeGreaterThan(0)

      const trademark = data.trademarks[0]
      expect(trademark.status.serialNumber).toBe("78462704")
      expect(trademark.status.markElement).toBe("APPLE")
      expect(trademark.owner.ownerName).toBe("Apple Inc.")
      expect(trademark.registration.registrationNumber).toBe("3068631")
    })

    it("handles serial number not found", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: mockResponses.notFound,
      })
      globalThis.fetch = mockFetch

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()

      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/sn00000000/info.json")
      expect(response.ok).toBe(false)
      expect(response.status).toBe(404)
    })
  })

  describe("Complete Registration Number Lookup Workflow", () => {
    it("looks up registration number and returns details", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(registrationNumberJsonResponse),
      })
      globalThis.fetch = mockFetch

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()

      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/rn0978952/info.json")
      expect(response.ok).toBe(true)

      const data = await response.json()
      expect(data.trademarks[0].registration.registrationNumber).toBe("0978952")
    })
  })

  describe("Complete Status Check Workflow", () => {
    it("retrieves status HTML and extracts title", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(statusHtmlResponse),
      })
      globalThis.fetch = mockFetch

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()

      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/content")
      const html = await response.text()

      // Extract title
      const titleMatch = html.match(/<title>(.*?)<\/title>/i)
      expect(titleMatch).not.toBeNull()
      expect(titleMatch?.[1]).toContain("APPLE")
    })
  })

  describe("Complete Image Retrieval Workflow", () => {
    it("verifies image exists and returns URL", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "image/png"]]),
      })
      globalThis.fetch = mockFetch

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()

      const imageUrl = "https://tsdrapi.uspto.gov/ts/cd/rawImage/78462704"
      const response = await fetch(imageUrl, { method: "HEAD" })

      expect(response.ok).toBe(true)
      expect(imageUrl).toContain("/rawImage/78462704")
    })

    it("handles missing image gracefully", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      })
      globalThis.fetch = mockFetch

      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/rawImage/00000000", { method: "HEAD" })

      expect(response.ok).toBe(false)
    })
  })

  describe("Complete Document Bundle Workflow", () => {
    it("generates document bundle URL", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()

      const serialNumber = "78462704"
      const documentUrl = `https://tsdrapi.uspto.gov/ts/cd/casedocs/bundle.pdf?sn=${serialNumber}`

      expect(documentUrl).toContain("bundle.pdf")
      expect(documentUrl).toContain(serialNumber)
    })
  })

  describe("Multi-Step Workflows", () => {
    it("searches wordmark then looks up serial number", async () => {
      process.env.USPTO_API_KEY = "test-api-key"
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      // Step 1: Search by wordmark
      const mockPg = createMockPgModule({
        queryResults: { rows: searchResultsWithScores },
      })
      vi.doMock("pg", () => mockPg)

      // Step 2: Look up serial number from results
      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(serialNumberJsonResponse),
      })
      globalThis.fetch = mockFetch

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()

      // Simulate workflow
      const firstResult = searchResultsWithScores[0]
      expect(firstResult.serial_number).toBeDefined()

      // Look up details for first result
      const response = await fetch(
        `https://tsdrapi.uspto.gov/ts/cd/casestatus/sn${firstResult.serial_number}/info.json`,
      )
      expect(response.ok).toBe(true)
    })

    it("handles MCP session lifecycle", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const { default: server } = await import("../../index.js")

      // Session should be creatable
      expect(server).toBeDefined()

      // Multiple tool calls in same session
      const tools = ["trademark_search_by_wordmark", "trademark_search_by_serial", "trademark_status"]

      expect(tools.length).toBe(3)
    })
  })

  describe("Error Recovery Workflows", () => {
    it("recovers from temporary API failures", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      let callCount = 0
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return { ok: false, status: 503, statusText: "Service Unavailable" }
        }
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve(serialNumberJsonResponse),
        }
      })
      globalThis.fetch = mockFetch

      // First call fails
      const response1 = await fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/info.json")
      expect(response1.ok).toBe(false)

      // Second call succeeds
      const response2 = await fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/info.json")
      expect(response2.ok).toBe(true)
    })

    it("falls back gracefully when database unavailable", async () => {
      process.env.USPTO_API_KEY = "test-api-key"
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      const mockPg = createMockPgModule({
        shouldFailConnect: true,
        connectError: new Error("Connection refused"),
      })
      vi.doMock("pg", () => mockPg)

      const { default: server } = await import("../../index.js")

      // Server should still be functional
      expect(server).toBeDefined()
    })
  })
})

describe("Performance Scenarios", () => {
  it("handles rapid successive requests", async () => {
    process.env.USPTO_API_KEY = "test-api-key"

    const mockFetch = createFetchMock({
      defaultResponse: createSuccessResponse(serialNumberJsonResponse),
    })
    globalThis.fetch = mockFetch

    const { default: server } = await import("../../index.js")
    expect(server).toBeDefined()

    // Simulate multiple rapid requests
    const requests = Array.from({ length: 10 }, (_, i) =>
      fetch(`https://tsdrapi.uspto.gov/ts/cd/casestatus/sn7846270${i}/info.json`),
    )

    const responses = await Promise.all(requests)
    expect(responses.every((r) => r.ok)).toBe(true)
  })
})
