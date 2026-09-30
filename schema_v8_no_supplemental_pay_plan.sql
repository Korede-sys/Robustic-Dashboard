-- ============================================================================
-- Robustic — migration 8: extend agent_commission_plans with a second plan type
-- Run in Supabase SQL Editor. Requires migration 7 (schema_v7) already run.
--
-- Confirmed: 001fc-gwa-spareshop's unusual numbers (uplifted commission
-- lower than base commission) are an intentional negotiated arrangement,
-- not a data error as this table's earlier comments assumed. They should
-- be excluded from Bonus/Palliative/Gift entirely -- same effective
-- treatment as a "40% on profit" agent for supplemental pay -- but their
-- weekly commission stays completely normal (still the sheet's own value
-- or the default tiered calculation, NOT overridden to 40% of profit).
--
-- This is a genuinely different plan type, so the table needed a second
-- allowed value rather than reusing "forty_percent_profit" for something
-- it doesn't actually mean.
-- ============================================================================

alter table agent_commission_plans drop constraint agent_commission_plans_plan_check;
alter table agent_commission_plans add constraint agent_commission_plans_plan_check
  check (plan in ('forty_percent_profit', 'no_supplemental_pay'));

insert into agent_commission_plans (agent_username, plan, note) values
  ('001fc-gwa-spareshop', 'no_supplemental_pay', 'Negotiated arrangement, confirmed Sep 2026 -- commission stays normal, no Bonus/Palliative/Gift')
on conflict (agent_username) do update set plan = excluded.plan, note = excluded.note;

-- ============================================================================
-- To undo just this migration (only safe if no "no_supplemental_pay" rows
-- other than the seed above exist yet):
-- delete from agent_commission_plans where plan = 'no_supplemental_pay';
-- alter table agent_commission_plans drop constraint agent_commission_plans_plan_check;
-- alter table agent_commission_plans add constraint agent_commission_plans_plan_check
--   check (plan in ('forty_percent_profit'));
-- ============================================================================
