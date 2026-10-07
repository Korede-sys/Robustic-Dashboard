-- ============================================================================
-- AccessBet BDO Report — migration 10: Xpool imports
-- Run in Supabase SQL Editor. Run it BEFORE the first Xpool upload (the app
-- will say so if you forget). Safe to run once; independent of migration 9.
--
-- 1. Allows the new file type 'XP' (Xpool Agent Breakdown export). The existing
--    check constraint only allows the original five types, so it is replaced.
--    Every existing row and every existing type remains valid.
-- 2. Adds a nullable parent_username to line_items. Xpool lists cashier
--    accounts (e.g. "gokana-cashier1") under a parent agent; the parent is
--    kept so the cashier's state/channel can be read from it, and so an
--    optional roll-up to the parent is possible later. Nothing else uses it.
-- 3. Adds a nullable money_win to line_items. The Elbet products' "MoneyWin"
--    column (used for Total Wins / Pending Payout) was parsed but never saved,
--    so those figures vanished once an upload was saved and reloaded. New
--    uploads now keep it. Elbet files uploaded BEFORE this migration have no
--    stored value (the raw numbers aren't recoverable), so their Pending
--    Payout stays "—" until those files are deleted and uploaded again.
-- ============================================================================

-- Drop whatever check constraint currently restricts batches.type (found by
-- its content rather than its name, so this works however it was named).
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'batches'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%GB%'
  loop
    execute format('alter table batches drop constraint %I', c);
  end loop;
end $$;

alter table batches add constraint batches_type_check
  check (type in ('GB', 'EB', 'EB_MB', 'SP', 'SP_MB', 'XP'));

alter table line_items add column if not exists parent_username text;
alter table line_items add column if not exists money_win numeric;

-- Registry (only if migration 9 has been run).
do $$
begin
  update data_sources
     set integration_type = 'csv_upload',
         status_note = 'Own backoffice; calculates and pays commission itself. Data arrives by manual CSV upload (Agent Breakdown export).'
   where id = 'xpool';
exception when undefined_table then null;
end $$;

-- ============================================================================
-- To undo:
-- delete from batches where type = 'XP';   -- remove any Xpool uploads first
-- alter table batches drop constraint batches_type_check;
-- alter table batches add constraint batches_type_check check (type in ('GB','EB','EB_MB','SP','SP_MB'));
-- alter table line_items drop column parent_username;
-- alter table line_items drop column money_win;
-- ============================================================================
