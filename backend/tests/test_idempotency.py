from sqlalchemy import select

from app.agent.nodes.act import act
from app.agent.nodes.decide import decide
from app.agent.nodes.gate import gate
from app.agent.nodes.ingest import ingest
from app.agent.nodes.understand import understand
from app.db import session
from app.db.models import ActionExecution, AuditEvent
from mock_paytm import store
from tests.test_engines import d1  # noqa: F401 - shared fixture


def test_same_decision_twice_one_refund(d1: str) -> None:  # noqa: F811
    state = gate(decide(understand(ingest({"ticket_id": d1, "run_id": "run_00000001"}))))
    first = act(state)
    second = act(state)  # same ticket, same gate summary

    refunds = [r for r in store.refunds.values() if r["txn_id"] == "txn_48213_a"]
    assert len(refunds) == 1 and refunds[0]["refund_id"].startswith("rfd_")
    assert [r.result for r in first["executed"]] == [r.result for r in second["executed"]]

    with session.SessionLocal() as db:
        rows = db.scalars(select(ActionExecution)).all()
        events = db.scalars(select(AuditEvent).where(AuditEvent.ticket_id == d1)).all()
    assert sorted(r.name for r in rows) == ["credit_compensation", "initiate_reversal"]
    assert len({r.idempotency_key for r in rows}) == 2

    money = {"initiate_reversal", "credit_compensation"}
    calls = [e for e in events if e.kind == "tool_call" and e.payload_json["name"] in money]
    assert len(calls) == 2  # one per action, all from the first run
    skips = [e for e in events if e.kind == "tool_result" and e.payload_json.get("skipped")]
    assert sorted(e.payload_json["name"] for e in skips) == sorted(money)
