"""Embeddings behind EMBEDDINGS_ENABLED (docs/04 §9). fastembed is imported lazily, only when on."""

import logging
import math
from typing import Any

from sqlalchemy import select

from app.config import settings
from app.db import session
from app.db.models import TicketEmbedding

log = logging.getLogger(__name__)
MODEL_NAME = "BAAI/bge-small-en-v1.5"
_model: Any = None
_failed = False


class EmbeddingsUnavailable(RuntimeError):
    """fastembed missing or the model could not be loaded (decision: T24, callers fall back)."""


def enabled() -> bool:
    return bool(settings.EMBEDDINGS_ENABLED) and not _failed


def embed(texts: list[str]) -> list[list[float]]:
    global _model, _failed
    if not enabled():
        raise EmbeddingsUnavailable("embeddings disabled or unavailable")
    if _model is None:
        try:
            from fastembed import TextEmbedding  # lazy: never imported when the flag is off

            _model = TextEmbedding(MODEL_NAME)
        except Exception as exc:  # import error, download/network error
            _failed = True
            log.warning("embeddings_unavailable: %s", exc)
            raise EmbeddingsUnavailable(str(exc)) from exc
    return [[float(x) for x in v] for v in _model.embed(texts)]


def cosine(a: list[float], b: list[float]) -> float:
    d = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return sum(x * y for x, y in zip(a, b, strict=False)) / d if d else 0.0


def store(ticket_id: str, masked_text: str) -> None:
    """Write the ticket_embeddings row for the MASKED text (never raw, S2)."""
    vec = embed([masked_text])[0]
    with session.SessionLocal() as db:
        db.merge(TicketEmbedding(ticket_id=ticket_id, embedding_json=vec))
        db.commit()


def similar_tickets(ticket_id: str, k: int | None = 3) -> list[tuple[str, float]]:
    """Other tickets ranked by cosine to this one, best first (k=None: all)."""
    with session.SessionLocal() as db:
        rows = {r.ticket_id: r.embedding_json for r in db.scalars(select(TicketEmbedding))}
    me = rows.pop(ticket_id, None)
    if me is None:
        return []
    # ponytail: linear scan over JSON vectors; fine for a demo-sized table
    ranked = sorted(((t, cosine(me, v)) for t, v in rows.items()), key=lambda s: -s[1])
    return ranked if k is None else ranked[:k]
