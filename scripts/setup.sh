#!/usr/bin/env bash
#
# USPTO Trademark Database Setup Script
#
# This script sets up the trademark database with minimal user input.
# It handles Python dependencies and launches the interactive wizard.
#
# Usage:
#   ./setup.sh                    # Interactive mode
#   ./setup.sh --test             # Test mode (single file, no prompts)
#   ./setup.sh --api-key KEY      # Provide API key via CLI
#   ./setup.sh --db-url URL       # Provide database URL via CLI
#   ./setup.sh --non-interactive  # Skip all confirmation prompts
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "========================================"
echo "  USPTO Trademark Database Setup"
echo "========================================"
echo ""

# Check Python version (3.8+)
check_python() {
    if command -v python3 &> /dev/null; then
        PYTHON=python3
    elif command -v python &> /dev/null; then
        PYTHON=python
    else
        echo -e "${RED}Error: Python is not installed.${NC}"
        echo "Please install Python 3.8 or higher."
        exit 1
    fi

    # Check version
    version=$($PYTHON -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    major=$(echo "$version" | cut -d. -f1)
    minor=$(echo "$version" | cut -d. -f2)

    if [ "$major" -lt 3 ] || ([ "$major" -eq 3 ] && [ "$minor" -lt 8 ]); then
        echo -e "${RED}Error: Python 3.8+ is required. Found: $version${NC}"
        exit 1
    fi

    echo -e "${GREEN}[OK]${NC} Python $version found"
}

# Check if Docker is installed (optional, for Docker mode)
check_docker() {
    if command -v docker &> /dev/null; then
        echo -e "${GREEN}[OK]${NC} Docker found (optional: enables Docker database mode)"
        DOCKER_AVAILABLE=1
    else
        echo -e "${YELLOW}[INFO]${NC} Docker not found (you can still use an existing database)"
        DOCKER_AVAILABLE=0
    fi
}

# Create virtual environment and install dependencies
setup_venv() {
    VENV_DIR="$SCRIPT_DIR/.venv"

    if [ ! -d "$VENV_DIR" ]; then
        echo ""
        echo "Creating Python virtual environment..."
        $PYTHON -m venv "$VENV_DIR"
    fi

    # Activate venv
    source "$VENV_DIR/bin/activate"

    # Upgrade pip quietly
    pip install --upgrade pip -q

    # Install dependencies
    echo "Installing Python dependencies..."
    pip install -r requirements.txt -q

    echo -e "${GREEN}[OK]${NC} Dependencies installed"
}

# Main
echo "Checking prerequisites..."
echo ""

check_python
check_docker

setup_venv

echo ""
echo "Starting setup wizard..."
echo ""

# Run the wizard
$PYTHON wizard.py "$@"

# Deactivate venv
deactivate 2>/dev/null || true
