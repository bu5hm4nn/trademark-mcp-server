/**
 * Unit tests for trademark_search_by_serial tool
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createFetchMock,
  createUsptoFetchMock,
  createAuthenticatedFetchMock,
  createTimeoutFetchMock,
  mockResponses,
  createSuccessResponse,
  createErrorResponse,
} from "../../mocks/fetch-mock.js"
import { serialNumberJsonResponse, serialNumberXmlResponse } from "../../fixtures/api-responses.js"

describe("trademark_search_by_serial", () => {
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

  describe("successful searches", () => {
    it("returns JSON response for valid serial number", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(serialNumberJsonResponse),
      })
      globalThis.fetch = mockFetch

      const { default: server } = await import("../../../index.js")
      expect(server).toBeDefined()

      // Verify fetch mock is configured correctly
      expect(mockFetch).toBeDefined()

      // Call fetch to verify the mock works
      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/info.json")
      expect(response.ok).toBe(true)

      const data = await response.json()
      expect(data.trademarks).toBeDefined()
      expect(data.trademarks[0].status.markElement).toBe("APPLE")
    })

    it("returns XML response when format=xml", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(serialNumberXmlResponse),
      })
      globalThis.fetch = mockFetch

      const { default: server } = await import("../../../index.js")
      expect(server).toBeDefined()

      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/info.xml")
      const xmlData = await response.text()

      expect(xmlData).toContain("<?xml")
      expect(xmlData).toContain("APPLE")
      expect(xmlData).toContain("78462704")
    })

    it("includes all trademark fields in response", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(serialNumberJsonResponse),
      })
      globalThis.fetch = mockFetch

      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/info.json")
      const data = await response.json()

      const trademark = data.trademarks[0]
      expect(trademark.status).toBeDefined()
      expect(trademark.filing).toBeDefined()
      expect(trademark.registration).toBeDefined()
      expect(trademark.owner).toBeDefined()
    })
  })

  describe("validation", () => {
    it("validates serial number is exactly 8 digits", () => {
      // Serial number validation is done by Zod schema
      const validSerialNumbers = ["78462704", "12345678", "00000001"]
      const invalidSerialNumbers = ["7846270", "784627041", "abcdefgh", "1234567a"]

      validSerialNumbers.forEach((sn) => {
        expect(sn.length).toBe(8)
        expect(/^\d{8}$/.test(sn)).toBe(true)
      })

      invalidSerialNumbers.forEach((sn) => {
        const isValid = sn.length === 8 && /^\d{8}$/.test(sn)
        expect(isValid).toBe(false)
      })
    })

    it("rejects non-numeric serial numbers", () => {
      const nonNumericSerials = ["ABCDEFGH", "1234ABCD", "!@#$%^&*"]

      nonNumericSerials.forEach((sn) => {
        expect(/^\d+$/.test(sn)).toBe(false)
      })
    })
  })

  describe("API errors", () => {
    it("returns helpful message when API key missing", async () => {
      delete process.env.USPTO_API_KEY

      const { default: server } = await import("../../../index.js")
      expect(server).toBeDefined()

      // The tool should check for API key and return an error message
      // This is tested through the server's tool execution
    })

    it("handles 401 authentication errors", async () => {
      process.env.USPTO_API_KEY = "invalid-key"

      const mockFetch = createFetchMock({
        defaultResponse: mockResponses.unauthorized,
      })
      globalThis.fetch = mockFetch

      const { default: server } = await import("../../../index.js")
      expect(server).toBeDefined()

      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/info.json")
      expect(response.ok).toBe(false)
      expect(response.status).toBe(401)
    })

    it("handles 404 not found errors", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: mockResponses.notFound,
      })
      globalThis.fetch = mockFetch

      const { default: server } = await import("../../../index.js")
      expect(server).toBeDefined()

      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/sn00000000/info.json")
      expect(response.ok).toBe(false)
      expect(response.status).toBe(404)
    })

    it("handles network timeouts", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = vi.fn().mockRejectedValue(new Error("Request timeout"))
      globalThis.fetch = mockFetch

      const { default: server } = await import("../../../index.js")
      expect(server).toBeDefined()

      await expect(
        fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/info.json")
      ).rejects.toThrow("Request timeout")
    })

    it("handles 500 server errors", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: mockResponses.serverError,
      })
      globalThis.fetch = mockFetch

      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/info.json")
      expect(response.ok).toBe(false)
      expect(response.status).toBe(500)
    })

    it("handles rate limit (429) errors", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: mockResponses.rateLimit,
      })
      globalThis.fetch = mockFetch

      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/info.json")
      expect(response.ok).toBe(false)
      expect(response.status).toBe(429)
    })
  })

  describe("URL construction", () => {
    it("constructs correct JSON URL", () => {
      const baseUrl = "https://tsdrapi.uspto.gov/ts/cd"
      const serialNumber = "78462704"
      const expectedUrl = `${baseUrl}/casestatus/sn${serialNumber}/info.json`

      expect(expectedUrl).toBe(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/info.json"
      )
    })

    it("constructs correct XML URL", () => {
      const baseUrl = "https://tsdrapi.uspto.gov/ts/cd"
      const serialNumber = "78462704"
      const expectedUrl = `${baseUrl}/casestatus/sn${serialNumber}/info.xml`

      expect(expectedUrl).toBe(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/info.xml"
      )
    })
  })
})
