#!/usr/bin/env bash
# finscipline.sh — Finscipline development helper
#
#   ./finscipline.sh setup   Install dependencies and create .env  (run once)
#   ./finscipline.sh start   Launch backend + frontend in the background
#   ./finscipline.sh stop    Shut down running servers

set -euo pipefail

# Always run from the project root regardless of where the script is invoked
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV=".venv"
BACKEND_PORT=8000
FRONTEND_PORT=5173
PID_FILE=".finscipline.pids"
LOG_DIR="logs"

# ─── output helpers ──────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { printf "${GREEN}  ✓${NC}  %s\n" "$*"; }
warn() { printf "${YELLOW}  !${NC}  %s\n" "$*"; }
fail() { printf "${RED}  ✗${NC}  %s\n" "$*"; exit 1; }
step() { printf "${CYAN}  →${NC}  %s\n" "$*"; }

require_cmd() {
    command -v "$1" &>/dev/null || fail "Required command not found: '$1'. Please install it first."
}

kill_port() {
    local port=$1 pid
    # lsof works on macOS; fall back to fuser on Linux
    pid=$(lsof -ti tcp:"$port" 2>/dev/null || fuser "$port/tcp" 2>/dev/null || true)
    if [[ -n "$pid" ]]; then
        kill $pid 2>/dev/null || true
        # Give it 2s to exit gracefully, then force-kill
        local i=0
        while kill -0 $pid 2>/dev/null && (( i < 20 )); do
            sleep 0.1; (( i++ ))
        done
        kill -9 $pid 2>/dev/null || true
        ok "Stopped process on port $port"
        return 0
    fi
    return 1
}

_spin() {
    local pid=$1 label=$2
    local t=0 spin='|/-\'
    while kill -0 "$pid" 2>/dev/null; do
        printf "\r      %s  %-30s  %ds" "${spin:$(( t % 4 )):1}" "$label" "$t"
        sleep 1
        t=$(( t + 1 ))
    done
    printf "\r%-65s\r" ""
}

# ─── setup ───────────────────────────────────────────────────────────────────
cmd_setup() {
    printf "\nFinscipline — Setup\n"
    printf "─────────────────────\n\n"

    # Python version check
    require_cmd python3
    python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)' \
        || fail "Python 3.11+ required (found $(python3 --version 2>&1))"
    ok "Python $(python3 --version 2>&1 | cut -d' ' -f2)"

    # Node version check
    require_cmd node
    node -e 'const v=parseInt(process.version.slice(1)); process.exit(v>=18?0:1)' \
        || fail "Node 18+ required (found $(node --version))"
    ok "Node $(node --version)"

    require_cmd npm

    # Python virtual environment
    if [[ ! -d "$VENV" ]]; then
        step "Creating Python virtual environment…"
        python3 -m venv "$VENV"
    fi
    ok "Virtual environment: $VENV/"

    # Python dependencies
    step "Installing Python dependencies…"
    "$VENV/bin/pip" install --quiet --upgrade pip
    "$VENV/bin/pip" install -r backend/requirements.txt
    ok "Python dependencies installed"

    # Node dependencies
    if [[ ! -d "frontend/node_modules" ]]; then
        step "Installing Node dependencies…"
        npm --prefix frontend install --silent
    fi
    ok "Node dependencies installed"

    # .env
    if [[ ! -f ".env" ]]; then
        cp .env.example .env
        # Auto-generate a strong SESSION_SECRET so the user doesn't have to
        GENERATED_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
        # Replace the blank SESSION_SECRET= line in-place (works on macOS + Linux)
        if [[ "$(uname)" == "Darwin" ]]; then
            sed -i '' "s/^SESSION_SECRET=$/SESSION_SECRET=${GENERATED_SECRET}/" .env
        else
            sed -i "s/^SESSION_SECRET=$/SESSION_SECRET=${GENERATED_SECRET}/" .env
        fi
        warn ".env created from .env.example — SESSION_SECRET auto-generated"
        warn "Open .env and set OPENAI_API_KEY=sk-... before running start"
    else
        ok ".env already exists"
    fi

    echo
    # Check whether the API key still needs to be filled in
    API_KEY=$(grep -E "^OPENAI_API_KEY=" .env 2>/dev/null | cut -d= -f2- | tr -d '[:space:]"' || true)
    if [[ -z "$API_KEY" || "$API_KEY" == "sk-..." ]]; then
        echo "  Next steps:"
        echo "    1. Open .env and set OPENAI_API_KEY=sk-..."
        echo "    2. ./finscipline.sh start"
    else
        echo "  Setup complete. Run: ./finscipline.sh start"
    fi
    echo
}

# ─── start ───────────────────────────────────────────────────────────────────
cmd_start() {
    [[ -d "$VENV" ]] \
        || fail "Virtual environment not found. Run './finscipline.sh setup' first."
    [[ -d "frontend/node_modules" ]] \
        || fail "Node modules not found. Run './finscipline.sh setup' first."
    [[ -f ".env" ]] \
        || fail ".env not found. Run './finscipline.sh setup' first."

    API_KEY=$(grep -E "^OPENAI_API_KEY=" .env | cut -d= -f2- | tr -d '[:space:]"' || true)
    [[ -n "$API_KEY" && "$API_KEY" != "sk-..." ]] \
        || fail "OPENAI_API_KEY is not set in .env. Add your key and try again."

    SESSION_SECRET=$(grep -E "^SESSION_SECRET=" .env | cut -d= -f2- | tr -d '[:space:]"' || true)
    [[ -n "$SESSION_SECRET" ]] \
        || fail "SESSION_SECRET is not set in .env. Run './finscipline.sh setup' to generate one."

    if [[ -f "$PID_FILE" ]]; then
        warn "Servers may already be running. Run './finscipline.sh stop' first."
        exit 1
    fi

    mkdir -p "$LOG_DIR"
    printf "\nStarting Finscipline…\n\n"

    # Backend
    "$VENV/bin/uvicorn" backend.main:app \
        --host 127.0.0.1 --port "$BACKEND_PORT" \
        >> "$LOG_DIR/backend.log" 2>&1 &
    BACKEND_PID=$!
    echo "$BACKEND_PID" > "$PID_FILE"
    ok "Backend  PID=$BACKEND_PID  →  $LOG_DIR/backend.log"

    # Give uvicorn a moment to bind before the browser hits it
    sleep 1

    # Frontend (--prefix lets npm run from the project root)
    npm --prefix frontend run dev \
        >> "$LOG_DIR/frontend.log" 2>&1 &
    FRONTEND_PID=$!
    echo "$FRONTEND_PID" >> "$PID_FILE"
    ok "Frontend PID=$FRONTEND_PID  →  $LOG_DIR/frontend.log"

    echo
    printf "  %-12s http://localhost:%s\n" "Backend:"  "$BACKEND_PORT"
    printf "  %-12s http://localhost:%s\n" "Frontend:" "$FRONTEND_PORT"
    echo
    echo "  Open http://localhost:$FRONTEND_PORT in your browser."
    echo "  Run ./finscipline.sh stop when you are done."
    echo
}

# ─── stop ────────────────────────────────────────────────────────────────────
cmd_stop() {
    printf "\nStopping Finscipline…\n\n"
    STOPPED=0
    kill_port "$BACKEND_PORT"  && STOPPED=1 || true
    kill_port "$FRONTEND_PORT" && STOPPED=1 || true
    rm -f "$PID_FILE"
    [[ $STOPPED -eq 1 ]] || warn "No servers were running."
    echo
}

# ─── logs ────────────────────────────────────────────────────────────────────
cmd_logs() {
    local log="$LOG_DIR/app.log"
    if [[ ! -f "$log" ]]; then
        warn "No log file yet. Start the server first: ./finscipline.sh start"
        exit 1
    fi
    echo "Tailing $log  (Ctrl+C to stop)…"
    echo
    tail -f "$log"
}

# ─── main ────────────────────────────────────────────────────────────────────
case "${1:-}" in
    setup) cmd_setup ;;
    start) cmd_start ;;
    stop)  cmd_stop  ;;
    logs)  cmd_logs  ;;
    *)
        echo
        echo "  Usage: ./finscipline.sh [setup|start|stop|logs]"
        echo
        echo "    setup   Install dependencies and create .env (run once after cloning)"
        echo "    start   Launch backend + frontend in the background"
        echo "    stop    Shut down running servers"
        echo "    logs    Tail the live application log (logs/app.log)"
        echo
        ;;
esac
