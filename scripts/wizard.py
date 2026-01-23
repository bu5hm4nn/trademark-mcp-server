#!/usr/bin/env python3
"""
USPTO Trademark Database Setup Wizard

Interactive setup wizard for the USPTO trademark database.
Handles API key configuration, database setup, and data loading.

Usage:
    python wizard.py [--non-interactive] [--api-key KEY] [--db-url URL]
"""

import os
import sys
import time
import signal
import argparse
import subprocess
import tempfile
import zipfile
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

# Global reference to active subprocess for cleanup
_active_process: Optional[subprocess.Popen] = None


def _cleanup_subprocess(signum=None, frame=None):
    """Clean up subprocess and its children on exit."""
    global _active_process
    if _active_process is not None:
        try:
            # Kill the entire process group
            os.killpg(os.getpgid(_active_process.pid), signal.SIGTERM)
        except (ProcessLookupError, OSError):
            pass
        _active_process = None
    if signum == signal.SIGINT:
        console.print("\n[yellow]Interrupted - cleaning up...[/yellow]")
        sys.exit(1)

import httpx
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn, DownloadColumn, TransferSpeedColumn
from rich.prompt import Prompt, Confirm
from rich.panel import Panel
from rich.table import Table

# Constants
USPTO_API_BASE = "https://api.uspto.gov/api/v1/datasets"

# USPTO Trademark Product IDs
PRODUCT_DAILY = "TRTDXFAP"    # Trademark Daily XML Files (recent updates)
PRODUCT_ANNUAL = "TRTYRAP"   # Trademark Annual XML Files (full archive 1884-present)
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent  # trademark-mcp-server root
DATA_DIR = PROJECT_DIR / "data"
ENV_FILE = PROJECT_DIR / ".env"

# HTTP settings for USPTO API
HTTP_TIMEOUT = 600  # 10 minutes for large files
HTTP_RETRY = 10
SLEEP_AFTER_429 = 0.5

console = Console()


def print_header():
    """Print the wizard header."""
    console.print()
    console.print(Panel.fit(
        "[bold blue]USPTO Trademark Database Setup Wizard[/bold blue]",
        border_style="blue"
    ))
    console.print()


def validate_api_key(api_key: str) -> tuple[bool, str]:
    """
    Validate USPTO API key by making a test request.

    Returns:
        Tuple of (is_valid, message)
    """
    headers = {"x-api-key": api_key}
    url = f"{USPTO_API_BASE}/products/{PRODUCT_DAILY}"

    try:
        response = httpx.get(url, headers=headers, timeout=30)

        if response.status_code == 200:
            data = response.json()
            if data.get("count", 0) > 0:
                return True, "API key validated successfully"
            return False, "API key valid but no trademark data found"
        elif response.status_code == 401:
            return False, "Invalid API key (unauthorized)"
        elif response.status_code == 403:
            return False, "API key does not have access to trademark data"
        elif response.status_code == 429:
            return False, "Rate limited - please wait and try again"
        else:
            return False, f"API error: HTTP {response.status_code}"

    except httpx.TimeoutException:
        return False, "Connection timeout - USPTO API may be slow"
    except httpx.RequestError as e:
        return False, f"Connection error: {e}"


def load_env_file() -> Dict[str, str]:
    """Load existing .env file if present."""
    env_vars = {}
    if ENV_FILE.exists():
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    env_vars[key.strip()] = value.strip().strip('"\'')
    return env_vars


def save_to_env(key: str, value: str):
    """Save or update a key in the .env file."""
    env_vars = load_env_file()
    env_vars[key] = value

    with open(ENV_FILE, "w") as f:
        for k, v in env_vars.items():
            f.write(f'{k}="{v}"\n')


def step_api_key(auto_accept: bool = False) -> str:
    """Step 1: Get and validate USPTO API key."""
    console.print("[bold]Step 1: USPTO API Key[/bold]")
    console.print("  Get your key at: [link=https://developer.uspto.gov]https://developer.uspto.gov[/link]")
    console.print()

    # Check for existing key in .env
    env_vars = load_env_file()
    existing_key = env_vars.get("USPTO_API_KEY") or os.environ.get("USPTO_API_KEY")

    if existing_key:
        console.print(f"  Found existing API key: {existing_key[:8]}...{existing_key[-4:]}")
        use_existing = auto_accept or Confirm.ask("  Use this key?", default=True)
        if use_existing:
            with console.status("Validating API key..."):
                valid, message = validate_api_key(existing_key)
            if valid:
                console.print(f"  [green]✓ {message}[/green]")
                console.print()
                return existing_key
            else:
                console.print(f"  [red]✗ {message}[/red]")
                console.print("  Please enter a valid key.")

    # Prompt for API key
    while True:
        api_key = Prompt.ask("  Enter your USPTO API Key", password=True)

        if not api_key:
            console.print("  [red]API key is required[/red]")
            continue

        with console.status("Validating API key..."):
            valid, message = validate_api_key(api_key)

        if valid:
            console.print(f"  [green]✓ {message}[/green]")

            # Offer to save
            if Confirm.ask("  Save key to .env for future use?", default=True):
                save_to_env("USPTO_API_KEY", api_key)
                console.print(f"  [green]✓ Saved to {ENV_FILE.name}[/green]")

            console.print()
            return api_key
        else:
            console.print(f"  [red]✗ {message}[/red]")
            console.print("  Please try again.")


def step_database_setup() -> str:
    """Step 2: Configure database connection."""
    console.print("[bold]Step 2: Database Setup[/bold]")
    console.print()

    # Check for existing connection
    env_vars = load_env_file()
    existing_url = env_vars.get("TRADEMARK_DB_URL") or os.environ.get("TRADEMARK_DB_URL")

    # Check if Docker is available
    docker_available = False
    try:
        result = subprocess.run(["docker", "--version"], capture_output=True, text=True)
        docker_available = result.returncode == 0
    except FileNotFoundError:
        pass

    options = []
    if docker_available:
        options.append(("1", "Use Docker (recommended - auto-creates PostgreSQL)"))
    options.append(("2", "Use existing PostgreSQL connection string"))

    for opt_num, opt_text in options:
        console.print(f"  [{opt_num}] {opt_text}")
    console.print()

    if existing_url:
        console.print(f"  Found existing DB URL: {_mask_password(existing_url)}")
        if Confirm.ask("  Use this connection?", default=True):
            if _test_db_connection(existing_url):
                console.print()
                return existing_url
            else:
                console.print("  [red]Connection failed. Please choose another option.[/red]")

    valid_choices = [opt[0] for opt in options]
    choice = Prompt.ask("  Choose", choices=valid_choices, default=valid_choices[0])

    if choice == "1" and docker_available:
        return _setup_docker_database()
    else:
        return _setup_existing_database()


def _mask_password(url: str) -> str:
    """Mask password in database URL for display."""
    import re
    return re.sub(r'(://[^:]+:)[^@]+(@)', r'\1****\2', url)


def _test_db_connection(db_url: str) -> bool:
    """Test database connection."""
    try:
        import psycopg2
        conn = psycopg2.connect(db_url)
        conn.close()
        console.print("  [green]✓ Database connection successful[/green]")
        return True
    except Exception as e:
        console.print(f"  [red]✗ Connection failed: {e}[/red]")
        return False


def _setup_docker_database() -> str:
    """Start PostgreSQL in Docker."""
    console.print()
    console.print("  Starting PostgreSQL container...")

    compose_file = SCRIPT_DIR / "docker-compose.db.yml"

    if not compose_file.exists():
        console.print(f"  [red]Error: {compose_file} not found[/red]")
        sys.exit(1)

    # Start container
    try:
        subprocess.run(
            ["docker", "compose", "-f", str(compose_file), "up", "-d"],
            check=True,
            capture_output=True,
            cwd=SCRIPT_DIR
        )
    except subprocess.CalledProcessError as e:
        console.print(f"  [red]Error starting Docker: {e.stderr.decode()}[/red]")
        sys.exit(1)

    # Wait for PostgreSQL to be ready
    db_url = "postgresql://trademark:trademark@localhost:5432/trademarks"

    with console.status("Waiting for PostgreSQL to be ready..."):
        for _ in range(30):  # Wait up to 30 seconds
            if _test_db_connection_quiet(db_url):
                break
            time.sleep(1)
        else:
            console.print("  [red]Timeout waiting for PostgreSQL[/red]")
            sys.exit(1)

    console.print("  [green]✓ Database ready at localhost:5432[/green]")

    # Save to .env
    if Confirm.ask("  Save connection to .env?", default=True):
        save_to_env("TRADEMARK_DB_URL", db_url)
        console.print(f"  [green]✓ Saved to {ENV_FILE.name}[/green]")

    console.print()
    return db_url


def _test_db_connection_quiet(db_url: str) -> bool:
    """Test database connection without output."""
    try:
        import psycopg2
        conn = psycopg2.connect(db_url, connect_timeout=5)
        conn.close()
        return True
    except Exception:
        return False


def _setup_existing_database() -> str:
    """Get existing database connection string."""
    console.print()
    console.print("  Enter PostgreSQL connection string.")
    console.print("  Format: postgresql://user:password@host:port/database")
    console.print()

    while True:
        db_url = Prompt.ask("  Connection string")

        if not db_url.startswith("postgresql://"):
            console.print("  [red]URL must start with postgresql://[/red]")
            continue

        if _test_db_connection(db_url):
            # Save to .env
            if Confirm.ask("  Save connection to .env?", default=True):
                save_to_env("TRADEMARK_DB_URL", db_url)
                console.print(f"  [green]✓ Saved to {ENV_FILE.name}[/green]")
            console.print()
            return db_url

        console.print("  Please try again.")


def get_available_files(api_key: str, product_id: str = PRODUCT_DAILY) -> List[Dict[str, Any]]:
    """Fetch list of available trademark files from USPTO API."""
    headers = {"x-api-key": api_key}
    url = f"{USPTO_API_BASE}/products/{product_id}"

    try:
        response = _make_request(url, headers)
        response.raise_for_status()
        data = response.json()

        products = data.get("bulkDataProductBag", [])
        if not products:
            return []

        file_bag = products[0].get("productFileBag", {})
        files = file_bag.get("fileDataBag", [])

        # Sort by date descending (newest first)
        files.sort(key=lambda x: x.get("fileDataFromDate", ""), reverse=True)

        return files
    except Exception as e:
        console.print(f"  [red]Error fetching file list: {e}[/red]")
        return []


def _make_request(url: str, headers: dict, retry: int = 0) -> httpx.Response:
    """Make HTTP request with retry logic for rate limiting."""
    try:
        response = httpx.get(url, headers=headers, timeout=HTTP_TIMEOUT, follow_redirects=True)

        if response.status_code == 429 and retry < HTTP_RETRY:
            time.sleep(SLEEP_AFTER_429 * (2 ** retry))  # Exponential backoff
            return _make_request(url, headers, retry + 1)

        return response
    except httpx.TimeoutException:
        if retry < HTTP_RETRY:
            time.sleep(SLEEP_AFTER_429 * (2 ** retry))
            return _make_request(url, headers, retry + 1)
        raise


def step_data_selection(api_key: str) -> tuple[List[Dict[str, Any]], bool]:
    """
    Step 3: Select data to download.

    Returns:
        Tuple of (files_to_download, continue_with_daily)
        - continue_with_daily: If True, caller should run daily import after these files
    """
    console.print("[bold]Step 3: Data Selection[/bold]")
    console.print()

    # First, choose data source
    console.print("  [bold]Data Source:[/bold]")
    console.print("  [1] Daily updates only (recent changes)")
    console.print("  [2] Full archive only (1884-present, ~9 GB)")
    console.print("  [3] Full setup: archive + daily updates (recommended)")
    console.print()

    source_choice = Prompt.ask("  Choose data source", choices=["1", "2", "3"], default="3")

    continue_with_daily = False

    if source_choice == "1":
        product_id = PRODUCT_DAILY
        product_name = "daily"
    elif source_choice == "2":
        product_id = PRODUCT_ANNUAL
        product_name = "annual"
    else:  # option 3 - full setup
        product_id = PRODUCT_ANNUAL
        product_name = "annual"
        continue_with_daily = True  # Will import daily files after annual

    console.print()
    with console.status(f"Fetching available {product_name} files from USPTO API..."):
        files = get_available_files(api_key, product_id)

    if not files:
        console.print("  [red]No files available. Check your API key permissions.[/red]")
        sys.exit(1)

    # Filter to only .zip files
    zip_files = [f for f in files if f.get("fileName", "").endswith(".zip")]

    # Calculate date ranges and total size
    dates = [f.get("fileDataFromDate", "") for f in zip_files if f.get("fileDataFromDate")]
    total_available_size = sum(f.get("fileSize", 0) for f in zip_files)

    if dates:
        newest_date = max(dates)
        oldest_date = min(dates)
        console.print(f"  Found {len(zip_files)} {product_name} files ({oldest_date} to {newest_date})")
    else:
        console.print(f"  Found {len(zip_files)} files")
    console.print(f"  Total size: {_format_size(total_available_size)}")
    console.print()

    if source_choice == "1":
        # Daily files - offer date-based selection
        console.print("  [bold]Selection:[/bold]")
        console.print("  [1] Recent files (last 30 days)")
        console.print("  [2] Specific date range")
        console.print("  [3] Single file (for testing)")
        console.print()

        choice = Prompt.ask("  Choose", choices=["1", "2", "3"], default="1")

        if choice == "1":
            # Last 30 days
            cutoff = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
            selected = [f for f in zip_files if f.get("fileDataFromDate", "") >= cutoff]
            if not selected:
                console.print("  [yellow]No files in last 30 days, using most recent 30[/yellow]")
                selected = zip_files[:30]
        elif choice == "2":
            # Date range
            console.print()
            start_date = Prompt.ask("  Start date (YYYY-MM-DD)")
            end_date = Prompt.ask("  End date (YYYY-MM-DD)")
            selected = [
                f for f in zip_files
                if start_date <= f.get("fileDataFromDate", "") <= end_date
            ]
            if not selected:
                console.print("  [red]No files found in that range[/red]")
                return step_data_selection(api_key)
        else:
            # Single file (most recent)
            selected = zip_files[:1]
    elif source_choice == "2":
        # Annual archive only - offer all or subset
        console.print("  [bold]Selection:[/bold]")
        console.print("  [1] Download all archive files (full database)")
        console.print("  [2] Single file (for testing)")
        console.print()

        choice = Prompt.ask("  Choose", choices=["1", "2"], default="1")

        if choice == "1":
            selected = zip_files
        else:
            # Single file (first/smallest for testing)
            selected = zip_files[-1:]  # Last file is usually smallest
    else:
        # Full setup (option 3) - automatically select all archive files
        selected = zip_files
        console.print(f"  [cyan]Full setup:[/cyan] Will import all {len(selected)} archive files,")
        console.print(f"  then continue with daily updates to bring database current.")

    # Show summary
    total_size = sum(f.get("fileSize", 0) for f in selected)
    console.print()
    console.print(f"  Selected {len(selected)} files ({_format_size(total_size)})")
    if continue_with_daily:
        console.print("  [dim]+ daily updates will follow[/dim]")
    console.print()

    return selected, continue_with_daily


def _format_size(size_bytes: int) -> str:
    """Format bytes to human readable size."""
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def download_files(api_key: str, files: List[Dict], output_dir: Path) -> List[Path]:
    """Download selected files with progress bars."""
    console.print("[bold]Step 4: Download & Import[/bold]")
    console.print()

    output_dir.mkdir(parents=True, exist_ok=True)
    headers = {"x-api-key": api_key}
    downloaded = []

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        DownloadColumn(),
        TransferSpeedColumn(),
        console=console,
    ) as progress:
        for file_info in files:
            filename = file_info.get("fileName", "unknown.zip")
            download_url = file_info.get("fileDownloadURI")
            file_size = file_info.get("fileSize", 0)

            if not download_url:
                # Construct URL if not provided
                download_url = f"{USPTO_API_BASE}/products/files/{TRADEMARK_PRODUCT_ID}/{filename}"

            output_path = output_dir / filename

            # Skip if already downloaded
            if output_path.exists() and output_path.stat().st_size == file_size:
                console.print(f"  [dim]Skipping {filename} (already downloaded)[/dim]")
                downloaded.append(output_path)
                continue

            task = progress.add_task(f"  {filename}", total=file_size)

            try:
                with httpx.stream("GET", download_url, headers=headers, timeout=HTTP_TIMEOUT, follow_redirects=True) as response:
                    response.raise_for_status()

                    with open(output_path, "wb") as f:
                        for chunk in response.iter_bytes(chunk_size=8192):
                            f.write(chunk)
                            progress.update(task, advance=len(chunk))

                downloaded.append(output_path)

            except Exception as e:
                console.print(f"  [red]Error downloading {filename}: {e}[/red]")
                if output_path.exists():
                    output_path.unlink()

    console.print()
    console.print(f"  [green]✓ Downloaded {len(downloaded)} files[/green]")
    return downloaded


def _check_tables_exist(db_url: str) -> bool:
    """Check if the trademarks table already exists."""
    try:
        import psycopg2
        conn = psycopg2.connect(db_url, connect_timeout=5)
        with conn.cursor() as cur:
            cur.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_name = 'trademarks'
                );
            """)
            exists = cur.fetchone()[0]
        conn.close()
        return exists
    except Exception:
        return False


def _parse_db_url(db_url: str) -> Optional[Dict[str, str]]:
    """Parse database URL into components."""
    import re
    match = re.match(r'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)', db_url)
    if not match:
        return None

    db_user, db_password, db_host, db_port, db_name = match.groups()
    return {
        "DB_HOST": db_host,
        "DB_PORT": db_port,
        "DB_NAME": db_name,
        "DB_USER": db_user,
        "DB_PASSWORD": db_password,
    }


def _get_num_workers() -> int:
    """Calculate number of workers (80% of available CPUs)."""
    import multiprocessing
    cpu_count = multiprocessing.cpu_count()
    workers = max(1, int(cpu_count * 0.8))
    return workers


def import_data(db_url: str, zip_files: List[Path]) -> int:
    """Import downloaded ZIP files into database using parallel processing."""
    console.print()
    console.print("  Loading into database...")

    # Parse database URL for load_xml.py environment
    db_env = _parse_db_url(db_url)
    if not db_env:
        console.print("  [red]Invalid database URL format[/red]")
        return 0

    env = os.environ.copy()
    env.update(db_env)

    # Check if tables exist, only initialize if needed
    tables_exist = _check_tables_exist(db_url)
    if not tables_exist:
        with console.status("  Initializing database schema..."):
            result = subprocess.run(
                [sys.executable, "load_xml.py", "--init-db"],
                env=env,
                capture_output=True,
                text=True,
                cwd=SCRIPT_DIR
            )
            if result.returncode != 0:
                console.print("  [yellow]Warning: Schema initialization had issues[/yellow]")
                if result.stderr:
                    console.print(f"  [dim]{result.stderr[:200]}[/dim]")
            else:
                console.print("  [green]✓ Database schema initialized[/green]")
    else:
        console.print("  [dim]Using existing database schema[/dim]")

    # Calculate workers (80% of CPUs)
    num_workers = _get_num_workers()
    console.print(f"  [dim]Using {num_workers} parallel workers[/dim]")

    # For multiple files, use parallel bulk import
    if len(zip_files) > 1:
        console.print(f"  Importing {len(zip_files)} files in parallel...")
        console.print()

        # Build command with all file paths
        cmd = [
            sys.executable, "-u", "load_xml.py",  # -u for unbuffered output
            "--xml-paths"
        ] + [str(f) for f in zip_files] + [
            "--workers", str(num_workers),
            "--skip-indexes"
        ]

        # Stream output in real-time
        total_records = 0
        global _active_process
        process = subprocess.Popen(
            cmd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=SCRIPT_DIR,
            bufsize=1,  # Line buffered
            start_new_session=True  # Create new process group for clean termination
        )
        _active_process = process

        # Read and display output line by line
        for line in process.stdout:
            line = line.rstrip()
            if not line:
                continue

            # Parse record counts from completed file lines
            if "completed" in line.lower() and "records" in line.lower():
                import re
                match = re.search(r'(\d[\d,]*)\s+records', line)
                if match:
                    count = int(match.group(1).replace(",", ""))
                    total_records += count

            # Show progress lines
            if any(x in line.lower() for x in ["completed", "processing", "extracting", "total"]):
                console.print(f"  [dim]{line}[/dim]")

        process.wait()
        _active_process = None  # Clear reference after completion

        if process.returncode != 0:
            console.print("  [yellow]Warning: Import had some issues[/yellow]")
        else:
            console.print(f"  [green]✓ Import complete[/green]")

        return total_records
    else:
        # Single file - use simple import
        total_records = 0

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("  Importing...", total=len(zip_files))

            for zip_file in zip_files:
                progress.update(task, description=f"  {zip_file.name}")

                result = subprocess.run(
                    [sys.executable, "load_xml.py", "--xml-path", str(zip_file), "--skip-indexes"],
                    env=env,
                    capture_output=True,
                    text=True,
                    cwd=SCRIPT_DIR
                )

                # Parse record count from output
                for line in result.stdout.split("\n"):
                    if "records" in line.lower() and "completed" in line.lower():
                        import re
                        match = re.search(r'(\d[\d,]*)\s+records', line)
                        if match:
                            count = int(match.group(1).replace(",", ""))
                            total_records += count

                if result.returncode != 0:
                    console.print(f"  [yellow]Warning: {zip_file.name} import had issues[/yellow]")
                    if result.stderr:
                        console.print(f"  [dim]{result.stderr[:200]}[/dim]")

                progress.update(task, advance=1)

        return total_records


def create_indexes(db_url: str):
    """Create search indexes on the database."""
    console.print()
    console.print("  Creating search indexes...")

    # Parse database URL
    db_env = _parse_db_url(db_url)
    if not db_env:
        return

    env = os.environ.copy()
    env.update(db_env)

    with console.status("  Creating indexes (this may take a while)..."):
        result = subprocess.run(
            [sys.executable, "load_xml.py", "--create-indexes"],
            env=env,
            capture_output=True,
            text=True,
            cwd=SCRIPT_DIR
        )

    if result.returncode == 0:
        console.print("  [green]✓ Indexes created[/green]")
    else:
        console.print("  [yellow]Warning: Index creation had issues[/yellow]")


def get_record_count(db_url: str) -> int:
    """Get total record count from database."""
    try:
        import psycopg2
        conn = psycopg2.connect(db_url)
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM trademarks")
            count = cur.fetchone()[0]
        conn.close()
        return count
    except Exception:
        return 0


def print_summary(db_url: str, record_count: int):
    """Print setup completion summary."""
    console.print()
    console.print(Panel.fit(
        "[bold green]✓ Setup complete![/bold green]",
        border_style="green"
    ))
    console.print()

    # Get actual record count if we don't have it
    if record_count == 0:
        record_count = get_record_count(db_url)

    table = Table(show_header=False, box=None)
    table.add_column("Key", style="dim")
    table.add_column("Value")
    table.add_row("Database", _mask_password(db_url))
    table.add_row("Records", f"{record_count:,} trademarks loaded")

    console.print(table)
    console.print()
    console.print("  Test it:")
    console.print("  [dim]curl \"http://localhost:5001/search?q=APPLE\"[/dim]")
    console.print()


def main():
    parser = argparse.ArgumentParser(description="USPTO Trademark Database Setup Wizard")
    parser.add_argument("--api-key", help="USPTO API key (skip prompt)")
    parser.add_argument("--db-url", help="Database URL (skip prompt)")
    parser.add_argument("--non-interactive", action="store_true", help="Run without prompts")
    parser.add_argument("--test", action="store_true", help="Test mode: download only the most recent file")
    args = parser.parse_args()

    print_header()

    # Step 1: API Key
    if args.api_key:
        api_key = args.api_key
        with console.status("Validating API key..."):
            valid, message = validate_api_key(api_key)
        if not valid:
            console.print(f"[red]Invalid API key: {message}[/red]")
            sys.exit(1)
        console.print(f"[green]✓ API key validated[/green]")
        # Save to .env
        save_to_env("USPTO_API_KEY", api_key)
        console.print(f"[dim]Saved to {ENV_FILE}[/dim]")
    else:
        api_key = step_api_key(auto_accept=args.test or args.non_interactive)

    # Step 2: Database
    if args.db_url:
        db_url = args.db_url
        if not _test_db_connection(db_url):
            sys.exit(1)
        # Save to .env
        save_to_env("TRADEMARK_DB_URL", db_url)
        console.print(f"[dim]Saved to {ENV_FILE}[/dim]")
    else:
        db_url = step_database_setup()

    # Step 3: Data Selection
    if args.test:
        # Test mode: just get the most recent daily file
        console.print("[bold]Step 3: Data Selection (Test Mode)[/bold]")
        console.print()
        with console.status("Fetching available daily files..."):
            all_files = get_available_files(api_key, PRODUCT_DAILY)
        if not all_files:
            console.print("[red]No files available[/red]")
            sys.exit(1)
        # Filter to only .zip files and get the most recent
        zip_files = [f for f in all_files if f.get("fileName", "").endswith(".zip")]
        files = zip_files[:1]
        continue_with_daily = False
        console.print(f"  [cyan]Test mode:[/cyan] Selected 1 file: {files[0].get('fileName')}")
        console.print()
    else:
        files, continue_with_daily = step_data_selection(api_key)

    # Confirm before proceeding
    if not args.non_interactive and not args.test:
        if not Confirm.ask("  Proceed with download and import?", default=True):
            console.print("  [yellow]Setup cancelled[/yellow]")
            sys.exit(0)

    # Step 4: Download
    downloaded = download_files(api_key, files, DATA_DIR)

    if not downloaded:
        console.print("[red]No files downloaded[/red]")
        sys.exit(1)

    # Step 5: Import
    total_records = import_data(db_url, downloaded)

    # Step 6: Daily updates (if full setup was selected)
    if continue_with_daily:
        console.print()
        console.print("[bold]Step 6: Daily Updates[/bold]")
        console.print()

        with console.status("Fetching available daily files..."):
            daily_files = get_available_files(api_key, PRODUCT_DAILY)

        if daily_files:
            # Filter to .zip files
            daily_zips = [f for f in daily_files if f.get("fileName", "").endswith(".zip")]

            # Annual archive covers up to end of 2024, so get daily files from 2025 onwards
            # This ensures we capture all data not in the annual archive
            cutoff_date = "2025-01-01"
            recent_daily = [f for f in daily_zips if f.get("fileDataFromDate", "") >= cutoff_date]

            if recent_daily:
                total_daily_size = sum(f.get("fileSize", 0) for f in recent_daily)
                console.print(f"  Found {len(recent_daily)} daily files since {cutoff_date}")
                console.print(f"  Total size: {_format_size(total_daily_size)}")
                console.print()

                # Download daily files
                daily_downloaded = download_files(api_key, recent_daily, DATA_DIR)

                if daily_downloaded:
                    # Import daily files
                    daily_records = import_data(db_url, daily_downloaded)
                    total_records += daily_records
            else:
                console.print("  [dim]No daily files newer than archive data[/dim]")
        else:
            console.print("  [yellow]Could not fetch daily files[/yellow]")

    # Step 7: Create indexes
    create_indexes(db_url)

    # Summary
    print_summary(db_url, total_records)


if __name__ == "__main__":
    # Register signal handlers for clean subprocess termination
    signal.signal(signal.SIGINT, _cleanup_subprocess)
    signal.signal(signal.SIGTERM, _cleanup_subprocess)

    try:
        main()
    except KeyboardInterrupt:
        _cleanup_subprocess()
        console.print("\n[yellow]Setup cancelled[/yellow]")
        sys.exit(1)
