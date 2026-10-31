import ast
import json
from pathlib import Path

import pytest

from app.config import settings
from app.domain.enums import ActionName, Channel, GateOutcome, TicketType
from app.domain.enums import Path as DecisionPath
from app.domain.schemas import (
    ContextBundle,
    CustomerProfile,
    Decision,
    ProposedAction,
    TicketDTO,
    Transaction,
    Understanding,
)
from app.policy import pii
from app.policy.engine import evaluate

FIX = Path(__file__).parent / "fixtures" / "paytm"
APP = Path(__file__).parents[1] / "app"


@pytest.fixture(autouse=True)
def _fixed_now(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # D1 txn is created 2026-10-28T10:00Z, so "now" is 3 days later.
    monkeypatch.setattr(settings, "LLM_MODE", "mock")
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite:///{tmp_path}/t.db")
    monkeypatch.setattr(settings, "DEMO_NOW_OVERRIDE", "2026-10-31T10:00:00+00:00")


def _load(name: str):
    return json.loads((FIX / name).read_text())


def _ctx(extra_txns: list[Transaction] | None = None) -> ContextBundle:
    txns = [Transaction(**t) for t in _load("transactions_riya.json")]
    return ContextBundle(
        customer=CustomerProfile(**_load("customer_riya.json")),
        transactions=txns + (extra_txns or []),
    )


TICKET = TicketDTO(id="tkt_48213", channel=Channel.in_app_chat, customer_id="cust_riya")
UND = Understanding(ticket_type=TicketType.failed_payment_reversal, confidence=0.92)


def _decision(txn_id: str = "txn_48213_a", amount: float = 2499) -> Decision:
    return Decision(
        path=DecisionPath.RESOLVE,
        proposed_actions=[
            ProposedAction(
                name=ActionName.initiate_reversal,
                params={"txn_id": txn_id, "amount_inr": amount, "reason": "DNC past TAT"},
            ),
            ProposedAction(
                name=ActionName.credit_compensation,
                params={"customer_id": "cust_riya", "amount_inr": 200, "txn_id": txn_id},
            ),
            ProposedAction(name=ActionName.send_reply, params={"channel": "in_app_chat"}),
        ],
    )


def test_d1_all_auto_execute() -> None:
    gate = evaluate(_decision(), _ctx(), TICKET, UND)
    assert gate.ticket_outcome == GateOutcome.AUTO_EXECUTE
    assert [r.outcome for r in gate.results] == [GateOutcome.AUTO_EXECUTE] * 3
    assert gate.results[1].action.params["amount_inr"] == 200


def test_reversal_12000_needs_approval_naming_limit() -> None:
    big = Transaction(
        id="txn_big",
        customer_id="cust_riya",
        amount_inr=12000,
        method="upi",
        status="DEBITED_NOT_CREDITED",
        created_at="2026-10-30T10:00:00Z",
    )
    decision = Decision(
        path=DecisionPath.RESOLVE,
        proposed_actions=[
            ProposedAction(
                name=ActionName.initiate_reversal, params={"txn_id": "txn_big", "amount_inr": 12000}
            ),
            ProposedAction(name=ActionName.send_reply, params={"channel": "in_app_chat"}),
        ],
    )
    gate = evaluate(decision, _ctx([big]), TICKET, UND)
    rev = gate.results[0]
    assert rev.outcome == GateOutcome.NEEDS_APPROVAL
    assert any("₹5,000" in r for r in rev.reasons)
    assert gate.ticket_outcome == GateOutcome.NEEDS_APPROVAL
    assert gate.results[1].action.params["holding_reply"] is True


def test_unknown_txn_is_blocked() -> None:
    gate = evaluate(_decision(txn_id="txn_nope"), _ctx(), TICKET, UND)
    rev = gate.results[0]
    assert rev.outcome == GateOutcome.BLOCKED
    assert any("unknown_reference" in r for r in rev.reasons)
    assert gate.ticket_outcome != GateOutcome.AUTO_EXECUTE


def test_compensation_recomputed() -> None:
    d = _decision()
    d.proposed_actions[1].params["amount_inr"] = 500
    res = evaluate(d, _ctx(), TICKET, UND).results[1]
    assert res.action.params["amount_inr"] == 200
    assert any("adjusted" in r for r in res.reasons)


def test_pii_mask() -> None:
    masked, found = pii.mask("call +91 98765 43210 or riya@okhdfc, mail riya@gmail.com")
    assert "98765" not in masked and "r***@okhdfc" in masked and "gmail" not in masked
    assert {"phone", "upi_vpa", "email"} <= set(found)


def test_no_eval_or_exec_in_app() -> None:
    hits = [
        f"{p}:{n.lineno}"
        for p in APP.rglob("*.py")
        for n in ast.walk(ast.parse(p.read_text()))
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Name)
        and n.func.id in {"eval", "exec"}
    ]
    assert hits == []
