from app.agent.nodes.act import TOOL_ERRORS, execute
from app.agent.state import AgentState
from app.domain.enums import ActionName, AuditKind
from app.domain.schemas import ActionResult, ProposedAction, TicketDTO
from app.services import audit, context


def _status(r: ActionResult, t: TicketDTO, run_id: str | None) -> tuple[bool, str | None]:
    """Re-read the mock state through the registry -> (ok, observed status)."""
    if not r.ok:
        return False, None
    tools, p = context.get_tools(), r.params
    try:
        if r.name == ActionName.initiate_reversal:
            s = tools.call("get_refund", t.id, run_id, refund_id=r.result["refund_id"]).status
            return s in ("INITIATED", "COMPLETED"), s
        if r.name == ActionName.credit_compensation:  # no read endpoint; trust the stored result
            s = r.result.get("status")
            return s == "CREDITED", s
        if r.name == ActionName.cancel_mandate:
            rows = tools.call("list_mandates", t.id, run_id, customer_id=t.customer_id)
            s = next((m.status for m in rows if m.id == p["mandate_id"]), None)
            return s == "CANCELLED", s
        if r.name == ActionName.retrigger_kyc:
            s = tools.call("get_kyc", t.id, run_id, entity_id=t.merchant_id or t.customer_id).status
            return s == "PENDING", s
        if r.name == ActionName.retrigger_settlement:
            rows = tools.call("list_settlements", t.id, run_id, merchant_id=t.merchant_id)
            s = next((x.status for x in rows if x.id == p["settlement_id"]), None)
            return s == "PROCESSING", s
    except TOOL_ERRORS as e:  # read failed (already audited); counts as a mismatch
        return False, f"error: {e}"
    return True, None


def verify(state: AgentState) -> AgentState:
    """Re-read every executed action; retry a mismatch once with the same idempotency key."""
    t, run_id = state["ticket"], state.get("run_id")
    executed, checks, errors = [], [], list(state.get("errors", []))
    for r in state.get("executed", []):
        ok, seen = _status(r, t, run_id)
        retried = False
        if not ok:
            r = execute(ProposedAction(name=r.name, params=r.params), t, run_id, force=True)
            ok, seen, retried = *_status(r, t, run_id), True
        if not ok:
            errors.append(f"{r.name.value} did not verify (saw {seen}); a human should check it.")
        executed.append(r)
        checks.append({"name": r.name.value, "ok": ok, "observed": seen, "retried": retried})
    ok_all = all(c["ok"] for c in checks)
    audit.record(t.id, AuditKind.verify, {"ok": ok_all, "checks": checks}, run_id=run_id)
    return {**state, "executed": executed, "verify_ok": ok_all, "errors": errors}
