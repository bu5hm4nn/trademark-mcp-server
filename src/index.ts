import { FastMCP } from "fastmcp"
import { z } from "zod"

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

// Base TSDR API URL
const TSDR_BASE_URL = "https://tsdrapi.uspto.gov/ts/cd"

// API Key for USPTO TSDR API (required since October 2020)
const API_KEY = process.env.USPTO_API_KEY

// PostgreSQL connection string for local trademark database (optional)
// Format: postgresql://user:password@host:port/database
const TRADEMARK_DB_URL = process.env.TRADEMARK_DB_URL

// TESS (Trademark Electronic Search System) URL for manual searches
const TESS_SEARCH_URL = "https://tmsearch.uspto.gov/search/search-results"

// Lazy-loaded PostgreSQL client (optional dependency)
let pgPool: any = null
let pgAvailable: boolean | null = null

async function getPostgresPool(): Promise<any | null> {
  if (pgAvailable === false) return null
  if (pgPool) return pgPool

  if (!TRADEMARK_DB_URL) {
    pgAvailable = false
    return null
  }

  try {
    const pg = await import("pg")
    pgPool = new pg.default.Pool({ connectionString: TRADEMARK_DB_URL })
    pgAvailable = true
    return pgPool
  } catch {
    // pg module not installed
    pgAvailable = false
    return null
  }
}

// Helper function to get headers with API key
function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "trademark-mcp-server/1.0.0",
  }

  if (API_KEY) {
    headers["USPTO-API-KEY"] = API_KEY
  }

  return headers
}

// Helper function to check if API key is configured
function checkApiKey(): string | null {
  if (!API_KEY) {
    return "❌ USPTO API key not configured. Please set the USPTO_API_KEY environment variable with your API key from https://account.uspto.gov/api-manager/"
  }
  return null
}

// Helper function to check if local trademark database is available
async function hasLocalTrademarkDb(): Promise<boolean> {
  const pool = await getPostgresPool()
  return pool !== null
}

// Trademark search by wordmark (text/phrase)
server.addTool({
  name: "trademark_search_by_wordmark",
  description: "Search for trademarks by wordmark (text/phrase). Uses local trademark database if configured, otherwise provides TESS search URL for manual lookup.",
  parameters: z.object({
    wordmark: z.string().min(1).describe("The trademark text/phrase to search for"),
    status: z.enum(["active", "all"]).default("all").describe("Filter by trademark status: 'active' (live trademarks only) or 'all'"),
    limit: z.number().min(1).max(100).default(20).describe("Maximum number of results to return"),
  }),
  annotations: {
    title: "Trademark Search by Wordmark",
    readOnlyHint: true,
    openWorldHint: true,
  },
  execute: async (args) => {
    // Check if local trademark database is available
    const pool = await getPostgresPool()

    if (pool) {
      try {
        // Build the SQL query with trigram similarity search
        let query = `
          SELECT
            serial_number,
            registration_number,
            mark_identification,
            status_code,
            filing_date,
            registration_date,
            similarity(mark_identification, $1) as sim_score
          FROM trademarks
          WHERE mark_identification % $1
        `
        const params: (string | number)[] = [args.wordmark]

        // Filter by status if requested
        if (args.status === "active") {
          query += ` AND status_code IN ('LIVE', 'REGISTERED')`
        }

        query += ` ORDER BY sim_score DESC LIMIT $2`
        params.push(args.limit)

        const result = await pool.query(query, params)

        if (result.rows.length === 0) {
          return `No trademarks found matching "${args.wordmark}" (status: ${args.status}).`
        }

        const results = result.rows.map((tm: any, index: number) => {
          return `${index + 1}. **${tm.mark_identification || "N/A"}**
   - Serial Number: ${tm.serial_number || "N/A"}
   - Registration Number: ${tm.registration_number || "N/A"}
   - Status: ${tm.status_code || "N/A"}
   - Filing Date: ${tm.filing_date || "N/A"}
   - Registration Date: ${tm.registration_date || "N/A"}
   - Similarity: ${(tm.sim_score * 100).toFixed(1)}%`
        }).join("\n\n")

        return `🔍 **Trademark Search Results for: "${args.wordmark}"** (status: ${args.status})\n\nFound ${result.rows.length} result(s):\n\n${results}\n\n---\nUse \`trademark_search_by_serial\` with a serial number to get full USPTO details.`
      } catch (error) {
        return `Error searching trademark database: ${error instanceof Error ? error.message : String(error)}\n\nFallback: Visit https://tmsearch.uspto.gov to search manually.`
      }
    }

    // Fallback: Provide TESS search URL guidance
    const tessUrl = `${TESS_SEARCH_URL}?query=${encodeURIComponent(args.wordmark)}&plurals=true&searchType=freeForm`

    return `🔍 **Trademark Search for: "${args.wordmark}"**

**Note:** Local trademark database not configured. Set TRADEMARK_DB_URL to enable programmatic wordmark search.

**Manual Search Option:**
📎 **TESS Search Link:** ${tessUrl}

**Alternative Methods:**
1. **Manual TESS Search:** Visit https://tmsearch.uspto.gov and enter your search
2. **If you have a serial number:** Use \`trademark_search_by_serial\` for detailed trademark data
3. **If you have a registration number:** Use \`trademark_search_by_registration\` for detailed data

**Common Serial Numbers for Reference:**
- Apple (logo): 78462704
- Nike (swoosh): 72016902
- Microsoft: 78213220`
  },
})

// Trademark search by serial number
server.addTool({
  name: "trademark_search_by_serial",
  description: "Search for trademark information using a serial number",
  parameters: z.object({
    serialNumber: z.string().min(8).max(8).describe("8-digit trademark serial number"),
    format: z.enum(["json", "xml"]).default("json").describe("Response format"),
  }),
  annotations: {
    title: "Trademark Search by Serial Number",
    readOnlyHint: true,
    openWorldHint: true,
  },
  execute: async (args) => {
    const apiKeyError = checkApiKey()
    if (apiKeyError) {
      return apiKeyError
    }

    try {
      // Use JSON or XML endpoint based on format parameter
      const fileExtension = args.format === "json" ? "json" : "xml"
      const url = `${TSDR_BASE_URL}/casestatus/sn${args.serialNumber}/info.${fileExtension}`

      const response = await fetch(url, {
        headers: getHeaders(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        if (errorText.includes("need to register for an API key")) {
          throw new Error(`🔑 USPTO API Authentication Issue

The USPTO TSDR API is rejecting our API key. This could be due to:

1. **API Key Activation Delay**: New keys may need 24-48 hours to activate
2. **Endpoint Restrictions**: Individual record endpoints may be temporarily disabled
3. **Authentication Method**: The API might require a different authentication format

**Your API Key**: ${API_KEY ? `${API_KEY.substring(0, 8)}...` : "Not set"}

**Next Steps**:
• Contact USPTO support: APIhelp@uspto.gov 
• Include your API key and this error message
• Ask specifically about individual record endpoint access

**Alternative**: Try bulk data download endpoints if available.`)
        }
        throw new Error(`USPTO API returned ${response.status}: ${response.statusText}. Error: ${errorText}`)
      }

      // Parse response based on format
      if (args.format === "json") {
        const jsonData = await response.json()
        return JSON.stringify(jsonData, null, 2)
      } else {
        const xmlData = await response.text()
        return xmlData
      }
    } catch (error) {
      return `Error fetching trademark data: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})

// Trademark status lookup
server.addTool({
  name: "trademark_status",
  description: "Get comprehensive status information for a trademark by serial number",
  parameters: z.object({
    serialNumber: z.string().min(8).max(8).describe("8-digit trademark serial number"),
  }),
  annotations: {
    title: "Trademark Status Lookup",
    readOnlyHint: true,
    openWorldHint: true,
  },
  execute: async (args) => {
    const apiKeyError = checkApiKey()
    if (apiKeyError) {
      return apiKeyError
    }

    try {
      const url = `${TSDR_BASE_URL}/casestatus/sn${args.serialNumber}/content`

      const response = await fetch(url, {
        headers: getHeaders(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        if (errorText.includes("need to register for an API key")) {
          throw new Error(`🔑 USPTO API Authentication Issue

The USPTO TSDR API is rejecting our API key. This could be due to:

1. **API Key Activation Delay**: New keys may need 24-48 hours to activate
2. **Endpoint Restrictions**: Individual record endpoints may be temporarily disabled
3. **Authentication Method**: The API might require a different authentication format

**Your API Key**: ${API_KEY ? `${API_KEY.substring(0, 8)}...` : "Not set"}

**Next Steps**:
• Contact USPTO support: APIhelp@uspto.gov 
• Include your API key and this error message
• Ask specifically about individual record endpoint access

**Alternative**: Try bulk data download endpoints if available.`)
        }
        throw new Error(`USPTO API returned ${response.status}: ${response.statusText}. Error: ${errorText}`)
      }

      const htmlContent = await response.text()

      // Extract key information from HTML (basic parsing)
      const titleMatch = htmlContent.match(/<title>(.*?)<\/title>/i)
      const title = titleMatch ? titleMatch[1] : "No title found"

      return `Trademark Status Report for Serial Number: ${args.serialNumber}\n\nTitle: ${title}\n\nFull HTML content available at: ${url}\n\nNote: This tool returns the HTML content from the USPTO. For structured data, use trademark_search_by_serial instead.`
    } catch (error) {
      return `Error fetching trademark status: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})

// Trademark image retrieval
server.addTool({
  name: "trademark_image",
  description: "Get the image URL for a trademark by serial number",
  parameters: z.object({
    serialNumber: z.string().min(8).max(8).describe("8-digit trademark serial number"),
  }),
  annotations: {
    title: "Trademark Image Retrieval",
    readOnlyHint: true,
    openWorldHint: true,
  },
  execute: async (args) => {
    const apiKeyError = checkApiKey()
    if (apiKeyError) {
      return apiKeyError
    }

    try {
      const imageUrl = `${TSDR_BASE_URL}/rawImage/${args.serialNumber}`

      // Test if the image exists by making a HEAD request
      const response = await fetch(imageUrl, {
        method: "HEAD",
        headers: getHeaders(),
      })

      if (!response.ok) {
        return `No image found for trademark serial number: ${args.serialNumber}`
      }

      return `Trademark image URL for serial number ${args.serialNumber}: ${imageUrl}\n\nYou can view this image by opening the URL in a web browser.`
    } catch (error) {
      return `Error retrieving trademark image: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})

// Trademark documents bundle
server.addTool({
  name: "trademark_documents",
  description: "Get the document bundle URL for a trademark by serial number",
  parameters: z.object({
    serialNumber: z.string().min(8).max(8).describe("8-digit trademark serial number"),
  }),
  annotations: {
    title: "Trademark Documents Bundle",
    readOnlyHint: true,
    openWorldHint: true,
  },
  execute: async (args) => {
    const apiKeyError = checkApiKey()
    if (apiKeyError) {
      return apiKeyError
    }

    try {
      const documentsUrl = `${TSDR_BASE_URL}/casedocs/bundle.pdf?sn=${args.serialNumber}`

      return `Document bundle URL for trademark serial number ${args.serialNumber}: ${documentsUrl}\n\nThis URL provides a PDF containing all documents related to this trademark application.\n\nNote: Document downloads are rate-limited to 4 requests per minute per API key.`
    } catch (error) {
      return `Error generating document bundle URL: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})

// Advanced trademark search by registration number
server.addTool({
  name: "trademark_search_by_registration",
  description: "Search for trademark information using a registration number",
  parameters: z.object({
    registrationNumber: z.string().min(7).max(8).describe("7-8 digit trademark registration number"),
    format: z.enum(["json", "xml"]).default("json").describe("Response format"),
  }),
  annotations: {
    title: "Trademark Search by Registration Number",
    readOnlyHint: true,
    openWorldHint: true,
  },
  execute: async (args) => {
    const apiKeyError = checkApiKey()
    if (apiKeyError) {
      return apiKeyError
    }

    try {
      // Use JSON or XML endpoint based on format parameter
      const fileExtension = args.format === "json" ? "json" : "xml"
      const url = `${TSDR_BASE_URL}/casestatus/rn${args.registrationNumber}/info.${fileExtension}`

      const response = await fetch(url, {
        headers: getHeaders(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        if (errorText.includes("need to register for an API key")) {
          throw new Error(`🔑 USPTO API Authentication Issue

The USPTO TSDR API is rejecting our API key. This could be due to:

1. **API Key Activation Delay**: New keys may need 24-48 hours to activate
2. **Endpoint Restrictions**: Individual record endpoints may be temporarily disabled
3. **Authentication Method**: The API might require a different authentication format

**Your API Key**: ${API_KEY ? `${API_KEY.substring(0, 8)}...` : "Not set"}

**Next Steps**:
• Contact USPTO support: APIhelp@uspto.gov 
• Include your API key and this error message
• Ask specifically about individual record endpoint access

**Alternative**: Try bulk data download endpoints if available.`)
        }
        throw new Error(`USPTO API returned ${response.status}: ${response.statusText}. Error: ${errorText}`)
      }

      // Parse response based on format
      if (args.format === "json") {
        const jsonData = await response.json()
        return JSON.stringify(jsonData, null, 2)
      } else {
        const xmlData = await response.text()
        return xmlData
      }
    } catch (error) {
      return `Error fetching trademark data by registration number: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})

export default server
