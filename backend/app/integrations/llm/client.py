"""LLMClient: Anthropic tool-use structured outputs with replay cache and mock fallback."""

import logging
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel

from app.config import settings
from app.integrations.llm import cache, mock

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)
# (decision: T25) every replay->mock fallback is logged and appended here as its reason.
FALLBACKS: list[str] = []
PROMPTS = Path(__file__).parents[2] / "agent" / "prompts"


def _fallback(reason: str) -> None:
    FALLBACKS.append(reason)
    log.info("llm_fallback mode=replay reason=%s", reason)


def load_prompt(name: str) -> str:
    """Prompt text from agent/prompts/<name>.md (prompts never live in Python strings)."""
    return (PROMPTS / f"{name}.md").read_text()


class LLMClient:
    def __init__(self, sdk: Any = None) -> None:
        # (decision: `sdk` lets tests inject a fake Anthropic client; built lazily otherwise)
        self._sdk = sdk

    def _client(self) -> Any:
        if self._sdk is None:
            import anthropic

            # (decision: FIX4) bounded timeout: a hung call must not stall the queue worker
            self._sdk = anthropic.Anthropic(
                api_key=settings.ANTHROPIC_API_KEY, timeout=20.0, max_retries=1
            )
        return self._sdk

    def _live(self, model: str, system: str, user: str, schema: type[BaseModel]) -> dict[str, Any]:
        tool = f"record_{schema.__name__.lower()}"
        resp = self._client().messages.create(
            model=model,
            max_tokens=1500,
            temperature=0,
            system=system,
            messages=[{"role": "user", "content": user}],
            tools=[
                {
                    "name": tool,
                    "description": f"Record the {schema.__name__} as structured output.",
                    "input_schema": schema.model_json_schema(),
                }
            ],
            tool_choice={"type": "tool", "name": tool},
        )
        block = next((b for b in resp.content if b.type == "tool_use"), None)
        if block is None:
            raise RuntimeError("The model returned no tool_use block.")
        log.info("llm_call model=%s schema=%s", model, schema.__name__)
        return dict(block.input)

    def structured(self, system: str, user: str, schema: type[T], model: str) -> T:
        mode = settings.LLM_MODE
        if mode == "mock":
            return mock.respond(system, user, schema)
        key = cache.cache_key(model, system, user, schema)
        if mode == "replay":
            hit = cache.get(settings.LLM_CACHE_DIR, key)
            if hit is not None:
                log.info("cache_hit key=%s", key)
                return schema.model_validate(hit)
            log.info("cache_miss key=%s", key)
            if self._sdk is None and not settings.ANTHROPIC_API_KEY:
                _fallback("no_api_key")
                return mock.respond(system, user, schema)  # D10: no key -> mock
        elif self._sdk is None and not settings.ANTHROPIC_API_KEY:
            raise RuntimeError("LLM_MODE=live needs ANTHROPIC_API_KEY.")
        try:
            out = schema.model_validate(self._live(model, system, user, schema))
        except Exception:
            if mode != "replay":
                raise
            log.exception("llm_call failed in replay; falling back to mock")
            _fallback("llm_error")
            return mock.respond(system, user, schema)
        cache.put(settings.LLM_CACHE_DIR, key, out.model_dump(mode="json"))
        return out
