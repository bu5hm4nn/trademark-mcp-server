/**
 * Tool implementations for trademark MCP server
 * Exported separately for testability
 */

// Base TSDR API URL
export const TSDR_BASE_URL = "https://tsdrapi.uspto.gov/ts/cd"

// TESS (Trademark Electronic Search System) URL for manual searches
export const TESS_SEARCH_URL = "https://tmsearch.uspto.gov/search/search-results"

// Types for dependency injection
export interface ToolDependencies {
  getApiKey: () => string | undefined
  getDbUrl: () => string | undefined
  fetchFn: typeof fetch
  pgImport: () => Promise<any>
}

// Default dependencies using environment variables
export const defaultDependencies: ToolDependencies = {
  getApiKey: () => process.env.USPTO_API_KEY,
  getDbUrl: () => process.env.TRADEMARK_DB_URL,
  fetchFn: fetch,
  pgImport: () => import("pg"),
}

// Lazy-loaded PostgreSQL client state
let pgPool: any = null
let pgAvailable: boolean | null = null

/**
 * Reset pool state (for testing)
 */
export function resetPoolState(): void {
  pgPool = null
  pgAvailable = null
}

/**
 * Get or create PostgreSQL pool
 */
export async function getPostgresPool(deps: ToolDependencies = defaultDependencies): Promise<any | null> {
  if (pgAvailable === false) return null
  if (pgPool) return pgPool

  const dbUrl = deps.getDbUrl()
  if (!dbUrl) {
    pgAvailable = false
    return null
  }

  try {
    const pg = await deps.pgImport()
    pgPool = new pg.default.Pool({ connectionString: dbUrl })
    pgAvailable = true
    return pgPool
  } catch {
    pgAvailable = false
    return null
  }
}

/**
 * Get HTTP headers with API key
 */
export function getHeaders(deps: ToolDependencies = defaultDependencies): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "trademark-mcp-server/1.0.0",
  }

  const apiKey = deps.getApiKey()
  if (apiKey) {
    headers["USPTO-API-KEY"] = apiKey
  }

  return headers
}

/**
 * Check if API key is configured
 */
export function checkApiKey(deps: ToolDependencies = defaultDependencies): string | null {
  if (!deps.getApiKey()) {
    return "❌ USPTO API key not configured. Please set the USPTO_API_KEY environment variable with your API key from https://account.uspto.gov/api-manager/"
  }
  return null
}

// Tool argument types
export interface WordmarkSearchArgs {
  wordmark: string
  status: "active" | "all"
  limit: number
}

export interface SerialSearchArgs {
  serialNumber: string
  format: "json" | "xml"
}

export interface RegistrationSearchArgs {
  registrationNumber: string
  format: "json" | "xml"
}

export interface StatusArgs {
  serialNumber: string
}

export interface ImageArgs {
  serialNumber: string
}

export interface DocumentsArgs {
  serialNumber: string
}

/**
 * Search trademarks by wordmark (text/phrase)
 */
export async function searchByWordmark(
  args: WordmarkSearchArgs,
  deps: ToolDependencies = defaultDependencies
): Promise<string> {
  const pool = await getPostgresPool(deps)

  if (pool) {
    try {
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
}

/**
 * Search trademark by serial number
 */
export async function searchBySerial(
  args: SerialSearchArgs,
  deps: ToolDependencies = defaultDependencies
): Promise<string> {
  const apiKeyError = checkApiKey(deps)
  if (apiKeyError) {
    return apiKeyError
  }

  try {
    const fileExtension = args.format === "json" ? "json" : "xml"
    const url = `${TSDR_BASE_URL}/casestatus/sn${args.serialNumber}/info.${fileExtension}`

    const response = await deps.fetchFn(url, {
      headers: getHeaders(deps),
    })

    if (!response.ok) {
      const errorText = await response.text()
      if (errorText.includes("need to register for an API key")) {
        throw new Error(`🔑 USPTO API Authentication Issue

The USPTO TSDR API is rejecting our API key. This could be due to:

1. **API Key Activation Delay**: New keys may need 24-48 hours to activate
2. **Endpoint Restrictions**: Individual record endpoints may be temporarily disabled
3. **Authentication Method**: The API might require a different authentication format

**Your API Key**: ${deps.getApiKey() ? `${deps.getApiKey()!.substring(0, 8)}...` : "Not set"}

**Next Steps**:
• Contact USPTO support: APIhelp@uspto.gov
• Include your API key and this error message
• Ask specifically about individual record endpoint access

**Alternative**: Try bulk data download endpoints if available.`)
      }
      throw new Error(`USPTO API returned ${response.status}: ${response.statusText}. Error: ${errorText}`)
    }

    if (args.format === "json") {
      const jsonData = await response.json()
      return JSON.stringify(jsonData, null, 2)
    } else {
      return await response.text()
    }
  } catch (error) {
    return `Error fetching trademark data: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Get trademark status
 */
export async function getTrademarkStatus(
  args: StatusArgs,
  deps: ToolDependencies = defaultDependencies
): Promise<string> {
  const apiKeyError = checkApiKey(deps)
  if (apiKeyError) {
    return apiKeyError
  }

  try {
    const url = `${TSDR_BASE_URL}/casestatus/sn${args.serialNumber}/content`

    const response = await deps.fetchFn(url, {
      headers: getHeaders(deps),
    })

    if (!response.ok) {
      const errorText = await response.text()
      if (errorText.includes("need to register for an API key")) {
        throw new Error(`🔑 USPTO API Authentication Issue

The USPTO TSDR API is rejecting our API key.

**Your API Key**: ${deps.getApiKey() ? `${deps.getApiKey()!.substring(0, 8)}...` : "Not set"}

**Next Steps**:
• Contact USPTO support: APIhelp@uspto.gov`)
      }
      throw new Error(`USPTO API returned ${response.status}: ${response.statusText}. Error: ${errorText}`)
    }

    const htmlContent = await response.text()
    const titleMatch = htmlContent.match(/<title>(.*?)<\/title>/i)
    const title = titleMatch ? titleMatch[1] : "No title found"

    return `Trademark Status Report for Serial Number: ${args.serialNumber}\n\nTitle: ${title}\n\nFull HTML content available at: ${url}\n\nNote: This tool returns the HTML content from the USPTO. For structured data, use trademark_search_by_serial instead.`
  } catch (error) {
    return `Error fetching trademark status: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Get trademark image URL
 */
export async function getTrademarkImage(
  args: ImageArgs,
  deps: ToolDependencies = defaultDependencies
): Promise<string> {
  const apiKeyError = checkApiKey(deps)
  if (apiKeyError) {
    return apiKeyError
  }

  try {
    const imageUrl = `${TSDR_BASE_URL}/rawImage/${args.serialNumber}`

    const response = await deps.fetchFn(imageUrl, {
      method: "HEAD",
      headers: getHeaders(deps),
    })

    if (!response.ok) {
      return `No image found for trademark serial number: ${args.serialNumber}`
    }

    return `Trademark image URL for serial number ${args.serialNumber}: ${imageUrl}\n\nYou can view this image by opening the URL in a web browser.`
  } catch (error) {
    return `Error retrieving trademark image: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Get trademark documents URL
 */
export async function getTrademarkDocuments(
  args: DocumentsArgs,
  deps: ToolDependencies = defaultDependencies
): Promise<string> {
  const apiKeyError = checkApiKey(deps)
  if (apiKeyError) {
    return apiKeyError
  }

  const documentsUrl = `${TSDR_BASE_URL}/casedocs/bundle.pdf?sn=${args.serialNumber}`

  return `Document bundle URL for trademark serial number ${args.serialNumber}: ${documentsUrl}\n\nThis URL provides a PDF containing all documents related to this trademark application.\n\nNote: Document downloads are rate-limited to 4 requests per minute per API key.`
}

/**
 * Search trademark by registration number
 */
export async function searchByRegistration(
  args: RegistrationSearchArgs,
  deps: ToolDependencies = defaultDependencies
): Promise<string> {
  const apiKeyError = checkApiKey(deps)
  if (apiKeyError) {
    return apiKeyError
  }

  try {
    const fileExtension = args.format === "json" ? "json" : "xml"
    const url = `${TSDR_BASE_URL}/casestatus/rn${args.registrationNumber}/info.${fileExtension}`

    const response = await deps.fetchFn(url, {
      headers: getHeaders(deps),
    })

    if (!response.ok) {
      const errorText = await response.text()
      if (errorText.includes("need to register for an API key")) {
        throw new Error(`🔑 USPTO API Authentication Issue

The USPTO TSDR API is rejecting our API key.

**Your API Key**: ${deps.getApiKey() ? `${deps.getApiKey()!.substring(0, 8)}...` : "Not set"}

**Next Steps**:
• Contact USPTO support: APIhelp@uspto.gov`)
      }
      throw new Error(`USPTO API returned ${response.status}: ${response.statusText}. Error: ${errorText}`)
    }

    if (args.format === "json") {
      const jsonData = await response.json()
      return JSON.stringify(jsonData, null, 2)
    } else {
      return await response.text()
    }
  } catch (error) {
    return `Error fetching trademark data by registration number: ${error instanceof Error ? error.message : String(error)}`
  }
}
