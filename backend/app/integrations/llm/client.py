"""LLMClient: Sarvam/Anthropic structured outputs with replay cache and mock fallback.

(decision: SARVAM-1) provider chain = LLM_PROVIDER (default sarvam), then anthropic; a provider
without a key is skipped; any error/invalid output moves to the next; the last resort is mock.
"""

import json
import logging
from pathlib import Path
from typing import Any, TypeVar

import httpx
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
    log.info("llm_fallback mode=%s reason=%s", settings.LLM_MODE, reason)


def load_prompt(name: str) -> str:
    """Prompt text from agent/prompts/<name>.md (prompts never live in Python strings)."""
    return (PROMPTS / f"{name}.md").read_text()


class LLMClient:
    def __init__(self, sdk: Any = None, http: httpx.Client | None = None) -> None:
        # (decision: `sdk`/`http` let tests inject a fake Anthropic / Sarvam transport)
        self._sdk = sdk
        self._http = http

    def _client(self) -> Any:
        if self._sdk is None:
            import anthropic

            # (decision: FIX4) bounded timeout: a hung call must not stall the queue worker
            self._sdk = anthropic.Anthropic(
                api_key=settings.ANTHROPIC_API_KEY, timeout=20.0, max_retries=1
            )
        return self._sdk

    def _sarvam(
        self, model: str, system: str, user: str, schema: type[BaseModel]
    ) -> dict[str, Any]:
        """OpenAI-compatible POST {SARVAM_BASE_URL}/chat/completions with one forced tool."""
        tool = f"record_{schema.__name__.lower()}"
        body = {
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0,
            "max_tokens": 1500,
            "reasoning_effort": None,  # reasoning tokens would eat the 1500 budget
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": tool,
                        "description": f"Record the {schema.__name__} as structured output.",
                        "parameters": schema.model_json_schema(),
                    },
                }
            ],
            "tool_choice": {"type": "function", "function": {"name": tool}},
        }
        post = self._http.post if self._http is not None else httpx.post
        url = f"{settings.SARVAM_BASE_URL.rstrip('/')}/chat/completions"
        headers = {"api-subscription-key": settings.SARVAM_API_KEY}
        for attempt in range(2):  # one retry, only on timeout/connection, 429, 5xx
            try:
                resp = post(url, json=body, headers=headers, timeout=20.0)
                resp.raise_for_status()
                break
            except httpx.HTTPStatusError as e:
                if attempt or e.response.status_code not in (429, 500, 502, 503, 504):
                    raise
            except httpx.TransportError:
                if attempt:
                    raise
        choice = resp.json()["choices"][0]
        if choice.get("finish_reason") == "length":
            raise RuntimeError("finish_reason=length")
        msg = choice["message"]
        if msg.get("tool_calls"):
            raw = msg["tool_calls"][0]["function"]["arguments"]
        else:  # model ignored the tool: accept a bare JSON reply
            raw = (msg.get("content") or "").strip().removeprefix("```json").strip("`").strip()
        log.info("llm_call provider=sarvam model=%s schema=%s", model, schema.__name__)
        return json.loads(raw)

    def _chain(self, model: str) -> list[tuple[str, str, bool]]:
        """(provider, model, has_key) candidates, primary first, anthropic as the fallback."""
        primary = settings.LLM_PROVIDER
        if model == settings.LLM_MODEL_UNDERSTAND and settings.LLM_PROVIDER_UNDERSTAND:
            primary = settings.LLM_PROVIDER_UNDERSTAND
        elif model == settings.LLM_MODEL_DECIDE and settings.LLM_PROVIDER_DECIDE:
            primary = settings.LLM_PROVIDER_DECIDE
        has = {
            "sarvam": bool(settings.SARVAM_API_KEY) or self._http is not None,
            "anthropic": bool(settings.ANTHROPIC_API_KEY) or self._sdk is not None,
        }
        models = {"sarvam": settings.SARVAM_MODEL, "anthropic": model}
        order = [primary] + [p for p in ("anthropic",) if p != primary]
        return [(p, models[p], has[p]) for p in order if p in has]

    def structured(self, system: str, user: str, schema: type[T], model: str) -> T:
        mode = settings.LLM_MODE
        if mode == "mock":
            return mock.respond(system, user, schema)
        chain = self._chain(model)
        # replay looks up every provider's key, so a warmed cache works with no keys set
        keys = {p: cache.cache_key(f"{p}:{m}", system, user, schema) for p, m, _ in chain}
        chain = [(p, m) for p, m, ok in chain if ok]
        if mode == "replay":
            for key in keys.values():
                hit = cache.get(settings.LLM_CACHE_DIR, key)
                if hit is not None:
                    log.info("cache_hit key=%s", key)
                    return schema.model_validate(hit)
            log.info("cache_miss key=%s", next(iter(keys.values()), "-"))
        if not chain:
            _fallback("no_api_key")
            return mock.respond(system, user, schema)  # D10: no key -> mock
        for provider, m in chain:
            call = self._sarvam if provider == "sarvam" else self._anthropic
            try:
                out = schema.model_validate(call(m, system, user, schema))
            except Exception as e:  # noqa: BLE001 - HTTP, timeout, bad JSON, validation
                status = getattr(getattr(e, "response", None), "status_code", "")
                log.warning(
                    "llm_fallback provider=%s reason=%s %s", provider, type(e).__name__, status
                )
                continue
            cache.put(settings.LLM_CACHE_DIR, keys[provider], out.model_dump(mode="json"))
            return out
        _fallback("llm_error")
        return mock.respond(system, user, schema)

    def _anthropic(
        self, model: str, system: str, user: str, schema: type[BaseModel]
    ) -> dict[str, Any]:
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
