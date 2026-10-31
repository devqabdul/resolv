"""Background loops (docs/02 §11). (decision: T8) daemon threads instead of asyncio tasks, so
blocking HTTP/LLM work never stalls the API loop; `start()` is called once from the lifespan."""

import logging
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from app.agent import runner
from app.config import settings
from app.domain.enums import AuditKind
from app.services import audit, incidents, tickets

log = logging.getLogger(__name__)
_stop = threading.Event()
_started = False


def process_queue() -> list[str]:
    """Claim up to QUEUE_CONCURRENCY NEW tickets and run them in parallel threads."""
    ids = tickets.claim_new(settings.QUEUE_CONCURRENCY)
    if ids:
        with ThreadPoolExecutor(max_workers=len(ids)) as pool:
            list(pool.map(runner.run, ids))
    return ids


def cluster_incidents() -> None:
    """Group recent tickets by ledger signature into incidents (docs/02 §8)."""
    incidents.cluster()


def sla_guard() -> None:
    """Placeholder until T17 (services/sla.py)."""


def _loop(name: str, fn: Callable[[], object], every: float) -> None:
    while not _stop.is_set():
        try:
            fn()
        except Exception as e:  # one failure never kills the loop
            log.exception("%s failed", name)
            try:
                audit.record("system", AuditKind.error, {"loop": name, "error": str(e)}, "system")
            except Exception:
                log.exception("could not audit %s error", name)
        _stop.wait(every)


def start() -> None:
    """Start the loops once (idempotent). Importing this module never starts anything."""
    global _started
    if _started:
        return
    _started = True
    _stop.clear()
    for name, fn, every in [
        ("process_queue", process_queue, 1.0),
        ("cluster_incidents", cluster_incidents, 5.0),  # (decision: T15) 5 s, not 15 s
        ("sla_guard", sla_guard, 30.0),
    ]:
        threading.Thread(target=_loop, args=(name, fn, every), name=name, daemon=True).start()


def stop() -> None:
    global _started
    _stop.set()
    _started = False
