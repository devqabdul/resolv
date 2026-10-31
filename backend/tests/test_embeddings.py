"""EMBEDDINGS_ENABLED=false: fastembed never imported, keyword/recency retrieval (T24)."""

import sys

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.agent.nodes.ingest import ingest
from app.agent.tools import build_registry
from app.config import settings
from app.db import session
from app.db.models import Ticket, TicketEmbedding
from app.integrations.paytm.client import PaytmClient
from app.main import app
from app.services import context

B = "http://localhost:8000/mock/paytm/v1"


def test_disabled_path_uses_keyword_and_recency(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMBEDDINGS_ENABLED", "false")
    monkeypatch.setattr(settings, "EMBEDDINGS_ENABLED", False)
    eng = create_engine(f"sqlite:///{tmp_path / 't.db'}")
    session.init_db(eng)
    monkeypatch.setattr(session, "SessionLocal", sessionmaker(bind=eng, expire_on_commit=False))
    paytm = PaytmClient(B, client=TestClient(app, base_url=B))
    paytm.admin_reset()
    paytm.admin_seed()
    tools = build_registry(paytm)
    monkeypatch.setattr(context, "_registry", tools)
    with session.SessionLocal() as db:
        db.add_all(
            [
                Ticket(
                    id="tkt_48213",
                    channel="in_app_chat",
                    customer_id="cust_riya",
                    raw_text="Paid Rs 2,499 by UPI, debited but order failed, no refund.",
                ),
                Ticket(
                    id="tkt_hinglish_refund_status",
                    channel="in_app_chat",
                    customer_id="cust_riya",
                    raw_text="mera refund kab aayega, paise kat gaye hain",
                ),
            ]
        )
        db.commit()
    for tid in ("tkt_48213", "tkt_hinglish_refund_status"):
        ingest({"ticket_id": tid, "run_id": "run_00000024"})
    ticket = context.load_ticket("tkt_hinglish_refund_status")
    bundle = context.build_context(ticket, tools)

    assert "fastembed" not in sys.modules
    assert [p.id for p in bundle.past_tickets] == ["tkt_48213"]
    assert [k.id for k in bundle.kb_snippets] == [
        k.id for k in context.kb_snippets(ticket.masked_text)
    ]
    with session.SessionLocal() as db:
        assert db.query(TicketEmbedding).count() == 0
