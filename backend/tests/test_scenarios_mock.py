"""All 7 demo scenarios end to end in LLM_MODE=mock on both engines (docs/06 T11)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agent import runner
from app.agent.tools import build_registry
from app.config import settings
from app.db import session
from app.db.models import Approval, AuditEvent, Ticket
from app.integrations.paytm.client import PaytmClient
from app.main import app
from app.services import context, demo

B = "http://localhost:8000/mock/paytm/v1"
MONEY = {"initiate_reversal", "credit_compensation"}
# scenario -> (final status, executed write tools, approval action names, assigned team)
EXPECTED: dict[str, tuple[str, set[str], set[str], str | None]] = {
    "d1_failed_upi": (
        "RESOLVED",
        {"initiate_reversal", "credit_compensation", "notify_customer"},
        set(),
        None,
    ),
    "d3_over_limit": ("AWAITING_APPROVAL", {"notify_customer"}, {"initiate_reversal"}, None),
    "hinglish_refund_status": ("RESOLVED", {"notify_customer"}, set(), None),
    "merchant_settlement": ("RESOLVED", {"retrigger_kyc", "notify_customer"}, set(), None),
    "kyc_rejected": ("RESOLVED", {"retrigger_kyc", "notify_customer"}, set(), None),
    "mandate_email": ("AWAITING_APPROVAL", {"notify_customer"}, {"cancel_mandate"}, None),
    "dispute": ("ROUTED", set(), set(), "risk"),
}


@pytest.fixture()
def paytm(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> PaytmClient:
    monkeypatch.setattr(settings, "LLM_MODE", "mock")
    p = PaytmClient(B, client=TestClient(app, base_url=B))
    monkeypatch.setattr(demo, "_paytm", lambda: p)
    monkeypatch.setattr(context, "_registry", build_registry(p))
    return p


@pytest.mark.parametrize("engine", ["langgraph", "runner"])
@pytest.mark.parametrize("name", list(EXPECTED))
def test_scenario(
    name: str, engine: str, paytm: PaytmClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "AGENT_ENGINE", engine)
    demo.reset()
    demo.seed()
    tid = demo.scenario(name)
    runner.run(tid)

    status, actions, approvals, team = EXPECTED[name]
    with session.SessionLocal() as db:
        t = db.get(Ticket, tid)
        ev = db.scalars(select(AuditEvent).where(AuditEvent.ticket_id == tid)).all()
        apr = db.scalars(select(Approval).where(Approval.ticket_id == tid)).all()
    calls = [e.payload_json for e in ev if e.kind == "tool_call"]
    written = {c["name"] for c in calls if not c["name"].startswith(("get_", "list_"))}
    replies = [e.payload_json for e in ev if e.kind == "reply_sent"]

    assert t.status == status, (t.status, t.path, t.assigned_team)
    assert written == actions
    assert {a.action_json["name"] for a in apr} == approvals
    assert len(replies) == (0 if status == "ROUTED" else 1)
    assert not written & MONEY or name == "d1_failed_upi"
    if team:
        h = next(e.payload_json for e in ev if e.kind == "handoff")
        assert t.assigned_team == h["assigned_team"] == team
        assert h["agent_summary"] and h["next_action_for_human"]
    if approvals:
        assert replies[0]["holding_reply"] is True
    if name == "d1_failed_upi":
        amt = {c["name"]: c["params"]["amount_inr"] for c in calls if c["name"] in MONEY}
        assert amt == {"initiate_reversal": 2499, "credit_compensation": 200}
    if name == "d3_over_limit":
        assert [(a.action_json["name"], a.action_json["params"]["amount_inr"]) for a in apr] == [
            ("initiate_reversal", 12000)
        ]
    if name == "hinglish_refund_status":
        und = next(e.payload_json for e in ev if e.kind == "understanding")
        assert und["language"] == "hi-en"
        rfd = paytm.get_refund("rfd_riya_prev")
        # The tool_call audit redacts reply text; the draft lives in the `decision` event.
        text = next(e.payload_json for e in ev if e.kind == "decision")["customer_reply_draft"]
        assert rfd.arn and rfd.arn.startswith("arn_") and rfd.arn in text and "ETA" in text
