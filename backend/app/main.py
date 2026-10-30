from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.session import init_db
from mock_paytm.main import mock_app


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    init_db()  # (decision: create tables on startup; no background loops here)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Resolv", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, object]:
        db = settings.DATABASE_URL.split(":", 1)[0].split("+", 1)[0]
        return {
            "ok": True,
            "llm_mode": settings.LLM_MODE,
            "db": db,
            "mock_paytm": "mounted",
        }

    app.mount("/mock/paytm/v1", mock_app)
    return app


app = create_app()
