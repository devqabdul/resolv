// Typed fetchers + SWR hooks for docs/02 §6.1. All hooks poll every 2 s (U2).
import useSWR, { type SWRConfiguration } from "swr";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export type TicketStatus =
  | "NEW" | "PROCESSING" | "RESOLVED" | "AWAITING_APPROVAL"
  | "ROUTED" | "ESCALATED" | "INCIDENT_LINKED" | "FAILED";

export interface Ticket {
  id: string;
  channel: string;
  customer_id: string | null;
  merchant_id: string | null;
  raw_text: string; // "" in list responses; UI shows masked_text (S2)
  masked_text: string;
  language: string | null;
  status: TicketStatus;
  handling_mode: string | null;
  candidate_txn_id: string | null;
  signature: string | null;
  created_at: string;
  ticket_type: string | null;
  priority: string | null;
  path: string | null;
  assigned_team: string | null;
  incident_id: string | null;
  sla_due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface AuditEvent {
  id: string;
  ticket_id: string | null;
  run_id: string | null;
  ts: string;
  actor: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface Approval {
  id: string;
  ticket_id: string;
  action_json: Record<string, unknown>;
  reasons_json: unknown;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
}

export interface TicketDetail {
  ticket: Ticket;
  run: { id: string; outcome: string | null; state: Record<string, unknown> } | null;
  timeline: AuditEvent[];
  approvals: Approval[];
  incident: Incident | null;
}

export interface Incident {
  id: string;
  title?: string;
  signature: string;
  status: string;
  ticket_count?: number;
  first_seen_at?: string;
  last_seen_at?: string;
  notice_draft?: string | null;
  [key: string]: unknown;
}

export interface IncidentDetail {
  incident: Incident;
  tickets: Ticket[];
  notifications: Notification[];
}

export interface Notification {
  id: string;
  [key: string]: unknown;
}

export interface Metrics {
  auto_resolution_rate: number;
  avg_first_response_sec: number;
  avg_resolution_sec: number;
  open: number;
  awaiting_approval: number;
  incidents_open: number;
  tat_breaches_prevented: number;
  by_type: Record<string, number>;
  window_minutes: number;
}

export interface Health { ok: boolean; llm_mode: string; db: string; mock_paytm: string }
export interface EvalsReport { generated_at: string; markdown: string; json: unknown }
export interface ProposedAction { name: string; params: Record<string, unknown> }
export interface TicketList { items: Ticket[]; total: number }

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body?: unknown) => request<T>(path, "POST", body);

// ---- plain fetchers (mutations + one-offs) ----
export const createTicket = (b: { channel: string; text: string; customer_id?: string; merchant_id?: string; metadata?: Record<string, unknown> }) => post<Ticket>("/api/tickets", b);
export const getTickets = (q: { status?: string; type?: string; incident_id?: string; limit?: number; since?: string } = {}) => get<TicketList>(`/api/tickets${qs(q)}`);
export const getTicket = (id: string) => get<TicketDetail>(`/api/tickets/${id}`);
export const rerunTicket = (id: string) => post<TicketDetail>(`/api/tickets/${id}/run`);
export const overrideTicket = (id: string, b: { path: string; note: string; decided_by: string; actions?: ProposedAction[] }) => post<Ticket>(`/api/tickets/${id}/override`, b);
export const getApprovals = (status = "PENDING") => get<Approval[]>(`/api/approvals${qs({ status })}`);
export const decideApproval = (id: string, b: { approve: boolean; note?: string; decided_by: string }) => post<{ approval: Approval; ticket: Ticket }>(`/api/approvals/${id}/decide`, b);
export const getIncidents = (status?: string) => get<Incident[]>(`/api/incidents${qs({ status })}`);
export const getIncident = (id: string) => get<IncidentDetail>(`/api/incidents/${id}`);
export const notifyIncident = (id: string) => post<Incident>(`/api/incidents/${id}/notify`);
export const getMetrics = (windowMinutes = 240) => get<Metrics>(`/api/metrics${qs({ window_minutes: windowMinutes })}`);
export const getAudit = (q: { ticket_id?: string; kind?: string; limit?: number } = {}) => get<AuditEvent[]>(`/api/audit${qs(q)}`);
export const getNotifications = (limit?: number) => get<Notification[]>(`/api/notifications${qs({ limit })}`);
export const getEvalsReport = () => get<EvalsReport>("/api/evals/report");
export const getHealth = () => get<Health>("/api/health");
export const demoReset = () => post<unknown>("/api/demo/reset");
export const demoSeed = () => post<unknown>("/api/demo/seed");
export const demoTicket = (scenario: string) => post<Ticket>(`/api/demo/ticket/${scenario}`);
export const demoSpike = (b: { issuer_bank: string; count: number; minutes: number }) => post<unknown>("/api/demo/spike", b);

// ---- SWR hooks, every one polls every 2 s ----
const usePoll = <T,>(key: string | null, fetcher: () => Promise<T>, cfg?: SWRConfiguration<T>) =>
  useSWR<T>(key, fetcher, { refreshInterval: 2000, ...cfg });

export const useTickets = (q: Parameters<typeof getTickets>[0] = {}) => usePoll(`/api/tickets${qs(q)}`, () => getTickets(q));
export const useTicket = (id: string | null) => usePoll(id ? `/api/tickets/${id}` : null, () => getTicket(id as string));
export const useApprovals = (status = "PENDING") => usePoll(`/api/approvals?${status}`, () => getApprovals(status));
export const useIncidents = (status?: string) => usePoll(`/api/incidents${qs({ status })}`, () => getIncidents(status));
export const useIncident = (id: string | null) => usePoll(id ? `/api/incidents/${id}` : null, () => getIncident(id as string));
export const useMetrics = (windowMinutes = 240) => usePoll(`/api/metrics?${windowMinutes}`, () => getMetrics(windowMinutes), { shouldRetryOnError: false });
export const useAudit = (q: Parameters<typeof getAudit>[0] = {}) => usePoll(`/api/audit${qs(q)}`, () => getAudit(q));
export const useNotifications = (limit?: number) => usePoll(`/api/notifications${qs({ limit })}`, () => getNotifications(limit));
export const useEvalsReport = () => usePoll("/api/evals/report", getEvalsReport);
export const useHealth = () => usePoll("/api/health", getHealth);
