from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.domain.enums import (
    ActionName,
    Channel,
    GateOutcome,
    HandlingMode,
    Path,
    Priority,
    TicketStatus,
    TicketType,
)


class TicketDTO(BaseModel):
    id: str
    channel: Channel
    customer_id: str | None = None
    merchant_id: str | None = None
    raw_text: str = ""
    masked_text: str = ""
    language: str | None = None
    status: TicketStatus = TicketStatus.NEW
    handling_mode: HandlingMode = HandlingMode.agent
    candidate_txn_id: str | None = None
    signature: str | None = None
    created_at: datetime | None = None


class Understanding(BaseModel):
    ticket_type: TicketType
    confidence: float = Field(ge=0, le=1)
    entities: dict[str, Any] = Field(default_factory=dict)
    sentiment: Literal["frustrated", "neutral", "calm", "angry"] = "neutral"
    language: Literal["en", "hi", "hi-en"] = "en"
    is_repeat_issue: bool = False
    summary_for_agent: str = ""


class ProposedAction(BaseModel):
    name: ActionName
    params: dict[str, Any] = Field(default_factory=dict)
    rationale: str = ""


class Decision(BaseModel):
    path: Path
    priority: Priority = Priority.P3
    proposed_actions: list[ProposedAction] = Field(default_factory=list)
    customer_reply_draft: str = ""
    agent_summary: str = ""
    next_action_for_human: str | None = None
    route_to_team: str | None = None
    reasoning: str = ""


class GateResult(BaseModel):
    action: ProposedAction
    outcome: GateOutcome
    reasons: list[str] = Field(default_factory=list)


class GateSummary(BaseModel):
    ticket_outcome: GateOutcome
    results: list[GateResult] = Field(default_factory=list)


class ActionResult(BaseModel):
    name: ActionName
    ok: bool
    params: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = None
    error: str | None = None


class CustomerProfile(BaseModel):
    id: str
    name: str
    tier: str | None = None
    since: str | None = None
    language: str = "en"
    phone_masked: str | None = None


class MerchantProfile(BaseModel):
    id: str
    name: str
    kyc_status: str
    settlement_cycle: str | None = None


class Transaction(BaseModel):
    id: str
    customer_id: str | None = None
    merchant_id: str | None = None
    amount_inr: float
    method: str  # upi | card | wallet | imps
    status: str  # SUCCESS | FAILED | DEBITED_NOT_CREDITED | PENDING
    issuer_bank: str | None = None
    failure_reason: str | None = None
    created_at: datetime
    refund_status: str = "NONE"  # NONE | INITIATED | COMPLETED | FAILED
    refund_id: str | None = None


class Refund(BaseModel):
    refund_id: str
    status: str  # INITIATED | COMPLETED | FAILED
    txn_id: str | None = None
    amount_inr: float | None = None
    arn: str | None = None
    eta: str | None = None


class Settlement(BaseModel):
    id: str
    merchant_id: str
    amount_inr: float
    status: str  # PROCESSING | SETTLED | ON_HOLD_KYC | FAILED
    expected_at: datetime | None = None
    reason: str | None = None


class KycCase(BaseModel):
    id: str | None = None
    status: str  # VERIFIED | PENDING | REJECTED
    rejection_reason: str | None = None
    resubmission_link: str | None = None


class Mandate(BaseModel):
    id: str
    merchant_name: str
    amount_inr: float
    frequency: str
    status: str  # ACTIVE | CANCELLED


class PastTicket(BaseModel):
    id: str
    ticket_type: str | None = None
    status: str | None = None
    summary: str = ""
    resolved_by: str | None = None
    created_at: datetime | None = None


class KbSnippet(BaseModel):
    id: str
    title: str
    content: str


class RegulatoryClock(BaseModel):
    days_since_txn: int
    tat_deadline: datetime
    days_late: int
    compensation_due_inr: int


class ContextBundle(BaseModel):
    customer: CustomerProfile | None = None
    merchant: MerchantProfile | None = None
    transactions: list[Transaction] = Field(default_factory=list)
    refunds: list[Refund] = Field(default_factory=list)
    settlements: list[Settlement] = Field(default_factory=list)
    kyc: KycCase | None = None
    mandates: list[Mandate] = Field(default_factory=list)
    past_tickets: list[PastTicket] = Field(default_factory=list)
    kb_snippets: list[KbSnippet] = Field(default_factory=list)
    regulatory_clock: RegulatoryClock | None = None
    policy_summary: str = ""


class IncidentNotice(BaseModel):
    """incident_notice.md structured output (decision: T15)."""

    proactive_notice_draft: str
    internal_summary: str
