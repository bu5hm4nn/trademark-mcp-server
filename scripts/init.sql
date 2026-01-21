-- PostgreSQL initialization script for USPTO Trademark Database
--
-- This script is run automatically when the PostgreSQL container starts.
-- It enables required extensions for trademark search functionality.
--

-- Enable pg_trgm for fuzzy text search (trigram matching)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable fuzzystrmatch for phonetic matching (soundex, metaphone)
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- Grant all privileges to the trademark user
GRANT ALL PRIVILEGES ON DATABASE trademarks TO trademark;
