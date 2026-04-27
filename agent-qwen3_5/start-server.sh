#!/bin/bash
# Start the Python backend server using the .agent-qwen3_5 virtual environment.
# This script is called by the frontend dev script via concurrently.

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$PROJECT_ROOT/.agent-qwen3_5"
SERVER_DIR="$PROJECT_ROOT/server"

# Create the virtual environment if it doesn't have a working Python
if [ ! -f "$VENV_DIR/bin/python" ]; then
  echo "[start-server] Creating virtual environment in $VENV_DIR ..."
  python3 -m venv "$VENV_DIR"
fi

# Activate the virtual environment
source "$VENV_DIR/bin/activate"

# # Install server dependencies
# echo "[start-server] Installing server dependencies..."
pip install -q -r "$SERVER_DIR/requirements.txt"

# Start the server
echo "[start-server] Starting Python server..."
exec python "$SERVER_DIR/server.py"
