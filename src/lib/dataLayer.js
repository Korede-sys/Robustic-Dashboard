import { supabase } from "./supabaseClient";

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
  };
}
function itemFromDb(row) {
  return {
    agentUsername: row.agent_username, sourceBlock: row.source_block,
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
  const { data: batchRow, error } = await supabase
    .from("batches")
    .insert({ type: batch.type, filename: batch.filename, uploaded_by: userId })
    .select()
    .single();
  if (error) throw error;

  await insertChunked("line_items", batch.items.map(i => itemToDb(i, batchRow.id)));
  if (batch.supplemental.length > 0) {
    await insertChunked("supplemental_payments", batch.supplemental.map(s => suppToDb(s, batchRow.id)));
  }
  return { ...batch, id: batchRow.id, uploadedAt: batchRow.uploaded_at };
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

  const itemsByBatch = {}, suppByBatch = {};
  for (const row of itemRows) (itemsByBatch[row.batch_id] ||= []).push(itemFromDb(row));
  for (const row of suppRows) (suppByBatch[row.batch_id] ||= []).push(suppFromDb(row));

  return batchRows.map(b => ({
    id: b.id, type: b.type, filename: b.filename, uploadedAt: b.uploaded_at,
    items: itemsByBatch[b.id] || [], supplemental: suppByBatch[b.id] || [],
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
