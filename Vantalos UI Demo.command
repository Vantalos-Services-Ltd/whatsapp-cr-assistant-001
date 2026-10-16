#!/usr/bin/env bash
# Double-click this file to open the Vantalos console with built-in demo data.
# No database, backend, WhatsApp, or AI service is needed or contacted.
cd "$(dirname "$0")" || exit 1
clear
if [ ! -x node_modules/.bin/next ]; then
  echo "First run: installing dependencies (about a minute)..."
  ./run install || exit 1
fi
./run ui
