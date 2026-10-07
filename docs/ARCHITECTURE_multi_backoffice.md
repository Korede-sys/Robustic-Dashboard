# Multi-Backoffice Reporting — Architecture & AccessBet Assessment

Status: **Phase 0 (assessment). Nothing in this document is implemented, and no integration is claimed to work.**
Scope of this document: (1) what exists today and what can be extended, (2) the target architecture, (3) the AccessBet integration assessment, (4) a phased plan, (5) decisions needed.

---

## 1. Summary

- The current app is a **React/Vite single-page app on Supabase (Postgres + Auth + RLS), deployed on Vercel**. It has **no server-side code at all** — every parser and every calculation runs in the browser.
- The existing CSV parsers already behave like one kind of connector ("approved export / CSV upload"). The cleanest path is to **formalise that**, not replace it: a connector interface whose output is the same normalized shape the reporting engine already consumes.
- Every source we have actually seen delivers **pre-aggregated weekly totals per agent, per product**. There is no ticket-level, transaction-level, wallet or daily data in any file received so far. Several requested reports (transactions, tickets/bets, wallets, daily summaries) **cannot be produced from current sources** and will only become possible if a connector can reach finer-grained data. Whether AccessBet can provide that is exactly what the investigation in §5 must establish.
- The AccessBet access method is **unknown**. It has not been investigated (I have no access to that system), and I am not inferring any endpoint from a page URL.
- Introducing live connectors requires adding a **server-side runtime** (the app has none) and a **secrets store**. This is the biggest structural change and is isolated to Phase 2.

---

## 2. Current architecture inventory (inspected, not assumed)

| Layer | What exists | Extensible? |
|---|---|---|
| Frontend | `src/App.jsx` (single large component file), `LoginScreen.jsx` | Yes — Reports/Settings pages can be added; the file should be split as it grows |
| Parsing | `engine-core.js` → `PARSERS = { GB, EB, EB_MB, SP, SP_MB }`, one per file format | **Yes — these are already "CSV/export connectors"** |
| Calculation | `engine-core.js` → `aggregateBatches`, verified commission/bonus/palliative/gift formulas, plan overrides | Keep as-is. Business rules stay in the reporting layer, **not** in connectors |
| Storage | `batches` (one row per uploaded file), `line_items` (agent × source_block aggregates), `supplemental_payments`, plus rules/plans/adjustments/activity tables | Extend with provenance columns (§4) |
| Auth/permissions | Supabase Auth + `profiles.role` + RLS (`admin / finance / manager / viewer`) | Reuse unchanged |
| Server-side code | **None** (no `api/`, no Supabase functions) | Must be introduced for any live connector |

Three findings that shape the design:

1. **`batches.type` has a hard `CHECK` constraint** limited to `GB, EB, EB_MB, SP, SP_MB`. New sources need a migration.
2. **`line_items` has no provenance or idempotency fields.** No `source_system`, `source_record_id`, `source_timestamp` or `synced_at`. A batch is identified only by its filename. Re-uploading the same file today creates duplicates unless a person deletes the old batch.
3. **`loadAllBatches()` pulls every line item into the browser** and aggregates client-side. Fine for weekly files (hundreds of rows each); **not viable** once a connector delivers daily or transaction-level volume. Server-side aggregation (Postgres views/RPC) is required before such data is ingested — see Phase 4.

---

## 3. Target architecture

```
Backoffice ──► Connector ──► Raw source data ──► Normalization ──► Central DB ──► Reporting engine ──► Dashboard
(per system)   (server-side)   (immutable,       (pure functions,   (Postgres,      (existing           (read-only,
                                original ids)     versioned)         RLS)            engine-core)        RLS-protected)
```

Principles:

- **Connectors only fetch and emit.** They never calculate commission. Source-reported figures are stored as reported (`commission_reported`); payable figures stay computed downstream by the existing engine (`commission_payable`). This preserves every formula verified so far.
- **The dashboard never talks to a backoffice.** It reads only the central database through RLS.
- **Raw is kept.** Every normalized row points back to a raw record; the original source identity is never overwritten.
- **Connectors are independent.** One folder per source, no shared mutable state, replaceable without touching the UI.

### Proposed layout

```
/connectors
  /_core            connector contract, sync runner, idempotency helpers, retry/rate-limit
  /csv-upload       wraps the existing PARSERS (GB, EB, SP, ...) — first real connector, already working
  /accessbet        assessment only until §5 is completed
  /walify  /globalbet  /elbet  /xpool  /lucky-greek  /lucky-ball    stubs created only when a source is approved
```

### Connector contract (minimal)

```ts
interface Connector {
  id: string;                          // 'accessbet', 'globalbet', ...
  integrationType: 'official_api' | 'authorized_internal_api' | 'approved_export' | 'csv_upload' | 'other_approved';
  capabilities(): { entities: Entity[]; granularity: 'daily'|'weekly'|'monthly'|'record'; incremental: boolean };
  testConnection(): Promise<Result>;                       // read-only, no side effects
  fetch(since: Watermark | null, opts): AsyncIterable<RawRecord>;   // raw, with original ids/timestamps
  normalize(raw: RawRecord): NormalizedRecord[];           // pure function, unit-testable offline
}
```

`capabilities()` is the honest part: each connector declares which entities and what granularity it can actually supply, and the UI only offers reports the selected source can truly back.

---

## 4. Unified data model

### What current sources can and cannot populate

| Entity (from the brief) | Populated by sources seen so far? |
|---|---|
| Agents | Partly — username only, plus state/branch/channel **decoded from the username prefix** (no names, phones, wallets) |
| Sales / Turnover / Commission / Bonuses | **Yes**, at agent × period × product grain |
| Tickets/Bets | **Count only** (aggregated). No individual tickets |
| Products, States/regions, Branches, Dates | Yes (derived) |
| Transactions, Wallet balances, Wallet transactions, Users/Players | **No source provides these today.** Note: the "Balance" column in our files is profit minus earnings — it is **not** a wallet balance |
| Daily summaries | **No** — every file is a weekly total; "daily" would be an estimate unless a connector supplies daily data |
| Audit/activity | Yes (`activity_log`) |

The model below is built **in layers so empty tables aren't created for data nobody provides**.

### Layer A — source registry and sync bookkeeping (Phase 1)

```sql
create table data_sources (
  id text primary key,                         -- 'accessbet','globalbet','elbet',...
  name text not null,
  integration_type text not null,              -- official_api | authorized_internal_api | approved_export | csv_upload | other_approved
  enabled boolean not null default false,
  config jsonb not null default '{}',          -- non-secret settings ONLY (secrets never here)
  created_at timestamptz default now()
);

create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_id text references data_sources(id),
  mode text not null,                          -- manual | scheduled | incremental | full
  status text not null,                        -- running | succeeded | failed | partial
  started_at timestamptz default now(),
  finished_at timestamptz,
  records_seen int, records_inserted int, records_updated int, records_skipped int,
  watermark_before text, watermark_after text,
  error_summary text,                          -- sanitized: never tokens/cookies/headers
  attempt int not null default 1
);
```

### Layer B — provenance on existing tables (Phase 1, non-breaking, all new columns nullable)

Add to `batches` and `line_items`: `source_system text`, `source_record_id text`, `source_timestamp timestamptz`, `synced_at timestamptz`, `integration_type text`.
Backfill existing rows: `source_system` derived from `type`, `integration_type = 'csv_upload'`. Replace the `batches.type` check with a lookup against `data_sources`.

### Layer C — raw + idempotency (Phase 2)

```sql
create table raw_records (
  id bigint generated always as identity primary key,
  source_id text not null references data_sources(id),
  source_record_id text not null,
  source_timestamp timestamptz,
  payload jsonb not null,                      -- original, unmodified
  synced_at timestamptz default now(),
  sync_run_id uuid references sync_runs(id),
  unique (source_id, source_record_id)         -- idempotency: re-sync upserts, never duplicates
);
```

For sources that provide no record id (all current CSVs), the key is **deterministic**: `hash(source_id, product/source_block, lower(agent_username), period_start, period_end)`. Re-uploading the same week then updates rather than duplicates.

### Layer D — fact tables (Phase 4, only when a source can fill them)

`transactions`, `tickets`, `wallet_balances`, `wallet_transactions`, `players` — each carrying the four provenance fields. Created **when a connector declares the capability**, not before.

---

## 5. AccessBet integration assessment

Target named in the brief: `https://shop.accessbet.com/admin/agents`.

### What I can and cannot determine

I cannot reach that site from here (no browsing capability, not on the allowed network) and I am not given credentials, by design. **So how the Agents page loads its data is currently unknown.** I will not guess endpoints.

### Evidence available (from screenshots already shared — page content only)

- The shop backoffice sidebar has a **Sales Reports** group: All Elbet, Luckyball, LuckyGreek, RocketMan, Virtual, xPool — plus **Sport Sales report, Sport Ticket report, Online Player Report**.
- The Elbet report page offers: product selector, date-from, date-to, a **Filter Result** button; KPI cards (Total Wins, Total Payout, Pending Payout, Est. Profit, Avg Daily Sales, Number of Tickets, Number of Days, Est. Commission); and a table with columns `S/N, AgentUsername, NumberOfTickets, MoneyIn, MoneyWin, MoneyPayout, Profit, Commission, Type`.
- The browser status bar showed a page URL of the form `…/report/elbet?type=tickets&GameID=5`. **That is a navigation URL. It says nothing about how data is loaded, and it must not be treated as an API endpoint.**
- The Elbet-family files we already process have exactly the same column set, so the same data likely originates from this system today (reached by manual export).

### The six checks the brief requires

| # | Question | Status |
|---|---|---|
| 1 | What data source is available? | **Unknown for `/admin/agents`.** Report pages exist for Elbet products, Virtual, xPool, Sport sales/tickets, Online players |
| 2 | How can it be accessed legitimately? | **Unknown.** Candidates in order of preference below |
| 3 | What authentication is required? | **Unknown.** A browser login (session cookie) is what a person uses; it must **not** be replicated by a connector |
| 4 | What fields are available? | Known for the Elbet report page (above). **Unknown for the Agents page** |
| 5 | Mapping to the normalized model | Elbet report: `AgentUsername→agent.username`, `NumberOfTickets→tickets_count`, `MoneyIn→turnover`, `MoneyWin→win_amount`, `MoneyPayout→payout_amount`, `Profit→profit`, `Commission→commission_reported`, `Type→commission_basis`. Agents page: cannot map until fields are seen |
| 6 | Reports that could be generated | Today's reports at weekly grain. Active/inactive agent lists **if** the Agents page exposes activity data. Daily/transaction/ticket/wallet reports **only if** a finer-grained source is confirmed |

### Candidate access methods, in order of preference

1. **Official or provider-sanctioned API** — ask the platform operator whether one exists and for read-only credentials.
2. **Scheduled/approved export** — a provider-supported export (file drop, emailed report, export button used under a service arrangement) feeding the existing CSV connector. Lowest risk; no new auth surface.
3. **Authorized internal API** — only if the provider confirms in writing that programmatic use of the endpoint the page already calls is permitted, and issues a dedicated read-only credential/token.
4. **Not acceptable:** logging in with a person's password and scraping pages, replaying session cookies, bypassing CAPTCHA/MFA, or any access the provider has not authorized. A connector will not be built on these, even if technically possible.

### How to investigate legitimately (to be done by someone authorized on that system)

1. Open the Agents page, open browser DevTools → **Network**, filter **Fetch/XHR**, reload.
2. If JSON responses appear: record **method, URL path, query-parameter names, response status, pagination parameters, and the JSON field names** (values replaced with fake samples).
3. If nothing appears: the page is server-rendered HTML — **no endpoint exists to integrate with**, and only methods 1–2 remain.
4. Note any **Export / Download** button on the page and what format it produces.
5. **Never share**: cookies, `Authorization` headers, CSRF/session tokens, passwords, or full request dumps. If unsure, redact before sending.
6. Separately, ask the AccessBet/platform owner: is there an official API or scheduled export, can a **read-only service account** be created, and what are the terms and rate limits?

(Claude in Chrome can assist the person doing step 1–4 in their own browser, but the findings brought back here must be the sanitized summary above — never raw session data.)

**Integration status: NOT STARTED. No AccessBet connector will be marked working until it has been run against the real source and its output reconciled against a known report.**

---

## 6. Security model

- **All credentials server-side only.** The browser bundle contains the Supabase anon key and nothing else. No backoffice credential, cookie, or token ever reaches frontend code.
- **Secrets storage:** Supabase Vault (or platform environment secrets), never plaintext in a table. `data_sources.config` holds non-secret settings only.
- **Read-only integration credentials** wherever the source allows; a failing write attempt should be a bug, not a possibility.
- **Sync execution** runs in a server-side function triggered manually (admin/finance only) or by a scheduler; the browser only requests "sync now" and reads status.
- **Logging:** `sync_runs.error_summary` and any logs are sanitized — no headers, tokens, or response bodies containing credentials.
- **RLS:** dashboard roles read normalized data; only admin can configure sources; only the sync runner writes raw/normalized tables.
- **Nothing credential-related is ever sent through Claude prompts.**

---

## 7. Synchronization design

| Requirement | Approach |
|---|---|
| Manual / scheduled | Manual button → server function; schedule via the database scheduler or platform cron |
| Incremental / full | Per-source watermark in `sync_runs`; full = ignore watermark, still idempotent |
| Idempotent | `unique (source_id, source_record_id)` + upsert; deterministic keys for aggregate-only sources |
| Duplicate detection | Same key ⇒ update, not insert; counts reported in `sync_runs` (inserted / updated / skipped) |
| Retry | Exponential backoff with capped attempts; `attempt` recorded; partial runs resume from watermark |
| Rate limiting | Per-connector request budget declared in the connector, enforced by the runner |
| Error logging / history | `sync_runs` is the history; UI shows last success, last failure, and sanitized error |

---

## 8. Dashboard changes

- **Global source selector:** All Backoffices / one source. Because current data has no `source_system`, Phase 1 backfills it from the existing batch type so the selector works on existing data immediately.
- **Source vs. product are different dimensions.** A *source* is the system of record data is pulled from; a *product* is the game (Luckyball, LuckyGreek, Virtual…). Some names in the brief's list are sources (Globalbet, AccessBet, Walify), others look like products reached *through* a source (Luckyball, LuckyGreek, possibly Xpool). The data model keeps both; the UI can offer both filters. **Decision 1 below.**
- **Settings → Data Sources:** one row per source with the fields requested (status, integration type, last success/failure, record count, sync status, enable/disable, configure, sync now, error details). In Phase 1 the only functional source is CSV upload, and the page will say so plainly rather than show placeholder "connected" states.
- **Reports:** existing Reports/KPI/export work stays untouched. New reports are enabled per source only where `capabilities()` says the data exists.

---

## 9. Phased plan

| Phase | Deliverable | Risk | Claims made |
|---|---|---|---|
| 0 | This assessment; decisions; AccessBet investigation by an authorized person | None | None |
| 1 | `data_sources` + `sync_runs`; provenance columns + backfill; connector interface; `csv-upload` connector wrapping existing parsers; source selector; Settings → Data Sources (CSV only); duplicate-safe re-upload | Low — additive, nullable columns, existing flow unchanged | "CSV upload works as a connector" (already true) |
| 2 | Server-side runtime; secrets; sync runner, retries, scheduling, history; verified with a **clearly-labelled test connector** | Medium — new infrastructure | "Sync framework works" (against test data only) |
| 3 | First real connector — method decided by §5 findings; reconciled against a known report before enabling | Depends on access method | Only after reconciliation |
| 4 | Server-side aggregation (views/RPC) replacing load-everything-to-browser; fact tables for any entity a connector actually supplies | Medium | Per entity, as data exists |
| 5+ | Further connectors (Walify, Xpool, …), one at a time, each preceded by its own six-point assessment | Per source | Per source |

---

## 10. Decisions needed

1. **Source vs. product modelling** — confirm the two are separate dimensions (recommended). Which of the brief's eight names are systems of record, and which are products reached through one?
2. **Server runtime** — Supabase Edge Functions + Vault (recommended: database, auth and RLS are already Supabase) vs. Vercel serverless functions.
3. **Approve Phase 1** (additive, non-breaking, no new data sources).
4. **AccessBet investigation** — who can run the §5 steps, and is there a contact at AccessBet/the platform provider to ask about an official API or scheduled export?
5. **Walify and Xpool** — no sample file, export, or documentation has been seen for either. Is anything available?
6. **Daily/transaction/ticket/wallet reports** — confirm these are expected **only if** a connector can supply finer-grained data (they cannot come from today's weekly files).

---

## 11. Phase 1 — implemented (additive; existing behavior unchanged)

**Two dimensions, never mixed.** *Backoffice* = the system providing data (`batches.source_system`). *Product* = the betting product inside it (`line_items.product`: Luckyball, Luckygreek, Globalbet Virtual, Sports…). Reports filter on both at once (e.g. Backoffice: Elbet + Product: Luckygreek).

**Built:** `schema_v9_data_sources.sql` (registry, sync history, nullable provenance on `batches`, `product` on `line_items`, backfills, RLS); `src/lib/sources.js` (backoffice registry, capabilities, live-status rules); provenance and product written on every new upload with fallback if the migration hasn't been run; each upload logged as a *manual* sync run; global **Backoffice selector** in the header (Reports, Weeks, Shop Groups, Insights, Needs Attention, Inactive Agents, Drop-in Sales and exports read from it; History and Upload always show everything); **Admin → Data Sources** page.

**Data Sources page rules:** the CSV Upload connector is listed as its own connector (the existing import, verified working). Every backoffice shows its *live* connection status, which is derived only from live sync runs — a manual upload never counts, so all show **Not Connected**. Test Connection / Sync Now / Configure / Disable are disabled with a reason because no live connector exists. View Sync History shows real recorded runs. "Provides" lists only what files actually received contain (agents, sales, commission, bonuses, ticket counts — not ticket-level, transactions, wallets or daily).

**Verified against real files:** "All Backoffices" returns the identical batch list as before; per-backoffice stake, commission and payout sum exactly to the all-sources totals; the SQL product backfill equals the app's own product logic on all 2,290 real rows; Backoffice + Product combine correctly; a manual upload can never produce "Connected".

**Deliberately NOT done:** `batches.type` check constraint untouched; `line_items` gets only `product` (source inherited via `batch_id`); duplicate-safe re-upload not implemented (changes upload semantics — needs a decision); no server-side runtime yet.

**Open attributions:** Elbet-format files → *Elbet* (inferred); Sports files → *Other / unassigned*. Both stored per batch; correcting them is a data update.

**Live connectors: none. AccessBet: NOT STARTED, blocked on the access-method findings (§5).**

**Correction (owner-confirmed):** the shop menu at `shop.accessbet.com` (Walify) lists Xpool and Sport entries, but Walify does **not** report Sport or Xpool. Those menu entries must not be treated as data sources. Sport data therefore comes from a backoffice not yet identified; Xpool data comes from `xpool.accessbet.com`.

**Owner-confirmed scope (latest):**
- **Globalbet is the main source; Walify feeds on it.** Globalbet's own backoffice is authoritative for Globalbet sales, commission and bonus. Walify's Globalbet figures are downstream and are for checking only — never added on top of Globalbet's (would double-count). Rule to implement before any second copy of a product is ingested: one authoritative backoffice per product.
- **Sport:** no backoffice available yet. Sports files stay "Other / unassigned"; there is no fourth connector for now.
- **Xpool:** a separate backoffice (`xpool.accessbet.com`) with its own product. Required fields: **tickets, sales, commission** per agent. No sample received. Open: whether Xpool's commission is taken as reported by the backoffice or must be computed by our own rules (any computed formula must be verified against real data first). A new product name ("Xpool") will need adding to the product mapping when its data arrives.

**Owner-confirmed model (supersedes the attribution above):** Globalbet and Elbet are the **original** backoffices (Elbet carries Luckyball, Luckygreek, Rocket Man). **Walify is a reporting layer** that gets reports from both — it is not the original source of any product, so nothing is attributed to it and its copies are for checking only (never added to the originals). **Xpool** is its own backoffice with its own product and **calculates and pays commission itself**. Sport has no backoffice yet.

Authority per product: Globalbet Virtual → Globalbet; Luckyball / Luckygreek / Rocket Man → Elbet; Xpool → Xpool.

**Open design point — payable vs reported commission:** because Xpool pays its own commission, its commission is *reported, not payable by us*. If it were added into "Total Commission" next to Globalbet/Elbet it would overstate what must be paid. Proposed: store a per-source flag (`paid_by_us` true/false); Xpool figures are shown, labelled "paid by Xpool", and excluded from payable totals. Needs the owner's confirmation before implementing.

**Access paths (owner-confirmed):** the owner has direct logins to the original backoffices and downloads reports from them: Globalbet (CSV export), and the Luckyball / Luckygreek / Rocket Man reports **directly from the Elbet backoffice** (not via Walify). Xpool has an Export button on its Agent Breakdown report. Walify is therefore a viewing/reporting layer the dashboard does not need a connector for, except possibly later for cross-checking. Connector scope: **Globalbet, Elbet, Xpool** (plus Walify optionally).

**Decisions (owner-confirmed):** Xpool commission is paid inside Xpool and is per agent only — no parent/child hierarchy. It will be shown as reported and labelled "paid by Xpool", excluded from payable totals (implemented with the Xpool import; needs a per-source `paid_by_us` flag, to go in a separate migration alongside it). Elbet backoffice: `backoffice.accessbet.elbet.com`, exports PDF and Excel. Open: the Elbet CSV currently uploaded appears to be a hand-assembled sheet (three products side by side with duplicate and combined blocks); a raw Elbet export is needed to confirm whether the assembly can be removed.

---

## 12. Xpool import (CSV connector #4) — implemented and verified against a real export

**Source:** Xpool backoffice → Reports → Agent Breakdown → Export (`report-breakdown-parent.csv`). Recognised by its header row (the filename names no product). New file type `XP`, backoffice `xpool`, product `Xpool`.

**The file is a hierarchy, not a flat list.** Columns: `Agent, Depth, Scope, Parent, Bets, Stake, Payout, Gross Profit, Commission, Net Profit, Won, Lost, Pending`. `subtree` rows are roll-ups (a parent's own sales plus all its children); `own (direct)` rows are the parent's own sales; `own` rows are individual agents or cashier accounts. **Summing every row overstates stake by ~74%** (₦3.62M instead of ₦2.08M). The parser keeps every row except `subtree`, so each agent's own sales are counted exactly once — per agent only, as the owner asked.

**Verified against the owner's Xpool screen (week Sep 28 – Oct 4, 2026), exact:** 59 agents, 1,758 bets, ₦2,081,726.00 stake, ₦202,578.98 payout, ₦1,879,147.02 gross profit, ₦279,257.65 commission, ₦1,599,889.37 net. Every row satisfies gross = stake − payout and net = gross − commission. The 44 bets that are not Won/Lost/Pending equal the 44 shown on Xpool's own screen (status unknown — likely void/cancelled). An integrity guard **refuses** any export whose per-agent rows don't add up to its top-level rows.

**Commission is reported, not payable by us.** Xpool calculates and pays it inside its own backoffice. It is tracked as `reportedCommission` and never added to payable commission or put through our verification; payable commission for Xpool is ₦0 by design. The Reports KPI row shows it separately as "Commission paid by source", and the table marks it "paid by source". Keyed on the block name `XP:OWN` so it survives save/reload.

**Cashier accounts are rolled into their parent agent (owner-confirmed).** 30 of the 59 rows (15.2% of stake) are accounts like `gokana-cashier1`, listed by Xpool under a parent agent. Each is attributed to that parent (59 agents become 55; three parents have several cashiers); totals are unchanged. The original username Xpool reported is kept in `line_items.source_agent_username` so every roll-up is traceable. Pool sub-agents (the parent/child structure) are *not* rolled up — per agent only. Because the parents are the same agent usernames used in other products, an agent's Xpool figures now sit alongside their other products.

**The 44 bets that are not Won/Lost/Pending are void/cancelled (owner-confirmed).** Tickets are counted as Xpool counts them (1,758, which reconciles to Xpool's own total). Xpool's export does not split void stake out of Stake or Payout, so Stake and Gross Profit are as Xpool reports them; a separate void/cancelled count could be shown if wanted.

**Needs:** `schema_v10_xpool.sql` (allows type `XP`; adds `parent_username`, `source_agent_username`, `money_win`; safe to re-run). Run before the first Xpool upload; the app says so if forgotten.

**Regression:** across all other products (517 agents) every stake, commission, bonus, palliative and gift figure is identical before and after this change.

### Bug found and fixed while doing this
`moneyWin` (Elbet products' MoneyWin column, behind Total Wins / Pending Payout) was parsed but **never saved to the database**, so those figures worked on a fresh upload and silently reverted after save/reload. Now persisted (`line_items.money_win`) with a fallback for databases that haven't run migration 10. Elbet files uploaded *before* the migration have no stored value and must be deleted and re-uploaded to regain Pending Payout.

### Known related gap (not changed)
`avgStake` and `totalEarnings` (Globalbet legacy-file extras) are likewise not stored on line items, so the Agent Breakdown shows "—" for them after a reload. `avgStake` equals stake ÷ tickets exactly (verified on a real agent); `totalEarnings` equals commission + bonus + palliative + gift. Left unchanged pending the owner's decision.

---

## 13. Phase 2 — connector framework and server-side sync (built; no live connector exists)

**Flow:** `Dashboard (browser) → Supabase Edge Function "sync-source" → connector → external backoffice`, then `raw → normalize → sync_apply_batch → Supabase (batches / line_items) → existing reporting engine → dashboard`. The browser only ever calls the Edge Function with the user's own session. Backoffice credentials exist only as Edge Function secrets (`CONNECTOR_<ID>_<NAME>`, set with `supabase secrets set`), are namespaced per connector, are never stored in the database, and never reach the browser. Errors are scrubbed (`redact`) before anything is stored or returned.

**Layout:** `supabase/functions/_shared/` (connector contract, runner, store, resilience, sanitize, keys, block vocabulary, registry), `_shared/connectors/{globalbet,elbet,xpool,walify}.ts` (one per backoffice, all implementing the same `Connector` interface), `sync-source/index.ts` (the Edge Function), `schema_v11_sync_infrastructure.sql`, `tests/`. Files live under `supabase/functions/` because an Edge Function can only import from there.

**All four connectors are stubs.** Each records what is known, what is not, and what blocks it, reports `not_implemented`, and is refused by the runner — it cannot appear Connected. A stub becomes real only when its provider confirms a permitted access method (official API, scheduled export, or read-only account); then its file is replaced by a real `Connector` and nothing else changes. `Connected` additionally requires a live sync that actually retrieved data (`records_seen > 0`); a manual upload, a successful login, or an empty sync never qualifies.

**Guarantees, each covered by a test against real Postgres:** idempotent (re-sync = 0 inserted / 0 updated, no duplicates); changed values update in place and vanished rows are removed, with counts reported; atomic (a failed apply rolls back, including the batch it created); **never overwrites or duplicates a manual/CSV upload** — a sync period that overlaps one is skipped and reported; one sync per backoffice at a time; retries with exponential backoff and Retry-After, never on 401/403; rate limiting; bounded retries; secrets cannot reach run history or responses; first sync requires an explicit window, incremental resumes from the last watermark; the function is executable by the service role only. The server product mapping, the engine's `productOf`, and the SQL backfill are asserted identical.

**Not verified here (be aware):** the Edge Function entry file is strictly type-checked but was **not executed** (no Deno in the build environment); `SupabaseStore` was not run against a live Supabase project (its SQL function and the runner were, against Postgres). First deployment should be watched.

**Known limits / decisions to make:** bonus, palliative and gift (supplemental payments) are not part of the sync path — Globalbet's depend on inputs that today come from a manually enriched sheet; a manual batch with an unconfirmed period blocks syncs for that source until deleted or dated; rate limiting is per invocation; long syncs may need chunking against Edge Function time limits; scheduling (pg_cron calling the function with `x-cron-secret`) is designed but not wired.

**Deploy (optional until a connector exists):** run `schema_v9`, `schema_v10`, `schema_v11` in order; then `supabase functions deploy sync-source --no-verify-jwt` (the function authenticates every request itself). Until deployed, the Data Sources page shows "Sync service: Not deployed" and live sync is unavailable; CSV upload is unaffected.

**Migration safety.** Five versions of `schema_v9` and three of `schema_v10` were issued while the source model was settled, so a production database could be in any of 15 states. `schema_v11` therefore begins with guarded preconditions and a repeat-safe repair (current five sources, retired ones removed, uploads and run history re-filed, `product` guaranteed). `tests/migration-paths.test.ts` executes every one of the 15 combinations on real Postgres against sample data that the original version labelled its own way, runs the latest v10 and v11, and asserts the registry, the filing of every upload, run history, product labels, and table structure all equal a clean install — and that no row is lost. Finding from it: the first v9 had no `product` column; v11 now adds it.

---

## 14. Globalbet Financial Overview (tree) file — findings and fixes

Triggered by one agent whose dashboard row (stake 1,055,600, commission 41,017, no bonus) differed from the weekly sheet (1,051,900; 45,118.74 uplifted; bonus 15,000, palliative 10,000, gift 4,832.056).

**Root causes, each proved on real files before any change:**
1. **Reversal was ignored.** The tree's Total In is gross; the sheet (and Globalbet's own Profit) use it net of the Reversal column. Sheet stake = Total In − Reversal for **177 of 177** agents in a week where both formats exist; gross matched only the 140 with no reversal. (A first hypothesis, that "all players included" inflated the tree, was tested and was wrong.)
2. **A tree-only week had no uplift and no bonus/palliative/gift** — by design the tree parser never produced them. The formulas themselves reproduce the sheet exactly (the sheet row checks to the cent on every derived column).
3. **Latent bug (found while testing):** the rule "legacy sheet wins over the tree" ignored the period, so viewing several weeks together silently dropped a tree-only week for any agent who had a sheet in another week (one agent: 730,500 shown instead of 1,782,400).

**Fixes (engine only; parsers for every other product untouched):** tree stake = Total In − Reversal; for a week with only the tree file, uplifted commission (base × 1.10 — verified **274 of 274** default-plan agents across two sheets), bonus, palliative and gift are calculated with the same helper the legacy path now also uses; a legacy sheet suppresses the tree only for the **same week** (ranges overlapping by at least half of the shorter one; unknown periods keep the old rule); Avg Stake / Total Earnings / Balance are derived from Globalbet-only tallies (and recomputed across weeks).

**Verification:** your row reproduces on all nine figures from the tree file alone; tree-only vs sheet for the same week is identical on stake, commission, bonus, palliative and gift for **173 of 176** agents (the three exceptions below); with both files uploaded the result equals the sheet alone (176/176); every legacy, Elbet, Sports, monthly-bonus and Xpool file is identical to before the change.

**Known differences and open items**
- `001fc-gwa-spareshop` (no_supplemental_pay): the sheet pays 50% of base commission one week and 55% the next — not a fixed rate. A tree-only week shows Globalbet's base commission instead, which is higher than the sheet. Needs the owner's rule.
- `001fc-bwa-kubwa`: the sheet shows Bonus, Palliative and Gift of 0 in both weeks, but the engine calculates ₦25,000 / ₦29,000 of them (a legacy-path behaviour that predates these changes). If it is another negotiated no-supplemental agent it should be added to `agent_commission_plans`.
- Two agents' tree Profit differs from the sheet's by ₦498 and ₦200, changing one gift by ₦174.
- Tree files uploaded **before** this fix were stored with gross stake and cannot be corrected in place (Reversal is not stored); delete and re-upload them.
- Totals no longer equal AccessBET's own gross "Total In" row by exactly the total reversal.

---

## 15. Review & Adjust — correcting what is paid, between upload and export

**Why.** Some agents are paid by arrangement, not by formula: `001fc-bwa-kubwa` gets no bonus, palliative or gift (the sheet pays 0 in both weeks checked) and `001fc-gwa-spareshop`'s commission is a negotiated 50% or 55% of base that changes week to week. The system calculated both by the general rules. There was no way to correct bonus/palliative/gift at all, and commission could only be adjusted from a mismatch row on the Export screen.

**What it is.** A page under Finance, `Review & Adjust`, visible to admin/finance (`manage_adjustments`). After an upload, those users land on it for the week just saved; everyone else goes to Reports as before. It lists every agent in a chosen week with what the system calculated, and an Edit button per agent.

**Rules.**
- A correction is saved **beside** the uploaded data, never over it. It applies to **one agent in one week** and cannot touch any other week or agent. A reason is mandatory; the calculated figure it replaced, who made it and when are kept.
- Commission corrections are the existing `manual_adjustments` (per source line). Bonus / Palliative / Gift corrections are the new `row_overrides` (migration 12), one per agent, field and week; 0 is valid ("pay nothing this week").
- A correction beats the automatic rules (online exclusion, 40% plan, no-supplemental plan), the same precedence a commission adjustment already had. Only the corrected field changes; the other rules still apply to the rest.
- Typing the calculated figure back **removes** the correction instead of leaving a redundant one. Every correction has an Undo.
- For something that applies to every week, the editor offers the existing standing `no_supplemental_pay` plan instead of a one-off correction.
- `Mark week as reviewed` records who and when (`batch_reviews`). It is a **soft** checkpoint: Clean Export warns when selected weeks are unreviewed, and never blocks.
- Corrections feed every figure: Reports, Weeks, Shop Groups, Clean Export (a "Manually Adjusted" column). **Behaviour change:** Weeks and Shop Groups previously ignored manual adjustments entirely; they now include them, so a corrected week reads the same everywhere.

**Not editable here (deliberately).** Stake, tickets and profit. Bonus and palliative depend on them, so changing them silently would change what is owed; if the sheet itself is wrong, fix it at the source and upload it again. Monthly-bonus products are also not editable here yet.

**Verification.** 13 engine tests (kubwa and spareshop cases, week scoping, precedence, add-from-zero, undo), 10 tests of the save/remove/refuse decisions, 2 on migration 12 against real Postgres, and 8 that drive the real page in a simulated browser (open editor, zero the three payments, refused without a reason, saved correctly, failed save keeps the editor open, corrections listed with who/why, Undo, reviewed/reopen, hidden from users who cannot edit). Mutation checks confirmed the tests fail when overrides are ignored or leak across weeks. With no corrections supplied the engine is **identical** to before across every real file and week together.

**Deploy.** Run `schema_v12_review_and_overrides.sql` (independent of v7–v11; safe to re-run). Without it the app still works and commission corrections still save; saving a bonus/palliative/gift correction or a review says exactly which file to run.

---

## 16. Sheet vs dashboard — checking the dashboard's pay against what the sheet printed

**Why.** Pay is made from the weekly sheet today, and may move to the dashboard later. The dashboard calculates each agent's pay itself from the sheet's inputs; until now it ignored the figures the sheet *printed*. So a sheet that was wrong for one agent could not be noticed — which is exactly what happened with `001fc-bwa-kubwa`, whose sheet printed 0 for bonus, palliative and gift in both weeks checked while the dashboard calculated ₦25,000 and ₦29,000 (the owner confirms kubwa can still get a bonus, so the dashboard was right and the sheet was not).

**What.** At upload the legacy-sheet parser also keeps what the sheet printed per agent (uplifted commission, bonus, palliative, gift, total earnings); migration 13 stores them in `sheet_figures`. Each week then shows, per agent, one of: **match**, **corrected** (a person deliberately changed it in Review & Adjust), **explained** (a known rule: online agent, 40% plan, no-bonus plan — the no-bonus plan never excuses a *commission* difference), **differs** (nothing explains it — the ones to look at), or **not counted**. Tolerance is ₦0.50 so printed fractions do not raise alarms.

**Where it shows.** (1) The upload preview, *before anything is saved*, one sheet at a time (never merged across files). (2) Review & Adjust: a "Sheet" column, an "only differences from the sheet" filter, the headline "N of M agree", the sheet's printed figures inside the editor with a one-click "Use the sheet's figures", and a week-by-week history. The history is the evidence for switching: when it shows no unexplained differences for several weeks running, the dashboard is giving the same answer as the sheet.

**Result on the real weeks.** 15-09: 142 of 143 agents match; 29-09: 148 of 149 match; in both, the only difference is kubwa. The check changes no calculation (all products and weeks together are identical to before).

**Limits.** It compares *pay* (commission, bonus, palliative, gift, total), not the sheet's inputs (stake, tickets, profit) against Globalbet's own report; that would catch a mis-copied input and is the natural next step. It needs the weekly sheet to be uploaded; weeks uploaded before migration 13 have no stored figures (re-upload to compare). It never changes what is paid by itself: adopting the sheet's figures is a deliberate, reasoned, undoable correction.

**Deploy.** Run `schema_v13_sheet_figures.sql` (independent of v7–v12; safe to re-run). Without it everything still works; the upload preview still shows the check, but the comparison is not kept for later.
