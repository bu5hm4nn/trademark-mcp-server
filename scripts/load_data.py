#!/usr/bin/env python3
"""
USPTO Trademark Data Loader

Downloads and imports USPTO Trademark Case Files Dataset into PostgreSQL.
Data source: https://www.uspto.gov/ip-policy/economic-research/research-datasets/trademark-case-files-dataset

Usage:
    python load_data.py [--csv-path PATH] [--download]

Options:
    --csv-path PATH   Path to existing case_file.csv (skip download)
    --download        Download the dataset from USPTO (4+ GB)
"""

import os
import sys
import argparse
import logging
from datetime import datetime

import psycopg2
from psycopg2.extras import execute_values
import pandas as pd
import httpx

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Database configuration
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "trademarks")
DB_USER = os.getenv("DB_USER", "trademark")
DB_PASSWORD = os.getenv("DB_PASSWORD", "trademark")

# USPTO Dataset URL (CSV format) - Trademark Case Files Dataset
# Source: https://www.uspto.gov/ip-policy/economic-research/research-datasets/trademark-case-files-dataset
USPTO_DATASET_URL = "https://data.uspto.gov/ui/datasets/products/files/TRCFECO2/2023/case_file.csv.zip"
DATA_DIR = "/app/data"


def get_db_connection():
    """Get a database connection."""
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )


def download_dataset(output_dir: str) -> str:
    """Download USPTO dataset if not present."""
    import zipfile

    os.makedirs(output_dir, exist_ok=True)
    zip_path = os.path.join(output_dir, "case_file.csv.zip")
    csv_path = os.path.join(output_dir, "case_file.csv")

    # Check if CSV already exists
    if os.path.exists(csv_path):
        logger.info(f"Dataset already exists at {csv_path}")
        return csv_path

    # Download if zip doesn't exist
    if not os.path.exists(zip_path):
        logger.info(f"Downloading USPTO dataset from {USPTO_DATASET_URL}")
        logger.info("This is a large file (~4GB), please be patient...")

        with httpx.stream("GET", USPTO_DATASET_URL, timeout=None, follow_redirects=True) as response:
            response.raise_for_status()
            total = int(response.headers.get("content-length", 0))
            downloaded = 0

            with open(zip_path, "wb") as f:
                for chunk in response.iter_bytes(chunk_size=8192):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        pct = (downloaded / total) * 100
                        print(f"\rDownloading: {pct:.1f}% ({downloaded:,} / {total:,} bytes)", end="")

        print()  # New line after progress
        logger.info(f"Download complete: {zip_path}")

    # Extract CSV
    logger.info(f"Extracting {zip_path}")
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(output_dir)

    logger.info(f"Extraction complete: {csv_path}")
    return csv_path


def init_database():
    """Initialize database and create tables."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Drop existing table for fresh import
            cur.execute("DROP TABLE IF EXISTS trademarks CASCADE")

            # Create trademarks table
            cur.execute("""
                CREATE TABLE trademarks (
                    id SERIAL PRIMARY KEY,
                    serial_number VARCHAR(20) UNIQUE NOT NULL,
                    registration_number VARCHAR(20),
                    mark_identification TEXT,
                    status_code VARCHAR(10),
                    filing_date DATE,
                    registration_date DATE,
                    attorney_name TEXT,
                    mark_drawing_code VARCHAR(10),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            conn.commit()
            logger.info("Database tables created")
    finally:
        conn.close()


def create_indexes():
    """Create indexes after data load for better performance."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            logger.info("Creating indexes (this may take a while)...")

            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_trademarks_serial
                ON trademarks(serial_number);
            """)
            logger.info("  - Serial number index created")

            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_trademarks_registration
                ON trademarks(registration_number);
            """)
            logger.info("  - Registration number index created")

            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_trademarks_status
                ON trademarks(status_code);
            """)
            logger.info("  - Status code index created")

            # Full-text search index
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_trademarks_mark_fts
                ON trademarks USING gin(to_tsvector('english', COALESCE(mark_identification, '')));
            """)
            logger.info("  - Full-text search index created")

            conn.commit()
            logger.info("All indexes created successfully")
    finally:
        conn.close()


def load_csv_data(csv_path: str, batch_size: int = 10000):
    """Load CSV data into PostgreSQL."""
    logger.info(f"Loading data from {csv_path}")

    # Read CSV in chunks to handle large file
    # The USPTO case_file.csv has these relevant columns:
    # serial_no, registration_no, mark_id_char, cfh_status_cd, filing_dt, registration_dt, exm_attorney_name, mark_draw_cd

    column_mapping = {
        'serial_no': 'serial_number',
        'registration_no': 'registration_number',
        'mark_id_char': 'mark_identification',
        'cfh_status_cd': 'status_code',
        'filing_dt': 'filing_date',
        'registration_dt': 'registration_date',
        'exm_attorney_name': 'attorney_name',
        'mark_draw_cd': 'mark_drawing_code'
    }

    # Columns to read from CSV
    usecols = list(column_mapping.keys())

    conn = get_db_connection()
    total_loaded = 0

    try:
        # Read CSV in chunks
        for chunk_num, chunk in enumerate(pd.read_csv(
            csv_path,
            usecols=usecols,
            dtype=str,
            chunksize=batch_size,
            low_memory=False,
            on_bad_lines='skip'
        )):
            # Rename columns
            chunk = chunk.rename(columns=column_mapping)

            # Clean data
            chunk = chunk.fillna('')

            # Convert dates
            for date_col in ['filing_date', 'registration_date']:
                chunk[date_col] = pd.to_datetime(chunk[date_col], errors='coerce').dt.date

            # Prepare data for insertion
            records = chunk.to_dict('records')

            with conn.cursor() as cur:
                # Use execute_values for fast bulk insert
                values = [
                    (
                        r['serial_number'],
                        r['registration_number'] or None,
                        r['mark_identification'] or None,
                        r['status_code'] or None,
                        r['filing_date'] if pd.notna(r['filing_date']) else None,
                        r['registration_date'] if pd.notna(r['registration_date']) else None,
                        r['attorney_name'] or None,
                        r['mark_drawing_code'] or None
                    )
                    for r in records
                    if r['serial_number']  # Skip records without serial number
                ]

                if values:
                    execute_values(
                        cur,
                        """
                        INSERT INTO trademarks
                            (serial_number, registration_number, mark_identification,
                             status_code, filing_date, registration_date, attorney_name, mark_drawing_code)
                        VALUES %s
                        ON CONFLICT (serial_number) DO UPDATE SET
                            registration_number = EXCLUDED.registration_number,
                            mark_identification = EXCLUDED.mark_identification,
                            status_code = EXCLUDED.status_code,
                            filing_date = EXCLUDED.filing_date,
                            registration_date = EXCLUDED.registration_date,
                            attorney_name = EXCLUDED.attorney_name,
                            mark_drawing_code = EXCLUDED.mark_drawing_code
                        """,
                        values
                    )
                    conn.commit()
                    total_loaded += len(values)

            logger.info(f"  Loaded batch {chunk_num + 1}: {total_loaded:,} records total")

    except Exception as e:
        logger.error(f"Error loading data: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()

    logger.info(f"Data load complete: {total_loaded:,} trademarks imported")
    return total_loaded


def main():
    parser = argparse.ArgumentParser(description="Load USPTO Trademark data into PostgreSQL")
    parser.add_argument("--csv-path", help="Path to existing case_file.csv")
    parser.add_argument("--download", action="store_true", help="Download dataset from USPTO")
    parser.add_argument("--skip-download", action="store_true", help="Skip download, use existing data")
    args = parser.parse_args()

    start_time = datetime.now()
    logger.info("USPTO Trademark Data Loader")
    logger.info("=" * 50)

    # Determine CSV path
    if args.csv_path:
        csv_path = args.csv_path
        if not os.path.exists(csv_path):
            logger.error(f"CSV file not found: {csv_path}")
            sys.exit(1)
    elif args.download or not args.skip_download:
        csv_path = download_dataset(DATA_DIR)
    else:
        csv_path = os.path.join(DATA_DIR, "case_file.csv")
        if not os.path.exists(csv_path):
            logger.error(f"No CSV found at {csv_path}. Use --download to fetch it.")
            sys.exit(1)

    # Initialize database
    logger.info("Initializing database...")
    init_database()

    # Load data
    logger.info("Loading trademark data...")
    total = load_csv_data(csv_path)

    # Create indexes
    logger.info("Creating search indexes...")
    create_indexes()

    # Summary
    elapsed = datetime.now() - start_time
    logger.info("=" * 50)
    logger.info(f"Import complete!")
    logger.info(f"  Total trademarks: {total:,}")
    logger.info(f"  Time elapsed: {elapsed}")


if __name__ == "__main__":
    main()
