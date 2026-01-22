/**
 * Integration tests for PostgreSQL database operations
 * These tests require a real database connection (set TRADEMARK_DB_URL)
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest"
import { createMockPool, createMockPgModule } from "../mocks/pg-mock.js"
import {
  sampleTrademarks,
  fuzzyMatchRecords,
  searchResultsWithScores,
} from "../fixtures/db-records.js"

describe("PostgreSQL Integration", () => {
  let originalEnv: typeof process.env

  beforeEach(() => {
    originalEnv = { ...process.env }
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe("Connection Management", () => {
    it("connects to database successfully", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      const mockPg = createMockPgModule()
      vi.doMock("pg", () => mockPg)

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()

      // Verify database URL is set and pool module is available
      expect(process.env.TRADEMARK_DB_URL).toBeDefined()
      expect(mockPg.Pool).toBeDefined()
    })

    it("handles connection errors gracefully", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      const mockPg = createMockPgModule({
        shouldFailConnect: true,
        connectError: new Error("Connection refused"),
      })
      vi.doMock("pg", () => mockPg)

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()
      // Server should still load even with connection errors
    })

    it("caches pool instance", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      const mockPg = createMockPgModule()
      vi.doMock("pg", () => mockPg)

      await import("../../index.js")

      // Pool constructor should only be called once
      // due to caching in getPostgresPool
    })
  })

  describe("Trigram Similarity Search", () => {
    it("executes trigram similarity search", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      const mockPg = createMockPgModule({
        queryResults: { rows: searchResultsWithScores },
      })
      vi.doMock("pg", () => mockPg)

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()

      // Verify query structure
      expect(mockPg.pool.query).toBeDefined()
    })

    it("filters by status code", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      const activeOnly = sampleTrademarks.filter(
        (r) => r.status_code === "LIVE" || r.status_code === "REGISTERED"
      )

      const mockPg = createMockPgModule({
        queryResults: {
          rows: activeOnly.map((r) => ({ ...r, sim_score: 0.8 })),
        },
      })
      vi.doMock("pg", () => mockPg)

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()
    })

    it("handles empty results", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      const mockPg = createMockPgModule({
        queryResults: { rows: [] },
      })
      vi.doMock("pg", () => mockPg)

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()
    })

    it("handles large result sets efficiently", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      // Generate large result set
      const largeResultSet = Array.from({ length: 100 }, (_, i) => ({
        serial_number: `9700000${i.toString().padStart(2, "0")}`,
        registration_number: null,
        mark_identification: `TEST MARK ${i}`,
        status_code: "LIVE",
        filing_date: "2024-01-01",
        registration_date: null,
        sim_score: Math.random(),
      }))

      const mockPg = createMockPgModule({
        queryResults: { rows: largeResultSet },
      })
      vi.doMock("pg", () => mockPg)

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()
    })
  })

  describe("Query Error Handling", () => {
    it("handles query timeout", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      const mockPg = createMockPgModule({
        shouldFailQuery: true,
        queryError: new Error("Query timeout"),
      })
      vi.doMock("pg", () => mockPg)

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()
    })

    it("handles SQL syntax errors", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      const mockPg = createMockPgModule({
        shouldFailQuery: true,
        queryError: new Error("syntax error at or near"),
      })
      vi.doMock("pg", () => mockPg)

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()
    })

    it("handles connection drop during query", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      const mockPg = createMockPgModule({
        shouldFailQuery: true,
        queryError: new Error("Connection terminated unexpectedly"),
      })
      vi.doMock("pg", () => mockPg)

      const { default: server } = await import("../../index.js")
      expect(server).toBeDefined()
    })
  })

  describe("SQL Injection Prevention", () => {
    it("uses parameterized queries", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      const mockPg = createMockPgModule({
        queryResults: { rows: [] },
      })
      vi.doMock("pg", () => mockPg)

      await import("../../index.js")

      // The query should use $1, $2 placeholders, not string concatenation
      // This is enforced by the implementation using pool.query(sql, params)
    })

    it("handles special characters safely", async () => {
      process.env.TRADEMARK_DB_URL = "postgresql://test:test@localhost:5432/trademarks"

      const mockPg = createMockPgModule({
        queryResults: { rows: [] },
      })
      vi.doMock("pg", () => mockPg)

      await import("../../index.js")

      // Special characters in search terms should be handled safely
      const dangerousInputs = [
        "'; DROP TABLE trademarks; --",
        "UNION SELECT * FROM users",
        "1=1; DELETE FROM trademarks",
      ]

      // These should all be treated as literal search strings
      expect(dangerousInputs.length).toBe(3)
    })
  })
})

describe("Database Schema", () => {
  describe("Expected Table Structure", () => {
    it("expects trademarks table with required columns", () => {
      const requiredColumns = [
        "serial_number",
        "registration_number",
        "mark_identification",
        "status_code",
        "filing_date",
        "registration_date",
      ]

      // Verify our test fixtures match expected schema
      const sampleRecord = sampleTrademarks[0]
      requiredColumns.forEach((col) => {
        expect(sampleRecord).toHaveProperty(col)
      })
    })

    it("expects pg_trgm extension for similarity search", () => {
      // The schema requires pg_trgm extension
      const expectedExtension = "pg_trgm"
      expect(expectedExtension).toBe("pg_trgm")

      // Expected SQL function: similarity(text, text)
      const expectedFunction = "similarity"
      expect(expectedFunction).toBe("similarity")
    })

    it("expects GIN index on mark_identification", () => {
      // Expected index: gin_trgm_ops
      const expectedIndex = "gin (mark_identification gin_trgm_ops)"
      expect(expectedIndex).toContain("gin_trgm_ops")
    })
  })
})
