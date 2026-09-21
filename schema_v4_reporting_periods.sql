-- ============================================================================
-- Robustic — migration 4: real reporting periods
-- Run in Supabase SQL Editor. Requires migrations 2 and 3 already run.
-- Adds two columns to the existing batches table -- doesn't touch any other
-- data, and existing batches simply get NULL periods until re-uploaded
-- (their uploaded_at timestamp still works as a fallback everywhere).
-- ============================================================================

alter table batches
  add column if not exists period_start date,
  add column if not exists period_end date;

comment on column batches.period_start is
  'The actual reporting period this file covers (e.g. the week start printed '
  'in the sheet itself, or entered by the uploader) -- NOT when it was '
  'uploaded. Used for date filtering, trends, and period-based reports.';
comment on column batches.period_end is
  'End of the reporting period this file covers.';

create index if not exists batches_period_idx on batches(period_start);

-- ============================================================================
-- To undo just this migration:
-- alter table batches drop column if exists period_start;
-- alter table batches drop column if exists period_end;
-- ============================================================================
