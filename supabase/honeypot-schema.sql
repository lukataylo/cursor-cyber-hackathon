-- Dynamic honeypot generator. Run in Supabase SQL editor (after schema.sql).
-- Flow: create a decoy "site" (holding page = fake wp-login/drupal) -> attacker submits
-- credentials -> attempt logged -> escalation spins up a fake, pre-populated admin (Modal VM
-- if available, else in-app) with LLM-generated realistic fake data.

create table if not exists honeypot_sites (
  id uuid primary key default gen_random_uuid(),
  template text not null default 'wordpress' check (template in ('wordpress','drupal')),
  brand text not null default 'Acme',
  mimic_url text,
  status text not null default 'holding' check (status in ('holding','arming','active')),
  vm_url text,            -- Modal sandbox URL when spun up (else null -> in-app admin)
  created_at timestamptz not null default now()
);

create table if not exists honeypot_attempts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references honeypot_sites(id) on delete cascade,
  username text,
  password text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Pre-populated, realistic-looking fake data shown inside the decoy admin.
create table if not exists honeypot_data (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references honeypot_sites(id) on delete cascade,
  kind text not null check (kind in ('user','post','order','customer','comment','plugin')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table honeypot_sites enable row level security;
alter table honeypot_attempts enable row level security;
alter table honeypot_data enable row level security;

create policy "read sites" on honeypot_sites for select using (true);
create policy "read attempts" on honeypot_attempts for select using (true);
create policy "read hdata" on honeypot_data for select using (true);

alter publication supabase_realtime add table honeypot_sites;
alter publication supabase_realtime add table honeypot_attempts;
alter publication supabase_realtime add table honeypot_data;

-- Brand kit scraped from the target site, so the decoy mimics the real company.
alter table honeypot_sites add column if not exists logo_url text;
alter table honeypot_sites add column if not exists accent text;
