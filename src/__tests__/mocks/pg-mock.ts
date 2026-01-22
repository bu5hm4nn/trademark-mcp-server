/**
 * PostgreSQL Pool mock for testing
 */
import { vi, type Mock } from "vitest"
import type { TrademarkRecord } from "../fixtures/db-records.js"

export interface MockQueryResult {
  rows: Array<TrademarkRecord & { sim_score?: number }>
  rowCount?: number
  command?: string
}

export interface MockPoolConfig {
  queryResults?: MockQueryResult | MockQueryResult[]
  shouldFailConnect?: boolean
  shouldFailQuery?: boolean
  queryError?: Error
  connectError?: Error
  queryDelay?: number
}

/**
 * Creates a mock PostgreSQL Pool for testing
 */
export function createMockPool(config: MockPoolConfig = {}) {
  const {
    queryResults = { rows: [] },
    shouldFailConnect = false,
    shouldFailQuery = false,
    queryError = new Error("Query failed"),
    connectError = new Error("Connection failed"),
    queryDelay = 0,
  } = config

  let queryCallCount = 0

  const mockQuery: Mock = vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
    if (queryDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, queryDelay))
    }

    if (shouldFailQuery) {
      throw queryError
    }

    // Support multiple query results for sequential calls
    if (Array.isArray(queryResults)) {
      const result = queryResults[queryCallCount] || queryResults[queryResults.length - 1]
      queryCallCount++
      return result
    }

    return queryResults
  })

  const mockConnect: Mock = vi.fn().mockImplementation(async () => {
    if (shouldFailConnect) {
      throw connectError
    }

    return {
      query: mockQuery,
      release: vi.fn(),
    }
  })

  const mockEnd: Mock = vi.fn().mockResolvedValue(undefined)

  const pool = {
    query: mockQuery,
    connect: mockConnect,
    end: mockEnd,
    on: vi.fn(),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  }

  return {
    pool,
    mockQuery,
    mockConnect,
    mockEnd,
    resetCallCount: () => {
      queryCallCount = 0
    },
  }
}

/**
 * Creates mock pg module for dynamic import mocking
 */
export function createMockPgModule(config: MockPoolConfig = {}) {
  const { pool, mockQuery, mockConnect, mockEnd, resetCallCount } = createMockPool(config)

  const MockPool = vi.fn().mockImplementation(() => pool)

  return {
    default: {
      Pool: MockPool,
    },
    Pool: MockPool,
    pool,
    mockQuery,
    mockConnect,
    mockEnd,
    resetCallCount,
  }
}

/**
 * Mock for when pg module is not installed
 */
export function createPgNotInstalledMock() {
  return vi.fn().mockRejectedValue(new Error("Cannot find module 'pg'"))
}

/**
 * Helper to simulate trigram similarity search results
 */
export function createSimilarityResults(
  records: TrademarkRecord[],
  searchTerm: string
): MockQueryResult {
  // Simple simulation of trigram similarity scoring
  const scored = records
    .map((record) => {
      const mark = record.mark_identification.toLowerCase()
      const term = searchTerm.toLowerCase()

      // Very basic similarity calculation for testing
      let sim_score = 0
      if (mark === term) {
        sim_score = 1.0
      } else if (mark.includes(term) || term.includes(mark)) {
        sim_score = 0.7 + Math.random() * 0.2
      } else {
        // Check for common characters
        const markChars = new Set(mark.split(""))
        const termChars = new Set(term.split(""))
        const intersection = [...markChars].filter((c) => termChars.has(c))
        sim_score = intersection.length / Math.max(markChars.size, termChars.size)
      }

      return { ...record, sim_score }
    })
    .filter((r) => r.sim_score > 0.3)
    .sort((a, b) => b.sim_score - a.sim_score)

  return { rows: scored }
}

/**
 * Type for mocked pool
 */
export type MockedPool = ReturnType<typeof createMockPool>["pool"]
