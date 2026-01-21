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
│   ├── load_data.py  # USPTO bulk data downloader
│   ├── load_xml.py   # XML parser for trademark data
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

The `scripts/` directory contains Python scripts to populate PostgreSQL with USPTO trademark data.

### Current State

The scripts work but need improvement for ease of use:

1. **load_data.py** - Downloads USPTO bulk data files
2. **load_xml.py** - Parses XML and loads into PostgreSQL

### Data Source

USPTO Trademark Case Files Dataset: https://bulkdata.uspto.gov/

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

## TODO: Improve Data Loading

**Goal**: Make the data loading process simple and reliable for end users.

### Current Issues

1. **Complex setup** - User needs to manually download files, configure paths, run multiple scripts
2. **No progress feedback** - Long-running imports don't show progress well
3. **Error handling** - Scripts may fail silently or with cryptic errors
4. **No incremental updates** - Full reload required for updates

### Desired User Experience

```bash
# Ideal: Single command to set up and update trademark database
cd scripts/
pip install -r requirements.txt

# Initial setup (downloads ~10GB, takes hours)
python load_data.py --init --db-url postgresql://user:pass@host:5432/trademarks

# Daily updates (downloads ~50MB, takes minutes)
python load_data.py --update --db-url postgresql://user:pass@host:5432/trademarks
```

### Suggested Improvements

1. **Unified CLI** - Single entry point with clear commands
2. **Progress bars** - Use `tqdm` or similar for visual feedback
3. **Resume support** - Handle interruptions gracefully
4. **Logging** - Clear log output with verbosity levels
5. **Validation** - Check database connection before starting
6. **Docker option** - Dockerfile that handles the whole process

### Implementation Notes

- Keep Python scripts separate from Node.js MCP server
- PostgreSQL connection uses same `TRADEMARK_DB_URL` env var as MCP server
- Target audience: DevOps/technical users setting up the system
- Consider adding a health check endpoint to verify data freshness

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
