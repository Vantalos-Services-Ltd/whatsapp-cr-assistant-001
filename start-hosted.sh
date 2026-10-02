#!/usr/bin/env bash
# Hosted start: apply migrations, run the backend on 3001, serve the web console on $PORT.
set -e
./node_modules/.bin/prisma migrate deploy
PORT=3001 ./node_modules/.bin/tsx src/index.ts &
exec ./node_modules/.bin/next start -p "${PORT:-3000}"
