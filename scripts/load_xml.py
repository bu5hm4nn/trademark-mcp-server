#!/usr/bin/env python3
"""
USPTO Trademark XML Data Loader (Multithreaded)

Parses USPTO Trademark Daily/Backfile XML files and imports into PostgreSQL.
Uses multiprocessing for parallel processing of large bulk files.

Usage:
    python load_xml.py --bulk-dir /path/to/bulk/files    # Load all bulk XML zips
    python load_xml.py --xml-path /path/to/file.zip     # Load single file
    python load_xml.py --daily-dir /path/to/daily       # Load daily updates
"""

import os
import sys
import argparse
import logging
import zipfile
import glob
import tempfile
import multiprocessing as mp
from datetime import datetime
from xml.etree import ElementTree as ET
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Optional, List, Dict, Any

import psycopg2
import psycopg2.errors
from psycopg2.extras import execute_values

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(processName)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Database configuration
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "trademarks")
DB_USER = os.getenv("DB_USER", "trademark")
DB_PASSWORD = os.getenv("DB_PASSWORD", "trademark")

# Number of worker processes (use 6 of 10 available cores)
NUM_WORKERS = int(os.getenv("NUM_WORKERS", "6"))
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "5000"))


def get_db_connection():
    """Get a database connection."""
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )


def init_database():
    """Initialize database with comprehensive schema."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Enable required extensions
            cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
            cur.execute("CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;")

            # Drop existing tables for fresh import
            cur.execute("DROP TABLE IF EXISTS trademark_statements CASCADE;")
            cur.execute("DROP TABLE IF EXISTS trademark_owners CASCADE;")
            cur.execute("DROP TABLE IF EXISTS trademarks CASCADE;")

            # Create main trademarks table with all fields
            cur.execute("""
                CREATE TABLE trademarks (
                    serial_number VARCHAR(20) PRIMARY KEY,
                    registration_number VARCHAR(20),
                    transaction_date DATE,

                    -- Core identification
                    mark_identification TEXT,
                    mark_drawing_code VARCHAR(10),
                    standard_characters BOOLEAN DEFAULT FALSE,

                    -- Status
                    status_code VARCHAR(10),
                    status_date DATE,

                    -- Key dates
                    filing_date DATE,
                    registration_date DATE,
                    publication_date DATE,
                    abandonment_date DATE,
                    cancellation_date DATE,
                    renewal_date DATE,

                    -- Cancellation
                    cancellation_code VARCHAR(10),

                    -- Mark type flags
                    is_trademark BOOLEAN DEFAULT FALSE,
                    is_service_mark BOOLEAN DEFAULT FALSE,
                    is_collective_trademark BOOLEAN DEFAULT FALSE,
                    is_collective_service_mark BOOLEAN DEFAULT FALSE,
                    is_collective_membership_mark BOOLEAN DEFAULT FALSE,
                    is_certification_mark BOOLEAN DEFAULT FALSE,

                    -- Register type
                    is_supplemental_register BOOLEAN DEFAULT FALSE,

                    -- Drawing characteristics
                    has_color BOOLEAN DEFAULT FALSE,
                    is_3d BOOLEAN DEFAULT FALSE,

                    -- Filing basis (current)
                    basis_use_in_commerce BOOLEAN DEFAULT FALSE,
                    basis_intent_to_use BOOLEAN DEFAULT FALSE,
                    basis_foreign_application BOOLEAN DEFAULT FALSE,
                    basis_foreign_registration BOOLEAN DEFAULT FALSE,
                    basis_international_registration BOOLEAN DEFAULT FALSE,

                    -- Pending actions
                    cancellation_pending BOOLEAN DEFAULT FALSE,
                    opposition_pending BOOLEAN DEFAULT FALSE,
                    interference_pending BOOLEAN DEFAULT FALSE,
                    concurrent_use_pending BOOLEAN DEFAULT FALSE,

                    -- Section status
                    section_8_accepted BOOLEAN DEFAULT FALSE,
                    section_15_acknowledged BOOLEAN DEFAULT FALSE,
                    section_2f BOOLEAN DEFAULT FALSE,

                    -- Attorney
                    attorney_name TEXT,
                    attorney_docket_number TEXT,
                    domestic_representative TEXT,

                    -- Classifications (arrays for multi-class marks)
                    international_classes TEXT[],  -- Nice Classification (001-045)
                    us_classes TEXT[],             -- US Classification (A, B, 200, etc.)
                    primary_class VARCHAR(10),

                    -- First use dates (from primary classification)
                    first_use_anywhere_date DATE,
                    first_use_in_commerce_date DATE,

                    -- Design search codes
                    design_codes TEXT[],

                    -- Primary owner (denormalized for fast search)
                    owner_name TEXT,
                    owner_type VARCHAR(10),
                    owner_legal_entity_type VARCHAR(10),
                    owner_address TEXT,
                    owner_city TEXT,
                    owner_state VARCHAR(10),
                    owner_country VARCHAR(10),
                    owner_postcode VARCHAR(20),

                    -- Correspondent
                    correspondent_address TEXT,

                    -- International registration
                    ir_number VARCHAR(20),
                    ir_registration_date DATE,
                    ir_status_code VARCHAR(10),

                    -- Metadata
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            # Create statements table for goods/services descriptions
            cur.execute("""
                CREATE TABLE trademark_statements (
                    id SERIAL PRIMARY KEY,
                    serial_number VARCHAR(20) NOT NULL REFERENCES trademarks(serial_number) ON DELETE CASCADE,
                    type_code VARCHAR(10),
                    text TEXT,
                    UNIQUE(serial_number, type_code, text)
                );
            """)

            # Create owners table for multiple owners
            cur.execute("""
                CREATE TABLE trademark_owners (
                    id SERIAL PRIMARY KEY,
                    serial_number VARCHAR(20) NOT NULL REFERENCES trademarks(serial_number) ON DELETE CASCADE,
                    entry_number INTEGER,
                    party_type VARCHAR(10),
                    party_name TEXT,
                    legal_entity_type VARCHAR(10),
                    address TEXT,
                    city TEXT,
                    state VARCHAR(10),
                    country VARCHAR(10),
                    postcode VARCHAR(20),
                    dba_aka TEXT,
                    UNIQUE(serial_number, entry_number)
                );
            """)

            conn.commit()
            logger.info("Database schema created successfully")

    except Exception as e:
        logger.error(f"Error creating schema: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()


def create_indexes():
    """Create indexes after data load for better performance."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            logger.info("Creating indexes (this may take a while)...")

            # Primary lookup indexes
            cur.execute("CREATE INDEX IF NOT EXISTS idx_tm_registration ON trademarks(registration_number);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_tm_status ON trademarks(status_code);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_tm_filing_date ON trademarks(filing_date);")
            logger.info("  - Basic indexes created")

            # Full-text search index (simple dictionary for brand names)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_tm_mark_fts
                ON trademarks USING gin(to_tsvector('simple', COALESCE(mark_identification, '')));
            """)
            logger.info("  - Full-text search index created")

            # Trigram index for fuzzy search
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_tm_mark_trgm
                ON trademarks USING gin(mark_identification gin_trgm_ops);
            """)
            logger.info("  - Trigram index created")

            # Classification indexes (GIN for array containment queries)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_tm_intl_classes
                ON trademarks USING gin(international_classes);
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_tm_us_classes
                ON trademarks USING gin(us_classes);
            """)
            logger.info("  - Classification indexes created")

            # Owner name index for search
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_tm_owner_name
                ON trademarks USING gin(to_tsvector('simple', COALESCE(owner_name, '')));
            """)
            logger.info("  - Owner name index created")

            # Mark type indexes for filtering
            cur.execute("CREATE INDEX IF NOT EXISTS idx_tm_is_trademark ON trademarks(is_trademark) WHERE is_trademark;")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_tm_is_service_mark ON trademarks(is_service_mark) WHERE is_service_mark;")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_tm_is_certification_mark ON trademarks(is_certification_mark) WHERE is_certification_mark;")
            logger.info("  - Mark type indexes created")

            # Statements index
            cur.execute("CREATE INDEX IF NOT EXISTS idx_stmt_serial ON trademark_statements(serial_number);")

            # Owners index
            cur.execute("CREATE INDEX IF NOT EXISTS idx_owner_serial ON trademark_owners(serial_number);")

            conn.commit()
            logger.info("All indexes created successfully")

    except Exception as e:
        logger.error(f"Error creating indexes: {e}")
        raise
    finally:
        conn.close()


def parse_date(date_str: str) -> Optional[datetime]:
    """Parse USPTO date format YYYYMMDD to date object."""
    if not date_str or date_str == '0' or len(date_str) != 8:
        return None
    try:
        return datetime.strptime(date_str, '%Y%m%d').date()
    except ValueError:
        return None


def get_text(element: ET.Element, tag: str) -> Optional[str]:
    """Safely get text from XML element."""
    child = element.find(tag)
    if child is not None and child.text:
        return child.text.strip()
    return None


def get_bool(element: ET.Element, tag: str) -> bool:
    """Get boolean from T/F indicator element."""
    text = get_text(element, tag)
    return text == 'T' if text else False


def get_all_text(element: ET.Element, tag: str) -> List[str]:
    """Get all text values for a repeated element."""
    values = []
    for child in element.findall(tag):
        if child.text:
            values.append(child.text.strip())
    return values


def parse_case_file(case_file_elem: ET.Element) -> Optional[Dict[str, Any]]:
    """Parse a single case-file element into a record dict."""
    serial = get_text(case_file_elem, 'serial-number')
    if not serial:
        return None

    record = {
        'serial_number': serial,
        'registration_number': get_text(case_file_elem, 'registration-number'),
        'transaction_date': parse_date(get_text(case_file_elem, 'transaction-date')),
    }

    # Skip placeholder registration numbers
    if record['registration_number'] == '0000000':
        record['registration_number'] = None

    # Parse case-file-header
    header = case_file_elem.find('case-file-header')
    if header is not None:
        # Core fields
        record['mark_identification'] = get_text(header, 'mark-identification')
        record['mark_drawing_code'] = get_text(header, 'mark-drawing-code')
        record['standard_characters'] = get_bool(header, 'standard-characters-claimed-in')

        # Status
        record['status_code'] = get_text(header, 'status-code')
        record['status_date'] = parse_date(get_text(header, 'status-date'))

        # Key dates
        record['filing_date'] = parse_date(get_text(header, 'filing-date'))
        record['registration_date'] = parse_date(get_text(header, 'registration-date'))
        record['publication_date'] = parse_date(get_text(header, 'published-for-opposition-date'))
        record['abandonment_date'] = parse_date(get_text(header, 'abandonment-date'))
        record['cancellation_date'] = parse_date(get_text(header, 'cancellation-date'))
        record['renewal_date'] = parse_date(get_text(header, 'renewal-date'))
        record['cancellation_code'] = get_text(header, 'cancellation-code')

        # Mark type flags
        record['is_trademark'] = get_bool(header, 'trademark-in')
        record['is_service_mark'] = get_bool(header, 'service-mark-in')
        record['is_collective_trademark'] = get_bool(header, 'collective-trademark-in')
        record['is_collective_service_mark'] = get_bool(header, 'collective-service-mark-in')
        record['is_collective_membership_mark'] = get_bool(header, 'collective-membership-mark-in')
        record['is_certification_mark'] = get_bool(header, 'certification-mark-in')

        # Register type
        record['is_supplemental_register'] = get_bool(header, 'supplemental-register-in')

        # Drawing characteristics
        record['has_color'] = get_bool(header, 'color-drawing-current-in')
        record['is_3d'] = get_bool(header, 'drawing-3d-current-in')

        # Filing basis (current)
        record['basis_use_in_commerce'] = get_bool(header, 'use-application-currently-in')
        record['basis_intent_to_use'] = get_bool(header, 'intent-to-use-current-in')
        record['basis_foreign_application'] = get_bool(header, 'filing-basis-current-44d-in')
        record['basis_foreign_registration'] = get_bool(header, 'filing-basis-current-44e-in')
        record['basis_international_registration'] = get_bool(header, 'filing-basis-current-66a-in')

        # Pending actions
        record['cancellation_pending'] = get_bool(header, 'cancellation-pending-in')
        record['opposition_pending'] = get_bool(header, 'opposition-pending-in')
        record['interference_pending'] = get_bool(header, 'interference-pending-in')
        record['concurrent_use_pending'] = get_bool(header, 'concurrent-use-proceeding-in')

        # Section status
        record['section_8_accepted'] = get_bool(header, 'section-8-accepted-in')
        record['section_15_acknowledged'] = get_bool(header, 'section-15-acknowledged-in')
        record['section_2f'] = get_bool(header, 'section-2f-in')

        # Attorney
        record['attorney_name'] = get_text(header, 'attorney-name')
        record['attorney_docket_number'] = get_text(header, 'attorney-docket-number')
        record['domestic_representative'] = get_text(header, 'domestic-representative-name')

    # Parse classifications
    intl_classes = []
    us_classes = []
    primary_class = None
    first_use_anywhere = None
    first_use_commerce = None

    classifications = case_file_elem.find('classifications')
    if classifications is not None:
        for classification in classifications.findall('classification'):
            intl_codes = get_all_text(classification, 'international-code')
            us_codes = get_all_text(classification, 'us-code')
            intl_classes.extend(intl_codes)
            us_classes.extend(us_codes)

            if primary_class is None:
                primary_class = get_text(classification, 'primary-code')
            if first_use_anywhere is None:
                first_use_anywhere = parse_date(get_text(classification, 'first-use-anywhere-date'))
            if first_use_commerce is None:
                first_use_commerce = parse_date(get_text(classification, 'first-use-in-commerce-date'))

    record['international_classes'] = list(set(intl_classes)) if intl_classes else None
    record['us_classes'] = list(set(us_classes)) if us_classes else None
    record['primary_class'] = primary_class
    record['first_use_anywhere_date'] = first_use_anywhere
    record['first_use_in_commerce_date'] = first_use_commerce

    # Parse design search codes
    design_codes = []
    design_searches = case_file_elem.find('design-searches')
    if design_searches is not None:
        for design_search in design_searches.findall('design-search'):
            code = get_text(design_search, 'code')
            if code:
                design_codes.append(code)
    record['design_codes'] = design_codes if design_codes else None

    # Parse primary owner
    owners = []
    case_file_owners = case_file_elem.find('case-file-owners')
    if case_file_owners is not None:
        for owner in case_file_owners.findall('case-file-owner'):
            owner_data = {
                'entry_number': get_text(owner, 'entry-number'),
                'party_type': get_text(owner, 'party-type'),
                'party_name': get_text(owner, 'party-name'),
                'legal_entity_type': get_text(owner, 'legal-entity-type-code'),
                'address': ' '.join(filter(None, [get_text(owner, f'address-{i}') for i in range(1, 3)])),
                'city': get_text(owner, 'city'),
                'state': get_text(owner, 'state'),
                'country': get_text(owner, 'country'),
                'postcode': get_text(owner, 'postcode'),
                'dba_aka': get_text(owner, 'dba-aka-text'),
            }
            owners.append(owner_data)

    # Store primary owner in main record
    if owners:
        primary_owner = owners[0]
        record['owner_name'] = primary_owner['party_name']
        record['owner_type'] = primary_owner['party_type']
        record['owner_legal_entity_type'] = primary_owner['legal_entity_type']
        record['owner_address'] = primary_owner['address']
        record['owner_city'] = primary_owner['city']
        record['owner_state'] = primary_owner['state']
        record['owner_country'] = primary_owner['country']
        record['owner_postcode'] = primary_owner['postcode']

    record['owners'] = owners  # Store all owners for separate table

    # Parse correspondent
    correspondent = case_file_elem.find('correspondent')
    if correspondent is not None:
        addr_parts = [get_text(correspondent, f'address-{i}') for i in range(1, 6)]
        record['correspondent_address'] = '\n'.join(filter(None, addr_parts))

    # Parse statements
    statements = []
    case_file_statements = case_file_elem.find('case-file-statements')
    if case_file_statements is not None:
        for stmt in case_file_statements.findall('case-file-statement'):
            type_code = get_text(stmt, 'type-code')
            text = get_text(stmt, 'text')
            if type_code and text:
                statements.append({'type_code': type_code, 'text': text})
    record['statements'] = statements

    # Parse international registration
    ir = case_file_elem.find('international-registration')
    if ir is not None:
        record['ir_number'] = get_text(ir, 'international-registration-number')
        record['ir_registration_date'] = parse_date(get_text(ir, 'international-registration-date'))
        record['ir_status_code'] = get_text(ir, 'international-status-code')

    return record


def upsert_batch(records: List[Dict], max_retries: int = 5) -> int:
    """Upsert a batch of records to the database with retry for deadlocks and lock timeouts."""
    if not records:
        return 0

    import time
    import random

    last_error = None
    for attempt in range(max_retries):
        conn = None
        try:
            conn = get_db_connection()
            with conn.cursor() as cur:
                # Set lock_timeout to wait up to 30 seconds for locks instead of failing immediately
                # This allows concurrent transactions to complete before timing out
                cur.execute("SET lock_timeout = '30s';")
                # Increase deadlock_timeout to give more time for lock conflicts to resolve
                cur.execute("SET deadlock_timeout = '5s';")
            result = _do_upsert(conn, records)
            conn.close()
            return result
        except (psycopg2.errors.DeadlockDetected, psycopg2.errors.LockNotAvailable) as e:
            last_error = e
            error_type = "Deadlock" if isinstance(e, psycopg2.errors.DeadlockDetected) else "Lock timeout"
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    pass
                try:
                    conn.close()
                except Exception:
                    pass
            if attempt < max_retries - 1:
                # Exponential backoff with jitter
                sleep_time = (2 ** attempt) + random.uniform(0, 1)
                logger.warning(f"{error_type} detected, retry {attempt + 1}/{max_retries} after {sleep_time:.1f}s")
                time.sleep(sleep_time)
            else:
                logger.error(f"{error_type} persisted after {max_retries} retries")
                raise
        except Exception as e:
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    pass
                try:
                    conn.close()
                except Exception:
                    pass
            raise

    if last_error:
        raise last_error
    return 0


def _deduplicate_records(records: List[Dict]) -> List[Dict]:
    """
    Deduplicate records by serial_number, keeping only the newest entry.

    When the same serial_number appears multiple times in a batch (common in daily files
    when a trademark's status changes), we keep the record with the most recent
    transaction_date, falling back to status_date if transaction_date is not available.
    """
    from collections import defaultdict

    # Group records by serial_number
    by_serial = defaultdict(list)
    for r in records:
        by_serial[r['serial_number']].append(r)

    # For each serial_number, keep the newest record
    deduplicated = []
    for serial, entries in by_serial.items():
        if len(entries) == 1:
            deduplicated.append(entries[0])
        else:
            # Sort by transaction_date (newest first), then status_date as tiebreaker
            # None dates are treated as oldest
            def date_key(r):
                td = r.get('transaction_date')
                sd = r.get('status_date')
                # Return tuple for sorting: (transaction_date, status_date)
                # Use a very old date for None to sort them last
                from datetime import date
                min_date = date(1800, 1, 1)
                return (td or min_date, sd or min_date)

            entries.sort(key=date_key, reverse=True)
            deduplicated.append(entries[0])
            logger.debug(f"Deduplicated {len(entries)} entries for serial {serial}, kept newest")

    return deduplicated


def _do_upsert(conn, records: List[Dict]) -> int:
    """Actually perform the upsert. Caller is responsible for closing connection."""
    with conn.cursor() as cur:
        # Deduplicate records - keep only the newest entry for each serial_number
        unique_records = _deduplicate_records(records)

        # Sort records by serial_number to ensure consistent lock ordering
        # This prevents deadlocks within the same batch
        sorted_records = sorted(unique_records, key=lambda r: r['serial_number'])

        # Prepare main trademark values
        trademark_values = []
        for r in sorted_records:
            trademark_values.append((
                r['serial_number'],
                r.get('registration_number'),
                r.get('transaction_date'),
                r.get('mark_identification'),
                r.get('mark_drawing_code'),
                r.get('standard_characters', False),
                r.get('status_code'),
                r.get('status_date'),
                r.get('filing_date'),
                r.get('registration_date'),
                r.get('publication_date'),
                r.get('abandonment_date'),
                r.get('cancellation_date'),
                r.get('renewal_date'),
                r.get('cancellation_code'),
                r.get('is_trademark', False),
                r.get('is_service_mark', False),
                r.get('is_collective_trademark', False),
                r.get('is_collective_service_mark', False),
                r.get('is_collective_membership_mark', False),
                r.get('is_certification_mark', False),
                r.get('is_supplemental_register', False),
                r.get('has_color', False),
                r.get('is_3d', False),
                r.get('basis_use_in_commerce', False),
                r.get('basis_intent_to_use', False),
                r.get('basis_foreign_application', False),
                r.get('basis_foreign_registration', False),
                r.get('basis_international_registration', False),
                r.get('cancellation_pending', False),
                r.get('opposition_pending', False),
                r.get('interference_pending', False),
                r.get('concurrent_use_pending', False),
                r.get('section_8_accepted', False),
                r.get('section_15_acknowledged', False),
                r.get('section_2f', False),
                r.get('attorney_name'),
                r.get('attorney_docket_number'),
                r.get('domestic_representative'),
                r.get('international_classes'),
                r.get('us_classes'),
                r.get('primary_class'),
                r.get('first_use_anywhere_date'),
                r.get('first_use_in_commerce_date'),
                r.get('design_codes'),
                r.get('owner_name'),
                r.get('owner_type'),
                r.get('owner_legal_entity_type'),
                r.get('owner_address'),
                r.get('owner_city'),
                r.get('owner_state'),
                r.get('owner_country'),
                r.get('owner_postcode'),
                r.get('correspondent_address'),
                r.get('ir_number'),
                r.get('ir_registration_date'),
                r.get('ir_status_code'),
            ))

        # Upsert trademarks
        execute_values(
            cur,
            """
            INSERT INTO trademarks (
                serial_number, registration_number, transaction_date,
                mark_identification, mark_drawing_code, standard_characters,
                status_code, status_date,
                filing_date, registration_date, publication_date, abandonment_date,
                cancellation_date, renewal_date, cancellation_code,
                is_trademark, is_service_mark, is_collective_trademark,
                is_collective_service_mark, is_collective_membership_mark, is_certification_mark,
                is_supplemental_register, has_color, is_3d,
                basis_use_in_commerce, basis_intent_to_use, basis_foreign_application,
                basis_foreign_registration, basis_international_registration,
                cancellation_pending, opposition_pending, interference_pending, concurrent_use_pending,
                section_8_accepted, section_15_acknowledged, section_2f,
                attorney_name, attorney_docket_number, domestic_representative,
                international_classes, us_classes, primary_class,
                first_use_anywhere_date, first_use_in_commerce_date,
                design_codes,
                owner_name, owner_type, owner_legal_entity_type,
                owner_address, owner_city, owner_state, owner_country, owner_postcode,
                correspondent_address,
                ir_number, ir_registration_date, ir_status_code,
                updated_at
            ) VALUES %s
            ON CONFLICT (serial_number) DO UPDATE SET
                registration_number = EXCLUDED.registration_number,
                transaction_date = EXCLUDED.transaction_date,
                mark_identification = EXCLUDED.mark_identification,
                mark_drawing_code = EXCLUDED.mark_drawing_code,
                standard_characters = EXCLUDED.standard_characters,
                status_code = EXCLUDED.status_code,
                status_date = EXCLUDED.status_date,
                filing_date = EXCLUDED.filing_date,
                registration_date = EXCLUDED.registration_date,
                publication_date = EXCLUDED.publication_date,
                abandonment_date = EXCLUDED.abandonment_date,
                cancellation_date = EXCLUDED.cancellation_date,
                renewal_date = EXCLUDED.renewal_date,
                cancellation_code = EXCLUDED.cancellation_code,
                is_trademark = EXCLUDED.is_trademark,
                is_service_mark = EXCLUDED.is_service_mark,
                is_collective_trademark = EXCLUDED.is_collective_trademark,
                is_collective_service_mark = EXCLUDED.is_collective_service_mark,
                is_collective_membership_mark = EXCLUDED.is_collective_membership_mark,
                is_certification_mark = EXCLUDED.is_certification_mark,
                is_supplemental_register = EXCLUDED.is_supplemental_register,
                has_color = EXCLUDED.has_color,
                is_3d = EXCLUDED.is_3d,
                basis_use_in_commerce = EXCLUDED.basis_use_in_commerce,
                basis_intent_to_use = EXCLUDED.basis_intent_to_use,
                basis_foreign_application = EXCLUDED.basis_foreign_application,
                basis_foreign_registration = EXCLUDED.basis_foreign_registration,
                basis_international_registration = EXCLUDED.basis_international_registration,
                cancellation_pending = EXCLUDED.cancellation_pending,
                opposition_pending = EXCLUDED.opposition_pending,
                interference_pending = EXCLUDED.interference_pending,
                concurrent_use_pending = EXCLUDED.concurrent_use_pending,
                section_8_accepted = EXCLUDED.section_8_accepted,
                section_15_acknowledged = EXCLUDED.section_15_acknowledged,
                section_2f = EXCLUDED.section_2f,
                attorney_name = EXCLUDED.attorney_name,
                attorney_docket_number = EXCLUDED.attorney_docket_number,
                domestic_representative = EXCLUDED.domestic_representative,
                international_classes = EXCLUDED.international_classes,
                us_classes = EXCLUDED.us_classes,
                primary_class = EXCLUDED.primary_class,
                first_use_anywhere_date = EXCLUDED.first_use_anywhere_date,
                first_use_in_commerce_date = EXCLUDED.first_use_in_commerce_date,
                design_codes = EXCLUDED.design_codes,
                owner_name = EXCLUDED.owner_name,
                owner_type = EXCLUDED.owner_type,
                owner_legal_entity_type = EXCLUDED.owner_legal_entity_type,
                owner_address = EXCLUDED.owner_address,
                owner_city = EXCLUDED.owner_city,
                owner_state = EXCLUDED.owner_state,
                owner_country = EXCLUDED.owner_country,
                owner_postcode = EXCLUDED.owner_postcode,
                correspondent_address = EXCLUDED.correspondent_address,
                ir_number = EXCLUDED.ir_number,
                ir_registration_date = EXCLUDED.ir_registration_date,
                ir_status_code = EXCLUDED.ir_status_code,
                updated_at = CURRENT_TIMESTAMP
            """,
            trademark_values,
            template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)"
        )

        conn.commit()
        return len(records)


def process_xml_file(xml_path: str) -> int:
    """Process a single XML file and return count of records processed."""
    logger.info(f"Processing {xml_path}")

    records = []
    total_processed = 0

    try:
        # Use iterparse for memory efficiency
        context = ET.iterparse(xml_path, events=('end',))

        for event, elem in context:
            if elem.tag == 'case-file':
                record = parse_case_file(elem)
                if record:
                    records.append(record)

                # Clear element to save memory
                elem.clear()

                # Batch insert
                if len(records) >= BATCH_SIZE:
                    inserted = upsert_batch(records)
                    total_processed += inserted
                    records = []

        # Insert remaining records
        if records:
            inserted = upsert_batch(records)
            total_processed += inserted

    except ET.ParseError as e:
        logger.error(f"XML parse error in {xml_path}: {e}")
    except Exception as e:
        logger.error(f"Error processing {xml_path}: {e}")
        raise

    logger.info(f"Completed {xml_path}: {total_processed:,} records")
    return total_processed


def process_zip_file(zip_path: str) -> int:
    """Extract and process XML from a zip file."""
    logger.info(f"Extracting {zip_path}")

    total = 0
    with tempfile.TemporaryDirectory() as tmpdir:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            for name in zf.namelist():
                if name.endswith('.xml'):
                    zf.extract(name, tmpdir)
                    xml_path = os.path.join(tmpdir, name)
                    total += process_xml_file(xml_path)
                    # Remove extracted file to save disk space
                    os.remove(xml_path)

    return total


def worker_process_file(file_path: str) -> tuple:
    """Worker function to process a single file (for multiprocessing)."""
    try:
        if file_path.endswith('.zip'):
            count = process_zip_file(file_path)
        elif file_path.endswith('.xml'):
            count = process_xml_file(file_path)
        else:
            return (file_path, 0, None)
        return (file_path, count, None)
    except Exception as e:
        return (file_path, 0, str(e))


def process_files_parallel(file_paths: List[str], num_workers: int = NUM_WORKERS) -> int:
    """Process multiple files in parallel using ProcessPoolExecutor."""
    total_processed = 0
    total_files = len(file_paths)
    completed = 0

    logger.info(f"Processing {total_files} files with {num_workers} workers")

    with ProcessPoolExecutor(max_workers=num_workers) as executor:
        futures = {executor.submit(worker_process_file, fp): fp for fp in file_paths}

        for future in as_completed(futures):
            file_path = futures[future]
            completed += 1

            try:
                path, count, error = future.result()
                if error:
                    logger.error(f"Error processing {path}: {error}")
                else:
                    total_processed += count
                    logger.info(f"[{completed}/{total_files}] Completed {os.path.basename(path)}: {count:,} records (Total: {total_processed:,})")
            except Exception as e:
                logger.error(f"Exception processing {file_path}: {e}")

    return total_processed


def main():
    parser = argparse.ArgumentParser(description="Load USPTO Trademark XML data into PostgreSQL (Multithreaded)")
    parser.add_argument("--xml-path", help="Path to a single XML or ZIP file")
    parser.add_argument("--bulk-dir", help="Path to directory containing bulk XML/ZIP files (apc*.zip)")
    parser.add_argument("--daily-dir", help="Path to directory containing daily update files")
    parser.add_argument("--pattern", default="apc*.zip", help="File pattern to match (default: apc*.zip)")
    parser.add_argument("--workers", type=int, default=NUM_WORKERS, help=f"Number of worker processes (default: {NUM_WORKERS})")
    parser.add_argument("--init-db", action="store_true", help="Initialize/reset database schema")
    parser.add_argument("--create-indexes", action="store_true", help="Create search indexes")
    parser.add_argument("--skip-indexes", action="store_true", help="Skip creating indexes after import")
    args = parser.parse_args()

    start_time = datetime.now()
    logger.info("USPTO Trademark XML Data Loader (Multithreaded)")
    logger.info(f"Workers: {args.workers}, Batch size: {BATCH_SIZE}")
    logger.info("=" * 60)

    # Initialize database if requested or if loading bulk data
    if args.init_db or args.bulk_dir:
        logger.info("Initializing database schema...")
        init_database()

    if args.create_indexes:
        create_indexes()
        return

    total_loaded = 0

    if args.xml_path:
        # Single file
        if args.xml_path.endswith('.zip'):
            total_loaded = process_zip_file(args.xml_path)
        else:
            total_loaded = process_xml_file(args.xml_path)

    elif args.bulk_dir or args.daily_dir:
        # Directory of files
        search_dir = args.bulk_dir or args.daily_dir
        pattern = os.path.join(search_dir, args.pattern)
        files = sorted(glob.glob(pattern))

        if not files:
            logger.error(f"No files found matching {pattern}")
            sys.exit(1)

        logger.info(f"Found {len(files)} files to process")
        total_loaded = process_files_parallel(files, args.workers)

    else:
        logger.error("Please specify --xml-path, --bulk-dir, or --daily-dir")
        sys.exit(1)

    # Create indexes unless skipped
    if not args.skip_indexes and (args.bulk_dir or args.init_db):
        logger.info("Creating search indexes...")
        create_indexes()

    # Summary
    elapsed = datetime.now() - start_time
    logger.info("=" * 60)
    logger.info(f"Import complete!")
    logger.info(f"  Total records processed: {total_loaded:,}")
    logger.info(f"  Time elapsed: {elapsed}")
    logger.info(f"  Rate: {total_loaded / elapsed.total_seconds():.0f} records/sec")


if __name__ == "__main__":
    main()
