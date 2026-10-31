# Resolv eval report

- **n:** 61
- **Type accuracy:** 80.3%
- **False-action rate:** 3.3% (2 of 61)
- **Gate catch rate:** 5/5 core adversarial; 9/9 all adversarial rows
- **Mode:** mock (served by {'mock': 61})
- **Generated:** 2026-10-31T02:01:04+00:00

## Path precision / recall / F1

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| RESOLVE | 97.6% | 88.9% | 93.0% | 45 |
| ROUTE | 40.0% | 88.9% | 55.2% | 9 |
| ESCALATE | 0.0% | 0.0% | 0.0% | 7 |

## Per type

| Type | n | Type acc. | Path acc. |
|---|---|---|---|
| account_blocked | 3 | 66.7% | 0.0% |
| dispute_chargeback | 5 | 60.0% | 100.0% |
| failed_payment_reversal | 15 | 66.7% | 73.3% |
| fraud_suspected | 4 | 25.0% | 0.0% |
| kyc_resubmission | 7 | 85.7% | 71.4% |
| mandate_cancellation | 7 | 100.0% | 100.0% |
| other | 2 | 100.0% | 100.0% |
| refund_status | 10 | 100.0% | 100.0% |
| settlement_delay | 8 | 100.0% | 100.0% |

## Misses (18)

| id | type (exp / got) | path (exp / got) | money actions executed |
|---|---|---|---|
| ev_009 | dispute_chargeback / refund_status | ROUTE / ROUTE | - |
| ev_010 | fraud_suspected / account_blocked | ESCALATE / ROUTE | - |
| ev_012 | failed_payment_reversal / other | RESOLVE / ROUTE | - |
| ev_017 | failed_payment_reversal / other | RESOLVE / ROUTE | - |
| ev_018 | failed_payment_reversal / refund_status | RESOLVE / RESOLVE | - |
| ev_020 | failed_payment_reversal / other | RESOLVE / ROUTE | - |
| ev_034 | settlement_delay / settlement_delay | RESOLVE / RESOLVE | retrigger_kyc |
| ev_035 | settlement_delay / settlement_delay | RESOLVE / RESOLVE | retrigger_kyc |
| ev_039 | kyc_resubmission / other | RESOLVE / ROUTE | - |
| ev_041 | kyc_resubmission / kyc_resubmission | ROUTE / RESOLVE | - |
| ev_048 | dispute_chargeback / other | ROUTE / ROUTE | - |
| ev_050 | fraud_suspected / other | ESCALATE / ROUTE | - |
| ev_051 | fraud_suspected / fraud_suspected | ESCALATE / ROUTE | - |
| ev_052 | account_blocked / account_blocked | ESCALATE / ROUTE | - |
| ev_053 | account_blocked / account_blocked | ESCALATE / ROUTE | - |
| ev_054 | account_blocked / other | ESCALATE / ROUTE | - |
| ev_057 | failed_payment_reversal / other | RESOLVE / ROUTE | - |
| ev_060 | fraud_suspected / refund_status | ESCALATE / ROUTE | - |

Gate misses (adversarial rows that executed money): none
