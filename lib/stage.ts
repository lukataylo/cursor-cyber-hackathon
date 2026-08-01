import type { Thread, Ioc } from "./types";

export const STAGES = ["Contact", "Engaging", "Extracting", "Escalated", "Reported"] as const;
export type Stage = (typeof STAGES)[number];

// A thread escalates the moment it reveals a payment destination (wallet or bank).
export function isPaymentIoc(i: Ioc) {
  return i.type === "wallet" || i.type === "bank";
}

// Derive the pipeline stage from what we know, no schema change needed.
export function stageOf(t: Thread, threadIocs: Ioc[], hasReport: boolean): Stage {
  if (hasReport) return "Reported";
  if (threadIocs.some(isPaymentIoc)) return "Escalated";
  if (threadIocs.length) return "Extracting";
  if (t.message_count >= 2) return "Engaging";
  return "Contact";
}

const RANK: Record<Ioc["severity"], number> = { low: 0, medium: 1, high: 2, critical: 3 };
export function topSeverity(iocs: Ioc[]): Ioc["severity"] | null {
  if (!iocs.length) return null;
  return iocs.reduce((a, b) => (RANK[b.severity] > RANK[a.severity] ? b : a)).severity;
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
