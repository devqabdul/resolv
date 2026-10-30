from app.domain.enums import AuditKind
from app.domain.schemas import TicketDTO
from app.services import audit, context


class InternalHelpdesk:
    """Replies through the `notify_customer` tool (audited by the registry) + `reply_sent`."""

    def reply(
        self,
        ticket: TicketDTO,
        text: str,
        run_id: str | None,
        channel: str | None = None,
        language: str | None = None,
        holding: bool = False,
    ) -> None:
        ch = channel or ticket.channel.value
        context.get_tools().call(
            "notify_customer",
            ticket.id,
            run_id,
            customer_id=ticket.customer_id or ticket.merchant_id or "",
            channel=ch,
            text=text,
        )
        # Reply text is not logged here (it is in the `decision` event); only the metadata.
        audit.record(
            ticket.id,
            AuditKind.reply_sent,
            {"channel": ch, "language": language or ticket.language, "holding_reply": holding},
            run_id=run_id,
        )


helpdesk = InternalHelpdesk()
