/**
 * Live database test setup
 * Loads .env configuration and provides connection helpers
 */

import { config } from "dotenv"
import { resolve } from "path"

// Load .env from project root
config({ path: resolve(__dirname, "../../../.env") })

// Export connection info
export const LIVE_DB_URL = process.env.TRADEMARK_DB_URL

// Cache for connection test result
let connectionTestResult: boolean | null = null

/**
 * Test if we can actually connect to the database
 * Caches result to avoid repeated connection attempts
 */
async function canConnectToDatabase(): Promise<boolean> {
  if (connectionTestResult !== null) {
    return connectionTestResult
  }

  if (!LIVE_DB_URL) {
    connectionTestResult = false
    return false
  }

  let pool
  try {
    const pg = await import("pg")
    pool = new pg.default.Pool({
      connectionString: LIVE_DB_URL,
      connectionTimeoutMillis: 5000, // 5 second timeout
    })

    // Try to get a client and run a simple query
    const client = await pool.connect()
    await client.query("SELECT 1")
    client.release()

    connectionTestResult = true
    return true
  } catch {
    console.log("Live database not accessible - tests will be skipped")
    connectionTestResult = false
    return false
  } finally {
    if (pool) {
      await pool.end()
    }
  }
}

/**
 * Check if live tests should run
 * Tests will be skipped if TRADEMARK_DB_URL is not configured or database is unreachable
 */
export function shouldRunLiveTests(): boolean {
  // Synchronous check - only verifies URL is set
  // Actual connection test happens in beforeAll
  return !!LIVE_DB_URL
}

/**
 * Check if database is actually reachable (async version)
 * Call this in beforeAll to skip tests if DB is unreachable
 */
export async function isDatabaseReachable(): Promise<boolean> {
  return canConnectToDatabase()
}

/**
 * Get a real PostgreSQL pool for live testing
 * Returns null if TRADEMARK_DB_URL is not configured
 */
export async function getLivePool(): Promise<any | null> {
  if (!LIVE_DB_URL) return null

  // Check if database is reachable first
  const reachable = await canConnectToDatabase()
  if (!reachable) return null

  try {
    const pg = await import("pg")
    return new pg.default.Pool({
      connectionString: LIVE_DB_URL,
      connectionTimeoutMillis: 10000,
    })
  } catch (error) {
    console.error("Failed to create live database pool:", error)
    return null
  }
}

/**
 * Verify database has required structure
 * Throws if database is not properly configured
 */
export async function verifyDatabaseSetup(pool: any): Promise<void> {
  // Check pg_trgm extension
  const extResult = await pool.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")
  if (extResult.rows.length === 0) {
    throw new Error("pg_trgm extension is not installed in the database")
  }

  // Check trademarks table exists and has data
  const countResult = await pool.query("SELECT COUNT(*) as count FROM trademarks")
  const count = parseInt(countResult.rows[0].count, 10)
  if (count === 0) {
    throw new Error("Trademarks table is empty - cannot run live tests")
  }

  console.log(`Database verified: ${count.toLocaleString()} trademarks available`)
}
