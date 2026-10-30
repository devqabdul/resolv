.PHONY: backend frontend dev seed test evals warm lint

backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

dev:
	$(MAKE) backend & $(MAKE) frontend & wait

seed:
	./scripts/demo_reset.sh

test:
	cd backend && uv run pytest -q

evals:
	cd backend && uv run python -m evals.run

warm:
	./scripts/warm_cache.sh

lint:
	cd backend && uv run ruff check . && uv run ruff format --check .
