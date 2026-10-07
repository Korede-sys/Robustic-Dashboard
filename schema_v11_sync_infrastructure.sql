-- ============================================================================
-- AccessBet BDO Report — migration 11: server-side sync infrastructure
-- Run in Supabase SQL Editor AFTER migrations 9 and 10. Safe to re-run.
--
-- ADDITIVE. Adds: a flag separating live-connector sync runs from manual CSV
-- uploads; record-level provenance on line items; and ONE function,
-- sync_apply_batch, through which the Edge Function writes synced data.
--
-- sync_apply_batch guarantees:
--   * ATOMIC   - the whole batch is applied or none of it (one transaction).
--   * IDEMPOTENT - syncing the same data twice changes nothing: rows are matched
--     on (agent, source block) inside one batch per (source, type, period), so
--     there are no duplicates; the result reports inserted / updated /
--     unchanged / removed.
--   * SAFE FOR MANUAL DATA - it never touches a batch it did not create. If a
--     CSV/manual upload (or any other batch) for the same source and type
--     overlaps the period, the sync SKIPS that period and reports it, rather
--     than double-count or overwrite work that may include manual enrichment.
--   * SERVICE-ONLY - executable by the service role (the Edge Function) only;
--     no browser session can call it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Preconditions, and repair of whichever earlier v9 was run.
--
-- Several versions of schema_v9 were issued as the source model was settled
-- (they registered different sources and filed uploads differently). This step
-- brings any of them to the current model: Globalbet and Elbet are the original
-- sources, Walify is a reporting layer that originates nothing, Xpool is its own
-- backoffice, and 'other' holds anything unassigned. Safe to re-run: on a
-- database that is already current it changes nothing.
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.data_sources') is null or to_regclass('public.sync_runs') is null then
    raise exception 'Run schema_v9_data_sources.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'line_items' and column_name = 'source_agent_username') then
    raise exception 'Run the LATEST schema_v10_xpool.sql first (it is safe to run again), then run this file.';
  end if;
end $$;

-- The five current sources (descriptive fields refreshed; `enabled` is left as set).
insert into data_sources (id, name, integration_type, enabled, status_note, config) values
  ('globalbet', 'Globalbet', 'csv_upload', true, 'Original source for Globalbet sales; source of truth for commission and bonus. Data arrives by manual CSV upload.', '{"url": "walify.virtual-horizon.com/engine/backoffice"}'),
  ('elbet', 'Elbet', 'csv_upload', true, 'Original source for Luckyball, Luckygreek and Rocket Man. Data arrives by manual CSV upload.', '{"url": "backoffice.accessbet.elbet.com"}'),
  ('walify', 'Walify', null, true, 'Reporting layer that gets reports from Elbet and Globalbet. Not the original source of any product.', '{"url": "shop.accessbet.com"}'),
  ('xpool', 'Xpool', 'csv_upload', true, 'Own backoffice; calculates and pays commission itself. Data arrives by manual CSV upload (Agent Breakdown export).', '{"url": "xpool.accessbet.com"}'),
  ('other', 'Other / unassigned', 'csv_upload', true, 'Uploads whose backoffice is not identified yet.', '{}')
on conflict (id) do update
  set name = excluded.name, integration_type = excluded.integration_type, status_note = excluded.status_note, config = excluded.config;

-- The product column and its backfill (the very first v9 predates it; this is a
-- no-op everywhere else). Matches productOf() in the app.
alter table line_items add column if not exists product text;
create index if not exists line_items_product_idx on line_items(product);
update line_items set product = case
  when source_block like 'GB:%' then 'Globalbet Virtual'
  when source_block = 'EB:LUCKYBALL' then 'Luckyball'
  when source_block = 'EB:LUCKYGREECK' then 'Luckygreek'
  when source_block = 'EB:ROCKET_MAN' then 'Rocket Man'
  when source_block = 'EB_MB:BASE' then 'Luckyball (Monthly)'
  when left(source_block, 6) = 'SP_MB:' then 'Sports (Monthly)'
  when left(source_block, 3) = 'SP:' then 'Sports'
  when left(source_block, 3) = 'XP:' then 'Xpool'
  else 'Other'
end where product is null;

-- Uploads filed under a retired or wrong source. Only manual CSV runs ever
-- existed, so reassigning them cannot touch a live connector's history.
update batches set source_system = 'elbet' where type in ('EB', 'EB_MB') and source_system in ('walify', 'accessbet');
update batches set source_system = 'other' where source_system in ('sports', 'accessbet', 'lucky-greek', 'lucky-ball');
update sync_runs set source_id = 'elbet' where source_id = 'walify' and mode = 'manual';
update sync_runs set source_id = 'other' where source_id in ('sports', 'accessbet', 'lucky-greek', 'lucky-ball');
delete from data_sources where id in ('accessbet', 'sports', 'lucky-greek', 'lucky-ball');
-- Columns only the first v9 had (sources used to be split into systems and products).
alter table data_sources drop column if exists parent_source;
alter table data_sources drop column if exists kind;

-- Live sync runs vs manual CSV uploads. Existing rows and CSV uploads default
-- to 'csv_upload'; only the Edge Function writes 'connector'.
alter table sync_runs add column if not exists via text not null default 'csv_upload';
do $$ begin
  alter table sync_runs add constraint sync_runs_via_check check (via in ('csv_upload', 'connector'));
exception when duplicate_object then null; end $$;

-- Record-level provenance for rows created by a sync.
alter table line_items add column if not exists source_record_id text;
alter table line_items add column if not exists source_timestamp timestamptz;
alter table line_items add column if not exists synced_at timestamptz;
create index if not exists line_items_source_record_idx on line_items(source_record_id) where source_record_id is not null;

-- One live-sync batch per source, type and exact period (also closes the race
-- between two concurrent syncs).
create unique index if not exists batches_live_sync_unique
  on batches (source_system, type, period_start, period_end)
  where integration_type is not null and integration_type <> 'csv_upload';

create or replace function sync_apply_batch(
  p_source text, p_type text, p_period_start date, p_period_end date,
  p_integration text, p_items jsonb, p_run uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid; v_blocker uuid; v_blocker_integ text; v_total int;
  v_inserted int := 0; v_updated int := 0; v_unchanged int := 0; v_removed int := 0;
begin
  if p_integration is null or p_integration = 'csv_upload' then
    raise exception 'sync_apply_batch is for live connectors only';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'invalid period';
  end if;
  v_total := coalesce(jsonb_array_length(p_items), 0);

  -- Never touch a batch we did not create. Any other batch for this source and
  -- type whose period overlaps would double-count, so skip and report it. (A
  -- batch with an unconfirmed period is unbounded and therefore also blocks.)
  select id, integration_type into v_blocker, v_blocker_integ from batches
   where source_system = p_source and type = p_type
     and daterange(period_start, period_end, '[]') && daterange(p_period_start, p_period_end, '[]')
     and not (integration_type is not distinct from p_integration
              and period_start is not distinct from p_period_start
              and period_end is not distinct from p_period_end)
   limit 1;
  if found then
    return jsonb_build_object(
      'status', case when coalesce(v_blocker_integ, 'csv_upload') = 'csv_upload' then 'skipped_manual_exists' else 'skipped_overlap' end,
      'batch_id', v_blocker, 'items', v_total, 'inserted', 0, 'updated', 0, 'unchanged', 0, 'removed', 0);
  end if;

  select id into v_batch from batches
   where source_system = p_source and type = p_type and integration_type = p_integration
     and period_start = p_period_start and period_end = p_period_end;
  if not found then
    insert into batches (type, filename, uploaded_by, period_start, period_end, source_system, integration_type, source_record_id, synced_at)
    values (p_type, p_source || ' sync ' || p_period_start || ' to ' || p_period_end, null, p_period_start, p_period_end,
            p_source, p_integration, p_source || '|' || p_type || '|' || p_period_start || '|' || p_period_end, now())
    returning id into v_batch;
  else
    update batches set synced_at = now() where id = v_batch;
  end if;

  drop table if exists _incoming;
  create temp table _incoming (
    ak text primary key, k text, agent_username text not null, source_block text not null, tickets numeric, stake numeric,
    payout numeric, profit numeric, commission_amount numeric, commission_type text, balance numeric,
    is_house boolean not null, product text, parent_username text, money_win numeric, source_agent_username text,
    source_record_id text, source_timestamp timestamptz
  ) on commit drop;
  insert into _incoming
  select lower(x->>'agent_username') || '|' || (x->>'source_block'), x->>'key', x->>'agent_username', x->>'source_block', (x->>'tickets')::numeric, (x->>'stake')::numeric,
         (x->>'payout')::numeric, (x->>'profit')::numeric, (x->>'commission_amount')::numeric, x->>'commission_type',
         (x->>'balance')::numeric, coalesce((x->>'is_house')::boolean, false), x->>'product', x->>'parent_username',
         (x->>'money_win')::numeric, x->>'source_agent_username', x->>'source_record_id', (x->>'source_timestamp')::timestamptz
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x;

  select count(*) into v_unchanged from line_items li
    join _incoming i on lower(li.agent_username) || '|' || li.source_block = i.ak
   where li.batch_id = v_batch
     and li.tickets is not distinct from i.tickets and li.stake is not distinct from i.stake
     and li.payout is not distinct from i.payout and li.profit is not distinct from i.profit
     and li.commission_amount is not distinct from i.commission_amount and li.commission_type is not distinct from i.commission_type
     and li.balance is not distinct from i.balance and li.is_house is not distinct from i.is_house
     and li.product is not distinct from i.product and li.parent_username is not distinct from i.parent_username
     and li.money_win is not distinct from i.money_win and li.source_agent_username is not distinct from i.source_agent_username;

  update line_items li set
         tickets = i.tickets, stake = i.stake, payout = i.payout, profit = i.profit, commission_amount = i.commission_amount,
         commission_type = i.commission_type, balance = i.balance, is_house = i.is_house, product = i.product,
         parent_username = i.parent_username, money_win = i.money_win, source_agent_username = i.source_agent_username,
         source_record_id = i.source_record_id, source_timestamp = i.source_timestamp, synced_at = now()
    from _incoming i
   where li.batch_id = v_batch
     and lower(li.agent_username) || '|' || li.source_block = i.ak
     and not (li.tickets is not distinct from i.tickets and li.stake is not distinct from i.stake
              and li.payout is not distinct from i.payout and li.profit is not distinct from i.profit
              and li.commission_amount is not distinct from i.commission_amount and li.commission_type is not distinct from i.commission_type
              and li.balance is not distinct from i.balance and li.is_house is not distinct from i.is_house
              and li.product is not distinct from i.product and li.parent_username is not distinct from i.parent_username
              and li.money_win is not distinct from i.money_win and li.source_agent_username is not distinct from i.source_agent_username);
  get diagnostics v_updated = row_count;

  delete from line_items li where li.batch_id = v_batch and not exists (
    select 1 from _incoming i where lower(li.agent_username) || '|' || li.source_block = i.ak);
  get diagnostics v_removed = row_count;

  insert into line_items (batch_id, agent_username, source_block, tickets, stake, payout, profit, commission_amount,
                          commission_type, balance, is_house, product, parent_username, money_win, source_agent_username,
                          source_record_id, source_timestamp, synced_at)
  select v_batch, i.agent_username, i.source_block, i.tickets, i.stake, i.payout, i.profit, i.commission_amount,
         i.commission_type, i.balance, i.is_house, i.product, i.parent_username, i.money_win, i.source_agent_username,
         i.source_record_id, i.source_timestamp, now()
    from _incoming i
   where not exists (select 1 from line_items li where li.batch_id = v_batch
                       and lower(li.agent_username) || '|' || li.source_block = i.ak);
  get diagnostics v_inserted = row_count;

  return jsonb_build_object('status', 'applied', 'batch_id', v_batch, 'items', v_total,
    'inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged, 'removed', v_removed);
end $$;

-- Service role only. (Guarded so this also runs where a role is absent.)
do $$ begin
  revoke all on function sync_apply_batch(text, text, date, date, text, jsonb, uuid) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function sync_apply_batch(text, text, date, date, text, jsonb, uuid) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function sync_apply_batch(text, text, date, date, text, jsonb, uuid) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function sync_apply_batch(text, text, date, date, text, jsonb, uuid) to service_role; end if;
end $$;

-- ============================================================================
-- To undo:
-- drop function if exists sync_apply_batch(text, text, date, date, text, jsonb, uuid);
-- drop index if exists batches_live_sync_unique; drop index if exists line_items_source_record_idx;
-- alter table line_items drop column source_record_id, drop column source_timestamp, drop column synced_at;
-- alter table sync_runs drop constraint if exists sync_runs_via_check; alter table sync_runs drop column via;
-- ============================================================================
