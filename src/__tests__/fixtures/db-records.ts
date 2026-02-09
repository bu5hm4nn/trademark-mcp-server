/**
 * Sample trademark database records for testing
 */

export interface TrademarkRecord {
  serial_number: string
  registration_number: string | null
  mark_identification: string
  status_code: string
  filing_date: string | null
  registration_date: string | null
  owner_name?: string
  attorney_name?: string
}

// Sample trademark records
export const sampleTrademarks: TrademarkRecord[] = [
  {
    serial_number: "78462704",
    registration_number: "3068631",
    mark_identification: "APPLE",
    status_code: "630",
    filing_date: "2004-06-18",
    registration_date: "2006-03-14",
    owner_name: "Apple Inc.",
    attorney_name: "USPTO ATTORNEY",
  },
  {
    serial_number: "72016902",
    registration_number: "0978952",
    mark_identification: "NIKE",
    status_code: "630",
    filing_date: "1971-05-07",
    registration_date: "1974-01-22",
    owner_name: "Nike, Inc.",
    attorney_name: "NIKE LEGAL",
  },
  {
    serial_number: "78213220",
    registration_number: "2871738",
    mark_identification: "MICROSOFT",
    status_code: "630",
    filing_date: "2003-08-15",
    registration_date: "2004-08-10",
    owner_name: "Microsoft Corporation",
    attorney_name: "MS ATTORNEY",
  },
  {
    serial_number: "90123456",
    registration_number: null,
    mark_identification: "XEROX",
    status_code: "800",
    filing_date: "2020-01-15",
    registration_date: "2021-06-20",
    owner_name: "Xerox Corporation",
    attorney_name: null,
  },
  {
    serial_number: "90234567",
    registration_number: null,
    mark_identification: "GOOGLE",
    status_code: "630",
    filing_date: "2020-03-01",
    registration_date: null,
    owner_name: "Google LLC",
    attorney_name: null,
  },
  {
    serial_number: "89999999",
    registration_number: "8888888",
    mark_identification: "DEAD TRADEMARK",
    status_code: "710",
    filing_date: "2019-01-01",
    registration_date: "2020-01-01",
    owner_name: "Defunct Corp.",
    attorney_name: null,
  },
]

// Records with various status codes
export const statusCodeVariants: TrademarkRecord[] = [
  {
    serial_number: "97000001",
    registration_number: null,
    mark_identification: "PENDING MARK",
    status_code: "650",
    filing_date: "2024-01-01",
    registration_date: null,
  },
  {
    serial_number: "97000002",
    registration_number: "9000002",
    mark_identification: "REGISTERED MARK",
    status_code: "800",
    filing_date: "2023-01-01",
    registration_date: "2024-01-01",
  },
  {
    serial_number: "97000003",
    registration_number: null,
    mark_identification: "ABANDONED MARK",
    status_code: "710",
    filing_date: "2022-01-01",
    registration_date: null,
  },
  {
    serial_number: "97000004",
    registration_number: "9000004",
    mark_identification: "CANCELLED MARK",
    status_code: "790",
    filing_date: "2020-01-01",
    registration_date: "2021-01-01",
  },
]

// Records for fuzzy matching tests
export const fuzzyMatchRecords: TrademarkRecord[] = [
  {
    serial_number: "98000001",
    registration_number: "9800001",
    mark_identification: "SUNSHINE",
    status_code: "630",
    filing_date: "2023-06-01",
    registration_date: "2024-06-01",
  },
  {
    serial_number: "98000002",
    registration_number: "9800002",
    mark_identification: "SUNSHYNE",
    status_code: "630",
    filing_date: "2023-06-02",
    registration_date: "2024-06-02",
  },
  {
    serial_number: "98000003",
    registration_number: "9800003",
    mark_identification: "SUNSHNE",
    status_code: "630",
    filing_date: "2023-06-03",
    registration_date: "2024-06-03",
  },
  {
    serial_number: "98000004",
    registration_number: "9800004",
    mark_identification: "THE SUNSHINE EXPRESS",
    status_code: "800",
    filing_date: "2022-01-01",
    registration_date: "2023-01-01",
  },
  {
    serial_number: "98000005",
    registration_number: null,
    mark_identification: "UNRELATED MARK",
    status_code: "630",
    filing_date: "2023-07-01",
    registration_date: null,
  },
]

// Records with special characters for edge case testing
export const specialCharacterRecords: TrademarkRecord[] = [
  {
    serial_number: "99000001",
    registration_number: "9900001",
    mark_identification: "MARK & COMPANY",
    status_code: "630",
    filing_date: "2023-01-01",
    registration_date: "2024-01-01",
  },
  {
    serial_number: "99000002",
    registration_number: "9900002",
    mark_identification: "O'REILLY",
    status_code: "630",
    filing_date: "2023-01-02",
    registration_date: "2024-01-02",
  },
  {
    serial_number: "99000003",
    registration_number: "9900003",
    mark_identification: "50% OFF",
    status_code: "630",
    filing_date: "2023-01-03",
    registration_date: "2024-01-03",
  },
  {
    serial_number: "99000004",
    registration_number: "9900004",
    mark_identification: "CAFÉ MOCHA",
    status_code: "630",
    filing_date: "2023-01-04",
    registration_date: "2024-01-04",
  },
  {
    serial_number: "99000005",
    registration_number: null,
    mark_identification: 'TEST "QUOTED" MARK',
    status_code: "630",
    filing_date: "2023-01-05",
    registration_date: null,
  },
]

// Helper function to generate database query result format
export function toDbQueryResult(
  records: TrademarkRecord[],
  similarity?: number,
): { rows: Array<TrademarkRecord & { sim_score?: number }> } {
  return {
    rows: records.map((r) => ({
      ...r,
      ...(similarity !== undefined ? { sim_score: similarity } : {}),
    })),
  }
}

// Helper to create empty result
export const emptyDbResult = { rows: [] }

// Sample similarity scores for search results
export const searchResultsWithScores = [
  {
    ...fuzzyMatchRecords[0],
    sim_score: 1.0,
  },
  {
    ...fuzzyMatchRecords[1],
    sim_score: 0.9,
  },
  {
    ...fuzzyMatchRecords[2],
    sim_score: 0.85,
  },
  {
    ...fuzzyMatchRecords[3],
    sim_score: 0.6,
  },
]
