# 04 · Technologies — detailed reference

> One section per technology: what it is, why it over the alternatives, exact setup, how Resolv uses it (snippets use our real module names from `02-ARCHITECTURE.md`), gotchas, and the fallback if it misbehaves. Ends with the install checklist and a verification script.
> Version note: pins below are *lower bounds we are confident exist in 2026*; where the ecosystem moves fast the entry says "latest". Check actual versions before building.

---

## 1. Python 3.11+
- **What:** runtime for the backend, mock Paytm and evals.
- **Why:** 3.11+ gives `typing` features we use (`TypedDict total=False`, `Literal`, `Self`), fast startup, and every library here supports it. Avoid 3.13 if any wheel (fastembed/onnxruntime) is missing — 3.11 or 3.12 is the safe pick (decision: 3.12 if available, else 3.11).
- **Setup:** `python3 --version`; if missing: macOS `brew install python@3.12`, Ubuntu `sudo apt install python3.12 python3.12-venv`, or `uv python install 3.12`.
- **Gotcha:** never run the backend with the system interpreter — always the venv. `which python` must point inside `backend/.venv`.

## 2. FastAPI + Uvicorn
- **What:** ASGI web framework + server for `backend/app/main.py` and the mock Paytm sub-app.
- **Why over Flask/Django:** pydantic-native request/response models, automatic `/docs` (the frontend person can read contracts live), `lifespan` for background tasks, sub-app mounting for the mock.
- **Install:** `pip install "fastapi>=0.115" "uvicorn[standard]>=0.30"`
- **How we use it:**
  ```python
  # backend/app/main.py
  from contextlib import asynccontextmanager
  from fastapi import FastAPI
  from fastapi.middleware.cors import CORSMiddleware
  from app.workers.scheduler import start_workers, stop_workers
  from app.db.session import init_db
  from app.api import tickets, approvals, incidents, metrics, audit, demo
  from mock_paytm.main import app as mock_app

  @asynccontextmanager
  async def lifespan(app: FastAPI):
      init_db()
      tasks = start_workers()
      yield
      await stop_workers(tasks)

  app = FastAPI(title="Resolv", lifespan=lifespan)
  app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"], allow_headers=["*"])
  for r in (tickets, approvals, incidents, metrics, audit, demo):
      app.include_router(r.router, prefix="/api")
  app.mount("/mock/paytm", mock_app)   # mock_app has its own /v1/... routes
  ```
  Run: `cd backend && uvicorn app.main:app --reload --port 8000`.
- **Gotchas:** (1) `--reload` restarts the process on every save → workers restart too; fine. (2) **Never** use `--workers 2+`: each process would start its own worker loops and double-process tickets. (3) Mounted sub-app paths: the mock's routes are declared as `/v1/...` and appear at `/mock/paytm/v1/...`. (4) Return pydantic models or dicts, not ORM objects — convert in the service layer.
- **Fallback:** none needed; if `--reload` misbehaves with the asyncio loops, run without it and restart by hand.

## 3. Pydantic v2 + pydantic-settings
- **What:** data models (`app/domain/schemas.py`), config (`app/config.py`).
- **Why:** one model = API schema = LLM tool schema = validated DTO.
- **Install:** `pip install "pydantic>=2.7" "pydantic-settings>=2.3"`
- **How we use it:**
  ```python
  # app/config.py
  from pydantic_settings import BaseSettings, SettingsConfigDict
  class Settings(BaseSettings):
      model_config = SettingsConfigDict(env_file=".env", extra="ignore")
      DATABASE_URL: str = "sqlite:///./resolv.db"
      LLM_MODE: str = "replay"              # live | replay | mock
      ANTHROPIC_API_KEY: str | None = None
      LLM_MODEL_DECIDE: str = "claude-sonnet-5-5"
      LLM_MODEL_UNDERSTAND: str = "claude-haiku-5-5"
      LLM_CACHE_DIR: str = "./.llm_cache"
      PAYTM_BASE_URL: str = "http://localhost:8000/mock/paytm/v1"
      SLACK_WEBHOOK_URL: str | None = None
      EMBEDDINGS_ENABLED: bool = True
      INCIDENT_THRESHOLD: int = 10
      INCIDENT_WINDOW_MINUTES: int = 60
      QUEUE_CONCURRENCY: int = 3
      MOCK_LATENCY_MS: int = 120
      MOCK_REFUND_SETTLE_SECONDS: int = 20
      DEMO_NOW_OVERRIDE: str | None = None
  settings = Settings()
  ```
  LLM schema: `Decision.model_json_schema()` → `input_schema` of the Anthropic tool.
- **Gotchas:** (1) v2 API names: `model_validate`, `model_dump`, `model_json_schema` (not the v1 `parse_obj`/`dict`). (2) Keep LLM-facing models flat-ish: enums as `Literal[...]`, no `datetime` fields (use ISO strings) — simpler schemas, fewer model mistakes. (3) `extra="forbid"` on `Decision`/`Understanding` so hallucinated fields fail loudly in dev; relax to `ignore` if the model keeps adding fields.
- **Fallback:** —

## 4. SQLAlchemy 2.0 (SQLite default · Postgres + pgvector optional)
- **What:** ORM for 02 §5.
- **Why:** one codebase, two databases; 2.0 style (`Mapped[...]`, `select()`) is what Claude Code writes best now.
- **Install:** `pip install "sqlalchemy>=2.0"`; Postgres extras: `pip install "psycopg[binary]" pgvector`.
- **How we use it:**
  ```python
  # app/db/session.py
  from sqlalchemy import create_engine, event
  from sqlalchemy.orm import sessionmaker, DeclarativeBase
  from app.config import settings

  class Base(DeclarativeBase): ...

  is_sqlite = settings.DATABASE_URL.startswith("sqlite")
  engine = create_engine(settings.DATABASE_URL, connect_args={"check_same_thread": False} if is_sqlite else {}, pool_pre_ping=True)
  if is_sqlite:
      @event.listens_for(engine, "connect")
      def _pragmas(dbapi_conn, _):
          cur = dbapi_conn.cursor()
          cur.execute("PRAGMA journal_mode=WAL")
          cur.execute("PRAGMA busy_timeout=5000")
          cur.execute("PRAGMA synchronous=NORMAL")
          cur.close()
  SessionLocal = sessionmaker(engine, expire_on_commit=False)

  def init_db():
      from app.db import models  # noqa: register tables
      Base.metadata.create_all(engine)
      if not is_sqlite:
          with engine.begin() as c: c.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
  ```
  Usage pattern everywhere: `with SessionLocal() as db, db.begin(): ...` — one short transaction per unit of work.
- **Gotchas:** (1) **Sessions are not thread-safe.** Workers run node functions in threads (`anyio.to_thread.run_sync`); open the session *inside* the function, never pass one across threads. (2) SQLite allows one writer at a time: WAL + `busy_timeout` + short transactions make `QUEUE_CONCURRENCY=3` fine; keep LLM/HTTP calls **outside** transactions (fetch → close session → call LLM → open session → write). (3) `expire_on_commit=False` so DTOs built from ORM rows don't lazy-load after commit. (4) No Alembic: schema changes = `make reset` (acceptable for a prototype). (5) Vectors stored as JSON text in both DBs; pgvector column is a day-2 optimisation — the extension is enabled so the claim "Postgres + pgvector" holds.
- **Fallback:** SQLite is the default and the fallback. If Postgres via Docker fails, use SQLite.

## 5. Docker Compose (optional — Postgres only)
- **What:** `docker-compose.yml` with `pgvector/pgvector:pg16`.
- **Why:** keeps the deck's Postgres/pgvector claim demonstrable in one command.
  ```yaml
  services:
    db:
      image: pgvector/pgvector:pg16
      environment: { POSTGRES_USER: resolv, POSTGRES_PASSWORD: resolv, POSTGRES_DB: resolv }
      ports: ["5432:5432"]
      volumes: ["pgdata:/var/lib/postgresql/data"]
  volumes: { pgdata: {} }
  ```
  `docker compose up -d` then `DATABASE_URL=postgresql+psycopg://resolv:resolv@localhost:5432/resolv`.
- **Gotchas:** Docker Desktop on venue wifi may need a multi-GB download; pull the image in advance.
- **Fallback:** SQLite.

## 6. LangGraph
- **What:** `StateGraph` wiring of the eight nodes in `app/agent/graph.py`.
- **Why over hand-rolled loop / CrewAI / AutoGen:** explicit graph = explicit control; the deck names it; nodes stay plain functions so the fallback is trivial.
- **Install:** `pip install langgraph` (latest). Import surface we rely on: `from langgraph.graph import StateGraph, END`.
- **How we use it:**
  ```python
  # app/agent/graph.py
  from langgraph.graph import StateGraph, END
  from app.agent.state import AgentState
  from app.agent.nodes import ingest, understand, decide, gate, act, verify, close, handoff

  def after_ingest(s: AgentState) -> str:
      return "fast_path" if s.get("outcome") == "INCIDENT_LINKED" else "understand"
  def after_gate(s: AgentState) -> str:
      g = s["gate"]; d = s["decision"]
      return "act" if (g.ticket_outcome == "AUTO_EXECUTE" and d.path == "RESOLVE") else "handoff"
  def after_verify(s: AgentState) -> str:
      return "close" if s.get("verify_ok") else "handoff"

  def build_graph():
      g = StateGraph(AgentState)
      for name, fn in [("ingest", ingest.run), ("understand", understand.run), ("decide", decide.run), ("gate", gate.run),
                       ("act", act.run), ("verify", verify.run), ("close", close.run), ("handoff", handoff.run)]:
          g.add_node(name, fn)
      g.set_entry_point("ingest")
      g.add_conditional_edges("ingest", after_ingest, {"fast_path": END, "understand": "understand"})
      g.add_edge("understand", "decide"); g.add_edge("decide", "gate")
      g.add_conditional_edges("gate", after_gate, {"act": "act", "handoff": "handoff"})
      g.add_edge("act", "verify")
      g.add_conditional_edges("verify", after_verify, {"close": "close", "handoff": "handoff"})
      g.add_edge("close", END); g.add_edge("handoff", END)
      return g.compile()

  GRAPH = build_graph()
  def run_ticket(ticket_id: str) -> AgentState:
      return GRAPH.invoke({"ticket_id": ticket_id})
  ```
  Each node returns the **full updated state dict** (`{**state, "decision": decision}`) — simplest, avoids reducer surprises. (decision: the single `act` retry lives *inside* `verify.run` to keep the graph acyclic; same semantics as 02 §3.2.)
- **Gotchas:** (1) Conditional-edge mapping values must be node names or `END`. (2) Nodes must not raise: catch, append to `state["errors"]`, set `outcome="FAILED"`, and let the edge functions route to `handoff`. (3) API drift between LangGraph versions — if `set_entry_point` is missing use `g.add_edge(START, "ingest")` with `from langgraph.graph import START`. (4) Don't use checkpointers/persistence — unnecessary and they need extra packages.
- **Fallback:** `app/agent/runner.py`:
  ```python
  def run_ticket(ticket_id: str) -> AgentState:
      s = ingest.run({"ticket_id": ticket_id})
      if s.get("outcome") == "INCIDENT_LINKED": return s
      s = gate.run(decide.run(understand.run(s)))
      if s["gate"].ticket_outcome == "AUTO_EXECUTE" and s["decision"].path == "RESOLVE":
          s = verify.run(act.run(s))
          return close.run(s) if s.get("verify_ok") else handoff.run(s)
      return handoff.run(s)
  ```
  Switch with `AGENT_ENGINE=runner` (decision: add this env var, default `langgraph`).

## 7. Anthropic Python SDK (LLM layer)
- **What:** `app/integrations/llm/client.py` — structured outputs via tool-use; models `claude-sonnet-5-5` (decide, incident notice) and `claude-haiku-5-5` (understand).
- **Why:** tool-use with `tool_choice` forces a JSON object matching our pydantic schema — no JSON-in-prose parsing. Haiku for the cheap step keeps a ticket at ~₹4–6.
- **Install:** `pip install anthropic` (latest). Key: `ANTHROPIC_API_KEY` in `backend/.env`.
- **Pre-build check (one line):** `python -c "import anthropic; c=anthropic.Anthropic(); print([m.id for m in c.models.list().data][:20])"` — confirm both ids exist; if a name differs, change the env vars, nothing else.
- **How we use it:**
  ```python
  # app/integrations/llm/client.py
  import anthropic
  from app.config import settings
  from app.integrations.llm.cache import ReplayCache
  from app.integrations.llm import mock as mock_llm

  class LLMClient:
      def __init__(self):
          self.mode = settings.LLM_MODE
          self.cache = ReplayCache(settings.LLM_CACHE_DIR)
          self.client = anthropic.Anthropic() if self.mode != "mock" and settings.ANTHROPIC_API_KEY else None

      def structured(self, *, system: str, user: str, schema, tool_name: str, model: str):
          req = {"model": model, "max_tokens": 1500, "temperature": 0, "system": system,
                 "messages": [{"role": "user", "content": user}],
                 "tools": [{"name": tool_name, "description": f"Record the {tool_name}.", "input_schema": schema.model_json_schema()}],
                 "tool_choice": {"type": "tool", "name": tool_name}}
          if self.mode in ("replay", "live"):
              hit = self.cache.get(req) if self.mode == "replay" else None
              if hit is not None: return schema.model_validate(hit)
              if self.client is not None:
                  try:
                      resp = self.client.messages.create(**req)
                      block = next(b for b in resp.content if b.type == "tool_use")
                      self.cache.put(req, block.input)
                      return schema.model_validate(block.input)
                  except Exception as e:          # network, auth, 529 overloaded…
                      from app.services.audit import log_llm_failure; log_llm_failure(e)
          return mock_llm.structured(user=user, schema=schema, tool_name=tool_name)   # last resort
  ```
  `ReplayCache` key = `sha256(json.dumps(req, sort_keys=True))`, one JSON file per key under `backend/.llm_cache/` (committed after `make warm-cache`).
- **Gotchas:** (1) The user prompt must be **byte-identical** between warm-up and demo for cache hits: no timestamps, no `now()` in prompts — pass the regulatory clock as computed numbers only and set `DEMO_NOW_OVERRIDE` during warm-up and demo. (2) `temperature=0` still isn't fully deterministic → that's why replay exists. (3) `$ref`/`$defs` from nested pydantic models are accepted; `Literal` enums are fine; avoid `anyOf` with `null` on required fields (use `Optional` sparingly in LLM-facing models). (4) Status 529 (overloaded) and 429 — retry once with 2 s backoff then fall through to mock. (5) Prompt-injection: customer text goes inside a clearly delimited `<ticket>` block in the user message; the system prompt says it is data.
- **Fallback:** `LLM_MODE=replay` → automatic `mock` on miss/failure. Mock rules (keyword → type/path/actions) cover the seven scenarios and spike phrasings.

## 8. httpx
- **What:** HTTP client for `PaytmClient`, Slack, and `scripts/warm_cache.sh` equivalents.
- **Why:** sync and async in one library; explicit timeouts; good errors.
- **Install:** `pip install "httpx>=0.27"`
- **How we use it:**
  ```python
  # app/integrations/paytm/client.py
  class PaytmClient:
      def __init__(self, base_url: str = settings.PAYTM_BASE_URL):
          self.http = httpx.Client(base_url=base_url, timeout=httpx.Timeout(5.0, connect=2.0))
      def create_refund(self, *, txn_id, amount_inr, reason, idempotency_key):
          r = self.http.post("/refunds", json={"txn_id": txn_id, "amount_inr": amount_inr, "reason": reason, "idempotency_key": idempotency_key})
          if r.status_code >= 400: raise PaytmError(r.status_code, r.json().get("code", "unknown"), r.text)
          return Refund.model_validate(r.json())
  ```
- **Gotchas:** (1) Calling the mounted mock from inside the same process over HTTP is fine (uvicorn serves it) but needs the server to be *up* — tests use `httpx.Client(transport=httpx.ASGITransport(app=mock_app))` instead. (2) Always set timeouts; a hung call stalls a worker thread.
- **Fallback:** —

## 9. fastembed
- **What:** local embeddings (`BAAI/bge-small-en-v1.5`, 384-d) for past-ticket similarity, KB retrieval, secondary incident signal.
- **Why over sentence-transformers / API embeddings:** no torch (small install), no extra API key, CPU-fast.
- **Install:** `pip install fastembed`; pre-download: `python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"` (~130 MB, do it once).
- **How we use it:**
  ```python
  # app/integrations/embeddings.py
  _model = None
  def embed(texts: list[str]) -> list[list[float]]:
      global _model
      if not settings.EMBEDDINGS_ENABLED: return []
      if _model is None:
          from fastembed import TextEmbedding
          _model = TextEmbedding("BAAI/bge-small-en-v1.5")
      return [list(map(float, v)) for v in _model.embed(texts)]
  def cosine(a, b): import math; d = math.sqrt(sum(x*x for x in a)) * math.sqrt(sum(y*y for y in b)); return sum(x*y for x, y in zip(a, b)) / d if d else 0.0
  ```
- **Gotchas:** first call downloads the model (blocks ~1–2 min on slow wifi) → pre-download; onnxruntime wheels may lag the newest Python → use 3.11/3.12.
- **Fallback:** `EMBEDDINGS_ENABLED=false` → keyword overlap for KB/past tickets; clustering by signature only (it is the primary signal anyway).

## 10. PyYAML (policy rules)
- **What:** loads `app/policy/rules.yaml` (content in 02 §7.1).
- **Install:** `pip install "pyyaml>=6.0"`; load with `yaml.safe_load`.
- **How we use it:** `engine.py` evaluates `requires`/`auto_if`/`block_if` strings with a **tiny purpose-built evaluator**: tokens are dotted paths (`txn.status`, `params.amount_inr`, `limits.auto_refund_max_inr`, `clock.days_late`), operators `== != < <= > >= in`, literals (numbers, bare identifiers, `[A, B]` lists). No `eval()` — judges may ask.
- **Gotchas:** YAML parses `yes/no/on/off` as booleans and bare `1e3` as float; quote anything unusual. Validate the file at startup and fail fast with a clear message.
- **Fallback:** —

## 11. Background jobs: asyncio tasks (not APScheduler/Celery)
- **What:** `app/workers/scheduler.py` — three loops in the FastAPI lifespan.
- **Why:** zero extra processes/brokers; one `make backend` runs everything; APScheduler would add config for no gain; Celery needs Redis — which we deliberately dropped.
- **How we use it:**
  ```python
  import asyncio, anyio, logging
  from app.config import settings
  from app.services import tickets, incidents, sla
  log = logging.getLogger("workers")

  async def _loop(fn, every: float):
      while True:
          try: await anyio.to_thread.run_sync(fn)
          except Exception: log.exception("worker %s failed", fn.__name__)
          await asyncio.sleep(every)

  def start_workers():
      return [asyncio.create_task(_loop(tickets.process_queue_once, 1.0)),
              asyncio.create_task(_loop(incidents.cluster, 15.0)),
              asyncio.create_task(_loop(sla.guard, 30.0))]
  async def stop_workers(tasks):
      for t in tasks: t.cancel()
  ```
  `process_queue_once` claims up to `QUEUE_CONCURRENCY` `NEW` tickets (`UPDATE … SET status='PROCESSING' WHERE status='NEW'` in one transaction), then runs `run_ticket` for each in a `ThreadPoolExecutor(max_workers=QUEUE_CONCURRENCY)`.
- **Gotchas:** (1) Blocking work must go through `to_thread` or the API freezes. (2) One uvicorn process only (see §2). (3) Loops must swallow exceptions — a single bad ticket must not stop clustering.
- **Fallback:** if lifespan tasks misbehave, run the loops in a second process: `python -m app.workers.scheduler` (add a `__main__` that runs `asyncio.run(...)`).

## 12. pytest
- **What:** `backend/tests/`.
- **Install:** `pip install "pytest>=8" pytest-asyncio`; run `cd backend && pytest -q`.
- **How we use it:** policy/TAT/gate tests are pure functions over pydantic objects — no DB, no network; idempotency test uses a temp SQLite (`DATABASE_URL=sqlite:///:memory:` via env in `conftest.py`) and the mock app through `httpx.ASGITransport`.
- **Gotchas:** set `DEMO_NOW_OVERRIDE=2026-10-31T09:00:00Z` in tests so TAT maths is fixed; set `LLM_MODE=mock`.
- **Fallback:** —

## 13. Next.js 15 + TypeScript (cockpit)
- **What:** `frontend/` App Router app, five routes (02 §12).
- **Why over Streamlit/plain React:** named in the deck; looks like a product, not a notebook; scaffolds in minutes.
- **Setup:** `npx create-next-app@latest frontend --typescript --tailwind --app --eslint --no-src-dir --import-alias "@/*"` then `cd frontend && npm i swr react-markdown clsx`. Run `npm run dev` (port 3000). Env: `frontend/.env.local` with `NEXT_PUBLIC_API_BASE=http://localhost:8000`.
- **How we use it:**
  ```ts
  // frontend/lib/api.ts
  const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
  const useFixtures = process.env.NEXT_PUBLIC_USE_FIXTURES === "1";
  export const fetcher = async <T,>(path: string): Promise<T> => {
    if (useFixtures) return (await import(`@/fixtures${path.replace(/\//g, "_")}.json`)).default as T;
    const r = await fetch(`${BASE}${path}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    return r.json();
  };
  export const post = (path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  ```
  ```tsx
  // frontend/app/page.tsx
  "use client";
  import useSWR from "swr";
  import { fetcher } from "@/lib/api";
  export default function Queue() {
    const { data } = useSWR("/api/tickets?limit=50", fetcher, { refreshInterval: 2000 });
    const { data: m } = useSWR("/api/metrics", fetcher, { refreshInterval: 2000 });
    // render KpiTile row + TicketTable
  }
  ```
- **Gotchas:** (1) Anything using hooks/SWR must be a **client component** (`"use client"` at the top). (2) `NEXT_PUBLIC_*` vars are baked at build/dev start — restart `npm run dev` after editing `.env.local`. (3) CORS: backend must allow `http://localhost:3000` (done in §2). (4) Dynamic route folder is literally `app/tickets/[id]/page.tsx`; params are async in Next 15 (`const { id } = await params` in server components, or `useParams()` in client components). (5) Keep the demo drawer behind `?demo=1` so judges don't see "Reset" by accident.
- **Fallback:** one page (`app/page.tsx`) with tabs and an inline timeline drawer.

## 14. Tailwind CSS
- **What:** styling; palette = deck colours (navy `#002E6E`, cyan `#00BAF2`, text `#0B1F3A`, panel `#F2F6FB`).
- **Setup:** installed by `create-next-app --tailwind`. If it installs **v4**: `app/globals.css` starts with `@import "tailwindcss";` and custom colours go in `@theme { --color-navy: #002E6E; --color-cyan: #00BAF2; }` → classes `bg-navy`, `text-cyan`. If **v3**: extend `theme.colors` in `tailwind.config.ts`.
- **Gotchas:** large, legible badges: `text-sm font-semibold px-2 py-0.5 rounded` with solid colours — the demo screen is seen from a distance. Don't spend time on dark mode.
- **Fallback:** —

## 15. SWR
- **What:** polling data layer for the cockpit.
- **Why:** `refreshInterval: 2000` gives a "live" timeline with zero backend work (no websockets).
- **Gotchas:** after a POST (override/approve/demo action) call `mutate(key)` so the UI updates immediately; use `keepPreviousData: true` to avoid flicker; one `fetcher` for all keys.
- **Fallback:** `setInterval` + `fetch` in a `useEffect`.

## 16. Slack incoming webhooks
- **What:** `app/integrations/notify/slack.py` posts to `SLACK_WEBHOOK_URL`.
- **Setup:** Slack workspace → create app → *Incoming Webhooks* → add to channel `#ops` → copy URL into `backend/.env`. Create `#support-leads` too (or reuse `#ops`).
- **How we use it:**
  ```python
  def send(text: str, *, target: str = "#ops") -> bool:
      if not settings.SLACK_WEBHOOK_URL: return False
      r = httpx.post(settings.SLACK_WEBHOOK_URL, json={"text": f"[{target}] {text}"}, timeout=3.0)
      return r.status_code == 200
  ```
  `notify()` always writes the `notifications` row; `delivered` reflects Slack success.
- **Gotchas:** webhook URL is a secret (never commit `.env`); ~1 message/sec rate limit → batch spike nudges (one message per incident, not per ticket); the webhook posts to one fixed channel, so the `[target]` prefix is cosmetic.
- **Fallback:** in-app Notifications panel (always written).

## 17. Makefile
- **What:** root `Makefile` with the targets listed in 03 §6.
- **Gotcha:** recipes need **tabs**, not spaces; `make dev` uses `make -j2 backend frontend` so both logs interleave in one terminal (or open two terminals — simpler on stage).
- **Fallback:** the three raw commands in the README.

## 18. Claude Code (the build tool)
- **What:** the coding agent that implements this spec.
- **How we use it:** open the repo root (where `CLAUDE.md` and `docs/` live); give it **one task at a time** from `06-IMPLEMENTATION-PLAN.md`, in order; after each task run `make test` and commit.
- **Prompts that work:** "Implement task B3 from docs/06-IMPLEMENTATION-PLAN.md. Follow docs/02-ARCHITECTURE.md §7 exactly. Write the tests listed in the task first, then make them pass. Do not change any contract in 02 without telling me." Ask it to print `make test` output before saying it is done.
- **Gotchas:** it will happily "improve" the architecture — point it back at 02; it may invent a package API — tell it to check the installed version (`pip show langgraph`); `/clear` between unrelated tasks keeps it sharp; keep an eye on `git diff` size.
- **Fallback:** —

---

## 19. Install checklist (in this order)

| # | Step | Command |
|---|---|---|
| 2 | Git + GitHub | `git --version`; create private repo `resolv`; both members as collaborators |
| 3 | Python 3.12 (or 3.11) | `python3 --version` / `brew install python@3.12` / `uv python install 3.12` |
| 4 | Node 20 LTS + npm | `node --version` (≥ 20), `npm --version` |
| 5 | Claude Code | install per current docs (`npm install -g @anthropic-ai/claude-code` or the native installer); `claude --version`; log in |
| 6 | Backend venv + deps | `cd backend && python3.12 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt` (use the list in 03 §5.1 even before code exists) |
| 7 | fastembed model | `python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"` |
| 8 | Anthropic key | create key with credit; `export ANTHROPIC_API_KEY=…`; run the pre-build check in §7 |
| 9 | Slack webhook | §16; paste into `backend/.env` |
| 10 | Frontend scaffold warm-up | run `npx create-next-app@latest scratch-app …` in a throwaway folder so the npm cache is hot; delete it |
| 11 | Docker (optional) | `docker compose pull` with the Compose file from §5; skip if Docker isn't already installed |
| 12 | Repo skeleton (if allowed) | `CLAUDE.md`, `docs/`, `.env.example`, `Makefile`, `requirements.txt`, `docker-compose.yml`, empty `backend/app/__init__.py` |
| 13 | Rehearse Claude Code | on the throwaway app: ask it to add a page and run tests; learn the approve/deny prompts |
| 14 | Hardware | chargers, HDMI/USB-C adapter, phone hotspot tested, a second copy of the deck |

## 20. `scripts/verify_setup.sh` — run after install

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== python";   backend/.venv/bin/python --version
echo "== node";     node --version && npm --version
echo "== claude";   claude --version || echo "claude code missing"
echo "== deps";     backend/.venv/bin/python -c "import fastapi, sqlalchemy, httpx, yaml, pydantic, anthropic, langgraph, fastembed; print('imports ok')"
echo "== anthropic"; backend/.venv/bin/python - <<'PY'
import os, anthropic
assert os.environ.get("ANTHROPIC_API_KEY"), "ANTHROPIC_API_KEY not set"
c = anthropic.Anthropic()
ids = [m.id for m in c.models.list().data]
for want in (os.environ.get("LLM_MODEL_DECIDE","claude-sonnet-5-5"), os.environ.get("LLM_MODEL_UNDERSTAND","claude-haiku-5-5")):
    print(want, "OK" if want in ids else f"MISSING — pick one of {ids[:10]}")
r = c.messages.create(model=os.environ.get("LLM_MODEL_UNDERSTAND","claude-haiku-5-5"), max_tokens=20, messages=[{"role":"user","content":"Reply with the single word: ready"}])
print("live call:", r.content[0].text)
PY
echo "== fastembed"; backend/.venv/bin/python -c "from fastembed import TextEmbedding; m=TextEmbedding('BAAI/bge-small-en-v1.5'); print(len(next(m.embed(['hello']))), 'dims')"
if [ -f backend/app/main.py ]; then
  echo "== tests";   (cd backend && .venv/bin/pytest -q || true)
  echo "== api";     (cd backend && (.venv/bin/uvicorn app.main:app --port 8000 >/tmp/resolv.log 2>&1 &) && sleep 4 && curl -sf localhost:8000/api/health && echo && curl -sf localhost:8000/mock/paytm/v1/customers/cust_riya >/dev/null && echo "mock ok"; pkill -f "uvicorn app.main:app" || true)
fi
if [ -f frontend/package.json ]; then
  echo "== frontend build check"; (cd frontend && npx next --version)
fi
echo "ALL CHECKS DONE"
```
Expected: every line prints a version or `OK`; two model ids `OK`; `live call: ready`; `384 dims`; `{"ok":true,...}` and `mock ok` once the backend exists.
