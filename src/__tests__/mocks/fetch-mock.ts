/**
 * Fetch mock for USPTO API testing
 */
import { vi, type Mock } from "vitest"
import {
  serialNumberJsonResponse,
  serialNumberXmlResponse,
  registrationNumberJsonResponse,
  statusHtmlResponse,
  apiKeyMissingErrorResponse,
  notFoundErrorResponse,
  rateLimitErrorResponse,
  serverErrorResponse,
} from "../fixtures/api-responses.js"

export interface MockResponse {
  ok: boolean
  status: number
  statusText: string
  body?: any
  headers?: Record<string, string>
}

export interface FetchMockConfig {
  defaultResponse?: MockResponse
  responseMap?: Map<string, MockResponse>
  shouldFail?: boolean
  failError?: Error
  networkDelay?: number
}

/**
 * Creates a mock fetch function for testing
 */
export function createFetchMock(config: FetchMockConfig = {}): Mock {
  const {
    defaultResponse = createSuccessResponse({}),
    responseMap = new Map(),
    shouldFail = false,
    failError = new Error("Network error"),
    networkDelay = 0,
  } = config

  return vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
    if (networkDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, networkDelay))
    }

    if (shouldFail) {
      throw failError
    }

    const urlString = url.toString()
    const response = responseMap.get(urlString) || defaultResponse

    return createMockResponse(response)
  })
}

/**
 * Creates a mock Response object
 */
function createMockResponse(config: MockResponse) {
  const { ok, status, statusText, body, headers = {} } = config

  return {
    ok,
    status,
    statusText,
    headers: new Map(Object.entries(headers)),
    json: vi.fn().mockImplementation(async () => {
      if (typeof body === "string") {
        return JSON.parse(body)
      }
      return body
    }),
    text: vi.fn().mockImplementation(async () => {
      if (typeof body === "string") {
        return body
      }
      return JSON.stringify(body)
    }),
    clone: vi.fn().mockReturnThis(),
  }
}

// Pre-configured response factories
export function createSuccessResponse(body: any, headers?: Record<string, string>): MockResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body,
    headers,
  }
}

export function createErrorResponse(
  status: number,
  statusText: string,
  body?: any
): MockResponse {
  return {
    ok: false,
    status,
    statusText,
    body,
  }
}

// Pre-configured mock responses for common scenarios
export const mockResponses = {
  // Serial number lookup responses
  serialNumberJson: createSuccessResponse(serialNumberJsonResponse),
  serialNumberXml: createSuccessResponse(serialNumberXmlResponse),

  // Registration number lookup responses
  registrationNumberJson: createSuccessResponse(registrationNumberJsonResponse),

  // Status endpoint responses
  statusHtml: createSuccessResponse(statusHtmlResponse),

  // Error responses
  unauthorized: createErrorResponse(401, "Unauthorized", apiKeyMissingErrorResponse),
  notFound: createErrorResponse(404, "Not Found", notFoundErrorResponse),
  rateLimit: createErrorResponse(429, "Too Many Requests", JSON.stringify(rateLimitErrorResponse)),
  serverError: createErrorResponse(500, "Internal Server Error", JSON.stringify(serverErrorResponse)),

  // Image endpoint responses
  imageExists: {
    ok: true,
    status: 200,
    statusText: "OK",
    body: null,
    headers: { "content-type": "image/png" },
  } as MockResponse,
  imageNotFound: createErrorResponse(404, "Not Found", "Image not found"),
}

/**
 * Creates a fetch mock configured for USPTO API testing
 */
export function createUsptoFetchMock(customResponses?: Map<string, MockResponse>): Mock {
  const TSDR_BASE_URL = "https://tsdrapi.uspto.gov/ts/cd"

  const defaultResponses = new Map<string, MockResponse>([
    // Serial number endpoints
    [`${TSDR_BASE_URL}/casestatus/sn78462704/info.json`, mockResponses.serialNumberJson],
    [`${TSDR_BASE_URL}/casestatus/sn78462704/info.xml`, mockResponses.serialNumberXml],
    [`${TSDR_BASE_URL}/casestatus/sn78462704/content`, mockResponses.statusHtml],

    // Registration number endpoints
    [`${TSDR_BASE_URL}/casestatus/rn3068631/info.json`, mockResponses.registrationNumberJson],
    [`${TSDR_BASE_URL}/casestatus/rn0978952/info.json`, mockResponses.registrationNumberJson],

    // Image endpoints
    [`${TSDR_BASE_URL}/rawImage/78462704`, mockResponses.imageExists],
    [`${TSDR_BASE_URL}/rawImage/00000000`, mockResponses.imageNotFound],

    // Not found serial numbers
    [`${TSDR_BASE_URL}/casestatus/sn00000000/info.json`, mockResponses.notFound],
    [`${TSDR_BASE_URL}/casestatus/rn0000000/info.json`, mockResponses.notFound],
  ])

  // Merge custom responses
  if (customResponses) {
    customResponses.forEach((value, key) => defaultResponses.set(key, value))
  }

  return createFetchMock({ responseMap: defaultResponses })
}

/**
 * Creates a fetch mock that requires API key authentication
 */
export function createAuthenticatedFetchMock(): Mock {
  return vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined

    // Check for API key
    if (!headers?.["USPTO-API-KEY"]) {
      return createMockResponse(mockResponses.unauthorized)
    }

    // Return success response
    return createMockResponse(mockResponses.serialNumberJson)
  })
}

/**
 * Creates a fetch mock that simulates network timeout
 */
export function createTimeoutFetchMock(timeoutMs: number = 5000): Mock {
  return vi.fn().mockImplementation(async () => {
    await new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Request timeout")), timeoutMs)
    })
  })
}

/**
 * Creates a fetch mock that simulates rate limiting
 */
export function createRateLimitFetchMock(requestLimit: number = 3): Mock {
  let requestCount = 0

  return vi.fn().mockImplementation(async () => {
    requestCount++
    if (requestCount > requestLimit) {
      return createMockResponse(mockResponses.rateLimit)
    }
    return createMockResponse(mockResponses.serialNumberJson)
  })
}
