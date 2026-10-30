"""Rule-based stand-in for the LLM (LLM_MODE=mock; tests, CI, last-resort fallback).

(decision: the user prompt carries tagged blocks `<ticket>..</ticket>` and
`<context>{ContextBundle json}</context>`; without tags the whole text is the ticket.)
"""

import re
from typing import Any, TypeVar

from pydantic import BaseModel

from app.domain.enums import ActionName, Path, Priority, TicketType
from app.domain.schemas import ContextBundle, Decision, ProposedAction, Understanding

T = TypeVar("T", bound=BaseModel)
_HINGLISH = ("kab", "mera", "meri", "paise", "kat ", "gaya", "nahi", "hai", "bhai", "aayega")


def _tag(text: str, name: str) -> str | None:
    m = re.search(rf"<{name}>(.*?)</{name}>", text, re.DOTALL)
    return m.group(1).strip() if m else None


def _parse(user: str) -> tuple[str, ContextBundle]:
    raw = _tag(user, "context")
    ctx = ContextBundle.model_validate_json(raw) if raw else ContextBundle()
    return (_tag(user, "ticket") or user).lower(), ctx


def _classify(t: str) -> tuple[TicketType, float]:
    has = lambda *w: any(x in t for x in w)
    if has("chargeback", "dispute"):
        return TicketType.dispute_chargeback, 0.93
    if has("fraud", "unauthori", "scam", "hacked"):
        return TicketType.fraud_suspected, 0.93
    if has("account") and has("blocked", "locked", "suspended", "frozen"):
        return TicketType.account_blocked, 0.9
    if has("settlement"):
        return TicketType.settlement_delay, 0.92
    if has("kyc"):
        return TicketType.kyc_resubmission, 0.92
    if has("mandate", "autopay", "subscription", "auto-debit", "autodebit"):
        return TicketType.mandate_cancellation, 0.92
    debited = has("debit", "deducted", "kat gaye", "money cut", "charged")
    if (debited and has("fail", "not credited", "order", "declined", "timeout")) or has(
        "axis", "switch"
    ):
        return TicketType.failed_payment_reversal, 0.93
    if has("refund"):
        return TicketType.refund_status, 0.9
    if has("upi") and has("fail"):
        return TicketType.failed_payment_reversal, 0.9
    return TicketType.other, 0.4


def _dnc(ctx: ContextBundle) -> Any:
    rows = [x for x in ctx.transactions if x.status == "DEBITED_NOT_CREDITED"]
    return max(rows, key=lambda x: x.created_at, default=None)


def _refund(t: str, ctx: ContextBundle) -> Any:
    """The refund the customer asks about (decision: T11): id or amount named in the text,
    else the oldest one, so a refund Resolv just initiated never hides an earlier one."""
    nums = {float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*", t)}
    named = [r for r in ctx.refunds if r.refund_id in t or r.amount_inr in nums]
    return (named or ctx.refunds[::-1] or [None])[0]  # ctx.refunds is newest first


def _understand(user: str) -> Understanding:
    t, ctx = _parse(user)
    kind, conf = _classify(t)
    ent: dict[str, Any] = {}
    if kind == TicketType.failed_payment_reversal and (tx := _dnc(ctx)):
        ent = {"txn_id": tx.id, "amount_inr": tx.amount_inr, "issuer_bank": tx.issuer_bank}
    elif kind == TicketType.refund_status and (rf := _refund(t, ctx)):
        ent = {"refund_id": rf.refund_id, "txn_id": rf.txn_id}
    elif kind == TicketType.settlement_delay and ctx.settlements:
        ent = {"settlement_id": ctx.settlements[0].id}
    elif kind == TicketType.mandate_cancellation and ctx.mandates:
        ent = {"mandate_id": ctx.mandates[0].id}
    lang = "hi-en" if sum(w in t + " " for w in _HINGLISH) >= 2 else "en"
    mood = "angry" if "angry" in t or "!!" in t else "frustrated" if "still" in t else "neutral"
    return Understanding(
        ticket_type=kind,
        confidence=conf,
        entities=ent,
        sentiment=mood,
        language=lang,
        is_repeat_issue=any(p.ticket_type == kind.value for p in ctx.past_tickets),
        summary_for_agent=f"Mock read: {kind.value}.",
    )


def _decide(user: str) -> Decision:
    und = _understand(user)
    t, ctx = _parse(user)
    lang = und.language
    ch = {"channel": "in_app_chat", "language": lang}
    reply = lambda text: ProposedAction(name=ActionName.send_reply, params=ch, rationale=text)

    def done(acts: list[ProposedAction], text: str, why: str, pri: Priority = Priority.P2):
        return Decision(
            path=Path.RESOLVE,
            priority=pri,
            proposed_actions=[*acts, reply("Tell the customer what happened.")],
            customer_reply_draft=text,
            agent_summary=why,
            reasoning=why,
        )

    def route(team: str, why: str, nxt: str) -> Decision:
        return Decision(
            path=Path.ROUTE,
            priority=Priority.P2,
            customer_reply_draft="Sorry for the trouble. A specialist will review this and "
            "get back to you.",
            agent_summary=why,
            next_action_for_human=nxt,
            route_to_team=team,
            reasoning=why,
        )

    kind = und.ticket_type
    if kind in (TicketType.dispute_chargeback, TicketType.fraud_suspected):
        return route(
            "risk", f"{kind.value}: human-only.", "Review the case and contact the customer."
        )
    if kind == TicketType.account_blocked:
        return route(
            "risk", "account_blocked: human-only.", "Review the block and contact the customer."
        )
    if kind == TicketType.failed_payment_reversal:
        tx = _dnc(ctx)
        if tx is None:
            return route("payments_ops", "No failed debit found in context.", "Check the ledger.")
        if tx.refund_status not in ("NONE", "FAILED"):
            return done(
                [],
                f"Sorry for the wait. Your refund for {tx.id} is already {tx.refund_status}.",
                f"{tx.id} already has a refund; no money action.",
            )
        acts = [
            ProposedAction(
                name=ActionName.initiate_reversal,
                params={
                    "txn_id": tx.id,
                    "amount_inr": tx.amount_inr,
                    "reason": "DEBITED_NOT_CREDITED",
                },
                rationale="Debited but not credited.",
            )
        ]
        comp = ctx.regulatory_clock.compensation_due_inr if ctx.regulatory_clock else 0
        if comp > 0:
            acts.append(
                ProposedAction(
                    name=ActionName.credit_compensation,
                    params={
                        "customer_id": tx.customer_id,
                        "txn_id": tx.id,
                        "amount_inr": comp,
                        "reason": f"RBI TAT: {ctx.regulatory_clock.days_late} days late",
                    },
                    rationale="Compensation per RBI TAT.",
                )
            )
        text = f"Sorry for the trouble. We are reversing Rs {tx.amount_inr:g} for {tx.id}" + (
            f" and crediting Rs {comp} compensation." if comp else "."
        )
        why = f"{tx.id} debited not credited; clock gives compensation {comp}."
        return done(acts, text, why, Priority.P1 if comp else Priority.P2)
    if kind == TicketType.refund_status:
        rf = _refund(t, ctx)
        if rf is None:
            return route("payments_ops", "No refund found in context.", "Look up the refund.")
        text = (
            f"Sorry for the wait. Aapka refund {rf.refund_id} (ARN {rf.arn}) {rf.status} hai, "
            f"ETA {rf.eta}."
            if lang == "hi-en"
            else f"Sorry for the wait. Your refund {rf.refund_id} (ARN {rf.arn}) is {rf.status}, "
            f"ETA {rf.eta}."
        )
        return done([], text, f"Refund {rf.refund_id} is {rf.status}.")
    if kind in (TicketType.settlement_delay, TicketType.kyc_resubmission):
        st = ctx.settlements[0] if ctx.settlements else None
        if st and st.status == "FAILED" and ctx.merchant and ctx.merchant.kyc_status == "VERIFIED":
            act = ProposedAction(
                name=ActionName.retrigger_settlement, params={"settlement_id": st.id}
            )
            return done([act], "Sorry for the delay. We re-triggered your settlement.", "Failed.")
        if ctx.kyc and ctx.kyc.status in ("REJECTED", "PENDING"):
            act = ProposedAction(name=ActionName.retrigger_kyc, params={"kyc_id": ctx.kyc.id})
            why = f"KYC is {ctx.kyc.status} ({ctx.kyc.rejection_reason}); resubmission reopened."
            return done([act], "Sorry for the delay. We reopened your KYC; please resubmit.", why)
        return route("merchant_ops", "No actionable settlement or KYC state.", "Review manually.")
    if kind == TicketType.mandate_cancellation:
        md = next((m for m in ctx.mandates if m.status == "ACTIVE"), None)
        if md is None:
            return route("l1_support", "No active mandate in context.", "Check the mandates.")
        act = ProposedAction(name=ActionName.cancel_mandate, params={"mandate_id": md.id})
        return done([act], f"We are cancelling your {md.merchant_name} mandate.", "Cancel mandate.")
    return route("l1_support", "Unclear request.", "Read the ticket and reply.")


def respond(system: str, user: str, schema: type[T]) -> T:
    """Mock structured answer for `schema` (system is unused; kept for client parity)."""
    if schema is Understanding:
        return _understand(user)  # type: ignore[return-value]
    if schema is Decision:
        return _decide(user)  # type: ignore[return-value]
    raise ValueError(f"The mock has no rules for {schema.__name__}.")
