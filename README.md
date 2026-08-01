# Honeypot — autonomous scam-baiting threat-intel agent

An autonomous agent that engages phishing scammers over **email and voice**, wastes their
time with a believable persona, and **extracts structured threat intelligence** (crypto
wallets, mule bank accounts, phishing URLs, phone numbers) into a live monitoring dashboard —
then auto-drafts takedown reports. Time-wasting is the collection method; the IOC feed is the product.

Track: **Incident Response** (phishing investigations). Theme: AI-native cybersecurity.

## Working
- **Two channels, one brain.** Email (Gmail API poll → agent reply) and voice (Vapi call →
  transcript) both feed one shared pipeline: extract IOCs → store → live dashboard.
- **Autonomous persona agent** ("Margaret", Claude Sonnet 5) sustains multi-turn scam-bait
  conversations and steers scammers into revealing payment details.
- **IOC extractor** (schema-forced `generateObject`) pulls wallets/banks/URLs/phones/emails
  with severity + evidence snippet, deduped per thread.
- **Prompt-injection defence.** Inbound scammer text is wrapped as untrusted data; injection
  attempts are flagged (`INJECTION BLOCKED`) and the agent stays in character.
- **Live dashboard.** Realtime (Supabase) thread list, conversation view, IOC cards, and
  counters: scammer minutes wasted, IOCs harvested, high/critical, active threads.
- **Responsible-AI guardrails.** Never sends money/PII; takedown reports are **drafts pending
  human approval**; engages inbound only. IOC feed exports as CSV.
- `/api/simulate` drives the whole flow end-to-end with no live scammer — the stage demo path.

## Gaps / next
- Gmail uses 60s cron polling, not Pub/Sub push (add `users.watch()` for lower latency).
- Voice persona runs inside Vapi's live LLM; IOCs extracted at end-of-call, not mid-call.
- Takedown reports are drafted, not filed (deliberate human-in-loop; wire real abuse-desk APIs next).
- Dashboard is public-read for the demo; lock RLS down before real data.

## Tech stack
Next.js 16 (App Router) · Vercel (functions + cron) · Supabase (Postgres + Realtime + RLS) ·
Vercel AI Gateway → Claude Sonnet 5 · AI SDK v7 (`generateText` / `generateObject`) ·
Gmail API (`googleapis`) · Vapi (voice) · Tailwind v4.

## Setup
1. `cp .env.example .env.local` and fill in keys (see `.env.example`).
2. Supabase: run `supabase/schema.sql` in the SQL editor.
3. Gmail: enable Gmail API, create OAuth web client, get a refresh token (scope
   `https://mail.google.com/`) via the OAuth Playground.
4. Vapi: create an assistant, paste the persona from `lib/persona.ts` (`PERSONA_SYSTEM`) as its
   system prompt, attach a phone number, set Server URL → `https://<deploy>/api/voice/webhook`
   and the secret → `VAPI_WEBHOOK_SECRET`.
5. `npm run dev`, open the dashboard, then run `./scripts/seed.sh` (or deploy: `vercel`).

## Demo (3 min)
Run `./scripts/seed.sh http://localhost:3000` — it fires three scam messages (including one
prompt-injection attempt) at `/api/simulate`. Watch the dashboard: threads appear, the agent
replies, IOC cards pop, the injection message shows `INJECTION BLOCKED`, counters tick. Then
play the recorded voice-call clip, and hit **Draft takedown report**.
