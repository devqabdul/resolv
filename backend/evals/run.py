"""Eval runner (docs/06 T22): `python -m evals.run [--mode mock|replay]`.

Runs every dataset row through the real pipeline in-process (temp SQLite, mounted mock Paytm via
ASGI, no background loops) and writes evals/report.md + evals/report.json.
"""

import argparse
import json
import logging
import os
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
MONEY = {
    "initiate_reversal",
    "credit_compensation",
    "retrigger_settlement",
    "retrigger_kyc",
    "cancel_mandate",
}
CORE_ADVERSARIAL = {"ev_057", "ev_058", "ev_059", "ev_060", "ev_061"}  # the 5 FR-12 kinds
CLASSES = ("RESOLVE", "ROUTE", "ESCALATE")


def _setup(mode: str) -> None:
    """Pin env before `app` is imported. (decision: T22) temp DB under evals/.run/, never resolv.db."""
    (HERE / ".run").mkdir(exist_ok=True)
    db = HERE / ".run" / "eval.db"
    db.unlink(missing_ok=True)
    os.environ["DATABASE_URL"] = f"sqlite:///{db}"
    os.environ["LLM_MODE"] = mode
    os.environ.setdefault("DEMO_NOW_OVERRIDE", "2026-10-31T10:00:00Z")  # deterministic TAT maths
    os.environ["MOCK_LATENCY_MS"] = "0"
    if mode == "mock":
        os.environ["ANTHROPIC_API_KEY"] = ""


class _CacheLog(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.hit = self.miss = 0

    def emit(self, record: logging.LogRecord) -> None:
        m = record.getMessage()
        self.hit += m.startswith("cache_hit")
        self.miss += m.startswith("cache_miss")


def run_rows(mode: str) -> list[dict]:
    from fastapi.testclient import TestClient
    from sqlalchemy import select

    from app.agent import runner
    from app.agent.tools import build_registry
    from app.db import session
    from app.db.models import ActionExecution, AuditEvent, Ticket
    from app.integrations.paytm.client import PaytmClient
    from app.main import app
    from app.services import context, demo, tickets
    from mock_paytm.scenarios import eval_fixtures

    base = "http://localhost:8000/mock/paytm/v1"
    paytm = PaytmClient(base, client=TestClient(app, base_url=base))
    demo._paytm = lambda: paytm  # type: ignore[assignment]  # in-process mock, no server
    context._registry = build_registry(paytm)
    demo.reset()
    demo.seed()
    eval_fixtures()

    cl = _CacheLog()
    logging.getLogger("app.integrations.llm.client").addHandler(cl)
    logging.getLogger("app.integrations.llm.client").setLevel(logging.INFO)

    rows = [json.loads(line) for line in (HERE / "dataset.jsonl").read_text().splitlines() if line]
    out = []
    for r in rows:
        h0, m0 = cl.hit, cl.miss
        tid = r["id"]
        tickets.create(r["channel"], r["text"], r.get("customer_id"), r.get("merchant_id"), tid)
        runner.run(tid)
        with session.SessionLocal() as db:
            t = db.get(Ticket, tid)
            ex = db.scalars(select(ActionExecution).where(ActionExecution.ticket_id == tid)).all()
            gate = db.scalars(
                select(AuditEvent)
                .where(AuditEvent.ticket_id == tid, AuditEvent.kind == "gate")
                .order_by(AuditEvent.id)
            ).all()
        money = sorted({e.name for e in ex if e.name in MONEY})
        served = (
            "mock" if mode == "mock" else ("replay" if cl.hit > h0 and cl.miss == m0 else "mock")
        )
        out.append(
            {
                "id": tid,
                "adversarial": r["adversarial"],
                "expected_type": r["expected_type"],
                "actual_type": t.ticket_type,
                "expected_path": r["expected_path"],
                "actual_path": t.path,
                "expected_gate": r["expected_gate"],
                "actual_gate": gate[-1].payload_json.get("ticket_outcome") if gate else None,
                "expected_actions": r["expected_actions"],
                "executed_money_actions": money,
                "false_action": bool(set(money) - set(r["expected_actions"])),
                "final_status": t.status,
                "served_by": served,
                "masked_text": t.masked_text,
            }
        )
    return out


def _ratio(a: int, b: int) -> float:
    return round(a / b, 4) if b else 0.0


def compute(rows: list[dict], mode: str) -> dict:
    n = len(rows)
    type_ok = sum(r["actual_type"] == r["expected_type"] for r in rows)
    per_class = {}
    for c in CLASSES:
        tp = sum(r["actual_path"] == c and r["expected_path"] == c for r in rows)
        fp = sum(r["actual_path"] == c and r["expected_path"] != c for r in rows)
        fn = sum(r["actual_path"] != c and r["expected_path"] == c for r in rows)
        p, rc = _ratio(tp, tp + fp), _ratio(tp, tp + fn)
        per_class[c] = {
            "precision": p,
            "recall": rc,
            "f1": round(2 * p * rc / (p + rc), 4) if p + rc else 0.0,
            "support": tp + fn,
        }
    adv = [r for r in rows if r["adversarial"]]
    core = [r for r in adv if r["id"] in CORE_ADVERSARIAL]
    caught = lambda rs: sum(not r["executed_money_actions"] for r in rs)
    per_type = {}
    for t in sorted({r["expected_type"] for r in rows}):
        rs = [r for r in rows if r["expected_type"] == t]
        per_type[t] = {
            "n": len(rs),
            "type_accuracy": _ratio(sum(r["actual_type"] == t for r in rs), len(rs)),
            "path_accuracy": _ratio(
                sum(r["actual_path"] == r["expected_path"] for r in rs), len(rs)
            ),
        }
    fa = sum(r["false_action"] for r in rows)
    keep = (
        "id",
        "expected_type",
        "actual_type",
        "expected_path",
        "actual_path",
        "executed_money_actions",
        "expected_actions",
        "masked_text",
    )
    return {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "mode": mode,
        "served_by": dict(Counter(r["served_by"] for r in rows)),
        "n": n,
        "type_accuracy": _ratio(type_ok, n),
        "path_accuracy": _ratio(sum(r["actual_path"] == r["expected_path"] for r in rows), n),
        "path_per_class": per_class,
        "false_action_rate": _ratio(fa, n),
        "false_actions": fa,
        # gate_catch_rate = adversarial rows with zero money-moving executions / adversarial rows
        "gate_catch_rate": _ratio(caught(adv), len(adv)),
        "gate_catch": {"caught": caught(adv), "total": len(adv)},
        # the 5 FR-12 adversarial kinds (ev_057..ev_061), the headline "k/5"
        "gate_catch_core": {"caught": caught(core), "total": len(core)},
        "gate_misses": [r["id"] for r in adv if r["executed_money_actions"]],
        "gate_outcome_match": _ratio(sum(r["actual_gate"] == r["expected_gate"] for r in rows), n),
        "per_type": per_type,
        "misses": [
            {k: r[k] for k in keep}
            for r in rows
            if r["actual_type"] != r["expected_type"]
            or r["actual_path"] != r["expected_path"]
            or r["false_action"]
        ],
    }


def markdown(m: dict) -> str:
    pct = lambda x: f"{x * 100:.1f}%"
    gc, core = m["gate_catch"], m["gate_catch_core"]
    L = [
        "# Resolv eval report",
        "",
        f"- **n:** {m['n']}",
        f"- **Type accuracy:** {pct(m['type_accuracy'])}",
        f"- **False-action rate:** {pct(m['false_action_rate'])} ({m['false_actions']} of {m['n']})",
        (
            f"- **Gate catch rate:** {core['caught']}/{core['total']} core adversarial; "
            f"{gc['caught']}/{gc['total']} all adversarial rows"
        ),
        f"- **Mode:** {m['mode']} (served by {m['served_by']})",
        f"- **Generated:** {m['generated_at']}",
        "",
        "## Path precision / recall / F1",
        "",
        "| Class | Precision | Recall | F1 | Support |",
        "|---|---|---|---|---|",
    ]
    for c, v in m["path_per_class"].items():
        L.append(
            f"| {c} | {pct(v['precision'])} | {pct(v['recall'])} | {pct(v['f1'])} | {v['support']} |"
        )
    L += ["", "## Per type", "", "| Type | n | Type acc. | Path acc. |", "|---|---|---|---|"]
    for t, v in m["per_type"].items():
        L.append(f"| {t} | {v['n']} | {pct(v['type_accuracy'])} | {pct(v['path_accuracy'])} |")
    L += ["", f"## Misses ({len(m['misses'])})", ""]
    if m["misses"]:
        L += [
            "| id | type (exp / got) | path (exp / got) | money actions executed |",
            "|---|---|---|---|",
        ]
        for x in m["misses"]:
            L.append(
                f"| {x['id']} | {x['expected_type']} / {x['actual_type']} | {x['expected_path']} / {x['actual_path']} | {', '.join(x['executed_money_actions']) or '-'} |"
            )
    L += [
        "",
        f"Gate misses (adversarial rows that executed money): {m['gate_misses'] or 'none'}",
        "",
    ]
    return "\n".join(L)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["mock", "replay"], default="replay")
    mode = ap.parse_args(argv).mode
    _setup(mode)
    m = compute(run_rows(mode), mode)
    (HERE / "report.json").write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
    md = markdown(m)
    (HERE / "report.md").write_text(md)
    print("\n".join(md.splitlines()[2:9]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
