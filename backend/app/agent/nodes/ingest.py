import re

from app.agent.state import AgentState
from app.domain.enums import AuditKind
from app.policy.pii import mask
from app.services import audit, context, incidents

_HINGLISH = re.compile(r"\b(kab|mera|meri|paise|kat|gaya|gaye|nahi|hai|bhai|aayega|abhi)\b")


def _language(text: str) -> str:
    if re.search(r"[ऀ-ॿ]", text):
        return "hi"
    return "hi-en" if len(_HINGLISH.findall(text.lower())) >= 2 else "en"


def ingest(state: AgentState) -> AgentState:
    """Mask PII, hint the language, set the incident signature, check the fast path. No LLM."""
    tid, run_id = state["ticket_id"], state.get("run_id")
    ticket = state.get("ticket") or context.load_ticket(tid)
    masked, found = mask(ticket.raw_text)
    audit.record(tid, AuditKind.pii_masked, {"classes": found}, run_id=run_id)

    # Incident signature from the ledger, before any LLM call (CLAUDE.md, decision 30 Oct).
    cand = context.candidate_txn(context.list_ledger(context.get_tools(), ticket, run_id))
    sig = f"failed_payment_reversal|{cand.issuer_bank}|{cand.failure_reason}" if cand else None
    fields = {
        "masked_text": masked,
        "language": _language(masked),
        "candidate_txn_id": cand.id if cand else None,
        "signature": sig,
    }
    context.update_ticket(tid, **fields)
    ticket = ticket.model_copy(update=fields)
    audit.record(
        tid,
        AuditKind.ingest,
        {k: v for k, v in fields.items() if k != "masked_text"},
        run_id=run_id,
    )

    out: AgentState = {**state, "ticket": ticket}
    if incidents.match_open_incident(ticket) is not None:  # T16 fills in the fast path
        out["outcome"] = "INCIDENT_LINKED"
    return out
