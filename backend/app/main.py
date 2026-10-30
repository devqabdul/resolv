from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import audit, metrics, tickets
from app.db.session import init_db
from app.workers import scheduler
from mock_paytm.main import mock_app


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    init_db()  # (decision: create tables on startup)
    scheduler.start()  # (decision: T8) background loops; tests never run the lifespan
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Resolv", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        # (decision: T9) cockpit may run on any local port
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(metrics.router)
    app.include_router(tickets.router)
    app.include_router(audit.router)
    app.mount("/mock/paytm/v1", mock_app)
    return app


app = create_app()
