// Proves that schema_v11 brings a database to the CURRENT model no matter which
// earlier versions of schema_v9 / schema_v10 were run. Five versions of v9 and
// three of v10 were issued while the source model was being settled; any
// combination could be in production. Each one is executed here, for real, on
// PostgreSQL (PGlite), against sample data that the ORIGINAL version labelled in
// its own way; then the latest v10 and v11 are run and the result is compared
// with a database built cleanly from the latest files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f: string) => readFileSync(ROOT + f, "utf8");
const hist = (name: string, n: number) => read(`tests/fixtures/historical-migrations/${name}.${n}.sql`);
const V9 = "schema_v9_data_sources.sql", V10 = "schema_v10_xpool.sql", V11 = "schema_v11_sync_infrastructure.sql";
const SOURCES_NOW = ["elbet", "globalbet", "other", "walify", "xpool"];

async function baseDb(withSampleData: boolean): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role service_role; create role anon; create role authenticated;
    create table profiles (id uuid primary key default gen_random_uuid());
    create function get_my_role() returns text language sql as $$ select 'admin'::text $$;
  `);
  await db.exec((read("schema.sql").match(/create table (?:batches|line_items) \([\s\S]*?\n\);/g) ?? []).join("\n"));
  if (withSampleData) {
    // What a production database held BEFORE v9 was ever run.
    await db.exec(`
      insert into batches (type, filename, period_start, period_end) values
        ('GB','gb.csv','2026-09-21','2026-09-27'), ('EB','eb.csv','2026-09-14','2026-09-20'), ('EB_MB','ebmb.csv','2026-08-01','2026-08-31'),
        ('SP','sp.csv','2026-09-21','2026-09-27'), ('SP_MB','spmb.csv','2026-08-01','2026-08-31');
      insert into line_items (batch_id, agent_username, source_block, stake)
        select id, 'agent-' || type, case type when 'GB' then 'GB:FIN_OVERVIEW' when 'EB' then 'EB:LUCKYBALL' when 'EB_MB' then 'EB_MB:BASE'
                                               when 'SP' then 'SP:BASE' else 'SP_MB:BASE' end, 1000 from batches;`);
  }
  return db;
}
const colSnapshot = async (db: PGlite) => JSON.stringify((await db.query<any>(
  `select table_name, column_name, data_type, is_nullable from information_schema.columns
    where table_schema='public' and table_name in ('data_sources','batches','line_items','sync_runs') order by 1,2`)).rows);
const one = async (db: PGlite, sql: string) => Object.values((await db.query<any>(sql)).rows[0])[0] as any;
const list = async (db: PGlite, sql: string) => (await db.query<any>(sql)).rows.map((r) => Object.values(r)[0] as string);

// The reference: built cleanly from the latest files only.
let reference: { cols: string } | null = null;
async function getReference() {
  if (reference) return reference;
  const db = await baseDb(false);
  for (const f of [read(V9), read(V10), read(V11)]) await db.exec(f);
  reference = { cols: await colSnapshot(db) };
  return reference;
}

for (const v9 of [1, 2, 3, 4, 5]) {
  for (const v10 of [1, 2, 3]) {
    test(`v9 version ${v9} + v10 version ${v10}  ->  latest v10 + v11 reaches the current model`, async () => {
      const db = await baseDb(true);
      await db.exec(hist("schema_v9_data_sources", v9));
      // The app logs each upload as a manual run against the source it filed it under.
      await db.exec(`insert into sync_runs (source_id, mode, status, finished_at, records_seen, records_inserted, records_updated, records_skipped)
                     select source_system, 'manual', 'succeeded', now(), 1, 1, 0, 0 from batches`);
      await db.exec(hist("schema_v10_xpool", v10));
      // An Xpool upload made after v10 (labelled 'Other' by a v9 that had no Xpool branch).
      // (The very first v9 had no product column at all, so only write one where it exists.)
      const hasProduct = await one(db, `select exists (select 1 from information_schema.columns where table_name='line_items' and column_name='product')`);
      await db.exec(`insert into batches (type, filename, period_start, period_end, source_system, integration_type) values ('XP','xp.csv','2026-09-28','2026-10-04','xpool','csv_upload');
                     insert into line_items (batch_id, agent_username, source_block, stake${hasProduct ? ", product" : ""}) select id, 'xp-agent', 'XP:OWN', 500${hasProduct ? ", 'Other'" : ""} from batches where type='XP';`);

      // ---- the upgrade the user will actually run ----
      await db.exec(read(V10));
      await db.exec(read(V11));

      assert.deepEqual(await list(db, `select id from data_sources order by id`), SOURCES_NOW, "registry is exactly the five current sources");
      const label = Object.fromEntries((await db.query<any>(`select type, source_system from batches`)).rows.map((r) => [r.type, r.source_system]));
      assert.deepEqual(label, { GB: "globalbet", EB: "elbet", EB_MB: "elbet", SP: "other", SP_MB: "other", XP: "xpool" }, "every upload filed under the right backoffice");
      assert.equal(await one(db, `select count(*)::int from sync_runs where source_id not in (select id from data_sources)`), 0, "no run points at a missing source");
      assert.equal(await one(db, `select count(*)::int from sync_runs`), 5, "no upload history was lost");
      assert.deepEqual(await list(db, `select source_id from sync_runs where source_id <> 'other' order by source_id`), ["elbet", "elbet", "globalbet"], "history follows the corrected filing");
      assert.equal(await one(db, `select product from line_items where source_block='XP:OWN'`), "Xpool", "Xpool rows are labelled Xpool");
      assert.equal(await one(db, `select count(*)::int from line_items where product is null`), 0, "no row is missing a product");
      assert.equal(await one(db, `select count(*)::int from line_items`), 6, "no line item was lost");
      assert.equal(await colSnapshot(db), (await getReference()).cols, "table structure identical to a clean install");

      // ---- and the new sync function works on this migrated data ----
      const item = JSON.stringify([{ key: "k", agent_username: "a", source_block: "EB:LUCKYBALL", is_house: false, stake: 5, product: "Luckyball" }]);
      const apply = (a: string, b: string) => one(db, `select sync_apply_batch('elbet','EB','${a}','${b}','approved_export','${item}'::jsonb)->>'status'`);
      assert.equal(await apply("2026-09-28", "2026-10-04"), "applied", "a fresh period syncs");
      assert.equal(await apply("2026-09-15", "2026-09-21"), "skipped_manual_exists", "a period covered by an existing upload is protected");

      // ---- repeat-safe ----
      await db.exec(read(V10)); await db.exec(read(V11));
      assert.deepEqual(await list(db, `select id from data_sources order by id`), SOURCES_NOW);
      assert.equal(await one(db, `select count(*)::int from line_items where source_block <> 'XP:OWN' and stake = 1000`), 5, "re-running changed no existing data");
    });
  }
}

test("v11 refuses, with a clear message, when the prerequisites are missing", async () => {
  const none = await baseDb(true);
  await assert.rejects(none.exec(read(V11)), /Run schema_v9_data_sources\.sql first/);
  const oldV10 = await baseDb(true);
  await oldV10.exec(hist("schema_v9_data_sources", 4)); await oldV10.exec(hist("schema_v10_xpool", 1));
  await assert.rejects(oldV10.exec(read(V11)), /Run the LATEST schema_v10_xpool\.sql first/);
});

test("a clean install from the latest files has exactly the five sources and the sync function", async () => {
  const db = await baseDb(true);
  for (const f of [V9, V10, V11]) await db.exec(read(f));
  assert.deepEqual(await list(db, `select id from data_sources order by id`), SOURCES_NOW);
  assert.equal(await one(db, `select count(*)::int from pg_proc where proname = 'sync_apply_batch'`), 1);
});
