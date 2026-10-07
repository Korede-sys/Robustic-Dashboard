-- ============================================================================
-- AccessBet BDO Report — migration 13: the sheet's printed figures
-- Run in Supabase SQL Editor. Needs only the base schema and migration 2
-- (get_my_role()); independent of migrations 7-12. Safe to re-run.
--
-- When a weekly sheet is uploaded, the dashboard calculates each agent's pay itself
-- from the sheet's inputs. This table also keeps what the SHEET PRINTED for that pay
-- (uplifted commission, bonus, palliative, gift, total earnings), so the two can be
-- compared every week: a difference is either a sheet error or a rule the dashboard
-- does not know about. It is read-only reference data: nothing here changes what the
-- dashboard calculates, and it is deleted with its week.
-- ============================================================================

create table if not exists sheet_figures (
  batch_id uuid not null references batches(id) on delete cascade,
  agent_username text not null,               -- lowercased by the app
  commission numeric,
  bonus numeric,
  palliative numeric,
  gift numeric,
  total_earnings numeric,
  primary key (batch_id, agent_username)
);

alter table sheet_figures enable row level security;

drop policy if exists "view sheet figures" on sheet_figures;
create policy "view sheet figures" on sheet_figures for select
  using (get_my_role() in ('admin', 'finance', 'manager', 'viewer'));
-- Written by whoever can upload a week.
drop policy if exists "uploaders write sheet figures" on sheet_figures;
create policy "uploaders write sheet figures" on sheet_figures for all
  using (get_my_role() in ('admin', 'finance')) with check (get_my_role() in ('admin', 'finance'));

-- ============================================================================
-- To undo: drop table if exists sheet_figures;
-- ============================================================================
