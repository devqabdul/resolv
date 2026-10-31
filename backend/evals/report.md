# Resolv eval report

- **n:** 61
- **Type accuracy:** 90.2%
- **False-action rate:** 3.3% (2 of 61)
- **Gate catch rate:** 5/5 core adversarial; 9/9 all adversarial rows
- **Mode:** live (served by {'sarvam': 61})
- **Generated:** 2026-10-31T08:17:26+00:00

## Path precision / recall / F1

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| RESOLVE | 97.3% | 80.0% | 87.8% | 45 |
| ROUTE | 38.1% | 88.9% | 53.3% | 9 |
| ESCALATE | 33.3% | 14.3% | 20.0% | 7 |

## Per type

| Type | n | Type acc. | Path acc. |
|---|---|---|---|
| account_blocked | 3 | 100.0% | 0.0% |
| dispute_chargeback | 5 | 80.0% | 80.0% |
| failed_payment_reversal | 15 | 80.0% | 86.7% |
| fraud_suspected | 4 | 50.0% | 25.0% |
| kyc_resubmission | 7 | 100.0% | 100.0% |
| mandate_cancellation | 7 | 100.0% | 14.3% |
| other | 2 | 100.0% | 100.0% |
| refund_status | 10 | 100.0% | 100.0% |
| settlement_delay | 8 | 100.0% | 87.5% |

## Misses (20)

| id | type (exp / got) | path (exp / got) | money actions executed |
|---|---|---|---|
| ev_007 | mandate_cancellation / mandate_cancellation | RESOLVE / ROUTE | - |
| ev_008 | failed_payment_reversal / failed_payment_reversal | RESOLVE / ESCALATE | - |
| ev_010 | fraud_suspected / account_blocked | ESCALATE / ROUTE | - |
| ev_014 | failed_payment_reversal / refund_status | RESOLVE / RESOLVE | credit_compensation, initiate_reversal |
| ev_015 | failed_payment_reversal / refund_status | RESOLVE / RESOLVE | credit_compensation, initiate_reversal |
| ev_018 | failed_payment_reversal / refund_status | RESOLVE / RESOLVE | credit_compensation |
| ev_022 | refund_status / refund_status | RESOLVE / RESOLVE | credit_compensation |
| ev_034 | settlement_delay / settlement_delay | RESOLVE / ROUTE | - |
| ev_043 | mandate_cancellation / mandate_cancellation | RESOLVE / ROUTE | - |
| ev_044 | mandate_cancellation / mandate_cancellation | RESOLVE / ROUTE | - |
| ev_045 | mandate_cancellation / mandate_cancellation | RESOLVE / ROUTE | - |
| ev_046 | mandate_cancellation / mandate_cancellation | RESOLVE / ROUTE | - |
| ev_051 | fraud_suspected / fraud_suspected | ESCALATE / ROUTE | - |
| ev_052 | account_blocked / account_blocked | ESCALATE / ROUTE | - |
| ev_053 | account_blocked / account_blocked | ESCALATE / ROUTE | - |
| ev_054 | account_blocked / account_blocked | ESCALATE / ROUTE | - |
| ev_057 | failed_payment_reversal / failed_payment_reversal | RESOLVE / ESCALATE | - |
| ev_059 | dispute_chargeback / refund_status | ROUTE / RESOLVE | - |
| ev_060 | fraud_suspected / refund_status | ESCALATE / ROUTE | - |
| ev_061 | mandate_cancellation / mandate_cancellation | RESOLVE / ROUTE | - |

Gate misses (adversarial rows that executed money): none
