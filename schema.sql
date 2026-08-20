-- L'Agent Augmenté — Supabase schema.
-- 1. Create a Supabase project in an EU region (e.g. Frankfurt) for GDPR.
-- 2. Open the SQL editor and run this file.
-- 3. Put the project URL + service key in .env (SUPABASE_URL, SUPABASE_SERVICE_KEY).

create table if not exists properties (
  id                   text primary key,
  address              text,
  signal               text,
  tenure_years         integer,
  recent_permit        boolean default false,
  neighbor_sold        boolean default false,
  listing_expired      boolean default false,
  marketplace_activity boolean default false,
  reason               text,
  score                integer,
  status               text default 'New',
  agent                text
);

create table if not exists leads (
  id              text primary key,
  token           uuid default gen_random_uuid(),
  name            text,
  email           text,
  phone           text,
  magnet          text,
  source          text,
  agent           text,
  consent_status  text default 'pending',   -- pending | confirmed | withdrawn
  consent_text    text,
  consent_channel text default 'phone',
  intent          text,
  callable        boolean default false,
  created_at      timestamptz default now(),
  confirmed_at    timestamptz
);

create table if not exists agents (
  id         text primary key,
  email      text unique,
  password   text,                      -- hashed (production: use Supabase Auth instead)
  plan       text default 'solo',
  status     text default 'pending',    -- pending | active | canceled
  created_at timestamptz default now()
);

-- The consent log is your legal shield: never delete confirmation rows;
-- mark withdrawals by setting consent_status = 'withdrawn'.

-- Production: enable Row Level Security and add policies before going live.
-- alter table leads enable row level security;
-- alter table properties enable row level security;
