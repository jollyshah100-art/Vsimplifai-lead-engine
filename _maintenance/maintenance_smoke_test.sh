#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${1:-http://localhost:3000}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

check() {
  local expected="$1" method="$2" path="$3" kind="$4" data="${5:-}"
  local headers="$TMP/headers" body="$TMP/body" status
  : > "$headers"; : > "$body"
  if [[ -n "$data" ]]; then
    status=$(curl -sS -D "$headers" -o "$body" -w '%{http_code}' -X "$method" \
      -H 'Content-Type: application/json' --data "$data" "$BASE_URL$path")
  else
    status=$(curl -sS -D "$headers" -o "$body" -w '%{http_code}' -X "$method" "$BASE_URL$path")
  fi
  printf '%-6s %-38s expected=%s actual=%s\n' "$method" "$path" "$expected" "$status"
  [[ "$status" == "$expected" ]]

  if [[ "$expected" == "503" ]]; then
    grep -qi '^Retry-After: 3600' "$headers"
    grep -qi '^Cache-Control: .*no-store' "$headers"
    if [[ "$kind" == "api" ]]; then
      grep -qi '^Content-Type: application/json' "$headers"
      grep -q 'temporarily unavailable' "$body"
    else
      grep -qi '^Content-Type: text/html' "$headers"
      grep -qi '^X-Robots-Tag: noindex, nofollow' "$headers"
      grep -q 'MandIMMO évolue' "$body"
    fi
  fi
}

check 200 GET  /health health
check 503 GET  /capture.html page
check 503 GET  /login.html page
check 503 GET  '/confirm?token=fake' page
check 503 GET  /docs/deroule-pedagogique.pdf page
check 503 GET  /unknown-future-route page
check 503 POST /confirm page '{}'
check 503 POST /api/optin api '{"name":"MAINTENANCE TEST - DO NOT PROCESS","email":"maintenance-test@example.com","phone":"+33000000000"}'
check 503 POST /api/signup api '{"email":"maintenance-test@example.com","password":"not-a-real-password"}'
check 503 POST /api/login api '{"email":"maintenance-test@example.com","password":"not-a-real-password"}'
check 503 POST /api/confirm api '{"id":"L-FAKE"}'
check 503 POST /api/stripe/webhook api '{}'
check 503 GET  /api/not-a-real-route api

echo 'Render containment smoke test passed. Verify zero Supabase and Stripe writes separately.'
