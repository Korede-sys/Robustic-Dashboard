-- ============================================================================
-- Robustic — migration 5: Luckygreek "sales" reference rate
-- Run in Supabase SQL Editor. Requires migration 2 (schema_v2_rules_and_activity.sql)
-- already run, since this just adds one more row to commission_rules.
--
-- Real September data showed every Luckygreek "sales" commission consistently
-- 40% above what the sheet's own "sales (5%)" label would produce -- an exact,
-- repeated ratio (7% ÷ 5% = 1.4) across every agent, not noise. Confirmed:
-- the true rate is 7%, and the sheet's "(5%)" label text is stale.
--
-- This adds a whole-block rule for EB:LUCKYGREECK at 7%, which takes priority
-- over the per-row Type-text parsing that was reading the stale 5% label (see
-- the lookup order in computeCommission, engine-core.js). Override is OFF, by
-- design: this only corrects the audit cross-check so it stops flagging
-- correct payments as mismatches -- the sheet's own commission value is still
-- what's reported and exported, unchanged.
-- ============================================================================

insert into commission_rules (source_block, label, basis, rate, confidence)
values ('EB:LUCKYGREECK', 'Luckygreek — sales', 'stake', 0.07,
        'confirmed (corrected Sep 2026 -- sheet''s own "(5%)" label was stale, real rate is 7%)')
on conflict (source_block) do update
  set rate = excluded.rate, label = excluded.label, confidence = excluded.confidence;

-- ============================================================================
-- To undo just this migration:
-- delete from commission_rules where source_block = 'EB:LUCKYGREECK';
-- ============================================================================
