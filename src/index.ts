import { FastMCP } from "fastmcp"
import { z } from "zod"
import {
  searchByWordmark,
  searchBySerial,
  searchByRegistration,
  getTrademarkStatus,
  getTrademarkImage,
  getTrademarkDocuments,
} from "./tools.js"

const server = new FastMCP({
  name: "trademark-mcp-server",
  version: "1.1.0",
  instructions: `
This MCP server provides tools for searching and retrieving USPTO trademark information.

Available tools:
- trademark_search_by_wordmark: Search trademarks by text/phrase (uses local database if configured, otherwise provides TESS links)
- trademark_search_by_serial: Retrieve trademark details by 8-digit serial number (requires USPTO API key)
- trademark_search_by_registration: Retrieve trademark details by 7-8 digit registration number (requires USPTO API key)
- trademark_status: Get status information for a specific trademark (requires USPTO API key)
- trademark_image: Retrieve trademark image URLs (requires USPTO API key)
- trademark_documents: Get document bundle URLs for a trademark (requires USPTO API key)

Environment Variables:
- USPTO_API_KEY: Required for TSDR API calls (serial/registration lookups). Get from https://developer.uspto.gov/
- TRADEMARK_DB_URL: Optional. PostgreSQL connection string for local trademark database (e.g., postgresql://user:pass@host:5432/trademarks)

Rate limits:
- USPTO TSDR: 60 requests/min for general calls, 4 requests/min for PDF/ZIP downloads
`,
  health: {
    enabled: true,
    message: JSON.stringify({
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      service: "trademark-mcp-server",
    }),
    path: "/health",
    status: 200,
  },
})

// Trademark search by wordmark (text/phrase)
server.addTool({
  name: "trademark_search_by_wordmark",
  description:
    "Search for trademarks by wordmark (text/phrase). Uses local trademark database if configured, otherwise provides TESS search URL for manual lookup.",
  parameters: z.object({
    wordmark: z.string().min(1).max(255).describe("The trademark text/phrase to search for"),
    status: z
      .enum(["active", "all"])
      .default("all")
      .describe("Filter by trademark status: 'active' (live trademarks only) or 'all'"),
    limit: z.number().min(1).max(100).default(20).describe("Maximum number of results to return"),
  }),
  annotations: {
    title: "Trademark Search by Wordmark",
    readOnlyHint: true,
    openWorldHint: true,
  },
  execute: async (args) => searchByWordmark(args),
})

// Trademark search by serial number
server.addTool({
  name: "trademark_search_by_serial",
  description: "Search for trademark information using a serial number",
  parameters: z.object({
    serialNumber: z
      .string()
      .regex(/^\d{8}$/, "Must be exactly 8 digits")
      .describe("8-digit trademark serial number"),
    format: z.enum(["json", "xml"]).default("json").describe("Response format"),
  }),
  annotations: {
    title: "Trademark Search by Serial Number",
    readOnlyHint: true,
    openWorldHint: true,
  },
  execute: async (args) => searchBySerial(args),
})

// Trademark status lookup
server.addTool({
  name: "trademark_status",
  description: "Get comprehensive status information for a trademark by serial number",
  parameters: z.object({
    serialNumber: z
      .string()
      .regex(/^\d{8}$/, "Must be exactly 8 digits")
      .describe("8-digit trademark serial number"),
  }),
  annotations: {
    title: "Trademark Status Lookup",
    readOnlyHint: true,
    openWorldHint: true,
  },
  execute: async (args) => getTrademarkStatus(args),
})

// Trademark image retrieval
server.addTool({
  name: "trademark_image",
  description: "Get the image URL for a trademark by serial number",
  parameters: z.object({
    serialNumber: z
      .string()
      .regex(/^\d{8}$/, "Must be exactly 8 digits")
      .describe("8-digit trademark serial number"),
  }),
  annotations: {
    title: "Trademark Image Retrieval",
    readOnlyHint: true,
    openWorldHint: true,
  },
  execute: async (args) => getTrademarkImage(args),
})

// Trademark documents bundle
server.addTool({
  name: "trademark_documents",
  description: "Get the document bundle URL for a trademark by serial number",
  parameters: z.object({
    serialNumber: z
      .string()
      .regex(/^\d{8}$/, "Must be exactly 8 digits")
      .describe("8-digit trademark serial number"),
  }),
  annotations: {
    title: "Trademark Documents Bundle",
    readOnlyHint: true,
    openWorldHint: true,
  },
  execute: async (args) => getTrademarkDocuments(args),
})

// Advanced trademark search by registration number
server.addTool({
  name: "trademark_search_by_registration",
  description: "Search for trademark information using a registration number",
  parameters: z.object({
    registrationNumber: z
      .string()
      .regex(/^\d{7,8}$/, "Must be 7-8 digits")
      .describe("7-8 digit trademark registration number"),
    format: z.enum(["json", "xml"]).default("json").describe("Response format"),
  }),
  annotations: {
    title: "Trademark Search by Registration Number",
    readOnlyHint: true,
    openWorldHint: true,
  },
  execute: async (args) => searchByRegistration(args),
})

export default server
