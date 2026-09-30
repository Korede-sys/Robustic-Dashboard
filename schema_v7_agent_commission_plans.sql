-- ============================================================================
-- Robustic — migration 7: per-agent commission plans (Globalbet)
-- Run in Supabase SQL Editor. Requires migration 2 (schema_v2_rules_and_activity.sql)
-- already run (uses the same get_my_role() helper and profiles table).
--
-- Confirmed business rule: Globalbet agents are on one of two commission
-- plans. "Up to 10%" is the default -- every new account starts here
-- automatically, gets the tiered/selections-based commission, and is
-- eligible for weekly Bonus/Palliative/Gift. "40% on profit" is a manual
-- override for specific agents (typically high-volume/VIP), and those
-- agents get NO Bonus/Palliative/Gift at all -- confirmed against real data,
-- zero exceptions found.
--
-- Only OVERRIDES are stored here -- an agent with no row in this table is on
-- the default "up_to_10" plan. This matches the stated rule exactly ("any
-- new account automatically will be on up to 10%, unless we manually put it
-- on 40%") without needing to seed hundreds of rows for the default case.
--
-- What this table does: gates Bonus/Palliative/Gift eligibility (zero for
-- everyone on "40% on profit") AND, as of the commission-engine update that
-- shipped alongside this table's use, actively determines weekly commission
-- for these agents too -- confirmed against 29/29 real agents, exact match:
-- Commission = MAX(0, 40% x Profit), replacing the sheet's own Commission
-- column (which reflects a different, lower calculation for this tier).
-- Verified including the negative-profit case (commission floors at 0, not
-- negative).
-- ============================================================================

create table agent_commission_plans (
  id uuid primary key default gen_random_uuid(),
  agent_username text not null,  -- stored lowercase; the app normalizes before every read/write
  plan text not null check (plan in ('forty_percent_profit')),
  note text,
  set_by uuid references profiles(id),
  set_at timestamptz default now()
);
-- One active plan override per agent -- setting it again updates the
-- existing row (upsert) rather than stacking a second, ambiguous one.
create unique index agent_commission_plans_username_idx on agent_commission_plans(agent_username);

alter table agent_commission_plans enable row level security;

-- Same viewing rule as everything else reporting-related: anyone who can see
-- reports can see which agents are on which plan.
create policy "everyone with view access can view agent commission plans"
  on agent_commission_plans for select
  using (get_my_role() in ('admin', 'finance', 'manager', 'viewer'));

-- Only admin/finance can set or remove a plan override -- the same group
-- that already handles uploads, exports, and manual adjustments.
create policy "admin/finance can insert agent commission plans"
  on agent_commission_plans for insert
  with check (get_my_role() in ('admin', 'finance'));
create policy "admin/finance can update agent commission plans"
  on agent_commission_plans for update
  using (get_my_role() in ('admin', 'finance'));
create policy "admin/finance can delete agent commission plans"
  on agent_commission_plans for delete
  using (get_my_role() in ('admin', 'finance'));

-- Seed with the confirmed initial list of 40%-on-profit agents (Sep 2026).
insert into agent_commission_plans (agent_username, plan, note) values
  ('1019ak-uyo-jacob2', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0217na-akw-akwanga', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('001be-zak-wukari1', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0217by-owi-owhipa1', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0418by-obk-sandy', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('1119fc-ama-ekeson', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0119fc-ama-globatech', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0217fc-bwa-happylife', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0318fc-ama-stanthony', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0620na-akw-peter', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0217na-mas-kingsley', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0217na-mar-ruga', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0520la-ibe-femipre', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0120ni-taf-tonybet2', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0320fc-gwa-tonybet3', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0919ni-taf-tonytafa', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0820fc-ama-tonybet5', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0221fc-gwa-tonybet6', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0321fc-gwa-tonybet7', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0521ni-sul-tonybet9', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0620fc-gwa-tonybet4', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0326fc-gwa-tonybet10', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0326fc-gwa-tonybet11', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0724fc-ama-tosin1', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('0724fc-ama-josh7', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('1123fc-ama-josh2', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('1123fc-ama-josh1', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('fc-spa-23418', 'forty_percent_profit', 'Initial seed, Sep 2026'),
  ('fc-spa-23419', 'forty_percent_profit', 'Initial seed, Sep 2026')
on conflict (agent_username) do nothing;

-- ============================================================================
-- To undo just this migration:
-- drop table if exists agent_commission_plans;
-- ============================================================================
