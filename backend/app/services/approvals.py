"""Approvals (decision: T8 stub, replaced in T12): handoff inserts PENDING rows here."""

from app.db import session
from app.db.models import Approval
from app.domain.enums import AuditKind
from app.domain.schemas import ProposedAction
from app.services import audit
from app.services.tickets import new_id


def create(
    ticket_id: str, action: ProposedAction, reasons: list[str], run_id: str | None = None
) -> str:
    row = Approval(
        id=new_id("apr"),
        ticket_id=ticket_id,
        action_json=action.model_dump(mode="json"),
        reasons_json=reasons,
        status="PENDING",
    )
    with session.SessionLocal() as db:
        db.add(row)
        db.commit()
    audit.record(
        ticket_id,
        AuditKind.approval_created,
        {"approval_id": row.id, "action": action.name.value, "reasons": reasons},
        run_id=run_id,
    )
    return row.id
