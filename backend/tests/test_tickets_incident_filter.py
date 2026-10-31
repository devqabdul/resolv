from fastapi.testclient import TestClient

from app.agent import runner
from app.integrations.paytm.client import PaytmClient
from app.services import demo, incidents
from tests.test_incidents import paytm  # noqa: F401  (fixture)


def test_incident_id_filter(client: TestClient, paytm: PaytmClient) -> None:  # noqa: F811
    demo.scenario("d1_failed_upi")  # an unrelated ticket that must not be returned
    ids = demo.spike("AXIS", 20, 20)
    for i in ids:
        runner.run(i)
    assert incidents.cluster()
    [inc] = client.get("/api/incidents").json()

    r = client.get("/api/tickets", params={"incident_id": inc["id"], "limit": 500}).json()
    assert sorted(t["id"] for t in r["items"]) == sorted(ids)
    assert r["total"] == len(ids) == inc["ticket_count"]
    assert {t["incident_id"] for t in r["items"]} == {inc["id"]}

    assert client.get("/api/tickets", params={"incident_id": "inc_nope"}).json() == {
        "items": [],
        "total": 0,
    }
    assert client.get("/api/tickets", params={"limit": 500}).json()["total"] == len(ids) + 1
