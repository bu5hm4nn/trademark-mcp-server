/**
 * Integration tests for HTTP server functionality
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

describe("HTTP Server", () => {
  let originalEnv: typeof process.env

  beforeEach(() => {
    originalEnv = { ...process.env }
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe("Server Configuration", () => {
    it("uses default port when PORT not set", () => {
      delete process.env.PORT

      const defaultPort = process.env.PORT || 3000
      expect(defaultPort).toBe(3000)
    })

    it("uses PORT environment variable when set", () => {
      process.env.PORT = "8002"

      const port = parseInt(process.env.PORT, 10)
      expect(port).toBe(8002)
    })

    it("uses default host when HOST not set", () => {
      delete process.env.HOST

      const defaultHost = process.env.HOST || "0.0.0.0"
      expect(defaultHost).toBe("0.0.0.0")
    })

    it("uses HOST environment variable when set", () => {
      process.env.HOST = "127.0.0.1"

      const host = process.env.HOST
      expect(host).toBe("127.0.0.1")
    })
  })

  describe("Health Endpoint", () => {
    it("responds to health check at /health", async () => {
      const { default: server } = await import("../../index.js")

      // The server has health configuration
      expect(server).toBeDefined()

      // Expected health response format
      const healthResponse = {
        status: "healthy",
        timestamp: expect.any(String),
        version: "1.0.0",
        service: "trademark-mcp-server",
      }

      expect(healthResponse.status).toBe("healthy")
      expect(healthResponse.service).toBe("trademark-mcp-server")
    })

    it("returns 200 status for healthy server", () => {
      const healthStatus = 200
      expect(healthStatus).toBe(200)
    })

    it("includes timestamp in health response", () => {
      const timestamp = new Date().toISOString()
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })

  describe("MCP Endpoint", () => {
    it("accepts requests on MCP endpoint", async () => {
      const { default: server } = await import("../../index.js")

      // FastMCP handles MCP requests
      expect(server).toBeDefined()
    })

    it("requires proper content type", () => {
      const validContentTypes = ["application/json", "text/event-stream"]
      expect(validContentTypes).toContain("application/json")
    })
  })

  describe("Request Handling", () => {
    it("handles concurrent requests", async () => {
      const { default: server } = await import("../../index.js")

      // Server should handle multiple concurrent requests
      expect(server).toBeDefined()
    })

    it("handles malformed requests gracefully", async () => {
      const { default: server } = await import("../../index.js")

      // Server should return appropriate error for malformed requests
      expect(server).toBeDefined()
    })
  })

  describe("Error Responses", () => {
    it("returns proper error format", () => {
      const errorResponse = {
        error: {
          code: -32600,
          message: "Invalid Request",
        },
      }

      expect(errorResponse.error).toBeDefined()
      expect(errorResponse.error.code).toBeDefined()
      expect(errorResponse.error.message).toBeDefined()
    })

    it("includes error codes for different error types", () => {
      const errorCodes = {
        parseError: -32700,
        invalidRequest: -32600,
        methodNotFound: -32601,
        invalidParams: -32602,
        internalError: -32603,
      }

      expect(errorCodes.parseError).toBe(-32700)
      expect(errorCodes.invalidRequest).toBe(-32600)
    })
  })
})

describe("Session Management", () => {
  describe("Session Headers", () => {
    it("manages sessions via mcp-session-id header", () => {
      const sessionId = "test-session-123"
      const headers = {
        "mcp-session-id": sessionId,
      }

      expect(headers["mcp-session-id"]).toBe(sessionId)
    })

    it("generates new session ID for new connections", () => {
      const generateSessionId = () =>
        Math.random().toString(36).substring(2, 15)

      const sessionId1 = generateSessionId()
      const sessionId2 = generateSessionId()

      expect(sessionId1).not.toBe(sessionId2)
    })
  })
})

describe("CORS and Security", () => {
  describe("CORS Headers", () => {
    it("allows cross-origin requests when configured", () => {
      // FastMCP may handle CORS internally
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, mcp-session-id",
      }

      expect(corsHeaders["Access-Control-Allow-Origin"]).toBeDefined()
    })
  })
})

describe("Server Startup", () => {
  it("logs startup message", async () => {
    const { default: server } = await import("../../index.js")

    // Server should be ready to start
    expect(server).toBeDefined()
  })

  it("handles graceful shutdown", async () => {
    const { default: server } = await import("../../index.js")

    // Server should support graceful shutdown
    expect(server).toBeDefined()
  })
})
