// Source registry and helpers. Pure functions only -- no network, no React --
// so every rule here can be tested offline against real parsed files.
//
// Two separate dimensions, never mixed:
//   * BACKOFFICE (source): the system that provides the data. Stored per batch.
//   * PRODUCT: the betting product inside it (Luckyball, Luckygreek, Globalbet
//     Virtual, Sports, ...). Derived from the line item's source block and
//     stored in line_items.product. Reports filter on both at once.

export const INTEGRATION_TYPES = {
  official_api: "Official API",
  authorized_internal_api: "Authorized internal API",
  approved_export: "Approved export",
  csv_upload: "CSV / Excel upload",
  other_approved: "Other approved integration",
};

export const CONNECTION_STATUSES = [
  "Connected", "Not Connected", "Testing", "Syncing", "Sync Failed", "Disabled", "Requires Configuration",
];

// Backoffices (systems of record), as confirmed by the owner:
//   * Globalbet and Elbet are ORIGINAL sources (Elbet carries Luckyball,
//     Luckygreek and Rocket Man). Walify gets its reports from both.
//   * Walify is a REPORTING LAYER on top of them, not the original source of
//     any product. Its copies are for checking against the originals and must
//     never be added on top of them (that would double-count).
//   * Xpool is its own backoffice with its own product; it calculates and pays
//     commission itself.
// "AccessBet" is the business/brand, not a backoffice. `note` is shown on the
// Data Sources page and must stay true.
export const SOURCES = [
  { id: "globalbet", name: "Globalbet", url: "walify.virtual-horizon.com/engine/backoffice",
    note: "Original source for Globalbet sales (Walify feeds on it) and the source of truth used to pay commission and bonus. Data currently arrives by manual CSV upload." },
  { id: "elbet", name: "Elbet", url: "backoffice.accessbet.elbet.com",
    note: "Original source for Luckyball, Luckygreek and Rocket Man (Walify gets its reports from Elbet). The owner downloads these reports directly from the Elbet backoffice and uploads them as CSV. Automated access not yet assessed." },
  { id: "walify", name: "Walify", url: "shop.accessbet.com",
    note: "Reporting layer: gets reports from Elbet and Globalbet. Not the original source of any product, so nothing is attributed to it and its copies are for checking only. Access method not yet assessed." },
  { id: "xpool", name: "Xpool", url: "xpool.accessbet.com",
    note: "Separate backoffice with its own product (Xpool). It calculates and pays commission itself, inside Xpool (so its commission is reported, not payable by us). Per agent only. Needed: tickets, sales and commission as reported. Data arrives by manual CSV upload (Agent Breakdown export); no live connection." },
  { id: "other", name: "Other / unassigned", url: null,
    note: "Uploads whose backoffice isn't identified yet (currently the Sports files; no Sport backoffice exists yet)." },
];

// Which backoffice an uploaded file type is attributed to. Stored per batch,
// so correcting this later is a data update, not a code change. GB and EB
// are confirmed (Globalbet and Elbet are the original sources); SP has no
// identified backoffice yet.
export const SOURCE_BY_TYPE = { GB: "globalbet", EB: "elbet", EB_MB: "elbet", SP: "other", SP_MB: "other", XP: "xpool" };

export function sourceOfBatch(batch) {
  return batch.sourceSystem || SOURCE_BY_TYPE[batch.type] || null;
}

export function filterBatchesBySource(batches, sourceId) {
  if (!sourceId || sourceId === "all") return batches;
  return batches.filter(b => sourceOfBatch(b) === sourceId);
}

// What a source can actually provide, so the UI never offers a report the
// data can't back. For the CSV connector this is exactly what the files
// received so far contain -- every one is a pre-aggregated weekly total per
// agent: there are no individual tickets, transactions, wallets or daily rows.
export const CAPABILITIES = [
  { id: "agents", label: "Agents" },
  { id: "sales", label: "Sales / turnover" },
  { id: "commission", label: "Commission" },
  { id: "bonuses", label: "Bonuses" },
  { id: "ticket_counts", label: "Ticket counts" },
  { id: "tickets", label: "Ticket-level data" },
  { id: "transactions", label: "Transactions" },
  { id: "wallets", label: "Wallets" },
  { id: "daily", label: "Daily data" },
];
export const CSV_CAPABILITIES = {
  agents: true, sales: true, commission: true, bonuses: true, ticket_counts: true,
  tickets: false, transactions: false, wallets: false, daily: false,
};
export const NOT_AVAILABLE_MESSAGE =
  "This report is not available for the selected backoffice because the required data is not provided by this source.";

export function sourceProvides(capabilities, capabilityId) {
  return !!(capabilities && capabilities[capabilityId]);
}

// Live-connection status comes ONLY from live connector runs. A manual CSV upload
// is recorded as a run too but never counts: Connected requires a live sync that
// has actually RETRIEVED real data (records_seen > 0), so a connector that
// merely authenticates, or syncs an empty window, cannot show Connected.
// `via` (added by schema_v11) distinguishes the two; rows written before it
// existed are classed by mode (CSV uploads were always mode "manual").
const isLiveRun = (r) => (r.via ?? (r.mode === "manual" ? "csv_upload" : "connector")) === "connector";
export function liveConnectionStatus(runs, disabled = false) {
  if (disabled) return "Disabled";
  const live = (runs || []).filter(isLiveRun);
  if (live.length === 0) return "Not Connected";
  const latest = live[0]; // runs arrive newest-first
  if (latest.status === "running") return "Syncing";
  if (latest.status === "failed") return "Sync Failed";
  const gotRealData = live.some(r => (r.status === "succeeded" || r.status === "partial") && (r.records_seen || 0) > 0);
  return gotRealData ? "Connected" : "Not Connected";
}

// True when a Supabase insert failed only because schema_v9 hasn't been run,
// so uploads keep working instead of failing on an unknown column.
export function isMissingColumnError(error) {
  if (!error) return false;
  const text = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`;
  return error.code === "PGRST204" || error.code === "42703"
    || /source_system|integration_type|source_record_id|source_timestamp|synced_at|product|money_win|parent_username|source_agent_username|schema cache/i.test(text);
}
