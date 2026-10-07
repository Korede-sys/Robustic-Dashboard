-- ============================================================================
-- AccessBet BDO Report — migration 9: data source registry + sync history
-- Run in Supabase SQL Editor AFTER migrations 1-8. Safe to run once.
--
-- ADDITIVE ONLY: two new tables, five new NULLABLE columns on batches, and a
-- backfill of those columns. Nothing existing is dropped, renamed, or
-- re-constrained. The app also works if this has NOT been run yet (it falls
-- back to deriving the source from the batch type) -- running it just makes
-- provenance permanent and enables sync history.
--
-- Design notes (see docs/ARCHITECTURE_multi_backoffice.md):
--  * A "source" is a SYSTEM OF RECORD data is pulled from. LuckyGreek and
--    Luckyball are PRODUCTS inside the Elbet files, so they're registered as
--    kind='product' with a parent -- not as separate systems.
--  * No credentials or secrets are stored here, ever. `config` is for
--    non-secret settings only.
--  * Sports files have a confirmed product but an UNCONFIRMED source system;
--    they're registered as 'sports' until you tell us which backoffice
--    produces them.
-- ============================================================================

create table data_sources (
  id text primary key,
  name text not null,
  kind text not null default 'system' check (kind in ('system', 'product')),
  parent_source text references data_sources(id),
  integration_type text check (integration_type in
    ('official_api', 'authorized_internal_api', 'approved_export', 'csv_upload', 'other_approved')),
  enabled boolean not null default false,
  status_note text,
  config jsonb not null default '{}',
  created_at timestamptz default now()
);

create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_id text references data_sources(id),
  mode text not null check (mode in ('manual', 'scheduled', 'incremental', 'full')),
  status text not null check (status in ('running', 'succeeded', 'failed', 'partial')),
  started_at timestamptz default now(),
  finished_at timestamptz,
  records_seen int,
  records_inserted int,
  records_updated int,
  records_skipped int,
  watermark_before text,
  watermark_after text,
  error_summary text,        -- sanitized: never tokens, cookies, headers or credentials
  attempt int not null default 1
);
create index sync_runs_source_idx on sync_runs(source_id, started_at desc);

-- Provenance on existing batches. All nullable: nothing existing breaks.
alter table batches add column source_system text;
alter table batches add column integration_type text;
alter table batches add column source_record_id text;   -- for a file export: the filename
alter table batches add column source_timestamp timestamptz;
alter table batches add column synced_at timestamptz;
create index batches_source_idx on batches(source_system);

-- Registry seed. Only sources that actually receive data are enabled and given
-- an integration type; the rest are honestly "not connected".
insert into data_sources (id, name, kind, parent_source, integration_type, enabled, status_note) values
  ('accessbet', 'AccessBet', 'system', null, null, false, 'Access method not yet assessed.'),
  ('walify', 'Walify', 'system', null, null, false, 'No sample file or documentation received yet.'),
  ('globalbet', 'Globalbet', 'system', null, 'csv_upload', true, 'Updated by manual CSV upload.'),
  ('elbet', 'Elbet', 'system', null, 'csv_upload', true, 'Updated by manual CSV upload (Luckyball, Luckygreek, Rocket Man files).'),
  ('sports', 'Sports (source system unconfirmed)', 'system', null, 'csv_upload', true, 'Updated by manual CSV upload. Which backoffice produces these files is not confirmed.'),
  ('xpool', 'Xpool', 'system', null, null, false, 'Not a tracked source yet; no sample file.')
on conflict (id) do nothing;
insert into data_sources (id, name, kind, parent_source, integration_type, enabled, status_note) values
  ('lucky-greek', 'LuckyGreek', 'product', 'elbet', 'csv_upload', true, 'Product within the Elbet files.'),
  ('lucky-ball', 'Luckyball', 'product', 'elbet', 'csv_upload', true, 'Product within the Elbet files.')
on conflict (id) do nothing;

-- Backfill existing uploads. Mapping is by file type and can be corrected later.
update batches set
  source_system = case type
    when 'GB' then 'globalbet'
    when 'EB' then 'elbet' when 'EB_MB' then 'elbet'
    when 'SP' then 'sports' when 'SP_MB' then 'sports'
  end,
  integration_type = 'csv_upload',
  source_record_id = filename,
  synced_at = uploaded_at
where source_system is null;

-- RLS: same role model as everything else.
alter table data_sources enable row level security;
alter table sync_runs enable row level security;

create policy "view data sources" on data_sources for select
  using (get_my_role() in ('admin', 'finance', 'manager', 'viewer'));
create policy "admin manages data sources" on data_sources for all
  using (get_my_role() = 'admin') with check (get_my_role() = 'admin');

create policy "view sync runs" on sync_runs for select
  using (get_my_role() in ('admin', 'finance', 'manager', 'viewer'));
create policy "admin/finance record sync runs" on sync_runs for insert
  with check (get_my_role() in ('admin', 'finance'));

-- ============================================================================
-- To undo just this migration:
-- drop table if exists sync_runs; drop table if exists data_sources;
-- alter table batches drop column source_system, drop column integration_type,
--   drop column source_record_id, drop column source_timestamp, drop column synced_at;
-- ============================================================================
