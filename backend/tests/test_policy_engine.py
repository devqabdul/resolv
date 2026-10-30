"""docs/06 T10: policy engine cases (docs/02 §7). Now is pinned by conftest to 2026-10-31T10:00Z."""

import json
from pathlib import Path
from typing import Any

import pytest

from app.agent.nodes import gate as gate_node
from app.domain.enums import ActionName, AuditKind, Channel, GateOutcome, TicketType
from app.domain.enums import Path as DecisionPath
from app.domain.schemas import (
    ContextBundle,
    CustomerProfile,
    Decision,
    KycCase,
    Mandate,
    MerchantProfile,
    ProposedAction,
    Settlement,
    TicketDTO,
    Transaction,
    Understanding,
)
from app.policy.engine import evaluate

FIX = Path(__file__).parent / "fixtures" / "paytm"


def _load(name: str) -> Any:
    return json.loads((FIX / name).read_text())


def riya_ctx(*extra: Transaction) -> ContextBundle:
    return ContextBundle(
        customer=CustomerProfile(**_load("customer_riya.json")),
        transactions=[Transaction(**t) for t in _load("transactions_riya.json")] + list(extra),
    )


def ticket(channel: Channel = Channel.in_app_chat) -> TicketDTO:
    return TicketDTO(id="tkt_48213", channel=channel, customer_id="cust_riya")


def und(kind: TicketType = TicketType.failed_payment_reversal, conf: float = 0.92) -> Understanding:
    return Understanding(ticket_type=kind, confidence=conf)


def act(name: ActionName, **params: Any) -> ProposedAction:
    return ProposedAction(name=name, params=params)


def resolve(*actions: ProposedAction) -> Decision:
    return Decision(path=DecisionPath.RESOLVE, proposed_actions=list(actions))


def d1_decision(comp: float = 200) -> Decision:
    return resolve(
        act(ActionName.initiate_reversal, txn_id="txn_48213_a", amount_inr=2499),
        act(
            ActionName.credit_compensation,
            customer_id="cust_riya",
            txn_id="txn_48213_a",
            amount_inr=comp,
        ),
        act(ActionName.send_reply, channel="in_app_chat"),
    )


def test_d1_all_auto() -> None:
    gate = evaluate(d1_decision(), riya_ctx(), ticket(), und())
    assert gate.ticket_outcome == GateOutcome.AUTO_EXECUTE
    assert [r.outcome for r in gate.results] == [GateOutcome.AUTO_EXECUTE] * 3
    assert gate.results[0].action.params["amount_inr"] == 2499
    assert gate.results[1].action.params["amount_inr"] == 200
    assert "holding_reply" not in gate.results[2].action.params


def test_compensation_recompute_500_to_200_with_reason() -> None:
    res = evaluate(d1_decision(comp=500), riya_ctx(), ticket(), und()).results[1]
    assert res.outcome == GateOutcome.AUTO_EXECUTE
    assert res.action.params["amount_inr"] == 200
    assert any("₹500" in r and "₹200" in r for r in res.reasons)


def test_gate_node_audits_gate_adjusted_amount(monkeypatch: pytest.MonkeyPatch) -> None:
    recorded: list[tuple[AuditKind, dict[str, Any]]] = []
    monkeypatch.setattr(
        gate_node.audit, "record", lambda _tid, kind, payload, **_: recorded.append((kind, payload))
    )
    monkeypatch.setattr(gate_node.context, "update_ticket", lambda *_a, **_k: None)
    dec = d1_decision(comp=500)
    state = {
        "ticket": ticket(),
        "run_id": "run_0000abcd",
        "decision": dec,
        "understanding": und(),
        "context": riya_ctx(),
    }
    out = gate_node.gate(state)  # type: ignore[arg-type]
    assert out["gate"].results[1].action.params["amount_inr"] == 200
    adjusted = [p for k, p in recorded if k == AuditKind.gate_adjusted_amount]
    assert adjusted == [{"action": "credit_compensation", "from": 500, "to": 200}]


def big_txn() -> Transaction:
    return Transaction(
        id="txn_big",
        customer_id="cust_riya",
        amount_inr=12000,
        method="upi",
        status="DEBITED_NOT_CREDITED",
        created_at="2026-10-30T10:00:00Z",
    )


def test_reversal_12000_needs_approval_reason_names_5000() -> None:
    dec = resolve(act(ActionName.initiate_reversal, txn_id="txn_big", amount_inr=12000))
    gate = evaluate(dec, riya_ctx(big_txn()), ticket(), und())
    assert gate.ticket_outcome == GateOutcome.NEEDS_APPROVAL
    assert gate.results[0].outcome == GateOutcome.NEEDS_APPROVAL
    assert any("5,000" in r for r in gate.results[0].reasons)


def test_send_reply_becomes_holding_reply_on_needs_approval() -> None:
    dec = resolve(
        act(ActionName.initiate_reversal, txn_id="txn_big", amount_inr=12000),
        act(ActionName.send_reply, channel="in_app_chat"),
    )
    gate = evaluate(dec, riya_ctx(big_txn()), ticket(), und())
    assert gate.ticket_outcome == GateOutcome.NEEDS_APPROVAL
    reply = gate.results[1]
    assert reply.outcome == GateOutcome.AUTO_EXECUTE
    assert reply.action.params["holding_reply"] is True


def meera_mandate_ctx() -> ContextBundle:
    return ContextBundle(mandates=[Mandate(**m) for m in _load("mandates_meera.json")])


@pytest.mark.parametrize(
    ("channel", "outcome"),
    [(Channel.email, GateOutcome.NEEDS_APPROVAL), (Channel.in_app_chat, GateOutcome.AUTO_EXECUTE)],
)
def test_cancel_mandate_channel_rule(channel: Channel, outcome: GateOutcome) -> None:
    dec = resolve(act(ActionName.cancel_mandate, mandate_id="mnd_netflix"))
    gate = evaluate(dec, meera_mandate_ctx(), ticket(channel), und(TicketType.mandate_cancellation))
    assert gate.results[0].outcome == outcome
    assert gate.ticket_outcome == outcome


def chai_ctx(kyc_status: str) -> ContextBundle:
    return ContextBundle(
        merchant=MerchantProfile(id="mer_chai_point", name="Chai Point", kyc_status=kyc_status),
        settlements=[Settlement(**s) for s in _load("settlements_chai.json")],
    )


@pytest.mark.parametrize(
    ("kyc_status", "outcome"),
    [("PENDING", GateOutcome.NEEDS_APPROVAL), ("VERIFIED", GateOutcome.AUTO_EXECUTE)],
)
def test_retrigger_settlement_needs_verified_merchant_kyc(
    kyc_status: str, outcome: GateOutcome
) -> None:
    dec = resolve(act(ActionName.retrigger_settlement, settlement_id="stl_chai_01"))
    t = TicketDTO(id="tkt_chai", channel=Channel.merchant_portal, merchant_id="mer_chai_point")
    gate = evaluate(dec, chai_ctx(kyc_status), t, und(TicketType.settlement_delay))
    assert gate.results[0].outcome == outcome


@pytest.mark.parametrize(
    ("reason", "outcome"),
    [("FRAUD_SUSPECTED", GateOutcome.BLOCKED), ("ADDRESS_MISMATCH", GateOutcome.AUTO_EXECUTE)],
)
def test_retrigger_kyc_fraud_reason_blocked(reason: str, outcome: GateOutcome) -> None:
    kyc = KycCase(**{**_load("kyc_meera.json"), "rejection_reason": reason})
    dec = resolve(act(ActionName.retrigger_kyc, kyc_id="kyc_meera"))
    t = TicketDTO(id="tkt_meera", channel=Channel.in_app_chat, customer_id="cust_meera")
    gate = evaluate(dec, ContextBundle(kyc=kyc), t, und(TicketType.kyc_resubmission))
    assert gate.results[0].outcome == outcome
    assert gate.ticket_outcome == outcome
