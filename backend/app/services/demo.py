"""Demo controls: reset, seed, scenario tickets, spike (docs/02 §6.1, docs/06 T9)."""

import logging
import random
import threading
import time
from collections.abc import Callable

from app.config import settings
from app.db import session
from app.db.models import KbDoc
from app.domain.enums import AuditKind, Channel
from app.integrations.paytm.client import PaytmClient
from app.services import audit, context, tickets

log = logging.getLogger(__name__)

D1_TEXT = (
    "Paid Rs 2,499 by UPI from riya@okhdfc, money debited but order failed 3 days ago, "
    "still no refund. Call me on +91 98765 43210."
)

# (decision: T7) name -> (ticket id, channel, customer_id, merchant_id, text)
SCENARIOS: dict[str, tuple[str, Channel, str | None, str | None, str]] = {
    "d1_failed_upi": ("tkt_48213", Channel.in_app_chat, "cust_riya", None, D1_TEXT),
    "d3_over_limit": (
        "tkt_48219",
        Channel.in_app_chat,
        "cust_arjun",
        None,
        (
            "I paid Rs 12,000 by UPI to Urban Kart, money was debited but the order failed. "
            "Please reverse the full Rs 12,000 to my account."
        ),
    ),
    "hinglish_refund_status": (
        "tkt_hinglish_refund_status",
        Channel.in_app_chat,
        "cust_riya",
        None,
        # (decision: T11) names the Rs 1,200 Urban Kart refund so it is not confused with D1's.
        (
            "bhai mera Urban Kart wala Rs 1,200 ka refund rfd_riya_prev ka status kya hai, "
            "paise abhi tak nahi aaye"
        ),
    ),
    "merchant_settlement": (
        "tkt_merchant_settlement",
        Channel.merchant_portal,
        None,
        "mer_chai_point",
        "Our settlement stl_chai_001 of Rs 48,500 has not arrived yet. Why is it on hold?",
    ),
    "kyc_rejected": (
        "tkt_kyc_rejected",
        Channel.in_app_chat,
        "cust_meera",
        None,
        "My KYC was rejected for address mismatch. How do I submit it again?",
    ),
    "mandate_email": (
        "tkt_mandate_email",
        Channel.email,
        "cust_meera",
        None,
        "Please cancel my Netflix autopay mandate mnd_netflix, I no longer use the service.",
    ),
    "dispute": (
        "tkt_dispute",
        Channel.in_app_chat,
        "cust_riya",
        None,
        "I want to raise a chargeback dispute: the merchant charged me twice and refuses to help.",
    ),
}

# (decision: T7) 8 spike phrasings, 5 English then 3 Hinglish; {bank} is the issuer bank.
SPIKE_VARIANTS = [
    "Money was debited from my {bank} account but the payment failed. Please refund it.",
    "UPI payment failed and {bank} still deducted the amount. Where is my money?",
    "My transaction shows failed but the amount left my {bank} account. Need a reversal.",
    "Paid via UPI, order not placed, {bank} debit has not been reversed. Please help.",
    "Debited from {bank} but merchant says no payment received. Refund me urgently.",
    "mera {bank} se paisa kat gaya par payment fail ho gaya, refund kab milega?",
    "UPI payment fail hua lekin {bank} account se paise debit ho gaye, please wapas karo",
    "bhai {bank} ka debit ho gaya order nahi hua, paisa wapas chahiye jaldi",
]


def _paytm() -> PaytmClient:
    return PaytmClient(settings.PAYTM_BASE_URL)


def reset() -> None:
    session.reset_db()
    _paytm().admin_reset()


def seed() -> dict[str, int]:
    _paytm().admin_seed()
    with session.SessionLocal() as db:
        for k in context.KB_DOCS:
            db.merge(KbDoc(id=k.id, title=k.title, content=k.content))
        db.commit()
    return {"kb_docs": len(context.KB_DOCS)}


def scenario(name: str) -> str:
    """Create the named scenario ticket (status NEW); KeyError for an unknown name."""
    tid, channel, cust, mer, text = SCENARIOS[name]
    return tickets.create(channel.value, text, cust, mer, ticket_id=tid).id


SPIKE_BATCH = 10


def spike(
    issuer_bank: str,
    count: int,
    minutes: int,
    batch_delay_s: float = 2.0,
    background: bool | None = None,
) -> list[str]:
    """Mock bank outage plus one NEW ticket per generated customer, texts fixed by the args.

    (decision: T16) Tickets are created in batches of 10, `batch_delay_s` apart, in a background
    thread so the cockpit count climbs; ids are pre-generated and returned at once.
    `background=None` paces only while the scheduler loops run (live app); otherwise (tests,
    scripts) every ticket is created before returning, with no delay.
    """
    from app.workers import scheduler  # lazy: avoid importing the agent at module load

    out = _paytm().admin_bank_outage(issuer_bank, count, minutes)
    rng = random.Random(f"{issuer_bank}:{count}")
    rows = [
        (tickets.new_id("tkt"), rng.choice(SPIKE_VARIANTS).format(bank=issuer_bank), cid)
        for cid in out["customer_ids"]
    ]
    paced = scheduler._started if background is None else background

    def create_all() -> None:
        for i in range(0, len(rows), SPIKE_BATCH):
            if i and paced and batch_delay_s > 0:
                time.sleep(batch_delay_s)
            for tid, text, cid in rows[i : i + SPIKE_BATCH]:
                tickets.create(Channel.in_app_chat.value, text, customer_id=cid, ticket_id=tid)

    if paced:
        threading.Thread(target=_guarded, args=(create_all,), name="spike", daemon=True).start()
    else:
        create_all()
    return [tid for tid, _, _ in rows]


def _guarded(fn: Callable[[], None]) -> None:
    try:
        fn()
    except Exception as e:  # a background spike failure is audited, never silent
        log.exception("spike failed")
        audit.record("system", AuditKind.error, {"loop": "spike", "error": str(e)}, "system")
