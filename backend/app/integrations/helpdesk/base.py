from typing import Protocol

from app.domain.schemas import TicketDTO


class HelpdeskAdapter(Protocol):
    """Where customer replies go (internal now; a Freshdesk adapter can slot in later)."""

    def reply(
        self,
        ticket: TicketDTO,
        text: str,
        run_id: str | None,
        channel: str | None = None,
        language: str | None = None,
        holding: bool = False,
    ) -> None: ...
