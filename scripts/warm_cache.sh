#!/usr/bin/env bash
# T25: warm the replay cache with a LIVE run (needs SARVAM_API_KEY or ANTHROPIC_API_KEY + network), then switch to replay.
# Does not commit; it prints the git hint at the end.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${NEXT_PUBLIC_API_BASE:-http://localhost:8000}"

# (decision: FIX4) pin the clock in .env so the warm run and the pitch hash identical prompts.
[ -f .env ] || cp .env.example .env
# (decision: SARVAM-1) either provider key works; read from the shell or from .env.
envkey() { sed -n "s/^$1=\([^#[:space:]]*\).*/\1/p" .env | tail -1; }
if [ -z "${SARVAM_API_KEY:-$(envkey SARVAM_API_KEY)}" ] && [ -z "${ANTHROPIC_API_KEY:-$(envkey ANTHROPIC_API_KEY)}" ]; then
  echo "SARVAM_API_KEY (or ANTHROPIC_API_KEY) is required for the live warm-up; set it in .env" >&2
  exit 1
fi
PIN="$(sed -n 's/^DEMO_NOW_OVERRIDE=\([^#[:space:]]*\).*/\1/p' .env | tail -1)"
PIN="${PIN:-2026-11-01T10:00:00Z}"
if grep -q '^DEMO_NOW_OVERRIDE=' .env; then
  sed -i.bak "s/^DEMO_NOW_OVERRIDE=.*/DEMO_NOW_OVERRIDE=$PIN/" .env && rm -f .env.bak
else
  echo "DEMO_NOW_OVERRIDE=$PIN" >> .env
fi
echo "Warming with DEMO_NOW_OVERRIDE=$PIN"

export LLM_MODE=live
make backend &
BACKEND_PID=$!
trap 'kill "$BACKEND_PID" 2>/dev/null || true; pkill -P "$BACKEND_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -fsS "$BASE/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "$BASE/api/health" >/dev/null

curl -fsS -X POST "$BASE/api/demo/reset"
curl -fsS -X POST "$BASE/api/demo/seed"
for s in d1_failed_upi d3_over_limit hinglish_refund_status merchant_settlement kyc_rejected mandate_email dispute; do
  curl -fsS -X POST "$BASE/api/demo/ticket/$s"
  sleep 20
done
curl -fsS -X POST "$BASE/api/demo/spike" -H 'content-type: application/json' \
  -d '{"issuer_bank":"AXIS","count":120}'
sleep 30

make evals

# Switch to replay for the pitch; keep other .env lines.
if grep -q '^LLM_MODE=' .env; then
  sed -i.bak 's/^LLM_MODE=.*/LLM_MODE=replay/' .env && rm -f .env.bak
else
  echo 'LLM_MODE=replay' >> .env
fi

# Restart the backend in replay and verify the mode.
kill "$BACKEND_PID" 2>/dev/null || true
wait "$BACKEND_PID" 2>/dev/null || true
export LLM_MODE=replay
make backend &
BACKEND_PID=$!
for _ in $(seq 1 60); do
  curl -fsS "$BASE/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "$BASE/api/health" | grep -q '"llm_mode":"replay"' || { echo "health.llm_mode != replay" >&2; exit 1; }

make test
make lint

echo "REMINDER: keep DEMO_NOW_OVERRIDE=$PIN in .env for the pitch, or the replay cache will miss."
echo "Done. Review, then run: git add backend/.llm_cache backend/evals/report.* && git commit"
