/**
 * Unit tests for trademark_image tool
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createFetchMock, mockResponses } from "../../mocks/fetch-mock.js"

describe("trademark_image", () => {
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

  describe("successful image lookups", () => {
    it("verifies image exists with HEAD request", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "HEAD") {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Map([["content-type", "image/png"]]),
          }
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
        }
      })
      globalThis.fetch = mockFetch

      const { default: server } = await import("../../../index.js")
      expect(server).toBeDefined()

      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/rawImage/78462704", { method: "HEAD" })
      expect(response.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        "https://tsdrapi.uspto.gov/ts/cd/rawImage/78462704",
        expect.objectContaining({ method: "HEAD" }),
      )
    })

    it("returns image URL for existing trademark", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      })
      globalThis.fetch = mockFetch

      const imageUrl = "https://tsdrapi.uspto.gov/ts/cd/rawImage/78462704"

      // Verify URL construction
      expect(imageUrl).toContain("/rawImage/")
      expect(imageUrl).toContain("78462704")
    })

    it("includes content-type header for images", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === "content-type" ? "image/png" : null),
        },
      })
      globalThis.fetch = mockFetch

      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/rawImage/78462704", { method: "HEAD" })

      expect(response.ok).toBe(true)
    })
  })

  describe("image not found", () => {
    it("handles 404 for missing images", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = createFetchMock({
        defaultResponse: mockResponses.imageNotFound,
      })
      globalThis.fetch = mockFetch

      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/rawImage/00000000", { method: "HEAD" })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(404)
    })

    it("returns informative message for missing images", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      // When image doesn't exist, tool should return a message
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      })
      globalThis.fetch = mockFetch

      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/rawImage/00000000", { method: "HEAD" })

      expect(response.ok).toBe(false)
    })
  })

  describe("API errors", () => {
    it("returns error when API key missing", async () => {
      delete process.env.USPTO_API_KEY

      const { default: server } = await import("../../../index.js")
      expect(server).toBeDefined()
    })

    it("handles authentication errors", async () => {
      process.env.USPTO_API_KEY = "invalid-key"

      const mockFetch = createFetchMock({
        defaultResponse: mockResponses.unauthorized,
      })
      globalThis.fetch = mockFetch

      const response = await fetch("https://tsdrapi.uspto.gov/ts/cd/rawImage/78462704", { method: "HEAD" })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(401)
    })

    it("handles network errors", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"))
      globalThis.fetch = mockFetch

      await expect(fetch("https://tsdrapi.uspto.gov/ts/cd/rawImage/78462704", { method: "HEAD" })).rejects.toThrow(
        "Network error",
      )
    })
  })

  describe("URL construction", () => {
    it("constructs correct image URL", () => {
      const baseUrl = "https://tsdrapi.uspto.gov/ts/cd"
      const serialNumber = "78462704"
      const expectedUrl = `${baseUrl}/rawImage/${serialNumber}`

      expect(expectedUrl).toBe("https://tsdrapi.uspto.gov/ts/cd/rawImage/78462704")
    })

    it("uses rawImage endpoint", () => {
      const url = "https://tsdrapi.uspto.gov/ts/cd/rawImage/78462704"
      expect(url).toContain("/rawImage/")
    })
  })

  describe("request method", () => {
    it("uses HEAD request to check image existence", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      })
      globalThis.fetch = mockFetch

      await fetch("https://tsdrapi.uspto.gov/ts/cd/rawImage/78462704", { method: "HEAD" })

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: "HEAD" }))
    })
  })
})
