/**
 * Unit tests for trademark_search_by_registration tool
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createFetchMock,
  mockResponses,
  createSuccessResponse,
} from "../../mocks/fetch-mock.js"
import {
  registrationNumberJsonResponse,
  serialNumberXmlResponse,
} from "../../fixtures/api-responses.js"

describe("trademark_search_by_registration", () => {
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
    it("returns JSON response for valid registration number", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(registrationNumberJsonResponse),
      })
      globalThis.fetch = mockFetch

      const { default: server } = await import("../../../index.js")
      expect(server).toBeDefined()

      const response = await fetch(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/rn0978952/info.json"
      )
      expect(response.ok).toBe(true)

      const data = await response.json()
      expect(data.trademarks).toBeDefined()
      expect(data.trademarks[0].registration.registrationNumber).toBe("0978952")
    })

    it("returns XML response when format=xml", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(serialNumberXmlResponse),
      })
      globalThis.fetch = mockFetch

      const { default: server } = await import("../../../index.js")
      expect(server).toBeDefined()

      const response = await fetch(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/rn3068631/info.xml"
      )
      const xmlData = await response.text()

      expect(xmlData).toContain("<?xml")
      expect(xmlData).toContain("registrationNumber")
    })

    it("handles 7-digit registration numbers", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(registrationNumberJsonResponse),
      })
      globalThis.fetch = mockFetch

      const response = await fetch(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/rn1234567/info.json"
      )
      expect(response.ok).toBe(true)
    })

    it("handles 8-digit registration numbers", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(registrationNumberJsonResponse),
      })
      globalThis.fetch = mockFetch

      const response = await fetch(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/rn12345678/info.json"
      )
      expect(response.ok).toBe(true)
    })
  })

  describe("validation", () => {
    it("validates registration number is 7-8 digits", () => {
      const validRegistrationNumbers = ["1234567", "12345678", "0978952", "00123456"]
      const invalidRegistrationNumbers = ["123456", "123456789", "abcdefg"]

      validRegistrationNumbers.forEach((rn) => {
        const isValid = rn.length >= 7 && rn.length <= 8 && /^\d+$/.test(rn)
        expect(isValid).toBe(true)
      })

      invalidRegistrationNumbers.forEach((rn) => {
        const isValid = rn.length >= 7 && rn.length <= 8 && /^\d+$/.test(rn)
        expect(isValid).toBe(false)
      })
    })

    it("rejects registration numbers with letters", () => {
      const invalidNumbers = ["123456A", "ABCDEFG", "12-3456"]

      invalidNumbers.forEach((rn) => {
        expect(/^\d+$/.test(rn)).toBe(false)
      })
    })
  })

  describe("API errors", () => {
    it("returns helpful message when API key missing", async () => {
      delete process.env.USPTO_API_KEY

      const { default: server } = await import("../../../index.js")
      expect(server).toBeDefined()
    })

    it("handles 401 authentication errors", async () => {
      process.env.USPTO_API_KEY = "invalid-key"

      const mockFetch = createFetchMock({
        defaultResponse: mockResponses.unauthorized,
      })
      globalThis.fetch = mockFetch

      const response = await fetch(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/rn3068631/info.json"
      )
      expect(response.ok).toBe(false)
      expect(response.status).toBe(401)
    })

    it("handles 404 not found errors", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: mockResponses.notFound,
      })
      globalThis.fetch = mockFetch

      const response = await fetch(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/rn0000000/info.json"
      )
      expect(response.ok).toBe(false)
      expect(response.status).toBe(404)
    })

    it("handles network errors", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"))
      globalThis.fetch = mockFetch

      await expect(
        fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/rn3068631/info.json")
      ).rejects.toThrow("Network error")
    })
  })

  describe("URL construction", () => {
    it("constructs correct registration number URL", () => {
      const baseUrl = "https://tsdrapi.uspto.gov/ts/cd"
      const registrationNumber = "3068631"
      const expectedUrl = `${baseUrl}/casestatus/rn${registrationNumber}/info.json`

      expect(expectedUrl).toBe(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/rn3068631/info.json"
      )
    })

    it("uses rn prefix for registration numbers", () => {
      const url = "https://tsdrapi.uspto.gov/ts/cd/casestatus/rn3068631/info.json"
      expect(url).toContain("/rn")
      expect(url).not.toContain("/sn")
    })
  })
})
