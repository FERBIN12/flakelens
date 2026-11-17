#!/usr/bin/env bash
# Upload one JUnit XML report to FlakeLens.
# Usage: FLAKELENS_URL=... FLAKELENS_TOKEN=... upload-junit.sh report.xml [project] [commit] [run-id] [branch]
set -euo pipefail
xml=${1:?usage: upload-junit.sh report.xml [project] [commit] [run-id] [branch]}
: "${FLAKELENS_URL:?set FLAKELENS_URL to the web trigger URL}" "${FLAKELENS_TOKEN:?set FLAKELENS_TOKEN}"
enc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$1"; }
q="project=$(enc "${2:-default}")&commit=$(enc "${3:-}")&run=$(enc "${4:-}")&branch=$(enc "${5:-}")"
curl -sS --fail-with-body -X POST -H "Authorization: Bearer $FLAKELENS_TOKEN" -H 'Content-Type: application/xml' \
  --data-binary @"$xml" "$FLAKELENS_URL?$q"
echo
