"""Scenario entry points for the admin router."""

from . import store

__all__ = ["bank_outage"]
bank_outage = store.bank_outage
