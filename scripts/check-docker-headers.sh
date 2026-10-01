#!/usr/bin/env bash
# Checks that a running DeclaRenta web image (Dockerfile.web) sends its security
# headers on every kind of response: the HTML page, hashed JS and CSS under
# /assets/, a static file at the root, and the service worker.
#
# nginx drops every server-level add_header in a location that declares its own
# add_header, so a header that is only on the HTML page is the failure this
# guards against.
#
# Usage: scripts/check-docker-headers.sh [base-url]   (default http://127.0.0.1:8080)
set -euo pipefail

BASE="${1:-http://127.0.0.1:8080}"
REQUIRED=(
  Content-Security-Policy
  X-Content-Type-Options
  Referrer-Policy
  Permissions-Policy
  Cross-Origin-Opener-Policy
)

# Wait for nginx to answer (the container may still be starting).
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "$BASE/index.html" 2>/dev/null && break
  sleep 1
done

index_html=$(curl -fsS "$BASE/index.html")
asset_js=$(grep -oE '/assets/[^"]+\.js"' <<<"$index_html" | head -n1 | tr -d '"' || true)
asset_css=$(grep -oE '/assets/[^"]+\.css"' <<<"$index_html" | head -n1 | tr -d '"' || true)
if [ -z "$asset_js" ] || [ -z "$asset_css" ]; then
  echo "FAIL: index.html references no /assets/*.js or /assets/*.css" >&2
  exit 1
fi

failed=0
check_path() {
  local path="$1" headers h count
  headers=$(curl -fsS -o /dev/null -D - "$BASE$path" | tr -d '\r')
  for h in "${REQUIRED[@]}"; do
    if ! grep -qi "^$h:" <<<"$headers"; then
      echo "FAIL: $path has no $h header" >&2
      failed=1
    fi
  done
  count=$(grep -ci '^Cache-Control:' <<<"$headers" || true)
  if [ "$count" -gt 1 ]; then
    echo "FAIL: $path sends $count Cache-Control headers" >&2
    failed=1
  fi
  echo "checked $path"
}

for path in / /index.html "$asset_js" "$asset_css" /favicon.svg /sw.js; do
  check_path "$path"
done

# sw.js has no content hash in its name, so it must not be cached as immutable.
if curl -fsS -o /dev/null -D - "$BASE/sw.js" | grep -qi '^Cache-Control:.*immutable'; then
  echo "FAIL: /sw.js is cached as immutable" >&2
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi
echo "OK: security headers present on every response"
