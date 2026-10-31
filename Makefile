.PHONY: env backend frontend dev seed test evals warm lint

# (decision: FIX4) .env must exist: `uv run --env-file` fails without it, and it is how
# DEMO_NOW_OVERRIDE / MOCK_LATENCY_MS reach the mounted mock (which reads os.environ).
env:
	test -f .env || cp .env.example .env

backend: env
	cd backend && uv run --env-file ../.env uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

dev: env
	$(MAKE) backend & $(MAKE) frontend & wait

seed: env
	./scripts/demo_reset.sh

test:
	cd backend && uv run pytest -q

evals:
	cd backend && uv run python -m evals.run

warm: env
	./scripts/warm_cache.sh

lint:
	cd backend && uv run ruff check . && uv run ruff format --check .
