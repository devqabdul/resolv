"""Metrics for `GET /api/metrics` (docs/01 FR-11): three aggregate queries, no Python row loops."""

from datetime import timedelta
from typing import Any

from sqlalchemy import Float, String, case, cast, distinct, func, select
from sqlalchemy.sql.elements import ColumnElement

from app.db import session
from app.db.models import AuditEvent, Incident, Ticket
from app.domain.enums import TicketStatus as S
from app.util.clock import now

_DONE = [S.RESOLVED, S.CLOSED, S.INCIDENT_LINKED]


def _secs(end: Any, start: Any, dialect: str) -> ColumnElement[Any]:
    if dialect == "sqlite":
        return (func.julianday(end) - func.julianday(start)) * 86400.0
    return cast(func.extract("epoch", end - start), Float)


def compute(window_minutes: int = 240) -> dict[str, Any]:
    """Tickets created in the last `window_minutes`, except where noted.

    (decision: T17) auto_resolution_rate = (RESOLVED with resolved_by == "resolv" + INCIDENT_LINKED)
    / tickets that are not NEW/PROCESSING (0.0 when none).
    avg_first_response_sec = mean(first_response_at - created_at) over tickets with a first response.
    avg_resolution_sec = mean(resolved_at - created_at) over tickets with resolved_at.
    open / awaiting_approval are all-time live counts; incidents_open = incidents OPEN or COMMUNICATED.
    tat_breaches_prevented (proxy, docs/02 §9) = Resolv-resolved tickets that credited compensation.
    """
    since = now() - timedelta(minutes=window_minutes)
    with session.SessionLocal() as db:
        d = db.get_bind().dialect.name
        t = Ticket
        in_win = t.created_at >= since
        settled = t.status.notin_([str(S.NEW), str(S.PROCESSING)])
        auto = ((t.status == str(S.RESOLVED)) & (t.resolved_by == "resolv")) | (
            t.status == str(S.INCIDENT_LINKED)
        )
        row = db.execute(
            select(
                func.sum(case((in_win & settled, 1), else_=0)),
                func.sum(case((in_win & settled & auto, 1), else_=0)),
                func.avg(
                    case(
                        (
                            in_win & t.first_response_at.is_not(None),
                            _secs(t.first_response_at, t.created_at, d),
                        )
                    )
                ),
                func.avg(
                    case(
                        (in_win & t.resolved_at.is_not(None), _secs(t.resolved_at, t.created_at, d))
                    )
                ),
                func.sum(case((t.status.notin_([str(s) for s in _DONE]), 1), else_=0)),
                func.sum(case((t.status == str(S.AWAITING_APPROVAL), 1), else_=0)),
            )
        ).one()
        by_type = dict(
            db.execute(
                select(func.coalesce(t.ticket_type, "unknown"), func.count())
                .where(in_win)
                .group_by(t.ticket_type)
            ).all()
        )
        incidents_open = db.scalar(
            select(func.count())
            .select_from(Incident)
            .where(Incident.status.in_(["OPEN", "COMMUNICATED"]))
        )
        prevented = db.scalar(
            select(func.count(distinct(t.id)))
            .join(AuditEvent, AuditEvent.ticket_id == t.id)
            .where(
                in_win,
                t.status == str(S.RESOLVED),
                t.resolved_by == "resolv",
                AuditEvent.kind == "tool_result",
                cast(AuditEvent.payload_json, String).like('%"credit_compensation"%'),
            )
        )
    n_settled, n_auto, fr, res, n_open, n_appr = row
    return {
        "auto_resolution_rate": (n_auto or 0) / n_settled if n_settled else 0.0,
        "avg_first_response_sec": float(fr or 0.0),
        "avg_resolution_sec": float(res or 0.0),
        "open": int(n_open or 0),
        "awaiting_approval": int(n_appr or 0),
        "incidents_open": int(incidents_open or 0),
        "tat_breaches_prevented": int(prevented or 0),
        "by_type": by_type,
        "window_minutes": window_minutes,
    }
