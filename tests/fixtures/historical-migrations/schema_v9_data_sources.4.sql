-- ============================================================================
-- AccessBet BDO Report — migration 9: data sources, sync history, provenance
-- Run in Supabase SQL Editor AFTER migrations 1-8. Safe to run once.
--
-- ADDITIVE: two new tables, nullable columns on batches and line_items, and a
-- backfill. Nothing existing is dropped, renamed, or re-constrained. The app
-- also works if this has NOT been run yet (it derives source and product from
-- the file type / block name); running it makes them permanent and enables
-- sync history.
--
-- Two separate dimensions:
--   * BACKOFFICE = the system providing the data  -> batches.source_system
--   * PRODUCT    = the betting product inside it  -> line_items.product
-- No credentials or secrets are stored here, ever (`config` is non-secret).
-- ============================================================================

create table data_sources (
  id text primary key,
  name text not null,
  integration_type text check (integration_type in
    ('official_api', 'authorized_internal_api', 'approved_export', 'csv_upload', 'other_approved')),
  enabled boolean not null default true,
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

-- Provenance (backoffice) on batches. All nullable: nothing existing breaks.
alter table batches add column source_system text;
alter table batches add column integration_type text;
alter table batches add column source_record_id text;   -- for a file export: the filename
alter table batches add column source_timestamp timestamptz;
alter table batches add column synced_at timestamptz;
create index batches_source_idx on batches(source_system);

-- Product as its own dimension on line items (matches productOf() in the app).
alter table line_items add column product text;
create index line_items_product_idx on line_items(product);

insert into data_sources (id, name, integration_type, enabled, status_note, config) values
  ('globalbet', 'Globalbet', 'csv_upload', true, 'Original source for Globalbet sales; source of truth for commission and bonus. Data arrives by manual CSV upload.', '{"url": "walify.virtual-horizon.com/engine/backoffice"}'),
  ('elbet', 'Elbet', 'csv_upload', true, 'Original source for Luckyball, Luckygreek and Rocket Man. Data arrives by manual CSV upload.', '{}'),
  ('walify', 'Walify', null, true, 'Reporting layer that gets reports from Elbet and Globalbet. Not the original source of any product.', '{"url": "shop.accessbet.com"}'),
  ('xpool', 'Xpool', null, true, 'Own backoffice; calculates and pays commission itself. No sample file received yet.', '{"url": "xpool.accessbet.com"}'),
  ('other', 'Other / unassigned', 'csv_upload', true, 'Uploads whose backoffice is not identified yet.', '{}')
on conflict (id) do nothing;

-- Backfill existing uploads. Mapping is by file type and can be corrected later.
update batches set
  source_system = case type
    when 'GB' then 'globalbet'
    when 'EB' then 'elbet' when 'EB_MB' then 'elbet'
    when 'SP' then 'other' when 'SP_MB' then 'other'
  end,
  integration_type = 'csv_upload',
  source_record_id = filename,
  synced_at = uploaded_at
where source_system is null;

update line_items set product = case
  when source_block like 'GB:%' then 'Globalbet Virtual'
  when source_block = 'EB:LUCKYBALL' then 'Luckyball'
  when source_block = 'EB:LUCKYGREECK' then 'Luckygreek'
  when source_block = 'EB:ROCKET_MAN' then 'Rocket Man'
  when source_block = 'EB_MB:BASE' then 'Luckyball (Monthly)'
  when left(source_block, 6) = 'SP_MB:' then 'Sports (Monthly)'
  when left(source_block, 3) = 'SP:' then 'Sports'
  else 'Other'
end where product is null;

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
-- IF YOU ALREADY RAN AN EARLIER VERSION OF THIS FILE (any of: sources
-- 'accessbet', 'sports', 'lucky-greek', 'lucky-ball'; or Elbet files filed
-- under 'walify'), run ONLY this block instead of the whole file -- it
-- converts that to the current model:
--
--   insert into data_sources (id, name, integration_type, enabled, status_note, config) values
--     ('elbet', 'Elbet', 'csv_upload', true, 'Original source for Luckyball, Luckygreek and Rocket Man.', '{}'),
--     ('walify', 'Walify', null, true, 'Reporting layer that gets reports from Elbet and Globalbet.', '{"url": "shop.accessbet.com"}'),
--     ('other', 'Other / unassigned', 'csv_upload', true, 'Uploads whose backoffice is not identified yet.', '{}')
--     on conflict (id) do nothing;
--   update batches set source_system = 'elbet' where type in ('EB', 'EB_MB') and source_system in ('walify', 'accessbet');
--   update batches set source_system = 'other' where source_system = 'sports';
--   update sync_runs set source_id = 'elbet' where source_id in ('walify', 'accessbet') and source_id is not null
--     and exists (select 1 from data_sources where id = 'elbet');   -- manual upload runs only ever came from file uploads
--   update sync_runs set source_id = 'other' where source_id = 'sports';
--   delete from data_sources where id in ('accessbet', 'sports', 'lucky-greek', 'lucky-ball');
--   alter table line_items add column if not exists product text;
--   create index if not exists line_items_product_idx on line_items(product);
--   (then run the "update line_items set product = case ..." statement above)
--
-- To undo this migration entirely:
--   drop table if exists sync_runs; drop table if exists data_sources;
--   alter table batches drop column source_system, drop column integration_type,
--     drop column source_record_id, drop column source_timestamp, drop column synced_at;
--   alter table line_items drop column product;
-- ============================================================================
