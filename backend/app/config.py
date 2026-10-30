from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Env vars from docs/02 §15. Reads backend/.env (or repo-root .env) if present."""

    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    DATABASE_URL: str = "sqlite:///./resolv.db"
    LLM_MODE: str = "mock"  # live | replay | mock
    ANTHROPIC_API_KEY: str = ""
    LLM_MODEL_DECIDE: str = "claude-sonnet-5-5"
    LLM_MODEL_UNDERSTAND: str = "claude-haiku-5-5"
    LLM_CACHE_DIR: str = "./.llm_cache"
    PAYTM_BASE_URL: str = "http://localhost:8000/mock/paytm/v1"
    AGENT_ENGINE: str = "langgraph"  # langgraph | runner
    MOCK_LATENCY_MS: int = 120
    MOCK_REFUND_SETTLE_SECONDS: int = 20
    SLACK_WEBHOOK_URL: str = ""
    EMBEDDINGS_ENABLED: bool = True
    INCIDENT_THRESHOLD: int = 10
    INCIDENT_WINDOW_MINUTES: int = 60
    QUEUE_CONCURRENCY: int = 3
    DEMO_NOW_OVERRIDE: str = ""
    NEXT_PUBLIC_API_BASE: str = "http://localhost:8000"
    NEXT_PUBLIC_USE_FIXTURES: int = 0


settings = Settings()
