-- Honeypot schema. Run in Supabase SQL editor.
-- ponytail: public read for the demo dashboard; service role does all writes.

create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('email','voice')),
  counterparty text,
  subject text,
  status text not null default 'active',
  minutes_wasted numeric not null default 0,
  message_count int not null default 0,
  started_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  body text not null,
  injection_flag boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists iocs (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  type text not null check (type in ('wallet','bank','url','phone','email','other')),
  value text not null,
  confidence numeric not null default 0.5,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  evidence_snippet text,
  created_at timestamptz not null default now(),
  unique (thread_id, type, value)
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  target text,
  draft_body text not null,
  status text not null default 'draft' check (status in ('draft','approved')),
  created_at timestamptz not null default now()
);

-- RLS: anon can read (dashboard); writes go through service role which bypasses RLS.
alter table threads enable row level security;
alter table messages enable row level security;
alter table iocs enable row level security;
alter table reports enable row level security;

create policy "read threads" on threads for select using (true);
create policy "read messages" on messages for select using (true);
create policy "read iocs" on iocs for select using (true);
create policy "read reports" on reports for select using (true);

-- Realtime for the live dashboard
alter publication supabase_realtime add table threads;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table iocs;
