"""Deterministic policy gate (docs/02 §7.2). Decides; never executes anything."""

import re
from typing import Any

from app.domain.enums import ActionName, GateOutcome, Path
from app.domain.schemas import (
    ContextBundle,
    Decision,
    GateResult,
    GateSummary,
    ProposedAction,
    TicketDTO,
    Understanding,
)
from app.policy.rbi_tat import load_rules, regulatory_clock
from app.util.clock import now

_MISSING = object()
_ROOTS = {"txn", "refund", "settlement", "kyc", "mandate", "merchant", "params", "ticket", "clock"}
_ROOTS.add("limits")
_TOKEN = re.compile(r"\s*(\[[^\]]*\]|==|!=|<=|>=|<|>|\bin\b|[^\s\[\]]+)")
_OPS = {"==", "!=", "<=", ">=", "<", ">", "in"}

# param key -> (namespace, ContextBundle list attribute, id attribute)
_REFS = {
    "txn_id": ("txn", "transactions", "id"),
    "refund_id": ("refund", "refunds", "refund_id"),
    "settlement_id": ("settlement", "settlements", "id"),
    "mandate_id": ("mandate", "mandates", "id"),
}


def _fmt(v: Any) -> str:
    return f"{v:,.0f}" if isinstance(v, int | float) and not isinstance(v, bool) else str(v)


def _lookup(path: str, ns: dict[str, Any]) -> Any:
    root, *rest = path.split(".")
    cur = ns.get(root)
    if rest == ["exists"]:
        return cur is not None
    for part in rest:
        if cur is None:
            return _MISSING
        cur = cur.get(part, _MISSING) if isinstance(cur, dict) else getattr(cur, part, _MISSING)
        if cur is _MISSING:
            return _MISSING
    return cur


def _operand(tok: str, ns: dict[str, Any]) -> Any:
    if tok.startswith("["):
        return [x.strip() for x in tok[1:-1].split(",") if x.strip()]
    if re.fullmatch(r"-?\d+(\.\d+)?", tok):
        return float(tok)
    if tok.split(".")[0] in _ROOTS and "." in tok:
        return _lookup(tok, ns)
    return tok  # bare literal, e.g. DEBITED_NOT_CREDITED


def _test(expr: str, ns: dict[str, Any]) -> tuple[bool, Any, Any]:
    """Evaluate `lhs op rhs` (or a bare path) -> (result, lhs value, rhs value)."""
    toks = _TOKEN.findall(expr)
    if len(toks) == 1:
        val = _operand(toks[0], ns)
        return val is True, val, None
    if len(toks) != 3 or toks[1] not in _OPS:
        raise ValueError(f"Rule expression {expr!r} is not `lhs op rhs`; fix rules.yaml.")
    lhs, op, rhs = _operand(toks[0], ns), toks[1], _operand(toks[2], ns)
    if lhs is _MISSING or rhs is _MISSING or lhs is None:
        return False, lhs, rhs
    if hasattr(lhs, "value"):  # StrEnum -> plain value
        lhs = lhs.value
    try:
        if op == "in":
            return str(lhs) in rhs, lhs, rhs
        if op in ("==", "!="):
            same = str(lhs) == str(rhs) if isinstance(rhs, str) else lhs == rhs
            return same if op == "==" else not same, lhs, rhs
        a, b = float(lhs), float(rhs)
    except (TypeError, ValueError):
        return False, lhs, rhs
    return {"<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b}[op], lhs, rhs


def _resolve(action: ProposedAction, ctx: ContextBundle) -> tuple[dict[str, Any], list[str]]:
    """Objects referenced by the action, taken only from the ContextBundle."""
    objs: dict[str, Any] = {"merchant": ctx.merchant, "kyc": ctx.kyc}
    unknown: list[str] = []
    for key, (name, attr, id_attr) in _REFS.items():
        ref = action.params.get(key)
        if ref is None:
            continue
        match = next((o for o in getattr(ctx, attr) if getattr(o, id_attr) == ref), None)
        if match is None:
            unknown.append(f"{name} {ref}")
        objs[name] = match
    kyc_id = action.params.get("kyc_id")
    if kyc_id is not None:
        owners = {ctx.kyc and ctx.kyc.id, ctx.customer and ctx.customer.id}
        owners.add(ctx.merchant and ctx.merchant.id)
        if ctx.kyc is None or kyc_id not in owners:
            unknown.append(f"kyc {kyc_id}")
            objs["kyc"] = None
    return objs, unknown


def _evaluate_action(
    action: ProposedAction, ctx: ContextBundle, ticket: TicketDTO, rules: dict[str, Any]
) -> GateResult:
    rule = rules["actions"][action.name.value]
    objs, unknown = _resolve(action, ctx)
    if unknown:
        return GateResult(
            action=action,
            outcome=GateOutcome.BLOCKED,
            reasons=[
                (
                    f"unknown_reference: {', '.join(unknown)} is not in this ticket's context, "
                    "so nothing was executed; a human should confirm the right id."
                )
            ],
        )
    params = dict(action.params)
    txn = objs.get("txn")
    clock = regulatory_clock(txn, now()) if txn is not None else None
    ns = {**objs, "params": params, "ticket": ticket, "clock": clock, "limits": rules["limits"]}

    failed = [req for req in rule.get("requires", []) if not _test(req, ns)[0]]
    if failed:
        return GateResult(
            action=action,
            outcome=GateOutcome.BLOCKED,
            reasons=[f"Requirement not met: {', '.join(failed)}; route to a human to review."],
        )

    reasons: list[str] = []
    if "recompute" in rule:
        target, source = (s.strip() for s in rule["recompute"].split(" = "))
        new = _operand(source, ns)
        field = target.removeprefix("params.")
        if new is not _MISSING and new is not None and params.get(field) != new:
            reasons.append(
                f"{field} adjusted from ₹{_fmt(params.get(field, 0))} to ₹{_fmt(new)} "
                f"per the RBI TAT clock ({clock.days_late if clock else 0} days late)."
            )
            params[field] = new
            action = action.model_copy(update={"params": params})

    if "block_if" in rule:
        hit, lhs, _ = _test(rule["block_if"], ns)
        if hit:
            return GateResult(
                action=action,
                outcome=GateOutcome.BLOCKED,
                reasons=[*reasons, f"Blocked because {_fmt(lhs)} is never auto-handled; route it."],
            )

    if rule.get("auto") is True:
        return GateResult(action=action, outcome=GateOutcome.AUTO_EXECUTE, reasons=reasons)
    if "auto_if" in rule:
        expr = rule["auto_if"].strip()
        hit, lhs, rhs = _test(expr, ns)
        if hit:
            reasons.append(f"Auto-approved: {expr} ({_fmt(lhs)} vs {_fmt(rhs)}).")
            return GateResult(action=action, outcome=GateOutcome.AUTO_EXECUTE, reasons=reasons)
        lim = expr.split()[-1].split(".")[-1].removesuffix("_max_inr").replace("_", " ")
        if expr.split()[1] == "<=" and isinstance(rhs, int | float):
            reasons.append(
                f"amount {_fmt(lhs)} > {lim} limit {_fmt(rhs)}; needs a named human approval."
            )
        else:
            reasons.append(f"{expr} is false ({_fmt(lhs)}); needs a named human approval.")
    return GateResult(action=action, outcome=GateOutcome.NEEDS_APPROVAL, reasons=reasons)


def _human_only(decision: Decision, reason: str) -> GateSummary:
    results = [
        GateResult(action=a, outcome=GateOutcome.AUTO_EXECUTE, reasons=["Internal notes are safe."])
        if a.name == ActionName.create_internal_note
        else GateResult(action=a, outcome=GateOutcome.HUMAN_ONLY, reasons=[reason])
        for a in decision.proposed_actions
    ]
    return GateSummary(ticket_outcome=GateOutcome.HUMAN_ONLY, results=results)


def evaluate(
    decision: Decision, ctx: ContextBundle, ticket: TicketDTO, understanding: Understanding
) -> GateSummary:
    rules = load_rules()
    if understanding.ticket_type.value in rules["human_only_ticket_types"]:
        return _human_only(
            decision,
            f"{understanding.ticket_type.value} tickets are human-only; "
            "Resolv dropped this action and routes the ticket to a human.",
        )
    threshold = rules["low_confidence_threshold"]
    if understanding.confidence < threshold and decision.path == Path.RESOLVE:
        # Forced ROUTE: HUMAN_ONLY sends the ticket to handoff, which marks it ROUTED.
        return _human_only(
            decision,
            f"Confidence {understanding.confidence:.2f} is below {threshold}, "
            "so Resolv forces ROUTE and a human picks this up.",
        )

    results = [_evaluate_action(a, ctx, ticket, rules) for a in decision.proposed_actions]
    outcomes = {r.outcome for r in results}
    if GateOutcome.NEEDS_APPROVAL in outcomes:
        ticket_outcome = GateOutcome.NEEDS_APPROVAL
        for r in results:
            if r.action.name == ActionName.send_reply and r.outcome == GateOutcome.AUTO_EXECUTE:
                # (decision: T4) holding_reply flag: act sends a holding reply instead of the draft
                r.action = r.action.model_copy(
                    update={"params": {**r.action.params, "holding_reply": True}}
                )
                r.reasons.append("Replaced by a holding reply until the approval is decided.")
    elif GateOutcome.BLOCKED in outcomes:
        ticket_outcome = GateOutcome.BLOCKED
    else:
        ticket_outcome = GateOutcome.AUTO_EXECUTE
    return GateSummary(ticket_outcome=ticket_outcome, results=results)
