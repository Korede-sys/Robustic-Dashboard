-- ============================================================================
-- Robustic — migration 6: manual line-level adjustments
-- Run in Supabase SQL Editor. Requires migration 2 (schema_v2_rules_and_activity.sql)
-- already run (uses the same get_my_role() helper and profiles table).
--
-- For the rare case a single agent/period line is wrong in a way that isn't a
-- whole-rate problem (a commission_rules fix would be the wrong tool -- that
-- changes every agent on that product/type, not just one). This table lets an
-- admin or finance user correct exactly one line, with a reason kept for
-- audit, without touching anyone else's numbers and without a code change.
--
-- An adjustment is the highest-priority source for what gets paid -- above
-- even a commission_rules override -- because it's the most specific and the
-- most deliberate: someone looked at this exact line and decided it's wrong.
-- The original sheet value is kept alongside it, never overwritten, so the
-- adjustment is always visible as a correction, not silently indistinguishable
-- from the source data.
-- ============================================================================

create table manual_adjustments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references batches(id) on delete cascade not null,
  agent_username text not null,
  source_block text not null,           -- e.g. 'EB:LUCKYGREECK' -- targets exactly one line, not a whole product/type
  original_commission numeric,          -- snapshot of the sheet's value at the time of the adjustment, for the audit trail
  adjusted_commission numeric not null, -- the corrected payable amount
  reason text not null,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);
create index manual_adjustments_batch_idx on manual_adjustments(batch_id);
-- One adjustment per agent/block within a batch -- re-saving updates it rather
-- than stacking a second, ambiguous correction on the same line. Plain
-- (non-functional) unique constraint so Supabase's upsert ON CONFLICT can
-- target it directly; the app lowercases agent_username before writing, the
-- same way it's already used as a lookup key everywhere else in the engine.
create unique index manual_adjustments_unique_line
  on manual_adjustments(batch_id, agent_username, source_block);

alter table manual_adjustments enable row level security;

-- Same viewing rule as everything else reporting-related: anyone who can see
-- reports can see why a number was corrected, not just admins/finance.
create policy "everyone with view access can view adjustments"
  on manual_adjustments for select
  using (get_my_role() in ('admin', 'finance', 'manager', 'viewer'));

-- Only admin/finance can create or remove one -- the same group that already
-- handles uploads and exports, i.e. the people responsible for what actually
-- gets paid.
create policy "admin/finance can insert adjustments"
  on manual_adjustments for insert
  with check (get_my_role() in ('admin', 'finance'));
create policy "admin/finance can update adjustments"
  on manual_adjustments for update
  using (get_my_role() in ('admin', 'finance'));
create policy "admin/finance can delete adjustments"
  on manual_adjustments for delete
  using (get_my_role() in ('admin', 'finance'));

-- ============================================================================
-- To undo just this migration:
-- drop table if exists manual_adjustments;
-- ============================================================================
