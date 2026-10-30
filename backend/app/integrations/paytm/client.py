"""Paytm client (httpx). Only ever talks to the mock Paytm (CLAUDE.md rule 2).

Money-moving methods (`initiate_reversal`, `credit_compensation`) MUST be reached through
`app.agent.tools.ToolRegistry.call()` only (CLAUDE.md rule 1).
"""

from typing import Any, TypeVar
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel

from app.integrations.paytm.schemas import (
    Compensation,
    CustomerProfile,
    Delivered,
    KycCase,
    Mandate,
    MandateCancelled,
    MerchantProfile,
    Refund,
    Settlement,
    SettlementRetriggered,
    Transaction,
)

_M = TypeVar("_M", bound=BaseModel)


class PaytmError(Exception):
    """Non-2xx answer from the (mock) Paytm API."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(f"Paytm returned {status_code}: {detail}")
        self.status_code = status_code
        self.detail = detail


def check_base_url(url: str) -> str:
    p = urlparse(url)
    path = p.path.rstrip("/")
    if p.hostname in ("localhost", "127.0.0.1") and (
        path.endswith("/mock/paytm/v1") or (p.port == 8001 and path == "/v1")
    ):
        return url.rstrip("/")
    raise ValueError(
        "PAYTM_BASE_URL must point at the mounted mock (/mock/paytm/v1) or the standalone "
        "mock on localhost:8001/v1; real Paytm endpoints are never allowed."
    )


class PaytmClient:
    def __init__(
        self, base_url: str, client: httpx.Client | None = None
    ) -> None:  # (decision: optional `client` lets tests inject an in-process ASGI client)
        self.base_url = check_base_url(base_url)
        self._http = client or httpx.Client(base_url=self.base_url, timeout=5.0)

    def _json(self, method: str, path: str, **kw: Any) -> Any:
        for attempt in (0, 1):  # 1 retry on 5xx
            r = self._http.request(method, path, **kw)
            if r.status_code < 500 or attempt:
                break
        if r.status_code >= 400:
            try:
                detail = str(r.json().get("detail", r.text))
            except ValueError:  # body is not JSON
                detail = r.text
            raise PaytmError(r.status_code, detail)
        return r.json()

    def _req(self, model: type[_M], method: str, path: str, **kw: Any) -> _M:
        return model.model_validate(self._json(method, path, **kw))

    def _list(self, model: type[_M], path: str, **params: Any) -> list[_M]:
        rows = self._json("GET", path, params={k: v for k, v in params.items() if v})
        return [model.model_validate(x) for x in rows]

    def get_customer(self, customer_id: str) -> CustomerProfile:
        return self._req(CustomerProfile, "GET", f"/customers/{customer_id}")

    def get_merchant(self, merchant_id: str) -> MerchantProfile:
        return self._req(MerchantProfile, "GET", f"/merchants/{merchant_id}")

    def list_transactions(
        self,
        customer_id: str | None = None,
        merchant_id: str | None = None,
        since: str | None = None,
    ) -> list[Transaction]:
        return self._list(
            Transaction,
            "/transactions",
            customer_id=customer_id,
            merchant_id=merchant_id,
            since=since,
        )

    def get_transaction(self, txn_id: str) -> Transaction:
        return self._req(Transaction, "GET", f"/transactions/{txn_id}")

    def initiate_reversal(
        self, txn_id: str, amount_inr: float, reason: str, idempotency_key: str | None = None
    ) -> Refund:
        if not idempotency_key:
            raise ValueError("initiate_reversal requires an idempotency_key.")
        body = {
            "txn_id": txn_id,
            "amount_inr": amount_inr,
            "reason": reason,
            "idempotency_key": idempotency_key,
        }
        return self._req(Refund, "POST", "/refunds", json=body)

    def get_refund(self, refund_id: str) -> Refund:
        return self._req(Refund, "GET", f"/refunds/{refund_id}")

    def credit_compensation(
        self,
        customer_id: str,
        amount_inr: float,
        reason: str,
        txn_id: str,
        idempotency_key: str | None = None,
    ) -> Compensation:
        if not idempotency_key:
            raise ValueError("credit_compensation requires an idempotency_key.")
        body = {
            "customer_id": customer_id,
            "amount_inr": amount_inr,
            "reason": reason,
            "txn_id": txn_id,
            "idempotency_key": idempotency_key,
        }
        return self._req(Compensation, "POST", "/compensations", json=body)

    def list_settlements(self, merchant_id: str | None = None) -> list[Settlement]:
        return self._list(Settlement, "/settlements", merchant_id=merchant_id)

    def retrigger_settlement(self, settlement_id: str) -> SettlementRetriggered:
        return self._req(SettlementRetriggered, "POST", f"/settlements/{settlement_id}/retrigger")

    def get_kyc(self, entity_id: str) -> KycCase:
        return self._req(KycCase, "GET", f"/kyc/{entity_id}")

    def retrigger_kyc(self, entity_id: str) -> KycCase:
        return self._req(KycCase, "POST", f"/kyc/{entity_id}/retrigger")

    def list_mandates(self, customer_id: str | None = None) -> list[Mandate]:
        return self._list(Mandate, "/mandates", customer_id=customer_id)

    def cancel_mandate(self, mandate_id: str) -> MandateCancelled:
        return self._req(MandateCancelled, "POST", f"/mandates/{mandate_id}/cancel")

    def notify_customer(self, customer_id: str, channel: str, text: str) -> Delivered:
        body = {"customer_id": customer_id, "channel": channel, "text": text}
        return self._req(Delivered, "POST", "/notifications", json=body)

    # Demo controls (docs/02 §6.2 /admin/*); deliberately NOT ToolRegistry tools.
    def admin_reset(self) -> dict[str, Any]:
        return self._json("POST", "/admin/reset")

    def admin_seed(self) -> dict[str, Any]:
        return self._json("POST", "/admin/seed")

    def admin_bank_outage(self, issuer_bank: str, count: int, minutes: int) -> dict[str, Any]:
        body = {"issuer_bank": issuer_bank, "count": count, "minutes": minutes}
        return self._json("POST", "/admin/scenarios/bank_outage", json=body)
