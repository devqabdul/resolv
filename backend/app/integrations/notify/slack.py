"""Slack incoming webhook (docs/04 §16). Never raises."""

import logging

import httpx

from app.config import settings

log = logging.getLogger(__name__)


def post(text: str) -> bool:
    """POST {"text": text}; True only on a 2xx. Caller checks SLACK_WEBHOOK_URL first."""
    try:
        r = httpx.post(settings.SLACK_WEBHOOK_URL, json={"text": text}, timeout=3.0)
    except Exception as e:  # noqa: BLE001 - timeout, DNS, anything: a notification must never break the agent
        log.warning("slack post failed: %s", type(e).__name__)
        return False
    if not 200 <= r.status_code < 300:
        log.warning("slack post returned %s", r.status_code)
        return False
    return True
