"""FIX1: the mock proposes retrigger_settlement for a FAILED settlement (gate holds it if KYC is
PENDING) and retrigger_kyc for ON_HOLD_KYC."""

from app.domain.enums import ActionName, Channel, GateOutcome, TicketType
from app.domain.schemas import (
    ContextBundle,
    Decision,
    KycCase,
    MerchantProfile,
    Settlement,
    TicketDTO,
    Understanding,
)
from app.integrations.llm import mock
from app.policy.engine import evaluate


def _ctx(stl_status: str, kyc_status: str) -> ContextBundle:
    return ContextBundle(
        merchant=MerchantProfile(id="mer_x", name="X", kyc_status=kyc_status),
        settlements=[
            Settlement(id="stl_x", merchant_id="mer_x", amount_inr=48000, status=stl_status)
        ],
        kyc=KycCase(id="kyc_x", status=kyc_status),
    )


def _decide(ctx: ContextBundle) -> Decision:
    user = f"<ticket>Settlement failed, please retry.</ticket><context>{ctx.model_dump_json()}</context>"
    return mock.respond("", user, Decision)


def test_failed_settlement_pending_kyc_needs_approval() -> None:
    ctx = _ctx("FAILED", "PENDING")
    dec = _decide(ctx)
    assert [a.name for a in dec.proposed_actions] == [
        ActionName.retrigger_settlement,
        ActionName.send_reply,
    ]
    t = TicketDTO(id="tkt_x", channel=Channel.merchant_portal, merchant_id="mer_x")
    gate = evaluate(
        dec, ctx, t, Understanding(ticket_type=TicketType.settlement_delay, confidence=0.9)
    )
    assert gate.results[0].outcome == GateOutcome.NEEDS_APPROVAL


def test_on_hold_kyc_settlement_retriggers_kyc() -> None:
    dec = _decide(_ctx("ON_HOLD_KYC", "PENDING"))
    assert [a.name for a in dec.proposed_actions] == [
        ActionName.retrigger_kyc,
        ActionName.send_reply,
    ]
