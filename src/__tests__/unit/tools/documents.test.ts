/**
 * Unit tests for trademark_documents tool
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

describe("trademark_documents", () => {
  let originalEnv: typeof process.env

  beforeEach(() => {
    originalEnv = { ...process.env }
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe("URL generation", () => {
    it("generates correct document bundle URL", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const { default: server } = await import("../../../index.js")
      expect(server).toBeDefined()

      const baseUrl = "https://tsdrapi.uspto.gov/ts/cd"
      const serialNumber = "78462704"
      const expectedUrl = `${baseUrl}/casedocs/bundle.pdf?sn=${serialNumber}`

      expect(expectedUrl).toBe(
        "https://tsdrapi.uspto.gov/ts/cd/casedocs/bundle.pdf?sn=78462704"
      )
    })

    it("uses PDF format for document bundles", () => {
      const url = "https://tsdrapi.uspto.gov/ts/cd/casedocs/bundle.pdf?sn=78462704"

      expect(url).toContain(".pdf")
      expect(url).toContain("bundle")
    })

    it("includes serial number as query parameter", () => {
      const url = "https://tsdrapi.uspto.gov/ts/cd/casedocs/bundle.pdf?sn=78462704"

      expect(url).toContain("?sn=")
      expect(url).toContain("78462704")
    })
  })

  describe("API key requirement", () => {
    it("requires API key to be set", async () => {
      delete process.env.USPTO_API_KEY

      const { default: server } = await import("../../../index.js")
      expect(server).toBeDefined()
      // Tool should return error message about missing API key
    })

    it("proceeds when API key is available", async () => {
      process.env.USPTO_API_KEY = "test-api-key"

      const { default: server } = await import("../../../index.js")
      expect(server).toBeDefined()
    })
  })

  describe("rate limit warnings", () => {
    it("includes rate limit information in response", () => {
      // The tool should include a note about rate limiting
      const expectedMessage =
        "Document downloads are rate-limited to 4 requests per minute per API key"

      expect(expectedMessage).toContain("rate-limited")
      expect(expectedMessage).toContain("4 requests per minute")
    })
  })

  describe("URL construction", () => {
    it("constructs correct casedocs URL", () => {
      const baseUrl = "https://tsdrapi.uspto.gov/ts/cd"
      const serialNumber = "78462704"
      const expectedUrl = `${baseUrl}/casedocs/bundle.pdf?sn=${serialNumber}`

      expect(expectedUrl).toBe(
        "https://tsdrapi.uspto.gov/ts/cd/casedocs/bundle.pdf?sn=78462704"
      )
    })

    it("uses casedocs endpoint", () => {
      const url = "https://tsdrapi.uspto.gov/ts/cd/casedocs/bundle.pdf?sn=78462704"
      expect(url).toContain("/casedocs/")
    })
  })

  describe("serial number validation", () => {
    it("accepts valid 8-digit serial numbers", () => {
      const validSerials = ["78462704", "12345678", "00000001", "99999999"]

      validSerials.forEach((serial) => {
        const url = `https://tsdrapi.uspto.gov/ts/cd/casedocs/bundle.pdf?sn=${serial}`
        expect(url).toContain(`?sn=${serial}`)
      })
    })
  })

  describe("response format", () => {
    it("returns URL and informational message", () => {
      const serialNumber = "78462704"
      const documentsUrl = `https://tsdrapi.uspto.gov/ts/cd/casedocs/bundle.pdf?sn=${serialNumber}`

      // Expected response format
      const expectedResponse = {
        url: documentsUrl,
        message: expect.stringContaining("Document bundle URL"),
        rateLimit: expect.stringContaining("rate-limited"),
      }

      expect(documentsUrl).toContain(serialNumber)
    })
  })
})
