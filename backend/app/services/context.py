"""Context builder (docs/02 §4): every Paytm fetch goes through ToolRegistry, so it is audited."""

import re
from datetime import timedelta
from typing import Any

from sqlalchemy import select

from app.agent.tools import ToolRegistry, build_registry
from app.db import session
from app.db.models import KbDoc, Ticket
from app.domain.schemas import (
    ContextBundle,
    KbSnippet,
    PastTicket,
    TicketDTO,
    Transaction,
)
from app.integrations import embeddings
from app.integrations.paytm.client import PaytmError
from app.policy.pii import mask
from app.policy.rbi_tat import load_rules, regulatory_clock
from app.util.clock import now

# (decision: T7) fallback KB used while the kb_docs table is empty; T9's seed writes these rows.
KB_DOCS: list[KbSnippet] = [
    KbSnippet(
        id="kb_rbi_tat",
        title="RBI TAT for failed transactions",
        content="UPI, IMPS and wallet failed debits must be reversed by T+1, cards by T+5. "
        "Each day late earns the customer Rs 100 compensation, credited automatically.",
    ),
    KbSnippet(
        id="kb_refund_limits",
        title="Refund and compensation limits",
        content="Resolv reverses debited-not-credited payments up to Rs 5,000 and credits "
        "compensation up to Rs 1,000 on its own; larger amounts need an approval.",
    ),
    KbSnippet(
        id="kb_settlement_cycles",
        title="Merchant settlement cycles",
        content="Merchant settlements run T+1 or T+2. A settlement on hold for KYC is released "
        "once the merchant KYC is verified; a failed settlement can be re-triggered.",
    ),
    KbSnippet(
        id="kb_kyc_reasons",
        title="KYC rejection reasons",
        content="Common KYC rejections are address mismatch and blurred documents. The customer "
        "resubmits through the resubmission link. Fraud or sanctions hits go to risk.",
    ),
    KbSnippet(
        id="kb_mandate_cancel",
        title="Cancelling a UPI mandate or autopay",
        content="Active mandates and subscriptions can be cancelled from the app or merchant "
        "portal; requests by email need a human approval before cancelling.",
    ),
    KbSnippet(
        id="kb_tone",
        title="Reply tone",
        content="Apologise once, give the reference number, say what happens next and when, "
        "and reply in the customer's language, including Hinglish.",
    ),
]

_registry: ToolRegistry | None = None


def get_tools() -> ToolRegistry:
    """Shared ToolRegistry for the nodes (decision: T7; tests and the runner may `set_tools`)."""
    global _registry
    if _registry is None:
        _registry = build_registry()
    return _registry


def set_tools(registry: ToolRegistry | None) -> None:
    global _registry
    _registry = registry


# (decision: T7) ticket row read/write lives here until services/tickets.py lands in T8.
def load_ticket(ticket_id: str) -> TicketDTO:
    with session.SessionLocal() as db:
        row = db.get(Ticket, ticket_id)
        if row is None:
            raise KeyError(f"Ticket {ticket_id} does not exist.")
        return TicketDTO.model_validate(row, from_attributes=True)


def update_ticket(ticket_id: str, **fields: Any) -> None:
    with session.SessionLocal() as db:
        row = db.get(Ticket, ticket_id)
        if row is None:
            raise KeyError(f"Ticket {ticket_id} does not exist.")
        for k, v in fields.items():
            setattr(row, k, v)
        db.commit()


def _safe(tools: ToolRegistry, name: str, t: TicketDTO, run_id: str | None, **kw: Any) -> Any:
    """Registry call that turns a Paytm 4xx/5xx (already audited) into None."""
    try:
        return tools.call(name, t.id, run_id, **kw)
    except PaytmError:
        return None


def list_ledger(tools: ToolRegistry, t: TicketDTO, run_id: str | None) -> list[Transaction]:
    """All txns for the ticket's customer or merchant, newest first (one audited call)."""
    who = {"customer_id": t.customer_id} if t.customer_id else {"merchant_id": t.merchant_id}
    if not any(who.values()):
        return []
    rows = _safe(tools, "list_transactions", t, run_id, **who) or []
    return sorted(rows, key=lambda x: x.created_at, reverse=True)


def candidate_txn(txns: list[Transaction]) -> Transaction | None:
    """Most recent DEBITED_NOT_CREDITED txn, else None."""
    return max(
        (x for x in txns if x.status == "DEBITED_NOT_CREDITED"),
        key=lambda x: x.created_at,
        default=None,
    )


def policy_summary() -> str:
    r = load_rules()
    lim = r["limits"]
    tat = ", ".join(
        f"{m} T+{v['auto_reversal_days']} (Rs {v['compensation_per_day_inr']}/day late)"
        for m, v in r["rbi_tat"].items()
    )
    return (
        f"Auto-refund limit Rs {lim['auto_refund_max_inr']}; auto-compensation limit "
        f"Rs {lim['auto_compensation_max_inr']}; above these a human approves. RBI TAT: {tat}. "
        f"Human-only ticket types: {', '.join(r['human_only_ticket_types'])}. "
        f"Confidence below {r['low_confidence_threshold']} routes to a human."
    )


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", text.lower()) if len(w) > 2}


def kb_snippets(text: str, k: int = 3) -> list[KbSnippet]:
    """Top-k KB docs by keyword overlap (decision: keyword scoring; past_tickets uses embeddings, T24)."""
    with session.SessionLocal() as db:
        rows = db.scalars(select(KbDoc)).all()
    docs = [(KbSnippet(id=d.id, title=d.title, content=d.content), d.tags or "") for d in rows] or [
        (d, "") for d in KB_DOCS
    ]
    q = _words(text)
    scored = [(len(q & _words(f"{d.title} {d.content} {tags}")), d) for d, tags in docs]
    scored.sort(key=lambda s: (-s[0], s[1].id))
    return [d for score, d in scored[:k] if score > 0]


def _past(r: Ticket) -> PastTicket:
    return PastTicket(
        id=r.id,
        ticket_type=r.ticket_type,
        status=r.status,
        summary=(r.masked_text or mask(r.raw_text)[0])[:200],  # never raw text (PII)
        resolved_by=r.resolved_by,
        created_at=r.created_at,
    )


def _recent_past(t: TicketDTO, n: int) -> list[PastTicket]:
    who = Ticket.customer_id == t.customer_id if t.customer_id else None
    if who is None and t.merchant_id:
        who = Ticket.merchant_id == t.merchant_id
    if who is None:
        return []
    q = select(Ticket).where(who, Ticket.id != t.id).order_by(Ticket.created_at.desc()).limit(n)
    with session.SessionLocal() as db:
        return [_past(r) for r in db.scalars(q).all()]


def _similar_past(t: TicketDTO, n: int) -> list[PastTicket]:
    ids = [i for i, _ in embeddings.similar_tickets(t.id, k=n)]
    if not ids:
        return []
    with session.SessionLocal() as db:
        rows = {r.id: r for r in db.scalars(select(Ticket).where(Ticket.id.in_(ids)))}
    return [_past(rows[i]) for i in ids if i in rows]


def past_tickets(t: TicketDTO, n: int = 3) -> list[PastTicket]:
    """Last n by recency; when embeddings are on, plus top-n by cosine, de-duplicated, recency
    first, at most 2n (decision: T24, per docs/02 §4)."""
    out = _recent_past(t, n)
    if embeddings.enabled():
        seen = {p.id for p in out}
        out += [p for p in _similar_past(t, n) if p.id not in seen]
    return out


def build_context(
    ticket: TicketDTO, tools: ToolRegistry, run_id: str | None = None
) -> ContextBundle:
    t, at = ticket, now()
    ledger = list_ledger(tools, t, run_id)
    refunds = [
        r
        for x in ledger
        if x.refund_id and (r := _safe(tools, "get_refund", t, run_id, refund_id=x.refund_id))
    ]
    txns = [x for x in ledger if x.created_at >= at - timedelta(days=30)][:10]
    cand = candidate_txn(txns)
    entity = t.merchant_id or t.customer_id
    return ContextBundle(
        customer=_safe(tools, "get_customer", t, run_id, customer_id=t.customer_id)
        if t.customer_id
        else None,
        merchant=_safe(tools, "get_merchant", t, run_id, merchant_id=t.merchant_id)
        if t.merchant_id
        else None,
        transactions=txns,
        refunds=refunds,
        settlements=(_safe(tools, "list_settlements", t, run_id, merchant_id=t.merchant_id) or [])
        if t.merchant_id
        else [],
        kyc=_safe(tools, "get_kyc", t, run_id, entity_id=entity) if entity else None,
        mandates=(_safe(tools, "list_mandates", t, run_id, customer_id=t.customer_id) or [])
        if t.customer_id
        else [],
        past_tickets=past_tickets(t),
        kb_snippets=kb_snippets(t.masked_text),
        regulatory_clock=regulatory_clock(cand, at) if cand else None,
        policy_summary=policy_summary(),
    )
