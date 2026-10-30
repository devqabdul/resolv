"""docs/06 T10: adversarial gate cases — no money action may survive any of these."""

from app.domain.enums import ActionName, GateOutcome, TicketType
from app.domain.enums import Path as DecisionPath
from app.domain.schemas import GateSummary, Transaction
from app.policy.engine import evaluate
from tests.test_policy_engine import act, d1_decision, resolve, riya_ctx, ticket, und

MONEY = {ActionName.initiate_reversal, ActionName.credit_compensation}


def no_money_auto(gate: GateSummary) -> bool:
    return not any(
        r.action.name in MONEY and r.outcome == GateOutcome.AUTO_EXECUTE for r in gate.results
    )


def test_unknown_txn_blocked_unknown_reference() -> None:
    dec = resolve(act(ActionName.initiate_reversal, txn_id="txn_nope", amount_inr=2499))
    gate = evaluate(dec, riya_ctx(), ticket(), und())
    assert gate.results[0].outcome == GateOutcome.BLOCKED
    assert any(r.startswith("unknown_reference") for r in gate.results[0].reasons)
    assert gate.ticket_outcome == GateOutcome.BLOCKED


def test_dispute_with_reversal_is_human_only() -> None:
    gate = evaluate(d1_decision(), riya_ctx(), ticket(), und(TicketType.dispute_chargeback))
    assert gate.ticket_outcome == GateOutcome.HUMAN_ONLY
    assert all(r.outcome == GateOutcome.HUMAN_ONLY for r in gate.results)
    assert no_money_auto(gate)


def test_low_confidence_resolve_forces_route() -> None:
    dec = d1_decision()
    assert dec.path == DecisionPath.RESOLVE
    gate = evaluate(dec, riya_ctx(), ticket(), und(conf=0.4))
    assert gate.ticket_outcome == GateOutcome.HUMAN_ONLY  # handoff marks it ROUTED
    assert no_money_auto(gate)
    assert any("0.40" in r for r in gate.results[0].reasons)


def test_amount_above_txn_amount_blocked() -> None:
    dec = resolve(act(ActionName.initiate_reversal, txn_id="txn_48213_a", amount_inr=2500))
    gate = evaluate(dec, riya_ctx(), ticket(), und())
    assert gate.results[0].outcome == GateOutcome.BLOCKED
    assert any("params.amount_inr <= txn.amount_inr" in r for r in gate.results[0].reasons)
    assert no_money_auto(gate)


def test_refund_already_initiated_blocked() -> None:
    txn = Transaction(
        id="txn_init",
        customer_id="cust_riya",
        amount_inr=999,
        method="upi",
        status="DEBITED_NOT_CREDITED",
        created_at="2026-10-28T10:00:00Z",
        refund_status="INITIATED",
        refund_id="rfd_x",
    )
    dec = resolve(act(ActionName.initiate_reversal, txn_id="txn_init", amount_inr=999))
    gate = evaluate(dec, riya_ctx(txn), ticket(), und())
    assert gate.results[0].outcome == GateOutcome.BLOCKED
    assert any("refund_status" in r for r in gate.results[0].reasons)
    assert no_money_auto(gate)
