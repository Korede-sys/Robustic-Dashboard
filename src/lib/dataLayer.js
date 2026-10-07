import { supabase } from "./supabaseClient";
import { SOURCE_BY_TYPE, isMissingColumnError } from "./sources";
import { productOf } from "./engine-core";

/* ============================================================ auth */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
export async function signOut() {
  await supabase.auth.signOut();
}
export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return data.subscription;
}
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
export async function getMyProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (error) throw error;
  return data;
}
export async function getAllProfiles() {
  const { data, error } = await supabase.from("profiles").select("*");
  if (error) throw error;
  return data;
}
export async function updateProfileRole(userId, role) {
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) throw error;
}

/* ============================================================ field mapping
   Postgres convention is snake_case; the parsing engine (unchanged from the
   already-validated version) uses camelCase throughout. These convert at the
   boundary so the engine itself never needs to know the database exists. */
function itemToDb(item, batchId) {
  return {
    batch_id: batchId, agent_username: item.agentUsername, source_block: item.sourceBlock,
    tickets: item.tickets, stake: item.stake, payout: item.payout, profit: item.profit,
    commission_amount: item.commissionAmount, commission_type: item.commissionType,
    balance: item.balance, is_house: item.isHouse,
    ...(item.parentUsername ? { parent_username: item.parentUsername } : {}), // only Xpool rows carry one
    ...(item.moneyWin !== null && item.moneyWin !== undefined ? { money_win: item.moneyWin } : {}), // only Elbet products carry one
    ...(item.sourceAgentUsername ? { source_agent_username: item.sourceAgentUsername } : {}), // only rolled-up Xpool cashier rows
  };
}
function itemFromDb(row) {
  return {
    agentUsername: row.agent_username, sourceBlock: row.source_block,
    parentUsername: row.parent_username || null,
    sourceAgentUsername: row.source_agent_username || null,
    moneyWin: row.money_win === null || row.money_win === undefined ? null : Number(row.money_win),
    tickets: row.tickets === null ? null : Number(row.tickets),
    stake: row.stake === null ? null : Number(row.stake),
    payout: row.payout === null ? null : Number(row.payout),
    profit: row.profit === null ? null : Number(row.profit),
    commissionAmount: row.commission_amount === null ? null : Number(row.commission_amount),
    commissionType: row.commission_type, balance: row.balance === null ? null : Number(row.balance),
    isHouse: row.is_house,
  };
}
function suppToDb(s, batchId) {
  return { batch_id: batchId, agent_username: s.agentUsername, type: s.type, amount: s.amount };
}
function suppFromDb(row) {
  return { agentUsername: row.agent_username, type: row.type, amount: Number(row.amount) };
}
function interventionToDb(rec, userId) {
  return {
    agent_username: rec.agentUsername, agent_state: rec.agentState, contacted_by: userId,
    reason: rec.reason || null, agent_feedback: rec.agentFeedback || null,
    action_required: rec.actionRequired || null, follow_up_date: rec.followUpDate || null,
    status: rec.status || "open", notes: rec.notes || null,
  };
}
function interventionFromDb(row, profileNameById) {
  return {
    id: row.id, agentUsername: row.agent_username, agentState: row.agent_state,
    contactedBy: profileNameById[row.contacted_by] || "—", contactedAt: row.contacted_at,
    reason: row.reason, agentFeedback: row.agent_feedback, actionRequired: row.action_required,
    followUpDate: row.follow_up_date, status: row.status, notes: row.notes,
  };
}

/* ============================================================ batches */
// Postgres has a practical limit on how many rows one insert should carry at
// once -- chunk large files (Sports weekly runs ~800+ line items) to stay safe.
const CHUNK_SIZE = 500;
async function insertChunked(table, rows) {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw error;
  }
}

export async function saveBatch(batch, userId) {
  const base = {
    type: batch.type, filename: batch.filename, uploaded_by: userId,
    period_start: batch.periodStart || null, period_end: batch.periodEnd || null,
  };
  // Provenance: where this data came from and how. For a file export the
  // closest thing to a source record id is the filename. If the provenance
  // migration (schema_v9) hasn't been run, retry with the original columns
  // only -- uploads must never break because of an optional upgrade.
  const sourceSystem = SOURCE_BY_TYPE[batch.type] || null;
  const provenance = {
    source_system: sourceSystem, integration_type: "csv_upload",
    source_record_id: batch.filename, synced_at: new Date().toISOString(),
  };
  let provenanceApplied = true;
  let { data: batchRow, error } = await supabase.from("batches").insert({ ...base, ...provenance }).select().single();
  if (error && isMissingColumnError(error)) {
    provenanceApplied = false; // schema_v9 not run yet: fall back to the original columns
    ({ data: batchRow, error } = await supabase.from("batches").insert(base).select().single());
  }
  if (error && error.code === "23514" && batch.type === "XP") {
    throw new Error("Xpool uploads need schema_v10_xpool.sql to be run in Supabase first. Nothing was saved.");
  }
  if (error) throw error;

  // Product is its own dimension, separate from the backoffice. Only written
  // when the same migration that added the column is known to be in place
  // (the batches insert above just proved it), so older databases still work.
  const itemRows = batch.items.map(i => (
    provenanceApplied ? { ...itemToDb(i, batchRow.id), product: productOf(i.sourceBlock) } : itemToDb(i, batchRow.id)
  ));
  try {
    await insertChunked("line_items", itemRows);
  } catch (e) {
    // money_win / parent_username come from migration 10. If it hasn't been run,
    // save everything else rather than fail the whole upload (the first chunk
    // is what fails, so nothing is half-written).
    if (!isMissingColumnError(e)) throw e;
    await insertChunked("line_items", itemRows.map(({ money_win, parent_username, source_agent_username, ...rest }) => rest));
  }
  if (batch.supplemental.length > 0) {
    await insertChunked("supplemental_payments", batch.supplemental.map(s => suppToDb(s, batchRow.id)));
  }
  if (batch.sheetFigures && batch.sheetFigures.length > 0) {
    try {
      await insertChunked("sheet_figures", batch.sheetFigures.map(f => ({
        batch_id: batchRow.id, agent_username: f.agentUsername.toLowerCase(),
        commission: f.commission, bonus: f.bonus, palliative: f.palliative, gift: f.gift, total_earnings: f.totalEarnings,
      })));
    } catch (e) { /* schema_v13 not run yet: the upload is fine; only the sheet-vs-dashboard check is unavailable for this week */ }
  }
  await recordUploadSyncRun(sourceSystem, batch.items.length + batch.supplemental.length);
  return {
    ...batch, id: batchRow.id, uploadedAt: batchRow.uploaded_at, periodStart: batchRow.period_start, periodEnd: batchRow.period_end,
    sourceSystem: batchRow.source_system || sourceSystem,
  };
}

// A manual upload IS a (manual) synchronization -- recording it gives the
// Data Sources page a real "last successful sync". Best-effort: the table
// only exists after schema_v9, and a failure here must never fail the upload.
async function recordUploadSyncRun(sourceId, recordCount) {
  if (!sourceId) return;
  try {
    await supabase.from("sync_runs").insert({
      source_id: sourceId, mode: "manual", status: "succeeded", finished_at: new Date().toISOString(),
      records_seen: recordCount, records_inserted: recordCount, records_updated: 0, records_skipped: 0,
    });
  } catch (e) { /* non-critical */ }
}

// Both return null/[] (not throw) when schema_v9 hasn't been run, so the UI
// can fall back to the built-in source list.
export async function loadDataSources() {
  const { data, error } = await supabase.from("data_sources").select("*").order("name");
  return error ? null : data;
}
export async function loadSyncRuns(limit = 200) {
  const { data, error } = await supabase.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(limit);
  return error ? [] : data;
}

export async function loadAllBatches() {
  const { data: batchRows, error: batchErr } = await supabase.from("batches").select("*").order("uploaded_at");
  if (batchErr) throw batchErr;
  if (batchRows.length === 0) return [];

  const batchIds = batchRows.map(b => b.id);
  const { data: itemRows, error: itemErr } = await supabase
    .from("line_items").select("*").in("batch_id", batchIds);
  if (itemErr) throw itemErr;
  const { data: suppRows, error: suppErr } = await supabase
    .from("supplemental_payments").select("*").in("batch_id", batchIds);
  if (suppErr) throw suppErr;

  // What each sheet printed (schema_v13). Absent table or no rows simply means no comparison for that week.
  const figuresByBatch = {};
  try {
    const { data: figRows, error: figErr } = await supabase.from("sheet_figures").select("*").in("batch_id", batchIds);
    if (!figErr) for (const r of figRows) (figuresByBatch[r.batch_id] ||= []).push({
      agentUsername: r.agent_username, commission: r.commission === null ? null : Number(r.commission), bonus: r.bonus === null ? null : Number(r.bonus),
      palliative: r.palliative === null ? null : Number(r.palliative), gift: r.gift === null ? null : Number(r.gift),
      totalEarnings: r.total_earnings === null ? null : Number(r.total_earnings),
    });
  } catch (e) { /* non-critical */ }
  const itemsByBatch = {}, suppByBatch = {};
  for (const row of itemRows) (itemsByBatch[row.batch_id] ||= []).push(itemFromDb(row));
  for (const row of suppRows) (suppByBatch[row.batch_id] ||= []).push(suppFromDb(row));

  return batchRows.map(b => ({
    id: b.id, type: b.type, filename: b.filename, uploadedAt: b.uploaded_at,
    sourceSystem: b.source_system || SOURCE_BY_TYPE[b.type] || null,
    // Old batches from before this feature have no period saved -- fall back to
    // the upload date so sorting/filtering still works, just less precisely.
    periodStart: b.period_start || b.uploaded_at?.slice(0, 10) || null,
    periodEnd: b.period_end || b.uploaded_at?.slice(0, 10) || null,
    items: itemsByBatch[b.id] || [], supplemental: suppByBatch[b.id] || [], sheetFigures: figuresByBatch[b.id] || [],
  }));
}

export async function deleteBatch(batchId) {
  // line_items and supplemental_payments cascade-delete via the foreign key.
  const { error } = await supabase.from("batches").delete().eq("id", batchId);
  if (error) throw error;
}

/* ============================================================ interventions */
export async function loadAllInterventions() {
  const [{ data: rows, error }, profiles] = await Promise.all([
    supabase.from("interventions").select("*").order("follow_up_date", { ascending: true, nullsFirst: false }),
    getAllProfiles(),
  ]);
  if (error) throw error;
  const nameById = {};
  for (const p of profiles) nameById[p.id] = p.name;
  return rows.map(r => interventionFromDb(r, nameById));
}

export async function saveIntervention(record, userId) {
  const { data, error } = await supabase.from("interventions").insert(interventionToDb(record, userId)).select().single();
  if (error) throw error;
  return data.id;
}
export async function updateInterventionStatus(id, status) {
  const { error } = await supabase.from("interventions").update({ status }).eq("id", id);
  if (error) throw error;
}
export async function deleteIntervention(id) {
  const { error } = await supabase.from("interventions").delete().eq("id", id);
  if (error) throw error;
}

/* ============================================================ commission rules */
export async function loadCommissionRules() {
  const { data, error } = await supabase.from("commission_rules").select("*").eq("active", true);
  if (error) throw error;
  // Reshape into the { sourceBlock: { basis, rate, confidence, override } } map the engine expects.
  const rules = {};
  for (const row of data) {
    rules[row.source_block] = { basis: row.basis, rate: Number(row.rate), confidence: row.confidence, override: !!row.override_source };
  }
  return { rules, rows: data };
}
export async function updateCommissionRule(id, patch, userId) {
  const { error } = await supabase.from("commission_rules")
    .update({ ...patch, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
export async function addCommissionRule(rule, userId) {
  const { error } = await supabase.from("commission_rules").insert({ ...rule, updated_by: userId });
  if (error) throw error;
}

/* ============================================================ agent commission plans */
function agentPlanFromDb(row, nameById) {
  return {
    id: row.id, agentUsername: row.agent_username, plan: row.plan, note: row.note,
    setBy: (nameById && nameById[row.set_by]) || "—", setAt: row.set_at,
  };
}
export async function loadAgentCommissionPlans() {
  const [{ data: rows, error }, profiles] = await Promise.all([
    supabase.from("agent_commission_plans").select("*").order("set_at", { ascending: false }),
    getAllProfiles(),
  ]);
  if (error) throw error;
  const nameById = {};
  for (const p of profiles) nameById[p.id] = p.name;
  return rows.map(r => agentPlanFromDb(r, nameById));
}
export async function setAgentCommissionPlan(agentUsername, plan, userId, note) {
  const { error } = await supabase.from("agent_commission_plans")
    .upsert({
      agent_username: agentUsername.toLowerCase(), plan, note: note || null,
      set_by: userId, set_at: new Date().toISOString(),
    }, { onConflict: "agent_username" });
  if (error) throw error;
}
export async function removeAgentCommissionPlan(agentUsername) {
  const { error } = await supabase.from("agent_commission_plans").delete().eq("agent_username", agentUsername.toLowerCase());
  if (error) throw error;
}

/* ============================================================ manual adjustments */
function adjustmentFromDb(row, nameById) {
  return {
    id: row.id, batchId: row.batch_id, agentUsername: row.agent_username, sourceBlock: row.source_block,
    originalCommission: row.original_commission === null ? null : Number(row.original_commission),
    adjustedCommission: Number(row.adjusted_commission), reason: row.reason,
    createdBy: (nameById && nameById[row.created_by]) || "—", createdAt: row.created_at,
  };
}
export async function loadAllAdjustments() {
  const [{ data: rows, error }, profiles] = await Promise.all([
    supabase.from("manual_adjustments").select("*").order("created_at", { ascending: false }),
    getAllProfiles(),
  ]);
  if (error) throw error;
  const nameById = {};
  for (const p of profiles) nameById[p.id] = p.name;
  return rows.map(r => adjustmentFromDb(r, nameById));
}
export async function addManualAdjustment(adj, userId) {
  // Upsert on the (batch, agent, block) unique index -- re-adjusting the same
  // line updates the existing correction rather than stacking an ambiguous
  // second one on top of it. Username is lowercased before writing, matching
  // how it's already used as the lookup key everywhere else in the engine.
  const { error } = await supabase.from("manual_adjustments")
    .upsert({
      batch_id: adj.batchId, agent_username: adj.agentUsername.toLowerCase(), source_block: adj.sourceBlock,
      original_commission: adj.originalCommission, adjusted_commission: adj.adjustedCommission,
      reason: adj.reason, created_by: userId, created_at: new Date().toISOString(),
    }, { onConflict: "batch_id,agent_username,source_block" });
  if (error) throw error;
}
export async function deleteManualAdjustment(id) {
  const { error } = await supabase.from("manual_adjustments").delete().eq("id", id);
  if (error) throw error;
}

/* ============================================================ activity log */
export async function logActivity(action, details, userId) {
  // Best-effort -- a logging failure should never block the actual action it's describing.
  try {
    await supabase.from("activity_log").insert({ actor_id: userId, action, details });
  } catch (e) {
    console.error("activity log write failed", e);
  }
}
export async function loadActivityLog(limit = 200) {
  const [{ data: rows, error }, profiles] = await Promise.all([
    supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(limit),
    getAllProfiles(),
  ]);
  if (error) throw error;
  const nameById = {};
  for (const p of profiles) nameById[p.id] = p.name;
  return rows.map(r => ({
    id: r.id, actorName: nameById[r.actor_id] || "—", action: r.action,
    details: r.details, createdAt: r.created_at,
  }));
}

/* ============================================================ live connectors */
// The browser's ONLY path to a backoffice: our Supabase Edge Function, with the
// user's own session. It never carries, receives or stores a backoffice
// credential, cookie or token -- those live as Edge Function secrets and are
// read server-side by the connector that owns them.
export async function listConnectors() {
  try {
    const { data, error } = await supabase.functions.invoke("sync-source", { body: { action: "list" } });
    if (error || !data || !Array.isArray(data.connectors)) return { reachable: false, connectors: null };
    return { reachable: true, connectors: data.connectors };
  } catch (e) {
    return { reachable: false, connectors: null };
  }
}

// body: { action: "test", source } | { action: "sync", source, mode, from, to }
export async function runConnectorAction(body) {
  const { data, error } = await supabase.functions.invoke("sync-source", { body });
  if (error) throw new Error(error.message || "The sync service did not respond.");
  return data;
}

/* ============================================================ review & adjust (schema_v12) */
// Corrections to Bonus / Palliative / Gift for one agent in one uploaded week, and the "this week has been
// reviewed" checkpoint. Reading degrades gracefully when schema_v12 hasn't been run: no corrections exist, and
// review tracking is reported as unavailable (null) so the UI says so instead of nagging about every week.
const v12Missing = (error) => error && (error.code === "42P01" || /does not exist|schema cache|could not find the table/i.test(error.message || ""));
const v12Help = "Review & Adjust needs schema_v12_review_and_overrides.sql to be run in Supabase first. Nothing was saved.";

function overrideFromDb(row, nameById) {
  return {
    id: row.id, batchId: row.batch_id, agentUsername: row.agent_username, field: row.field,
    originalValue: row.original_value === null ? null : Number(row.original_value), overrideValue: Number(row.override_value),
    reason: row.reason, createdBy: (nameById && nameById[row.created_by]) || "—", createdAt: row.created_at,
  };
}
export async function loadAllOverrides() {
  const [{ data: rows, error }, profiles] = await Promise.all([
    supabase.from("row_overrides").select("*").order("created_at", { ascending: false }),
    getAllProfiles(),
  ]);
  if (error) return [];
  const nameById = {};
  for (const p of profiles) nameById[p.id] = p.name;
  return rows.map(r => overrideFromDb(r, nameById));
}
export async function saveOverride(o, userId) {
  // One correction per agent, field and week: saving again updates it rather than stacking a second one.
  const { error } = await supabase.from("row_overrides").upsert({
    batch_id: o.batchId, agent_username: o.agentUsername.toLowerCase(), field: o.field,
    original_value: o.originalValue, override_value: o.overrideValue, reason: o.reason,
    created_by: userId, created_at: new Date().toISOString(),
  }, { onConflict: "batch_id,agent_username,field" });
  if (v12Missing(error)) throw new Error(v12Help);
  if (error) throw error;
}
export async function deleteOverride(id) {
  const { error } = await supabase.from("row_overrides").delete().eq("id", id);
  if (v12Missing(error)) throw new Error(v12Help);
  if (error) throw error;
}
export async function loadBatchReviews() {
  const [{ data: rows, error }, profiles] = await Promise.all([supabase.from("batch_reviews").select("*"), getAllProfiles()]);
  if (error) return null;   // null = review tracking isn't set up yet
  const nameById = {};
  for (const p of profiles) nameById[p.id] = p.name;
  return rows.map(r => ({ batchId: r.batch_id, reviewedBy: (nameById && nameById[r.reviewed_by]) || "—", reviewedAt: r.reviewed_at, note: r.note }));
}
export async function markBatchReviewed(batchId, userId, note) {
  const { error } = await supabase.from("batch_reviews").upsert(
    { batch_id: batchId, reviewed_by: userId, reviewed_at: new Date().toISOString(), note: note || null }, { onConflict: "batch_id" });
  if (v12Missing(error)) throw new Error(v12Help);
  if (error) throw error;
}
export async function unmarkBatchReviewed(batchId) {
  const { error } = await supabase.from("batch_reviews").delete().eq("batch_id", batchId);
  if (v12Missing(error)) throw new Error(v12Help);
  if (error) throw error;
}
