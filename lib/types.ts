export type Thread = {
  id: string;
  channel: "email" | "voice";
  counterparty: string | null;
  subject: string | null;
  status: string;
  minutes_wasted: number;
  message_count: number;
  started_at: string;
  last_at: string;
};

export type Message = {
  id: string;
  thread_id: string;
  direction: "inbound" | "outbound";
  body: string;
  injection_flag: boolean;
  created_at: string;
};

export type Ioc = {
  id: string;
  thread_id: string;
  type: "wallet" | "bank" | "url" | "phone" | "email" | "other";
  value: string;
  confidence: number;
  severity: "low" | "medium" | "high" | "critical";
  evidence_snippet: string | null;
  created_at: string;
};
