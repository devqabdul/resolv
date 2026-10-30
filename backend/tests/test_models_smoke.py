import json
import pathlib

import pytest
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import sessionmaker

from app.db import session
from app.db.models import AuditEvent, Ticket
from app.domain import schemas
from app.domain.enums import AuditKind
from app.services import audit
from app.util.clock import now

FIX = pathlib.Path(__file__).parent / "fixtures" / "paytm"


@pytest.fixture()
def db(tmp_path, monkeypatch):
    eng = create_engine(f"sqlite:///{tmp_path / 't.db'}")
    session.init_db(eng)
    session.reset_db(eng)
    monkeypatch.setattr(session, "SessionLocal", sessionmaker(bind=eng, expire_on_commit=False))
    return session.SessionLocal


def test_ticket_and_audit_roundtrip(db):
    with db() as s:
        s.add(Ticket(id="tkt_00000001", channel="in_app_chat", raw_text="hi", masked_text="hi"))
        s.commit()
    audit.record("tkt_00000001", AuditKind.ingest, {"a": 1}, run_id="run_00000001")
    audit.record("tkt_00000001", "decision", {"b": 2}, actor="system")
    with db() as s:
        evs = s.scalars(select(AuditEvent).order_by(AuditEvent.ts, AuditEvent.id)).all()
    assert [e.kind for e in evs] == ["ingest", "decision"]
    assert [e.actor for e in evs] == ["resolv", "system"]
    assert evs[0].run_id == "run_00000001" and evs[0].payload_json == {"a": 1}
    assert evs[0].ts <= evs[1].ts
    with db() as s:
        t = s.get(Ticket, "tkt_00000001")
    assert t.created_at.tzinfo is not None
    assert t.created_at <= now()  # aware vs aware: no TypeError
    assert evs[0].ts.tzinfo is not None


def test_column_names(db):
    insp = inspect(session.SessionLocal().get_bind())
    cols = lambda t: {c["name"] for c in insp.get_columns(t)}
    assert cols("tickets") == {
        "id", "channel", "customer_id", "merchant_id", "raw_text", "masked_text", "language",
        "status", "ticket_type", "priority", "path", "assigned_team", "incident_id",
        "handling_mode", "candidate_txn_id", "signature", "sla_due_at", "created_at",
        "first_response_at", "resolved_at", "resolved_by",
    }  # fmt: skip
    assert cols("audit_events") == {
        "id", "ticket_id", "run_id", "ts", "actor", "kind", "payload_json",
    }  # fmt: skip


def test_all_tables_created(db):
    names = set(inspect(session.SessionLocal().get_bind()).get_table_names())
    assert names == {
        "tickets", "ticket_runs", "audit_events", "approvals", "incidents",
        "incident_tickets", "notifications", "kb_docs", "ticket_embeddings",
        "action_executions",
    }  # fmt: skip


def test_fixtures_parse():
    load = lambda n: json.loads((FIX / n).read_text())
    schemas.CustomerProfile(**load("customer_riya.json"))
    txns = [schemas.Transaction(**t) for t in load("transactions_riya.json")]
    assert (txns[0].id, txns[0].amount_inr, txns[0].method, txns[0].issuer_bank) == (
        "txn_48213_a",
        2499,
        "upi",
        "HDFC",
    )
    assert txns[0].failure_reason == "BANK_SWITCH_TIMEOUT"
    assert txns[0].status == "DEBITED_NOT_CREDITED"
    schemas.Refund(**load("refund_initiated.json"))
    schemas.KycCase(**load("kyc_meera.json"))
    [schemas.Mandate(**m) for m in load("mandates_meera.json")]
    [schemas.Settlement(**x) for x in load("settlements_chai.json")]
