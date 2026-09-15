-- ============================================================================
-- Robustic — migration 2: editable commission rules + activity log
-- Run this in the Supabase SQL Editor. Safe to run on your existing project —
-- it only ADDS two new tables, it doesn't touch profiles/batches/line_items/
-- supplemental_payments/interventions or any data already in them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Commission rules: the flat-rate formulas used as a cross-check against the
-- sheet's own commission column (source is still always what gets paid —
-- these rules only drive the "does this match?" flag on the Formulas/Rules
-- screen). Editable by admins without touching code.
-- ---------------------------------------------------------------------------
create table commission_rules (
  id uuid primary key default gen_random_uuid(),
  source_block text not null unique,   -- e.g. 'SP:35PCT', matches sourceBlock in the parsing engine
  label text not null,                  -- human-readable name shown in the UI
  basis text not null check (basis in ('stake', 'profit')),
  rate numeric not null check (rate >= 0 and rate <= 1),
  confidence text not null default 'confirmed',
  active boolean not null default true, -- inactive rules are ignored, kept for history instead of deleted
  updated_by uuid references profiles(id),
  updated_at timestamptz default now()
);

-- Seed with the two rules already confirmed against real data.
insert into commission_rules (source_block, label, basis, rate, confidence) values
  ('SP:35PCT', 'Sports — 35% tier', 'profit', 0.35, 'confirmed'),
  ('SP:POOL', 'Sports — POOL tier', 'profit', 0.15, 'tentative (only 3 samples)');

alter table commission_rules enable row level security;
create policy "authenticated can view commission rules"
  on commission_rules for select using (auth.role() = 'authenticated');
create policy "admin can insert commission rules"
  on commission_rules for insert with check (get_my_role() = 'admin');
create policy "admin can update commission rules"
  on commission_rules for update using (get_my_role() = 'admin');
create policy "admin can delete commission rules"
  on commission_rules for delete using (get_my_role() = 'admin');

-- ---------------------------------------------------------------------------
-- Activity log: who did what. Every row is written by the app itself at the
-- moment an action happens (upload, delete, role change, follow-up action).
-- Anyone signed in can read it (it's meant to be visible, that's the point of
-- an audit trail); only the person performing an action can write their own
-- entry, so no one can log an action as someone else.
-- ---------------------------------------------------------------------------
create table activity_log (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id),
  action text not null,   -- 'upload' | 'delete_upload' | 'role_change' | 'log_followup' | 'resolve_followup' | 'delete_followup' | 'update_rule'
  details text,           -- short human-readable summary
  created_at timestamptz default now()
);
create index activity_log_created_idx on activity_log(created_at desc);

alter table activity_log enable row level security;
create policy "authenticated can view activity log"
  on activity_log for select using (auth.role() = 'authenticated');
create policy "users can log their own actions"
  on activity_log for insert with check (actor_id = auth.uid());

-- ============================================================================
-- To undo this migration only (leaves everything else untouched):
--
-- drop table if exists activity_log cascade;
-- drop table if exists commission_rules cascade;
-- ============================================================================
