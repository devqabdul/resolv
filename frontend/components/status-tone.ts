// (decision: UI-1) One cva map for every coloured pill: tinted fill + strong text from the
// --status-* tokens in globals.css (AA in both themes). Badge base is h-5 text-xs, so size here.
import { cva } from "class-variance-authority";

export const toneBadge = cva("h-6 rounded-full px-2.5 text-sm font-medium", {
  variants: {
    tone: {
      resolved: "bg-status-resolved/12 text-status-resolved",
      processing: "bg-status-processing/12 text-status-processing",
      awaiting: "bg-status-awaiting/12 text-status-awaiting",
      new: "bg-status-new/12 text-status-new",
      routed: "bg-status-routed/12 text-status-routed",
      incident: "bg-status-incident/12 text-status-incident",
      failed: "bg-status-failed/12 text-status-failed",
      closed: "bg-status-closed/15 text-status-closed",
    },
  },
  defaultVariants: { tone: "new" },
});

export type Tone = "resolved" | "processing" | "awaiting" | "new" | "routed" | "incident" | "failed" | "closed";

export const STATUS_TONE: Record<string, Tone> = {
  NEW: "new",
  PROCESSING: "processing",
  RESOLVED: "resolved",
  AWAITING_APPROVAL: "awaiting",
  ROUTED: "routed",
  ESCALATED: "routed",
  INCIDENT_LINKED: "incident",
  CLOSED: "closed",
  FAILED: "failed",
};

export const GATE_TONE: Record<string, Tone> = {
  AUTO_EXECUTE: "resolved",
  NEEDS_APPROVAL: "awaiting",
  BLOCKED: "failed",
  HUMAN_ONLY: "new",
};

export const PRIORITY_TONE: Record<string, Tone> = { P1: "failed", P2: "awaiting", P3: "new" };
