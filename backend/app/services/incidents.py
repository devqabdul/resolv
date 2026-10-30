from app.db.models import Incident
from app.domain.schemas import TicketDTO


def match_open_incident(ticket: TicketDTO) -> Incident | None:
    """OPEN incident whose signature matches the ticket (decision: T7 stub, replaced in T16)."""
    return None
