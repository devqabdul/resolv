import hashlib
import json
from typing import Any

import httpx
from sqlalchemy.exc import IntegrityError

from app.agent.state import AgentState
from app.agent.tools import _dump
from app.db import session
from app.db.models import ActionExecution
from app.domain.enums import ActionName, AuditKind, GateOutcome
from app.domain.schemas import ActionResult, ProposedAction, TicketDTO
from app.integrations.paytm.client import PaytmError
from app.services import audit, context

# What a registry call can raise (Paytm 4xx/5xx, transport, bad/missing params).
TOOL_ERRORS = (PaytmError, httpx.HTTPError, ValueError, KeyError, TypeError)

MONEY = {ActionName.initiate_reversal, ActionName.credit_compensation}
# Not registry tools: close/handoff send the reply; notes stay internal (no Paytm call).
NO_TOOL = {ActionName.send_reply, ActionName.create_internal_note}


def idempotency_key(ticket_id: str, name: str, params: dict[str, Any]) -> str:
    canon = json.dumps(params, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(f"{ticket_id}{name}{canon}".encode()).hexdigest()


def _tool_params(a: ProposedAction, t: TicketDTO, key: str) -> dict[str, Any]:
    p = {k: v for k, v in a.params.items() if k not in ("holding_reply", "idempotency_key")}
    if a.name == ActionName.initiate_reversal:
        return {
            "txn_id": p["txn_id"],
            "amount_inr": p["amount_inr"],
            "reason": p.get("reason", "DEBITED_NOT_CREDITED"),
            "idempotency_key": key,
        }
    if a.name == ActionName.credit_compensation:
        return {
            "customer_id": p.get("customer_id") or t.customer_id,
            "amount_inr": p["amount_inr"],
            "reason": p.get("reason", "RBI TAT compensation"),
            "txn_id": p["txn_id"],
            "idempotency_key": key,
        }
    if a.name == ActionName.retrigger_settlement:
        return {"settlement_id": p["settlement_id"]}
    if a.name == ActionName.retrigger_kyc:
        # The gate checked kyc_id belongs to this ticket; the mock keys KYC by entity id.
        return {"entity_id": t.merchant_id or t.customer_id}
    if a.name == ActionName.cancel_mandate:
        return {"mandate_id": p["mandate_id"]}
    if a.name == ActionName.notify_customer:
        return {
            "customer_id": p.get("customer_id") or t.customer_id or t.merchant_id,
            "channel": p.get("channel", t.channel.value),
            "text": p.get("text", ""),
        }
    raise ValueError(f"{a.name.value} has no tool mapping.")


def execute(
    a: ProposedAction, t: TicketDTO, run_id: str | None, force: bool = False
) -> ActionResult:
    """Run one gated action once per idempotency key; `force` re-invokes with the same key."""
    params = {k: v for k, v in a.params.items() if k not in ("holding_reply", "idempotency_key")}
    key = idempotency_key(t.id, a.name.value, params)
    with session.SessionLocal() as db:
        prev = db.get(ActionExecution, key)
    if prev is not None and not force:
        audit.record(
            t.id,
            AuditKind.tool_result,  # (decision: T8) idempotent skip = tool_result without a call
            {"name": a.name.value, "ok": True, "skipped": "idempotent", "idempotency_key": key},
            run_id=run_id,
        )
        return ActionResult(
            name=a.name, ok=True, params=params, result=prev.result_json or {}, idempotency_key=key
        )
    try:
        if a.name in NO_TOOL:
            result: dict[str, Any] = {"recorded": True}
        else:
            raw = context.get_tools().call(a.name.value, t.id, run_id, **_tool_params(a, t, key))
            result = _dump(raw)
    except TOOL_ERRORS as e:  # already audited as tool_result ok=false by the registry
        return ActionResult(name=a.name, ok=False, params=params, idempotency_key=key, error=str(e))
    with session.SessionLocal() as db:
        row = db.get(ActionExecution, key)
        if row is None:
            db.add(
                ActionExecution(
                    idempotency_key=key,
                    ticket_id=t.id,
                    name=a.name.value,
                    params_json=params,
                    result_json=result,
                )
            )
        else:
            row.result_json = result
        try:
            db.commit()
        except IntegrityError:  # a concurrent run stored the same key first
            db.rollback()
    return ActionResult(name=a.name, ok=True, params=params, result=result, idempotency_key=key)


def act(state: AgentState) -> AgentState:
    """Execute AUTO_EXECUTE actions in order through the ToolRegistry, idempotently."""
    t, run_id = state["ticket"], state.get("run_id")
    executed = [
        execute(r.action, t, run_id)
        for r in state["gate"].results
        if r.outcome == GateOutcome.AUTO_EXECUTE and r.action.name != ActionName.send_reply
    ]
    return {**state, "executed": executed}
