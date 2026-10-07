# Tests (optional, developer-only)

Not part of the website build and not needed to deploy. They run the real migration files on a real PostgreSQL
(PGlite), drive the real Review & Adjust page in a simulated browser (jsdom), and never contact any backoffice.

    npm install --no-save typescript tsx @electric-sql/pglite jsdom
    npx tsx --test tests/connector-framework.test.ts   # sync runner, idempotency, retries, secrets, manual-upload protection
    npx tsx --test tests/migration-paths.test.ts       # v11 repairs every earlier v9/v10 combination (15 paths)
    npx tsx --test tests/globalbet-tree.test.ts        # Globalbet Financial Overview: net-of-reversal stake, tree-only pay, per-week precedence
    npx tsx --test tests/review-overrides.test.ts      # per-week bonus/palliative/gift corrections in the engine + migration 12
    npx tsx --test tests/review-edits.test.ts          # what the edit form saves, removes or refuses
    npx tsx --test tests/sheet-check.test.ts           # sheet vs dashboard comparison: every state and rule, and migration 13
    npx tsx --test tests/review-page.test.tsx          # the pages: open editor, zero pay, reason required, save, undo, review, sheet comparison

All data in these tests is synthetic. `tests/fixtures/historical-migrations/` holds every earlier version of
schema_v9 and schema_v10 that was ever issued, so any of them can be re-tested.
