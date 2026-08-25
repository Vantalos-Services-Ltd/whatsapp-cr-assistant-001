#!/usr/bin/env bash
#
# Safely store an API key in .env.
#
#   ./set-key.sh              set the OpenAI key
#   ./set-key.sh DATABASE_URL set the Supabase connection string
#
# The value is typed invisibly, never echoed to screen, never written to your
# shell history, and never passed as a command argument (which would make it
# visible to other processes). A timestamped backup of .env is kept.
#
set -uo pipefail
cd "$(dirname "$0")"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'

KEY_NAME="${1:-OPENAI_API_KEY}"

case "$KEY_NAME" in
  OPENAI_API_KEY)  HINT="starts with 'sk-' — from platform.openai.com/api-keys" ;;
  DATABASE_URL)    HINT="starts with 'postgresql://' — from Supabase > Project Settings > Database" ;;
  TWILIO_AUTH_TOKEN|TWILIO_ACCOUNT_SID|TWILIO_WHATSAPP_NUMBER) HINT="from console.twilio.com" ;;
  *)               HINT="" ;;
esac

if [ ! -f .env ]; then
  echo -e "${RED}✗${NC} No .env file found in $(pwd)"
  exit 1
fi

echo ""
echo -e "  ${BOLD}Set ${KEY_NAME}${NC}"
[ -n "$HINT" ] && echo -e "  ${YELLOW}${HINT}${NC}"
echo ""
echo -e "  Paste the value and press Enter."
echo -e "  ${YELLOW}Nothing will appear on screen as you paste — that is expected.${NC}"
echo ""
printf "  > "

# -s hides input; -r stops backslashes being interpreted
IFS= read -rs VALUE
echo ""
echo ""

# Trim accidental whitespace/quotes from pasting
VALUE="$(printf '%s' "$VALUE" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"

if [ -z "$VALUE" ]; then
  echo -e "  ${RED}✗${NC} Nothing entered — no changes made."
  exit 1
fi

# Light sanity check, warn only
case "$KEY_NAME" in
  OPENAI_API_KEY)
    case "$VALUE" in
      sk-*) ;;
      *) echo -e "  ${YELLOW}!${NC} That doesn't start with 'sk-'. Saving anyway — double-check if the app rejects it."; echo "" ;;
    esac ;;
  DATABASE_URL)
    case "$VALUE" in
      postgres://*|postgresql://*) ;;
      *) echo -e "  ${YELLOW}!${NC} That doesn't look like a database URL. Saving anyway."; echo "" ;;
    esac ;;
esac

# Back up, then rewrite the single line. Uses a temp file rather than sed -i so
# the secret is never exposed in a process argument list.
BACKUP=".env.backup-$(date +%Y%m%d-%H%M%S)"
cp .env "$BACKUP"
chmod 600 "$BACKUP"

TMP="$(mktemp)"
KEY="$KEY_NAME" NEWVAL="$VALUE" awk '
  BEGIN { key = ENVIRON["KEY"]; val = ENVIRON["NEWVAL"]; done = 0 }
  {
    # match "KEY=" possibly preceded by "# " (a commented-out line)
    if ($0 ~ "^[[:space:]]*#?[[:space:]]*" key "=") {
      if (!done) { print key "=" val; done = 1 }
      # drop any further duplicates of this key
    } else { print }
  }
  END { if (!done) print key "=" val }
' .env > "$TMP"

mv "$TMP" .env
chmod 600 .env

# Confirm without revealing the value
MASKED="$(printf '%s' "$VALUE" | sed -E 's/^(.{6}).*(.{4})$/\1…\2/')"
LEN=${#VALUE}

echo -e "  ${GREEN}✓${NC} ${KEY_NAME} saved to .env"
echo -e "    stored as: ${MASKED}  (${LEN} characters)"
echo -e "    file permissions set to owner-only (600)"
echo -e "    backup: ${BACKUP}"
echo ""
echo -e "  ${BOLD}Restart to pick it up:${NC}  ./start-demo.sh"
echo ""

# Safety net: confirm .env is still ignored by git
if git check-ignore -q .env 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} .env is ignored by git — it will not be uploaded to GitHub."
else
  echo -e "  ${RED}✗ WARNING:${NC} .env is NOT ignored by git. Do not commit or push."
fi
echo ""
