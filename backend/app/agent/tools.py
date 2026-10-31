"""ToolRegistry: the ONLY path to Paytm tools, money-moving ones included (CLAUDE.md rule 1)."""

from collections.abc import Callable
from typing import Any

from pydantic import BaseModel

from app.config import settings
from app.domain.enums import AuditKind
from app.integrations.paytm.client import PaytmClient, PaytmError
from app.services import audit

MONEY_TOOLS = {"initiate_reversal", "credit_compensation"}
TOOL_NAMES = [
    "get_customer",
    "get_merchant",
    "list_transactions",
    "get_transaction",
    "initiate_reversal",
    "get_refund",
    "credit_compensation",
    "list_settlements",
    "retrigger_settlement",
    "get_kyc",
    "retrigger_kyc",
    "list_mandates",
    "cancel_mandate",
    "notify_customer",
]


def _dump(x: Any) -> Any:
    if isinstance(x, BaseModel):
        return x.model_dump(mode="json")
    if isinstance(x, list):
        return [_dump(i) for i in x]
    return x


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, tuple[Callable[..., Any], Any]] = {}

    def register(self, name: str, fn: Callable[..., Any], schema: Any = None) -> None:
        self._tools[name] = (fn, schema)

    def call(self, name: str, ticket_id: str, run_id: str | None, **params: Any) -> Any:
        if name not in self._tools:
            raise KeyError(f"Unknown tool {name}.")
        fn, _ = self._tools[name]
        # PII: free text (notify_customer.text) is never written to the audit log.
        logged = {k: ("<redacted>" if k == "text" else v) for k, v in params.items()}
        audit.record(
            ticket_id, AuditKind.tool_call, {"name": name, "params": logged}, run_id=run_id
        )
        try:
            if name in MONEY_TOOLS and not params.get("idempotency_key"):
                raise ValueError(f"{name} requires an idempotency_key.")
            result = fn(**params)
        except Exception as e:
            status = e.status_code if isinstance(e, PaytmError) else None
            audit.record(
                ticket_id,
                AuditKind.tool_result,
                {"name": name, "ok": False, "status": status, "error": str(e)},
                run_id=run_id,
            )
            raise
        audit.record(
            ticket_id,
            AuditKind.tool_result,
            {"name": name, "ok": True, "status": 200, "body": _dump(result)},
            run_id=run_id,
        )
        return result


def build_registry(client: PaytmClient | None = None) -> ToolRegistry:
    client = client or PaytmClient(settings.PAYTM_BASE_URL)
    reg = ToolRegistry()
    for n in TOOL_NAMES:
        reg.register(n, getattr(client, n))
    return reg
