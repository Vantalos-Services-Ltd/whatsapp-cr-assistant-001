#!/usr/bin/env bash
#
# Vantalos Recruiter — one-command demo launcher.
#
#   ./start-demo.sh          start everything
#   ./start-demo.sh --fresh  wipe and rebuild the demo data first
#
set -uo pipefail
cd "$(dirname "$0")"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'

say()  { echo -e "${BLUE}▸${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
die()  { echo -e "${RED}✗${NC} $1"; exit 1; }

export PATH="/usr/local/opt/postgresql@16/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH"

echo ""
echo -e "${BOLD}  Vantalos Recruiter — demo environment${NC}"
echo "  ────────────────────────────────────────"
echo ""

# --- 1. supporting services -------------------------------------------------
say "Checking database..."
if ! pg_isready -q 2>/dev/null; then
  warn "Postgres not running — starting it"
  brew services start postgresql@16 >/dev/null 2>&1
  for i in $(seq 1 20); do pg_isready -q 2>/dev/null && break; sleep 1; done
fi
pg_isready -q 2>/dev/null && ok "Database running" || die "Could not start Postgres. Run: brew services start postgresql@16"

say "Checking Redis..."
if ! redis-cli ping >/dev/null 2>&1; then
  warn "Redis not running — starting it"
  brew services start redis >/dev/null 2>&1
  for i in $(seq 1 20); do redis-cli ping >/dev/null 2>&1 && break; sleep 1; done
fi
redis-cli ping >/dev/null 2>&1 && ok "Redis running" || die "Could not start Redis. Run: brew services start redis"

# --- 2. stop anything already running ---------------------------------------
# Kill by PORT rather than by process name: pnpm/tsx spawn child processes whose
# names vary, and a stale listener on 3001 would otherwise make the health check
# below pass against the OLD process while the new one dies with EADDRINUSE.
say "Clearing any previous session..."
for port in 3000 3001; do
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 >/dev/null 2>&1 || true
  fi
done
pkill -f "tsx watch src/index.ts" >/dev/null 2>&1 || true
pkill -f "next dev"               >/dev/null 2>&1 || true

# wait for the ports to actually free up
for i in $(seq 1 15); do
  if [ -z "$(lsof -ti tcp:3000 2>/dev/null)" ] && [ -z "$(lsof -ti tcp:3001 2>/dev/null)" ]; then break; fi
  sleep 1
done
if [ -n "$(lsof -ti tcp:3001 2>/dev/null)" ]; then
  die "Port 3001 is still in use. Run 'pnpm stop', then try again."
fi
ok "Ready to start"

# --- 3. optional data refresh -----------------------------------------------
if [[ "${1:-}" == "--fresh" ]]; then
  say "Rebuilding demo data..."
  pnpm demo:seed >/dev/null 2>&1 && ok "Demo data rebuilt" || die "Seed failed. Run 'pnpm demo:seed' to see the error."
fi

# --- 4. backend -------------------------------------------------------------
say "Starting backend..."
pnpm dev:api > /tmp/vantalos-api.log 2>&1 &
for i in $(seq 1 40); do curl -s -o /dev/null http://localhost:3001/health 2>/dev/null && break; sleep 1; done
if curl -s -o /dev/null http://localhost:3001/health 2>/dev/null; then
  ok "Backend running on port 3001"
else
  echo ""; tail -25 /tmp/vantalos-api.log; echo ""
  die "Backend failed to start (log above, full log: /tmp/vantalos-api.log)"
fi

# --- 5. web console ---------------------------------------------------------
say "Starting web console..."
pnpm dev:web > /tmp/vantalos-web.log 2>&1 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3000/operator/login 2>/dev/null && break; sleep 1; done
if curl -s -o /dev/null http://localhost:3000/operator/login 2>/dev/null; then
  ok "Web console running on port 3000"
else
  echo ""; tail -25 /tmp/vantalos-web.log; echo ""
  die "Web console failed to start (log above, full log: /tmp/vantalos-web.log)"
fi

# --- 6. status --------------------------------------------------------------
AI_STATUS="$(grep -q '^OPENAI_API_KEY=.\+' .env && echo "on" || echo "off")"

echo ""
echo -e "${GREEN}${BOLD}  Everything is running.${NC}"
echo ""
echo -e "  ${BOLD}Open:${NC}      http://localhost:3000/operator"
echo -e "  ${BOLD}Email:${NC}     admin@example.com"
echo -e "  ${BOLD}Password:${NC}  admin123"
echo ""
if [[ "$AI_STATUS" == "off" ]]; then
  echo -e "  ${YELLOW}AI replies: OFF${NC} — no OpenAI key set."
  echo -e "  Everything works, but replies use simple canned text instead of AI."
  echo -e "  To turn on: add your key to OPENAI_API_KEY in the .env file, then restart."
else
  echo -e "  ${GREEN}AI replies: ON${NC}"
fi
echo ""
echo "  Simulate a candidate message:"
echo "    pnpm demo:message --list"
echo '    pnpm demo:message "Danny" "I can start Monday, got my CSCS card"'
echo ""
echo "  Watch what the system is doing:   pnpm logs"
echo "  Reset the demo data:              pnpm demo:seed"
echo "  Stop everything:                  pnpm stop"
echo ""

if command -v open >/dev/null 2>&1; then
  sleep 1
  open http://localhost:3000/operator/login >/dev/null 2>&1
fi
