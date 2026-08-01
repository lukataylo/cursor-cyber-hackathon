import { generateText, generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { PERSONA_SYSTEM, wrapUntrusted } from "./persona";

const MODEL = anthropic("claude-sonnet-5"); // direct Anthropic API (ANTHROPIC_API_KEY)

const IocSchema = z.object({
  iocs: z.array(
    z.object({
      type: z.enum(["wallet", "bank", "url", "phone", "email", "other"]),
      value: z.string().describe("the exact indicator, verbatim"),
      confidence: z.number().min(0).max(1),
      severity: z.enum(["low", "medium", "high", "critical"]),
      evidence_snippet: z.string().describe("short quote from the text where it appeared"),
    })
  ),
});

export type Ioc = z.infer<typeof IocSchema>["iocs"][number];

// Pull threat-intel indicators from a scammer message. Runs on every inbound message.
export async function extractIOCs(text: string): Promise<Ioc[]> {
  const { object } = await generateObject({
    model: MODEL,
    schema: IocSchema,
    system:
      "You are a threat-intel extractor. From the message, extract only concrete indicators " +
      "of compromise a scammer revealed: crypto wallets, bank/account/IBAN/sort codes, URLs, " +
      "phone numbers, emails. Do not invent any. If none, return an empty array. Severity: " +
      "payment destinations (wallet/bank) are high/critical; contact handles are low/medium.",
    prompt: text,
  });
  return object.iocs;
}

type Turn = { direction: "inbound" | "outbound"; body: string };

// Generate Margaret's next reply given the thread history.
export async function personaReply(subject: string, history: Turn[]): Promise<string> {
  const messages = history.map((t) => ({
    role: (t.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
    content: t.direction === "inbound" ? wrapUntrusted(t.body) : t.body,
  }));
  const { text } = await generateText({
    model: MODEL,
    system: PERSONA_SYSTEM + `\n\nEmail subject: ${subject || "(none)"}`,
    messages,
  });
  return text.trim();
}
