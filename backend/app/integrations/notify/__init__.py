"""notify(): one entry point for handoff, incident creation and the SLA guard.

(decision: T18) Always writes an `inapp` row; when SLACK_WEBHOOK_URL is set also posts to Slack
and writes a second `slack` row (delivered = 2xx). Each row is audited as `notification`.
Both rows share one `ts` so the panel can pair them.
"""

from app.config import settings
from app.domain.enums import AuditKind
from app.integrations.notify import inapp, slack
from app.services import audit
from app.util.clock import now


def notify(
    target: str,
    text: str,
    ticket_id: str | None = None,
    incident_id: str | None = None,
    *,
    run_id: str | None = None,
    actor: str = "system",
) -> None:
    ts = now()
    rows = [("inapp", True)]
    if settings.SLACK_WEBHOOK_URL:
        rows.append(("slack", slack.post(text)))
    for channel, delivered in rows:
        inapp.write(channel, target, text, delivered, ticket_id, incident_id, ts)
        audit.record(
            ticket_id or incident_id or "system",
            AuditKind.notification,
            {"channel": channel, "target": target, "delivered": delivered},
            run_id=run_id,
            actor=actor,
        )
