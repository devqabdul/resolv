from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from mock_paytm.main import mock_app


def create_app() -> FastAPI:
    app = FastAPI(title="Resolv")
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
