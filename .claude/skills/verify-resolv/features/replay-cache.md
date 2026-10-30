# replay-cache: Replay mode runs the scenarios offline

- id: replay-cache
- proven: no
- anchors:

## What it is

Pitch mode. With `LLM_MODE=replay` and the committed `backend/.llm_cache/` warmed by
`make warm`, every scenario runs from the cache with no network and produces identical
output each run. Not built yet (T6, T25).

## How to reach it

- Launch an instance with `LLM_MODE=replay ANTHROPIC_API_KEY= HTTPS_PROXY=http://127.0.0.1:9
  NO_PROXY=localhost,127.0.0.1` exported before the Launch block.

## Drive it

```sh
curl -fsS "$API/api/health" | jq -e '.llm_mode == "replay"'
curl -fsS -X POST "$API/api/demo/reset" && curl -fsS -X POST "$API/api/demo/seed"
for s in d1_failed_upi d3_over_limit hinglish_refund_status merchant_settlement kyc_rejected mandate_email dispute; do
  curl -fsS -X POST "$API/api/demo/ticket/$s" | jq -r .id
done | tee "$ART/ids.txt"
sleep 30
curl -fsS "$API/api/tickets?limit=50" -o "$ART/tickets.json"
jq -e '.items | map(select(.id == "tkt_48213"))[0].status == "RESOLVED"' "$ART/tickets.json"
jq -e '.items | map(select(.id == "tkt_48219"))[0].status == "AWAITING_APPROVAL"' "$ART/tickets.json"
jq -e '[.items[].status] | all(. != "FAILED" and . != "NEW" and . != "PROCESSING")' "$ART/tickets.json"
grep -c cache_hit "$RUN/api.log"; grep -c cache_miss "$RUN/api.log"
```

Expect `llm_mode` `replay`, every `jq -e` to exit 0, `cache_hit` count > 0 and
`cache_miss` count `0`. The `dispute` ticket ends `ROUTED` (assigned_team `risk`).

## Proof

All 7 scenarios reach their documented end states with zero cache misses while outbound
HTTPS is pointed at a closed port; the instance log is the side-effect record of where every
LLM answer came from.

## Gotchas

- A cache miss in replay falls through to live; with the dead proxy it errors, which is the
  point: it shows the cache is incomplete for this head (run `make warm`).
- Prompt or schema edits change the cache key; any change to `app/agent/prompts/*.md`
  invalidates the cache and needs a re-warm.
