"""Real fastembed model (run with --extra optional). Skips only if the model can't be fetched."""

import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("FASTEMBED_CACHE_PATH", str(Path.home() / ".cache" / "fastembed"))

from app.config import settings
from app.db import session
from app.db.models import Ticket
from app.integrations import embeddings

A = "My UPI payment of Rs 2499 was debited but the order failed and I got no refund"
B = "Money was deducted via UPI for a failed order, please refund my payment"
C = "How do I change the colour theme of the merchant dashboard?"


def test_embed_and_rank(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("fastembed")  # inside the test: collection must not import it
    monkeypatch.setattr(settings, "EMBEDDINGS_ENABLED", True)
    monkeypatch.setattr(embeddings, "_failed", False)
    try:
        va, vb, vc = embeddings.embed([A, B, C])
    except embeddings.EmbeddingsUnavailable as exc:
        pytest.skip(f"model download failed: {exc}")
    assert len(va) == len(vb) == len(vc) == 384
    assert embeddings.cosine(va, vb) > embeddings.cosine(va, vc)

    eng = create_engine(f"sqlite:///{tmp_path / 't.db'}")
    session.init_db(eng)
    monkeypatch.setattr(session, "SessionLocal", sessionmaker(bind=eng, expire_on_commit=False))
    with session.SessionLocal() as db:
        db.add_all(
            Ticket(id=i, channel="in_app_chat", raw_text=t)
            for i, t in (("tkt_a", A), ("tkt_b", B), ("tkt_c", C))
        )
        db.commit()
    for tid, text in (("tkt_a", A), ("tkt_b", B), ("tkt_c", C)):
        embeddings.store(tid, text)
    ranked = embeddings.similar_tickets("tkt_a", k=3)
    assert [t for t, _ in ranked] == ["tkt_b", "tkt_c"]


def test_past_tickets_recency_then_cosine(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("fastembed")
    monkeypatch.setattr(settings, "EMBEDDINGS_ENABLED", True)
    monkeypatch.setattr(embeddings, "_failed", False)
    eng = create_engine(f"sqlite:///{tmp_path / 't2.db'}")
    session.init_db(eng)
    monkeypatch.setattr(session, "SessionLocal", sessionmaker(bind=eng, expire_on_commit=False))
    rows = (("tkt_cur", "cust_x", A), ("tkt_mine", "cust_x", C), ("tkt_other", "cust_y", B))
    with session.SessionLocal() as db:
        db.add_all(
            Ticket(id=i, channel="in_app_chat", customer_id=c, raw_text=t) for i, c, t in rows
        )
        db.commit()
    try:
        for tid, _, text in rows:
            embeddings.store(tid, text)
    except embeddings.EmbeddingsUnavailable as exc:
        pytest.skip(f"model download failed: {exc}")
    from app.services import context

    got = [p.id for p in context.past_tickets(context.load_ticket("tkt_cur"))]
    assert got == ["tkt_mine", "tkt_other"]  # recency first, cosine-top not pushed out
