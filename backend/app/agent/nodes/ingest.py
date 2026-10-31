import re

from app.agent.state import AgentState
from app.domain.enums import AuditKind, HandlingMode
from app.integrations import embeddings
from app.integrations.helpdesk.internal import helpdesk
from app.policy.pii import mask
from app.services import audit, context, incidents
from app.util.clock import now

_HINGLISH = re.compile(r"\b(kab|mera|meri|paise|kat|gaya|gaye|nahi|hai|bhai|aayega|abhi)\b")


def _language(text: str) -> str:
    if re.search(r"[ऀ-ॿ]", text):
        return "hi"
    return "hi-en" if len(_HINGLISH.findall(text.lower())) >= 2 else "en"


_noted = False


def _embed(tid: str, masked: str, run_id: str | None) -> None:
    """Write ticket_embeddings when enabled; on failure audit `embeddings_unavailable` once."""
    global _noted
    if not embeddings.enabled():
        return
    try:
        embeddings.store(tid, masked)
    except embeddings.EmbeddingsUnavailable as exc:  # (decision: T24) never crash a run
        if not _noted:
            _noted = True
            note = {"note": "embeddings_unavailable", "reason": str(exc)[:200]}
            audit.record(tid, AuditKind.error, note, run_id=run_id)


def ingest(state: AgentState) -> AgentState:
    """Mask PII, hint the language, set the incident signature, check the fast path. No LLM."""
    tid, run_id = state["ticket_id"], state.get("run_id")
    ticket = state.get("ticket") or context.load_ticket(tid)
    masked, found = mask(ticket.raw_text)
    audit.record(tid, AuditKind.pii_masked, {"classes": found}, run_id=run_id)

    # Incident signature from the ledger, before any LLM call (CLAUDE.md, decision 30 Oct).
    cand_id, sig = incidents.signature_for(ticket, run_id)
    fields = {
        "masked_text": masked,
        "language": _language(masked),
        "candidate_txn_id": cand_id,
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

    _embed(tid, masked, run_id)
    out: AgentState = {**state, "ticket": ticket}
    inc = incidents.match_open_incident(ticket)
    if inc is not None:  # fast path (docs/02 §8): template holding reply, no LLM, graph ends
        text = incidents.attach_fast_path(ticket, inc, run_id)
        helpdesk.reply(ticket, text, run_id, holding=True)
        context.update_ticket(tid, first_response_at=now())
        out["ticket"] = ticket.model_copy(update={"handling_mode": HandlingMode.incident})
        out["outcome"] = "INCIDENT_LINKED"
    return out
