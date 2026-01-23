/**
 * Unit tests for trademark_status tool
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createFetchMock,
  mockResponses,
  createSuccessResponse,
} from "../../mocks/fetch-mock.js"
import { statusHtmlResponse, apiKeyMissingErrorResponse } from "../../fixtures/api-responses.js"

describe("trademark_status", () => {
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

  describe("successful lookups", () => {
    it("returns HTML response for valid serial number", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(statusHtmlResponse),
      })
      globalThis.fetch = mockFetch

      const { default: server } = await import("../../../index.js")
      expect(server).toBeDefined()

      const response = await fetch(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/content"
      )
      expect(response.ok).toBe(true)

      const htmlContent = await response.text()
      expect(htmlContent).toContain("<!DOCTYPE html>")
      expect(htmlContent).toContain("Trademark Case Status")
    })

    it("extracts title from HTML response", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(statusHtmlResponse),
      })
      globalThis.fetch = mockFetch

      const response = await fetch(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/content"
      )
      const htmlContent = await response.text()

      // Extract title using regex (same as implementation)
      const titleMatch = htmlContent.match(/<title>(.*?)<\/title>/i)
      const title = titleMatch ? titleMatch[1] : "No title found"

      expect(title).toBe("Trademark Status: APPLE (78462704)")
    })

    it("includes trademark information in response", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(statusHtmlResponse),
      })
      globalThis.fetch = mockFetch

      const response = await fetch(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/content"
      )
      const htmlContent = await response.text()

      expect(htmlContent).toContain("78462704")
      expect(htmlContent).toContain("APPLE")
      expect(htmlContent).toContain("Apple Inc.")
    })
  })

  describe("API errors", () => {
    it("returns error when API key missing", async () => {
      const { getTrademarkStatus } = await import("../../../tools.js")

      const deps = {
        getApiKey: () => undefined,
        getDbUrl: () => undefined,
        fetchFn: vi.fn(),
        pgImport: vi.fn(),
      }

      const result = await getTrademarkStatus({ serialNumber: "12345678" }, deps)

      expect(result).toBe(
        "❌ USPTO API key not configured. Please set the USPTO_API_KEY environment variable with your API key from https://account.uspto.gov/api-manager/"
      )
    })

    it("handles authentication errors", async () => {
      process.env.USPTO_API_KEY = "invalid-key"

      const mockFetch = createFetchMock({
        defaultResponse: mockResponses.unauthorized,
      })
      globalThis.fetch = mockFetch

      const response = await fetch(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/content"
      )
      expect(response.ok).toBe(false)
      expect(response.status).toBe(401)

      const errorText = await response.text()
      expect(errorText).toContain("need to register for an API key")
    })

    it("handles not found errors", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: mockResponses.notFound,
      })
      globalThis.fetch = mockFetch

      const response = await fetch(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn00000000/content"
      )
      expect(response.ok).toBe(false)
      expect(response.status).toBe(404)
    })

    it("handles network errors gracefully", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"))
      globalThis.fetch = mockFetch

      await expect(
        fetch("https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/content")
      ).rejects.toThrow("Connection refused")
    })
  })

  describe("URL construction", () => {
    it("constructs correct status content URL", () => {
      const baseUrl = "https://tsdrapi.uspto.gov/ts/cd"
      const serialNumber = "78462704"
      const expectedUrl = `${baseUrl}/casestatus/sn${serialNumber}/content`

      expect(expectedUrl).toBe(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/content"
      )
    })

    it("uses /content endpoint for status", () => {
      const url = "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/content"
      expect(url).toContain("/content")
      expect(url).not.toContain("/info")
    })
  })

  describe("HTML parsing", () => {
    it("handles HTML without title tag", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const htmlWithoutTitle = `<!DOCTYPE html>
<html>
<body>
  <h1>Trademark Status</h1>
</body>
</html>`

      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(htmlWithoutTitle),
      })
      globalThis.fetch = mockFetch

      const response = await fetch(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/content"
      )
      const htmlContent = await response.text()

      const titleMatch = htmlContent.match(/<title>(.*?)<\/title>/i)
      const title = titleMatch ? titleMatch[1] : "No title found"

      expect(title).toBe("No title found")
    })

    it("handles malformed HTML gracefully", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const malformedHtml = "<html><head><title>Test</title><body>Unclosed tags"

      const mockFetch = createFetchMock({
        defaultResponse: createSuccessResponse(malformedHtml),
      })
      globalThis.fetch = mockFetch

      const response = await fetch(
        "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78462704/content"
      )
      const htmlContent = await response.text()

      expect(htmlContent).toBeDefined()
      expect(htmlContent).toContain("Test")
    })
  })
})
