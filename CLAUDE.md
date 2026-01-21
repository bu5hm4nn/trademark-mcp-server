# Trademark MCP Server

## Project Overview

This is a Model Context Protocol (MCP) server that provides tools for searching and retrieving USPTO trademark information. It combines:

1. **USPTO TSDR API** - Real-time trademark lookups by serial/registration number
2. **Local PostgreSQL Database** - Bulk trademark data for wordmark (text) searches

## Architecture

```
┌─────────────────────────────────────────┐
│         Trademark MCP Server            │
│              (FastMCP)                  │
├─────────────────────────────────────────┤
│  Tools:                                 │
│  - trademark_search_by_wordmark         │
│  - trademark_search_by_serial           │
│  - trademark_search_by_registration     │
│  - trademark_status                     │
│  - trademark_image                      │
│  - trademark_documents                  │
└──────────┬──────────────────┬───────────┘
           │                  │
           ▼                  ▼
    ┌──────────────┐   ┌──────────────┐
    │  PostgreSQL  │   │  USPTO TSDR  │
    │  (pg_trgm)   │   │     API      │
    │   Optional   │   │   Required   │
    └──────────────┘   └──────────────┘
```

## Key Files

```
trademark-mcp-server/
├── src/
│   ├── index.ts      # MCP server with all tools
│   ├── server.ts     # HTTP server entry point
│   └── bin.ts        # CLI entry point (stdio)
├── scripts/
│   ├── setup.sh      # Interactive setup wizard entry point
│   ├── wizard.py     # Main setup wizard (API key, DB, download, import)
│   ├── load_xml.py   # XML parser for trademark data
│   ├── docker-compose.db.yml  # Standalone PostgreSQL for easy setup
│   ├── init.sql      # PostgreSQL initialization (extensions)
│   └── requirements.txt
├── Dockerfile        # Production Docker image
└── package.json
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `USPTO_API_KEY` | Yes (for TSDR) | API key from https://developer.uspto.gov |
| `TRADEMARK_DB_URL` | No | PostgreSQL connection string for wordmark searches |
| `PORT` | No | HTTP server port (default: 3000) |
| `HOST` | No | HTTP server host (default: 0.0.0.0) |

## Data Loading Scripts

The `scripts/` directory contains tools to populate PostgreSQL with USPTO trademark data.

### Quick Start

```bash
cd scripts/
./setup.sh
```

This launches an interactive wizard that:
1. Prompts for your USPTO API key (get one at https://developer.uspto.gov)
2. Sets up PostgreSQL (via Docker or existing connection)
3. Downloads trademark data from USPTO
4. Imports into database with progress bars
5. Creates search indexes

### Data Source

USPTO Trademark Daily XML Files (via Bulk Data API)

- Daily update files: `apc25MMDD.zip`, `apc26MMDD.zip`
- Contains 13M+ trademark records

### Database Schema

The scripts expect this PostgreSQL schema (with pg_trgm extension):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS trademarks (
    serial_number VARCHAR(20) PRIMARY KEY,
    registration_number VARCHAR(20),
    mark_identification TEXT,
    status_code VARCHAR(10),
    filing_date DATE,
    registration_date DATE,
    owner_name TEXT,
    attorney_name TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trademarks_mark_trgm
ON trademarks USING gin (mark_identification gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_trademarks_status
ON trademarks (status_code);
```

---

## USPTO Bulk Data API Reference

### Authentication
All endpoints require the `x-api-key` header:
```bash
curl -H "x-api-key: YOUR_API_KEY" https://api.uspto.gov/api/v1/datasets/products/search
```

### Endpoints

#### 1. Search Products
```
GET https://api.uspto.gov/api/v1/datasets/products/search
```
Lists all available bulk data products.

#### 2. Product Details
```
GET https://api.uspto.gov/api/v1/datasets/products/{productIdentifier}
```
Returns metadata and file list for a specific product.

**Response Example:**
```json
{
  "count": 1,
  "bulkDataProductBag": [
    {
      "productIdentifier": "TRTDXFAP",
      "productDescriptionText": "Trademark Daily XML Files",
      "productTitleText": "Trademark Daily XML Files",
      "productFrequencyText": "DAILY",
      "productFileBag": {
        "count": 100,
        "fileDataBag": [
          {
            "fileName": "apc250421.zip",
            "fileSize": 50000000,
            "fileDataFromDate": "2025-04-21",
            "fileDataToDate": "2025-04-21",
            "fileDownloadURI": "https://api.uspto.gov/api/v1/datasets/products/files/TRTDXFAP/apc250421.zip",
            "fileLastModifiedDateTime": "2025-04-22 01:00:00"
          }
        ]
      }
    }
  ]
}
```

#### 3. Download File
```
GET https://api.uspto.gov/api/v1/datasets/products/files/{productIdentifier}/{fileName}
```

**Example:**
```bash
curl -L -H "x-api-key: YOUR_API_KEY" \
  https://api.uspto.gov/api/v1/datasets/products/files/TRTDXFAP/apc250421.zip \
  -o apc250421.zip
```

### Trademark Product IDs
- **TRTDXFAP** - Trademark Daily XML Files (daily updates)
- **TRTYRAP** - Trademark Annual XML Files (full archive 1884-present, ~9 GB)

### Schema Reference
- Response Schema: https://data.uspto.gov/documents/documents/bulkdata-response-schema.json

### Rate Limiting & Best Practices

**HTTP 429 Handling:**
```python
SLEEP_AFTER_429 = 0.1
HTTP_RETRY = 10

def make_request(url, retry=0):
    response = requests.get(url, headers=headers, allow_redirects=True)
    if response.status_code == 429 and retry < HTTP_RETRY:
        time.sleep(SLEEP_AFTER_429)
        return make_request(url, retry + 1)
    return response
```

**Important Notes:**
- Always follow redirects (`-L` in curl, `allow_redirects=True` in Python)
- Set timeout to 600 seconds for large files (100MB+ may have 60s delay before streaming)
- Files larger than 250MB may timeout after 10 minutes
- Use exponential backoff for rate limit errors

---

## Advanced Usage

### Manual Data Loading

For advanced users who want to bypass the wizard:

```bash
# Initialize database schema only
python load_xml.py --init-db

# Load a specific ZIP file
python load_xml.py --xml-path /path/to/apc250121.zip

# Load all files from a directory
python load_xml.py --bulk-dir /path/to/data --workers 4

# Create indexes only
python load_xml.py --create-indexes
```

### Environment Variables for load_xml.py

```bash
DB_HOST=localhost
DB_PORT=5432
DB_NAME=trademarks
DB_USER=trademark
DB_PASSWORD=trademark
NUM_WORKERS=6        # Parallel processing workers
BATCH_SIZE=5000      # Records per batch
```

### Docker Database Management

```bash
# Start standalone PostgreSQL
docker compose -f scripts/docker-compose.db.yml up -d

# Stop and remove
docker compose -f scripts/docker-compose.db.yml down

# Stop and remove including data
docker compose -f scripts/docker-compose.db.yml down -v
```

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run locally (stdio mode)
pnpm start

# Run HTTP server
pnpm serve

# Test with MCP inspector
pnpm inspect
```

## Testing

```bash
# Run tests
pnpm test

# With coverage
pnpm test:coverage
```
