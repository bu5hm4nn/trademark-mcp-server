/**
 * Unit tests for Zod schema validation
 * Tests parameter validation for all MCP tools
 */
import { describe, it, expect } from "vitest"
import { z } from "zod"

// Recreate the schemas from index.ts for testing
const wordmarkSearchSchema = z.object({
  wordmark: z.string().min(1).describe("The trademark text/phrase to search for"),
  status: z.enum(["active", "all"]).default("all").describe("Filter by trademark status"),
  limit: z.number().min(1).max(100).default(20).describe("Maximum number of results"),
})

const serialSearchSchema = z.object({
  serialNumber: z.string().min(8).max(8).describe("8-digit trademark serial number"),
  format: z.enum(["json", "xml"]).default("json").describe("Response format"),
})

const registrationSearchSchema = z.object({
  registrationNumber: z.string().min(7).max(8).describe("7-8 digit registration number"),
  format: z.enum(["json", "xml"]).default("json").describe("Response format"),
})

const statusSchema = z.object({
  serialNumber: z.string().min(8).max(8).describe("8-digit trademark serial number"),
})

const imageSchema = z.object({
  serialNumber: z.string().min(8).max(8).describe("8-digit trademark serial number"),
})

const documentsSchema = z.object({
  serialNumber: z.string().min(8).max(8).describe("8-digit trademark serial number"),
})

describe("Schema Validation", () => {
  describe("wordmark search schema", () => {
    it("accepts valid wordmark search parameters", () => {
      const validInput = {
        wordmark: "APPLE",
        status: "active",
        limit: 10,
      }

      const result = wordmarkSearchSchema.safeParse(validInput)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.wordmark).toBe("APPLE")
        expect(result.data.status).toBe("active")
        expect(result.data.limit).toBe(10)
      }
    })

    it("uses default values when optional fields omitted", () => {
      const minimalInput = {
        wordmark: "TEST",
      }

      const result = wordmarkSearchSchema.safeParse(minimalInput)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe("all")
        expect(result.data.limit).toBe(20)
      }
    })

    it("rejects empty wordmark", () => {
      const invalidInput = {
        wordmark: "",
      }

      const result = wordmarkSearchSchema.safeParse(invalidInput)
      expect(result.success).toBe(false)
    })

    it("rejects invalid status value", () => {
      const invalidInput = {
        wordmark: "TEST",
        status: "invalid",
      }

      const result = wordmarkSearchSchema.safeParse(invalidInput)
      expect(result.success).toBe(false)
    })

    it("rejects limit below minimum", () => {
      const invalidInput = {
        wordmark: "TEST",
        limit: 0,
      }

      const result = wordmarkSearchSchema.safeParse(invalidInput)
      expect(result.success).toBe(false)
    })

    it("rejects limit above maximum", () => {
      const invalidInput = {
        wordmark: "TEST",
        limit: 101,
      }

      const result = wordmarkSearchSchema.safeParse(invalidInput)
      expect(result.success).toBe(false)
    })

    it("accepts limit at boundary values", () => {
      const minLimitInput = { wordmark: "TEST", limit: 1 }
      const maxLimitInput = { wordmark: "TEST", limit: 100 }

      expect(wordmarkSearchSchema.safeParse(minLimitInput).success).toBe(true)
      expect(wordmarkSearchSchema.safeParse(maxLimitInput).success).toBe(true)
    })
  })

  describe("serial search schema", () => {
    it("accepts valid 8-digit serial number", () => {
      const validInput = {
        serialNumber: "78462704",
        format: "json",
      }

      const result = serialSearchSchema.safeParse(validInput)
      expect(result.success).toBe(true)
    })

    it("uses json as default format", () => {
      const inputWithoutFormat = {
        serialNumber: "78462704",
      }

      const result = serialSearchSchema.safeParse(inputWithoutFormat)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.format).toBe("json")
      }
    })

    it("accepts xml format", () => {
      const xmlInput = {
        serialNumber: "78462704",
        format: "xml",
      }

      const result = serialSearchSchema.safeParse(xmlInput)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.format).toBe("xml")
      }
    })

    it("rejects serial number shorter than 8 characters", () => {
      const shortSerial = {
        serialNumber: "7846270",
      }

      const result = serialSearchSchema.safeParse(shortSerial)
      expect(result.success).toBe(false)
    })

    it("rejects serial number longer than 8 characters", () => {
      const longSerial = {
        serialNumber: "784627041",
      }

      const result = serialSearchSchema.safeParse(longSerial)
      expect(result.success).toBe(false)
    })

    it("rejects invalid format value", () => {
      const invalidFormat = {
        serialNumber: "78462704",
        format: "html",
      }

      const result = serialSearchSchema.safeParse(invalidFormat)
      expect(result.success).toBe(false)
    })
  })

  describe("registration search schema", () => {
    it("accepts valid 7-digit registration number", () => {
      const validInput = {
        registrationNumber: "1234567",
      }

      const result = registrationSearchSchema.safeParse(validInput)
      expect(result.success).toBe(true)
    })

    it("accepts valid 8-digit registration number", () => {
      const validInput = {
        registrationNumber: "12345678",
      }

      const result = registrationSearchSchema.safeParse(validInput)
      expect(result.success).toBe(true)
    })

    it("rejects registration number shorter than 7 characters", () => {
      const shortReg = {
        registrationNumber: "123456",
      }

      const result = registrationSearchSchema.safeParse(shortReg)
      expect(result.success).toBe(false)
    })

    it("rejects registration number longer than 8 characters", () => {
      const longReg = {
        registrationNumber: "123456789",
      }

      const result = registrationSearchSchema.safeParse(longReg)
      expect(result.success).toBe(false)
    })
  })

  describe("status schema", () => {
    it("accepts valid serial number", () => {
      const validInput = {
        serialNumber: "78462704",
      }

      const result = statusSchema.safeParse(validInput)
      expect(result.success).toBe(true)
    })

    it("rejects invalid serial number length", () => {
      const invalidInput = {
        serialNumber: "1234",
      }

      const result = statusSchema.safeParse(invalidInput)
      expect(result.success).toBe(false)
    })
  })

  describe("image schema", () => {
    it("accepts valid serial number", () => {
      const validInput = {
        serialNumber: "78462704",
      }

      const result = imageSchema.safeParse(validInput)
      expect(result.success).toBe(true)
    })

    it("rejects missing serial number", () => {
      const emptyInput = {}

      const result = imageSchema.safeParse(emptyInput)
      expect(result.success).toBe(false)
    })
  })

  describe("documents schema", () => {
    it("accepts valid serial number", () => {
      const validInput = {
        serialNumber: "78462704",
      }

      const result = documentsSchema.safeParse(validInput)
      expect(result.success).toBe(true)
    })

    it("rejects non-string serial number", () => {
      const invalidInput = {
        serialNumber: 78462704,
      }

      const result = documentsSchema.safeParse(invalidInput)
      expect(result.success).toBe(false)
    })
  })
})

describe("Edge Cases", () => {
  describe("special characters in wordmark", () => {
    it("accepts wordmarks with special characters", () => {
      const specialCases = [
        { wordmark: "O'REILLY" },
        { wordmark: "MARK & COMPANY" },
        { wordmark: "50% OFF" },
        { wordmark: "CAFÉ" },
        { wordmark: '"QUOTED"' },
        { wordmark: "TEST/SLASH" },
      ]

      specialCases.forEach((input) => {
        const result = wordmarkSearchSchema.safeParse(input)
        expect(result.success).toBe(true)
      })
    })

    it("accepts very long wordmarks", () => {
      const longWordmark = {
        wordmark: "A".repeat(1000),
      }

      const result = wordmarkSearchSchema.safeParse(longWordmark)
      expect(result.success).toBe(true)
    })

    it("accepts unicode characters", () => {
      const unicodeInput = {
        wordmark: "商标™®",
      }

      const result = wordmarkSearchSchema.safeParse(unicodeInput)
      expect(result.success).toBe(true)
    })
  })

  describe("serial number edge cases", () => {
    it("accepts serial numbers with leading zeros", () => {
      const leadingZeros = {
        serialNumber: "00000001",
      }

      const result = serialSearchSchema.safeParse(leadingZeros)
      expect(result.success).toBe(true)
    })

    it("accepts all-zero serial number", () => {
      const allZeros = {
        serialNumber: "00000000",
      }

      const result = serialSearchSchema.safeParse(allZeros)
      expect(result.success).toBe(true)
    })

    it("accepts max serial number", () => {
      const maxSerial = {
        serialNumber: "99999999",
      }

      const result = serialSearchSchema.safeParse(maxSerial)
      expect(result.success).toBe(true)
    })
  })
})
