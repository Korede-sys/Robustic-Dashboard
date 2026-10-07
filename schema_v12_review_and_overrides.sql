-- ============================================================================
-- AccessBet BDO Report — migration 12: Review & Adjust
-- Run in Supabase SQL Editor. Needs only the base schema and migration 2
-- (profiles and get_my_role()); independent of migrations 7-11. Safe to re-run.
--
-- Two small tables:
--
-- row_overrides  -- a person correcting ONE agent's Bonus, Palliative or Gift for
--   ONE uploaded week. (Commission corrections already have manual_adjustments;
--   this is its counterpart for the three supplemental payments, which had no way
--   to be edited.) The system's own calculated value is kept beside the override
--   and never overwritten, a reason is mandatory, and removing the row restores
--   the calculated figure. An override is the most specific instruction there is,
--   so it beats plan rules and the online-agent exclusion, exactly as a manual
--   commission adjustment does. 0 is a valid override ("pay nothing this week").
--
-- batch_reviews  -- "a person looked at this week's numbers and they are ready to
--   pay". A soft checkpoint between upload and export: it never blocks anything,
--   it just lets the Export screen warn about weeks nobody has reviewed.
-- ============================================================================

create table if not exists row_overrides (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  agent_username text not null,               -- lowercased by the app, like every other lookup key
  field text not null check (field in ('bonus', 'palliative', 'gift')),
  original_value numeric,                     -- what the system calculated when the override was made (audit trail)
  override_value numeric not null check (override_value >= 0),
  reason text not null check (length(btrim(reason)) > 0),
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);
create index if not exists row_overrides_batch_idx on row_overrides(batch_id);
-- One override per agent, field and week: re-saving updates it instead of stacking a second one.
create unique index if not exists row_overrides_unique on row_overrides(batch_id, agent_username, field);

create table if not exists batch_reviews (
  batch_id uuid primary key references batches(id) on delete cascade,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz default now(),
  note text
);

alter table row_overrides enable row level security;
alter table batch_reviews enable row level security;

-- Anyone who can see reports can see what was corrected and which weeks were reviewed.
drop policy if exists "view overrides" on row_overrides;
create policy "view overrides" on row_overrides for select
  using (get_my_role() in ('admin', 'finance', 'manager', 'viewer'));
drop policy if exists "view reviews" on batch_reviews;
create policy "view reviews" on batch_reviews for select
  using (get_my_role() in ('admin', 'finance', 'manager', 'viewer'));

-- Only admin/finance -- the people responsible for what is paid -- can change either.
drop policy if exists "admin/finance write overrides" on row_overrides;
create policy "admin/finance write overrides" on row_overrides for all
  using (get_my_role() in ('admin', 'finance')) with check (get_my_role() in ('admin', 'finance'));
drop policy if exists "admin/finance write reviews" on batch_reviews;
create policy "admin/finance write reviews" on batch_reviews for all
  using (get_my_role() in ('admin', 'finance')) with check (get_my_role() in ('admin', 'finance'));

-- ============================================================================
-- To undo: drop table if exists batch_reviews; drop table if exists row_overrides;
-- ============================================================================
