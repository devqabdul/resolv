from enum import StrEnum


class TicketType(StrEnum):
    failed_payment_reversal = "failed_payment_reversal"
    refund_status = "refund_status"
    settlement_delay = "settlement_delay"
    kyc_resubmission = "kyc_resubmission"
    mandate_cancellation = "mandate_cancellation"
    dispute_chargeback = "dispute_chargeback"
    fraud_suspected = "fraud_suspected"
    account_blocked = "account_blocked"
    other = "other"


class Path(StrEnum):
    RESOLVE = "RESOLVE"
    ROUTE = "ROUTE"
    ESCALATE = "ESCALATE"


class TicketStatus(StrEnum):
    NEW = "NEW"
    PROCESSING = "PROCESSING"
    RESOLVED = "RESOLVED"
    ROUTED = "ROUTED"
    ESCALATED = "ESCALATED"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    INCIDENT_LINKED = "INCIDENT_LINKED"
    CLOSED = "CLOSED"
    FAILED = "FAILED"


class Priority(StrEnum):
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"


class GateOutcome(StrEnum):
    AUTO_EXECUTE = "AUTO_EXECUTE"
    NEEDS_APPROVAL = "NEEDS_APPROVAL"
    BLOCKED = "BLOCKED"
    HUMAN_ONLY = "HUMAN_ONLY"


class ActionName(StrEnum):
    initiate_reversal = "initiate_reversal"
    credit_compensation = "credit_compensation"
    retrigger_settlement = "retrigger_settlement"
    retrigger_kyc = "retrigger_kyc"
    cancel_mandate = "cancel_mandate"
    send_reply = "send_reply"
    notify_customer = "notify_customer"
    create_internal_note = "create_internal_note"


class Channel(StrEnum):
    in_app_chat = "in_app_chat"
    email = "email"
    merchant_portal = "merchant_portal"


class HandlingMode(StrEnum):
    agent = "agent"
    incident = "incident"
    human = "human"


class AuditKind(StrEnum):
    ingest = "ingest"
    pii_masked = "pii_masked"
    tool_call = "tool_call"
    tool_result = "tool_result"
    understanding = "understanding"
    decision = "decision"
    gate = "gate"
    gate_adjusted_amount = "gate_adjusted_amount"
    verify = "verify"
    reply_sent = "reply_sent"
    status_change = "status_change"
    handoff = "handoff"
    approval_created = "approval_created"
    approval_decided = "approval_decided"
    override = "override"
    notification = "notification"
    sla_nudge = "sla_nudge"  # (decision: T17) one per ticket; doubles as the nudge-once memory
    incident_linked = "incident_linked"
    incident_fast_path = "incident_fast_path"
    error = "error"
