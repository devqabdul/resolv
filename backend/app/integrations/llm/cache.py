"""sha256 file cache for LLM responses (docs/02 §10)."""

import hashlib
import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel


def cache_key(model: str, system: str, user: str, schema: type[BaseModel]) -> str:
    payload = {
        "model": model,
        "system": system,
        "user": user,
        "schema_name": schema.__name__,
        "schema": schema.model_json_schema(),
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()


def get(cache_dir: str, key: str) -> dict[str, Any] | None:
    f = Path(cache_dir) / f"{key}.json"
    return json.loads(f.read_text()) if f.exists() else None


def put(cache_dir: str, key: str, response: dict[str, Any]) -> None:
    d = Path(cache_dir)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{key}.json").write_text(json.dumps(response, sort_keys=True, indent=2))
