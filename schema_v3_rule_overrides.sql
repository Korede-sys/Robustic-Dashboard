-- ============================================================================
-- Robustic — migration 3: rule overrides
-- Run in Supabase SQL Editor. Only adds one column to the existing
-- commission_rules table (from migration 2) -- doesn't touch any other data.
-- Requires migration 2 (schema_v2_rules_and_activity.sql) to already be run.
-- ============================================================================

alter table commission_rules
  add column if not exists override_source boolean not null default false;

comment on column commission_rules.override_source is
  'When true, this rule''s calculated value is what gets reported/exported for '
  'this product/tier -- replacing the sheet''s own commission value. When false '
  '(default), the rule is only a cross-check that flags disagreement; the '
  'sheet''s value is still what gets paid. Off by default so nothing changes '
  'unless someone deliberately turns it on.';

-- ============================================================================
-- To undo just this migration:
-- alter table commission_rules drop column if exists override_source;
-- ============================================================================
