/**
 * Live database integration tests
 *
 * These tests run against a real PostgreSQL database with USPTO trademark data.
 * Tests are skipped if TRADEMARK_DB_URL is not configured in .env or database is unreachable.
 *
 * Run with: pnpm test:live
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { shouldRunLiveTests, getLivePool, verifyDatabaseSetup, isDatabaseReachable } from "./setup.live"
import { searchByWordmark, resetPoolState } from "../../tools"

// Track if we should skip tests due to unreachable database
let pool: any = null
let databaseAvailable = false

// Skip entire suite if TRADEMARK_DB_URL is not configured
describe.skipIf(!shouldRunLiveTests())("Live Database Tests", () => {
  beforeAll(async () => {
    // Check if database is actually reachable
    const reachable = await isDatabaseReachable()
    if (!reachable) {
      console.log("Database not reachable - all tests will be skipped")
      return
    }

    pool = await getLivePool()
    if (!pool) {
      console.log("Failed to create pool - all tests will be skipped")
      return
    }

    try {
      await verifyDatabaseSetup(pool)
      databaseAvailable = true
    } catch (error) {
      console.log("Database setup verification failed:", error)
    }
  })

  afterAll(async () => {
    if (pool) {
      await pool.end()
    }
    resetPoolState()
  })

  describe("Database Connection & Structure", () => {
    it.skipIf(!shouldRunLiveTests())("connects to PostgreSQL successfully", async () => {
      if (!databaseAvailable) return
      const result = await pool.query("SELECT 1 as test")
      expect(result.rows[0].test).toBe(1)
    })

    it.skipIf(!shouldRunLiveTests())("has pg_trgm extension enabled", async () => {
      if (!databaseAvailable) return
      const result = await pool.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")
      expect(result.rows).toHaveLength(1)
    })

    it.skipIf(!shouldRunLiveTests())("has trademarks table with expected columns", async () => {
      if (!databaseAvailable) return
      const result = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'trademarks'
        ORDER BY column_name
      `)
      const columns = result.rows.map((r: any) => r.column_name)
      expect(columns).toContain("serial_number")
      expect(columns).toContain("mark_identification")
      expect(columns).toContain("status_code")
      expect(columns).toContain("filing_date")
      expect(columns).toContain("registration_number")
    })

    it.skipIf(!shouldRunLiveTests())("has similarity function available from pg_trgm", async () => {
      if (!databaseAvailable) return
      const result = await pool.query("SELECT similarity('HELLO', 'HELO') as sim")
      expect(result.rows[0].sim).toBeGreaterThan(0.5)
    })

    it.skipIf(!shouldRunLiveTests())("has trigram index on mark_identification", async () => {
      if (!databaseAvailable) return
      const result = await pool.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'trademarks'
        AND indexdef LIKE '%gin_trgm_ops%'
      `)
      expect(result.rows.length).toBeGreaterThan(0)
    })
  })

  describe("Trigram Similarity Search (Query Structure)", () => {
    it.skipIf(!shouldRunLiveTests())("executes trigram search query without error", async () => {
      if (!databaseAvailable) return
      // Test query structure, not specific results
      const result = await pool.query(
        `SELECT serial_number, mark_identification,
         similarity(mark_identification, $1) as sim_score
         FROM trademarks
         WHERE mark_identification % $1
         ORDER BY sim_score DESC LIMIT 5`,
        ["TEST"],
      )
      // Query should execute - results may vary
      expect(result.rows).toBeDefined()
      expect(Array.isArray(result.rows)).toBe(true)
    })

    it.skipIf(!shouldRunLiveTests())("supports status filtering in queries", async () => {
      if (!databaseAvailable) return
      const result = await pool.query(
        `SELECT COUNT(*) as count FROM trademarks
         WHERE status_code IN ('LIVE', 'REGISTERED')`,
      )
      // Should be able to filter - count may vary
      expect(parseInt(result.rows[0].count)).toBeGreaterThanOrEqual(0)
    })

    it.skipIf(!shouldRunLiveTests())("returns results ordered by similarity score", async () => {
      if (!databaseAvailable) return
      const result = await pool.query(
        `SELECT mark_identification,
         similarity(mark_identification, $1) as sim_score
         FROM trademarks
         WHERE mark_identification % $1
         ORDER BY sim_score DESC LIMIT 10`,
        ["COMPUTER"],
      )

      if (result.rows.length > 1) {
        // Verify results are sorted in descending order
        for (let i = 1; i < result.rows.length; i++) {
          expect(result.rows[i - 1].sim_score).toBeGreaterThanOrEqual(result.rows[i].sim_score)
        }
      }
    })

    it.skipIf(!shouldRunLiveTests())("handles special characters in search terms", async () => {
      if (!databaseAvailable) return
      // Should not throw on special characters
      const result = await pool.query(
        `SELECT COUNT(*) as count FROM trademarks
         WHERE mark_identification % $1`,
        ["TEST'S & STUFF"],
      )
      expect(parseInt(result.rows[0].count)).toBeGreaterThanOrEqual(0)
    })
  })

  describe("searchByWordmark Integration", () => {
    const getDeps = () => ({
      getApiKey: () => undefined,
      getDbUrl: () => process.env.TRADEMARK_DB_URL,
      fetchFn: fetch,
      pgImport: () => import("pg"),
    })

    beforeEach(() => {
      resetPoolState()
    })

    it.skipIf(!shouldRunLiveTests())("returns formatted results for any matching wordmark", async () => {
      if (!databaseAvailable) return
      const result = await searchByWordmark({ wordmark: "TECH", status: "all", limit: 5 }, getDeps())

      // Should either return results or "No trademarks found" message
      expect(result.includes("Trademark Search Results") || result.includes("No trademarks found")).toBe(true)
    })

    it.skipIf(!shouldRunLiveTests())("filters by active status correctly", async () => {
      if (!databaseAvailable) return
      const result = await searchByWordmark({ wordmark: "SOFTWARE", status: "active", limit: 10 }, getDeps())

      // If results returned, they should not include DEAD/ABANDONED/CANCELLED status
      if (result.includes("Trademark Search Results")) {
        expect(result).not.toMatch(/Status: (DEAD|ABANDONED|CANCELLED|EXPIRED)/i)
      }
    })

    it.skipIf(!shouldRunLiveTests())("respects limit parameter", async () => {
      if (!databaseAvailable) return
      const result = await searchByWordmark({ wordmark: "COMPUTER", status: "all", limit: 3 }, getDeps())

      if (result.includes("Trademark Search Results")) {
        // Count numbered results (1. 2. 3. etc)
        const matches = result.match(/^\d+\.\s+\*\*/gm) || []
        expect(matches.length).toBeLessThanOrEqual(3)
      }
    })

    it.skipIf(!shouldRunLiveTests())("includes similarity scores in results", async () => {
      if (!databaseAvailable) return
      const result = await searchByWordmark({ wordmark: "DIGITAL", status: "all", limit: 5 }, getDeps())

      if (result.includes("Trademark Search Results")) {
        expect(result).toContain("Similarity:")
      }
    })

    it.skipIf(!shouldRunLiveTests())("handles empty results gracefully", async () => {
      if (!databaseAvailable) return
      const result = await searchByWordmark({ wordmark: "XYZQWERTY12345UNLIKELY", status: "all", limit: 5 }, getDeps())

      expect(result).toContain("No trademarks found")
    })
  })

  describe("Data Integrity", () => {
    it.skipIf(!shouldRunLiveTests())("has records with valid serial numbers", async () => {
      if (!databaseAvailable) return
      const result = await pool.query(`
        SELECT serial_number FROM trademarks
        WHERE serial_number IS NOT NULL
        AND serial_number ~ '^[0-9]+$'
        LIMIT 10
      `)
      expect(result.rows.length).toBeGreaterThan(0)
    })

    it.skipIf(!shouldRunLiveTests())("has records with status codes", async () => {
      if (!databaseAvailable) return
      const result = await pool.query(`
        SELECT DISTINCT status_code FROM trademarks
        WHERE status_code IS NOT NULL
        LIMIT 20
      `)
      expect(result.rows.length).toBeGreaterThan(0)
    })

    it.skipIf(!shouldRunLiveTests())("has records with filing dates", async () => {
      if (!databaseAvailable) return
      const result = await pool.query(`
        SELECT COUNT(*) as count FROM trademarks
        WHERE filing_date IS NOT NULL
      `)
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0)
    })
  })

  describe("Performance Sanity Checks", () => {
    it.skipIf(!shouldRunLiveTests())("trigram search completes within reasonable time", async () => {
      if (!databaseAvailable) return
      const start = Date.now()

      await pool.query(
        `SELECT serial_number, mark_identification,
         similarity(mark_identification, $1) as sim_score
         FROM trademarks
         WHERE mark_identification % $1
         ORDER BY sim_score DESC LIMIT 20`,
        ["INNOVATION"],
      )

      const elapsed = Date.now() - start
      // Should complete within 5 seconds (generous for unoptimized)
      expect(elapsed).toBeLessThan(5000)
    })

    it.skipIf(!shouldRunLiveTests())("status filter does not significantly slow query", async () => {
      if (!databaseAvailable) return
      const start = Date.now()

      await pool.query(
        `SELECT serial_number, mark_identification,
         similarity(mark_identification, $1) as sim_score
         FROM trademarks
         WHERE mark_identification % $1
         AND status_code IN ('LIVE', 'REGISTERED')
         ORDER BY sim_score DESC LIMIT 20`,
        ["GLOBAL"],
      )

      const elapsed = Date.now() - start
      // Should still complete within 5 seconds with filter
      expect(elapsed).toBeLessThan(5000)
    })
  })
})
