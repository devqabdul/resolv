#!/usr/bin/env bash
set -euo pipefail
BASE="${NEXT_PUBLIC_API_BASE:-http://localhost:8000}"
curl -fsS -X POST "$BASE/api/demo/reset"
curl -fsS -X POST "$BASE/api/demo/seed"
