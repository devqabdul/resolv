import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

# Pin the environment before the app (and app.config.settings) is imported (D13).
os.environ["LLM_MODE"] = "mock"
os.environ["DATABASE_URL"] = f"sqlite:///{Path(tempfile.mkdtemp()) / 'test.db'}"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["SARVAM_API_KEY"] = ""  # (decision: SARVAM-1) tests never reach Sarvam, even with a key in .env
os.environ["DEMO_NOW_OVERRIDE"] = "2026-10-31T10:00:00Z"
os.environ["MOCK_LATENCY_MS"] = "0"
os.environ["EMBEDDINGS_ENABLED"] = "false"  # tests opt in to fastembed explicitly (T24)

import pytest
from fastapi.testclient import TestClient

from app.db.session import init_db
from app.main import app

init_db()


@pytest.fixture
def client() -> Iterator[TestClient]:
    # No `with` block: the lifespan (background loops) never starts.
    yield TestClient(app)
