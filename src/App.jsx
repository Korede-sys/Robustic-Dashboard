import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import {
  Upload, Download, CheckCircle2, AlertTriangle, ShieldCheck, ShieldAlert,
  FileSpreadsheet, History as HistoryIcon, BookOpen, X, Loader2, Trash2, LayoutGrid,
  Users, Package, MapPin, Search, ArrowUp, ArrowDown, Minus, Phone, ClipboardList, TrendingUp, Check, LogOut, UserCog,
  Sliders, Activity as ActivityIcon, Eye, ChevronDown,
} from "lucide-react";

import {
  PARSERS, detectFileType, detectPeriod, aggregateBatches, computeTrends, computeBatchSeries, toCSV,
  decodeAgent, productOf,
} from "./lib/engine-core";
import { parseCSV } from "./lib/csvparse";
import { can } from "./lib/permissions";
import {
  signIn, signOut, onAuthStateChange, getSession, getMyProfile, getAllProfiles, updateProfileRole,
  saveBatch, loadAllBatches, deleteBatch,
  loadAllInterventions, saveIntervention, updateInterventionStatus, deleteIntervention,
  loadCommissionRules, updateCommissionRule, addCommissionRule, logActivity, loadActivityLog,
  loadAllAdjustments, addManualAdjustment, deleteManualAdjustment,
} from "./lib/dataLayer";
import LoginScreen from "./LoginScreen";

/* ============================================================ design tokens */
const C = {
  // Light, enterprise-SaaS content area -- off-white page, pure-white cards.
  paper: "#F7F8FA", panel: "#FFFFFF", ink: "#0F1222", sub: "#6B7280", line: "#E6E8EE",
  // Semantic states, tuned for a light surface: green for confirmed/positive,
  // amber for tentative, red for mismatch/danger. Kept under the old names
  // (emerald/amber/brick) so existing call sites don't all need editing.
  emerald: "#067647", emeraldSoft: "#ECFDF3", amber: "#B54708", amberSoft: "#FFFAEB",
  brick: "#DC2626", brickSoft: "#FEF2F2",
  // "navy" is the primary-action/brand color -- indigo here, the one accent
  // used sparingly for active states and primary buttons.
  navy: "#4F46E5",
  // Sidebar is a distinct white surface with a border, not a colored/dark
  // rail -- active state reads via a soft indigo fill + indigo text.
  railBg: "#FFFFFF", railActiveBg: "#EEF0FF", railText: "#4B5165", railTextActive: "#4F46E5",
  stamp: "#4F46E5", stampSoft: "#EEF0FF",
};
const serif = { fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif", fontWeight: 800 };
const sans = { fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif" };
const mono = { fontFamily: "'IBM Plex Mono', 'SF Mono', Consolas, monospace" };
const nums = { fontVariantNumeric: "tabular-nums" };

const nairaShort = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const abs = Math.abs(n), sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}₦${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}₦${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}₦${(abs / 1_000).toFixed(0)}K`;
  return `${sign}₦${Math.round(abs)}`;
};
const naira = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return `${n < 0 ? "-" : ""}₦${Math.abs(Math.round(n)).toLocaleString("en-NG")}`;
};

const FILE_TYPE_LABELS = {
  GB: "Globalbet Virtual (weekly)", EB: "Luckyball & Luckygreek (weekly)",
  EB_MB: "Luckyball Monthly Bonus", SP: "Sports (weekly)", SP_MB: "Sport Monthly Bonus",
};

/* ============================================================ date-range filtering
   Batches carry periodStart/periodEnd (confirmed by the uploader at save time --
   see UploadTab). A batch is "in range" if its period overlaps the selected
   range at all, not just if it's fully contained -- a weekly file spanning a
   month boundary shouldn't vanish from either month's view. Batches with no
   period recorded (older data, or a period that was never confirmed) are left
   out of date-based selection entirely, since there's nothing to compare. */
function todayISO() { return toISODateLocal(new Date()); }
function toISODateLocal(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function addDaysISO(iso, n) { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return toISODateLocal(d); }
function startOfMonthISO(iso) { const d = new Date(iso + "T00:00:00"); return toISODateLocal(new Date(d.getFullYear(), d.getMonth(), 1)); }
function startOfWeekISO(iso) { const d = new Date(iso + "T00:00:00"); const dow = d.getDay(); const diff = dow === 0 ? 6 : dow - 1; return addDaysISO(iso, -diff); } // week starts Monday

const DATE_PRESETS = [
  { id: "all", label: "All time", range: () => null },
  { id: "week", label: "This week", range: () => { const t = todayISO(); return { start: startOfWeekISO(t), end: t }; } },
  { id: "month", label: "This month", range: () => { const t = todayISO(); return { start: startOfMonthISO(t), end: t }; } },
  { id: "4weeks", label: "Last 4 weeks", range: () => { const t = todayISO(); return { start: addDaysISO(t, -28), end: t }; } },
  { id: "custom", label: "Custom", range: null },
];

function batchesInRange(batches, start, end) {
  // Overlap test: batch.periodStart <= end AND batch.periodEnd >= start.
  return batches.filter(b => {
    if (!b.periodStart || !b.periodEnd) return false;
    return b.periodStart <= end && b.periodEnd >= start;
  });
}

/* ============================================================ report slicers
   Power-BI-style slicers for the Reports workspace ONLY -- filtered at the
   line-item level (not by re-slicing already-summed agent totals, which would
   be wrong for an agent active on more than one product) so per-product/state
   figures stay exactly as accurate as the unfiltered numbers. Clean Export,
   History, and everything else that touches what actually gets paid always
   uses the full, unsliced batches -- slicers never reach that path. */
function filterBatchesForSlicers(batches, { products, states, channels } = {}) {
  const noFilter = (!products || products.size === 0) && (!states || states.size === 0) && (!channels || channels.size === 0);
  if (noFilter) return batches;
  return batches.map(b => {
    const items = b.items.filter(item => {
      if (products && products.size > 0 && !products.has(productOf(item.sourceBlock))) return false;
      const meta = decodeAgent(item.agentUsername);
      if (states && states.size > 0 && !states.has(meta.stateName)) return false;
      if (channels && channels.size > 0 && !channels.has(meta.channel)) return false;
      return true;
    });
    // Supplemental payments (bonus/palliative/gift/monthly bonus) aren't tagged
    // with a product block, so product-slicing can't isolate them precisely --
    // keep them only when at least one item from this batch survived the
    // product filter. State/channel filtering IS precise for these, since they
    // carry their own agentUsername.
    const productPass = !products || products.size === 0 || items.length > 0;
    const supplemental = b.supplemental.filter(s => {
      if (!productPass) return false;
      const meta = decodeAgent(s.agentUsername);
      if (states && states.size > 0 && !states.has(meta.stateName)) return false;
      if (channels && channels.size > 0 && !channels.has(meta.channel)) return false;
      return true;
    });
    return { ...b, items, supplemental };
  });
}

// Triggers an actual browser download. toCSV() (from the shared engine) builds
// the CSV text; everything below is DOM-specific and belongs in the app, not
// in the engine module that also has to run outside a browser.
function downloadCSV(filename, rows, columns) {
  const text = toCSV(rows, columns);
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/* ============================================================ UI shell */
const ALL_NAV = [
  { id: "upload", label: "Upload & Process", icon: Upload, action: "upload", section: "Work" },
  { id: "reports", label: "Reports", icon: LayoutGrid, action: "view_reports", section: "Reporting" },
  { id: "lowactivity", label: "Needs Attention", icon: AlertTriangle, action: "manage_followups", section: "Operations" },
  { id: "followups", label: "Follow-ups", icon: ClipboardList, action: "manage_followups", section: "Operations" },
  { id: "export", label: "Clean Export", icon: Download, action: "export", section: "Operations" },
  { id: "history", label: "History", icon: HistoryIcon, action: "view_reports", section: "Operations" },
  { id: "rules", label: "Rules", icon: Sliders, action: "manage_rules", section: "Admin" },
  { id: "activity", label: "Activity", icon: ActivityIcon, action: "view_reports", section: "Admin" },
  { id: "users", label: "Team", icon: UserCog, action: "manage_users", section: "Admin" },
  { id: "formulas", label: "Formulas", icon: BookOpen, action: "view_reports", section: "Reference" },
];

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = not checked yet, null = no session
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [tab, setTab] = useState("reports");
  const [openNavGroup, setOpenNavGroup] = useState(null);
  const navRef = useRef(null);
  useEffect(() => {
    function onClickOutside(e) { if (navRef.current && !navRef.current.contains(e.target)) setOpenNavGroup(null); }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [interventions, setInterventions] = useState([]);
  const [callAgent, setCallAgent] = useState(null);
  const [rules, setRules] = useState({});
  const [ruleRows, setRuleRows] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const fileInputRef = useRef(null);

  // ---- auth: check session on load, react to sign-in/out ----
  useEffect(() => {
    let sub;
    (async () => {
      const s = await getSession();
      setSession(s);
      if (s) setProfile(await getMyProfile(s.user.id));
      setAuthLoading(false);
      sub = onAuthStateChange(async (newSession) => {
        setSession(newSession);
        setProfile(newSession ? await getMyProfile(newSession.user.id) : null);
      });
    })();
    return () => sub && sub.unsubscribe();
  }, []);

  // ---- data: load once we know who's signed in ----
  useEffect(() => {
    if (!session) return;
    (async () => {
      setLoading(true);
      const [loadedBatches, loadedInterventions, ruleData, loadedActivity, loadedAdjustments] = await Promise.all([
        loadAllBatches(),
        can(profile?.role, "manage_followups") ? loadAllInterventions() : Promise.resolve([]),
        // These tables are added by later migrations. If a migration hasn't been
        // run yet, fail gracefully to defaults instead of taking the whole app
        // down -- everything else still works, just without live rules (falls
        // back to the engine's built-in defaults), an activity history, or
        // manual adjustments yet.
        loadCommissionRules().catch(() => ({ rules: {}, rows: [] })),
        loadActivityLog().catch(() => []),
        loadAllAdjustments().catch(() => []),
      ]);
      setBatches(loadedBatches);
      setSelectedKeys(new Set(loadedBatches.map(b => b.id)));
      setInterventions(loadedInterventions);
      setRules(ruleData.rules);
      setRuleRows(ruleData.rows);
      setActivityLog(loadedActivity);
      setAdjustments(loadedAdjustments);
      setLoading(false);
    })();
  }, [session, profile?.role]);

  async function refreshActivity() {
    try { setActivityLog(await loadActivityLog()); } catch (e) { /* non-critical */ }
  }
  async function refreshAdjustments() {
    try { setAdjustments(await loadAllAdjustments()); } catch (e) { /* non-critical */ }
  }

  const [previewData, setPreviewData] = useState(null); // { parsedBatches, agg } once parsed, before saving

  async function parseAllPending() {
    setProcessing(true);
    const parsedBatches = [];
    for (const pf of pendingFiles) {
      if (!pf.detectedType) continue;
      const text = await pf.file.text();
      const rows = parseCSV(text);
      const { items, supplemental } = PARSERS[pf.detectedType](rows);
      const period = detectPeriod(pf.name, pf.detectedType, rows);
      parsedBatches.push({
        type: pf.detectedType, filename: pf.name, items, supplemental,
        periodStart: period.periodStart, periodEnd: period.periodEnd, periodConfidence: period.confidence,
      });
    }
    const agg = aggregateBatches(parsedBatches, rules);
    // Per-file, per-block item counts -- the direct way to spot a double-counting
    // bug before it becomes real data: a block with a suspiciously high count
    // relative to the others in the same file is exactly what caught the last one.
    const blockCounts = parsedBatches.map(b => {
      const counts = {};
      for (const item of b.items) counts[item.sourceBlock] = (counts[item.sourceBlock] || 0) + 1;
      return { filename: b.filename, type: b.type, counts, totalRows: b.items.length };
    });
    setPreviewData({ parsedBatches, agg, blockCounts });
    setProcessing(false);
  }

  async function confirmSave() {
    if (!previewData) return;
    setProcessing(true);
    const newBatches = [];
    for (const batch of previewData.parsedBatches) {
      const saved = await saveBatch(batch, session.user.id);
      newBatches.push(saved);
      await logActivity("upload", `Uploaded ${batch.filename} (${batch.items.length} rows)`, session.user.id);
    }
    setBatches(prev => {
      const merged = [...prev, ...newBatches];
      setSelectedKeys(new Set(merged.map(b => b.id)));
      return merged;
    });
    setPendingFiles([]);
    setPreviewData(null);
    setProcessing(false);
    setTab("reports");
    refreshActivity();
  }

  function cancelPreview() {
    setPreviewData(null);
  }

  const handleFiles = useCallback((fileList) => {
    const files = Array.from(fileList).map(f => ({
      file: f, name: f.name, detectedType: detectFileType(f.name), status: "pending",
    }));
    setPendingFiles(prev => [...prev, ...files]);
  }, []);

  async function removeBatch(b) {
    await deleteBatch(b.id);
    setBatches(prev => prev.filter(x => x.id !== b.id));
    setSelectedKeys(prev => { const next = new Set(prev); next.delete(b.id); return next; });
    await logActivity("delete_upload", `Deleted ${b.filename}`, session.user.id);
    refreshActivity();
  }

  async function logIntervention(record) {
    const id = await saveIntervention(record, session.user.id);
    setInterventions(prev => [...prev, { ...record, id, contactedBy: profile?.name || "—" }]);
    await logActivity("log_followup", `Logged a call with ${record.agentUsername}`, session.user.id);
    refreshActivity();
    return true;
  }
  async function handleUpdateInterventionStatus(record, status) {
    await updateInterventionStatus(record.id, status);
    setInterventions(prev => prev.map(i => i.id === record.id ? { ...i, status } : i));
    await logActivity(status === "resolved" ? "resolve_followup" : "reopen_followup", `${status === "resolved" ? "Resolved" : "Reopened"} follow-up for ${record.agentUsername}`, session.user.id);
    refreshActivity();
  }
  async function removeInterventionRecord(record) {
    await deleteIntervention(record.id);
    setInterventions(prev => prev.filter(i => i.id !== record.id));
    await logActivity("delete_followup", `Deleted follow-up for ${record.agentUsername}`, session.user.id);
    refreshActivity();
  }

  if (authLoading) {
    return <FullScreenMessage>Loading…</FullScreenMessage>;
  }
  if (!session) {
    return <LoginScreen onSignedIn={async () => { const s = await getSession(); setSession(s); }} />;
  }
  if (!profile) {
    return <FullScreenMessage>Setting up your profile…</FullScreenMessage>;
  }

  const NAV = ALL_NAV.filter(n => can(profile.role, n.action));
  const NAV_SECTIONS = [];
  for (const item of NAV) {
    let group = NAV_SECTIONS.find(g => g.section === item.section);
    if (!group) { group = { section: item.section, items: [] }; NAV_SECTIONS.push(group); }
    group.items.push(item);
  }
  const selectedBatches = batches.filter(b => selectedKeys.has(b.id));
  const agg = aggregateBatches(selectedBatches, rules, adjustments);
  const trends = computeTrends(batches);
  const series = computeBatchSeries(batches);

  return (
    <div style={{ background: C.paper, color: C.ink, minHeight: "100vh", display: "flex", ...sans }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap" />
      <style>{`
        input, select, textarea {
          background: ${C.panel}; color: ${C.ink}; border-color: ${C.line};
        }
        input::placeholder, textarea::placeholder { color: ${C.sub}; }
        input:focus, select:focus, textarea:focus { outline: 2px solid ${C.navy}22; border-color: ${C.navy}; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .lucide-loader-2 { animation: spin 0.8s linear infinite; }
        th {
          padding: 10px 12px; text-transform: uppercase; font-size: 10.5px; letter-spacing: .04em;
          font-weight: 700; color: ${C.sub}; text-align: left; border-bottom: 1px solid ${C.line};
          background: #FAFBFC; white-space: nowrap;
        }
        td { padding: 11px 12px; }
        table { border-collapse: collapse; width: 100%; }
        @media (max-width: 900px) {
          .app-sidebar { width: 72px !important; }
          .app-sidebar .nav-label-text, .app-sidebar .nav-section-label, .app-sidebar .nav-user-detail { display: none !important; }
        }
        @media (max-width: 640px) {
          .kpi-row { flex-wrap: wrap !important; }
          .kpi-row > div { min-width: calc(50% - 7px) !important; flex: none !important; }
        }
      `}</style>

      <nav aria-label="Main" className="app-sidebar" style={{
        width: 236, flexShrink: 0, background: C.railBg, borderRight: `1px solid ${C.line}`,
        display: "flex", flexDirection: "column", padding: "20px 14px", boxSizing: "border-box", height: "100vh",
        position: "sticky", top: 0, overflowY: "auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 10px 24px" }}>
          <RobusticMark />
          <span className="nav-label-text" style={{ ...serif, fontSize: 16, color: C.ink, letterSpacing: -0.3 }}>Robustic</span>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          {NAV_SECTIONS.map((group) => (
            <div key={group.section}>
              <div className="nav-section-label" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: "#A2A6B5", padding: "0 10px 6px", textTransform: "uppercase" }}>
                {group.section}
              </div>
              {group.items.map((n) => {
                const Icon = n.icon; const active = tab === n.id;
                return (
                  <button key={n.id} onClick={() => setTab(n.id)} title={n.label} style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px",
                    border: "none", background: active ? C.railActiveBg : "transparent",
                    color: active ? C.railTextActive : C.railText, borderRadius: 8, cursor: "pointer",
                    fontSize: 13.5, fontWeight: active ? 700 : 500, textAlign: "left", marginBottom: 2,
                  }}><Icon size={15} strokeWidth={2.2} style={{ flexShrink: 0 }} /><span className="nav-label-text">{n.label}</span></button>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{ paddingTop: 12, borderTop: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 999, background: C.stamp, display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0,
          }}>{profile.name?.[0]?.toUpperCase() || "?"}</div>
          <div className="nav-user-detail" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{profile.name}</div>
            <div style={{ fontSize: 10.5, color: C.sub, textTransform: "capitalize" }}>{profile.role}</div>
          </div>
          <button onClick={() => signOut()} title="Sign out" style={{
            border: "none", background: "transparent", color: C.sub, cursor: "pointer", padding: 4, display: "flex", flexShrink: 0,
          }}><LogOut size={15} /></button>
        </div>
      </nav>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{
          height: 60, flexShrink: 0, borderBottom: `1px solid ${C.line}`, background: C.panel,
          display: "flex", alignItems: "center", padding: "0 28px", justifyContent: "space-between", boxSizing: "border-box",
        }}>
          <div style={{ fontSize: 13, color: C.sub }}>
            {(NAV_SECTIONS.find(g => g.items.some(n => n.id === tab)) || {}).section}
            {" "}<span style={{ color: C.ink, fontWeight: 600 }}>/ {(ALL_NAV.find(n => n.id === tab) || {}).label}</span>
          </div>
          <div style={{ fontSize: 11.5, color: C.sub }}>{batches.length} file{batches.length !== 1 ? "s" : ""} uploaded</div>
        </div>

        <div style={{ flex: 1, padding: "26px 32px", maxWidth: 1520, width: "100%", boxSizing: "border-box" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.sub, fontSize: 14 }}>
            <Loader2 size={16} /> Loading saved history…
          </div>
        ) : (
          <>
            {tab === "upload" && can(profile.role, "upload") && (
              <UploadTab pendingFiles={pendingFiles} setPendingFiles={setPendingFiles} handleFiles={handleFiles}
                parseAllPending={parseAllPending} confirmSave={confirmSave} cancelPreview={cancelPreview}
                previewData={previewData} setPreviewData={setPreviewData} processing={processing} fileInputRef={fileInputRef} hasHistory={batches.length > 0} />
            )}
            {(tab === "lowactivity" || tab === "export") && batches.length > 0 && (
              <ReportFilters batches={batches} selectedKeys={selectedKeys} setSelectedKeys={setSelectedKeys} />
            )}
            {tab === "reports" && (
              <ReportsTab batches={batches} selectedKeys={selectedKeys} setSelectedKeys={setSelectedKeys}
                rules={rules} adjustments={adjustments} trends={trends} series={series} />
            )}
            {tab === "lowactivity" && can(profile.role, "manage_followups") && (
              <LowActivityTab agg={agg} trends={trends} onCall={setCallAgent} />
            )}
            {tab === "followups" && can(profile.role, "manage_followups") && (
              <FollowUpsTab interventions={interventions} updateStatus={handleUpdateInterventionStatus} removeIntervention={removeInterventionRecord} />
            )}
            {tab === "export" && can(profile.role, "export") && (
              <ExportTab agg={agg} canAdjust={can(profile.role, "manage_adjustments")} userId={session.user.id}
                refreshAdjustments={refreshAdjustments} logActivityFn={logActivity} />
            )}
            {tab === "history" && <HistoryTab batches={batches} removeBatch={can(profile.role, "delete_upload") ? removeBatch : null} />}
            {tab === "rules" && can(profile.role, "manage_rules") && (
              <RulesTab ruleRows={ruleRows} setRuleRows={setRuleRows} setRules={setRules} userId={session.user.id} logActivityFn={logActivity} refreshActivity={refreshActivity} batches={batches} />
            )}
            {tab === "activity" && <ActivityTab activityLog={activityLog} />}
            {tab === "users" && can(profile.role, "manage_users") && <UsersTab currentUserId={profile.id} refreshActivity={refreshActivity} />}
            {tab === "formulas" && <FormulasTab />}
          </>
        )}
        </div>
      </div>
      {callAgent && <CallModal agent={callAgent} onClose={() => setCallAgent(null)} onSave={logIntervention} />}
    </div>
  );
}

function RobusticMark() {
  // A stamp/ticket-perforation ring with an "R" monogram -- the one bold accent
  // color (rust stamp-red) used here as the brand mark, matching its only other
  // use: verification states, since a stamp is literally what this app produces.
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" style={{ flexShrink: 0 }}>
      <circle cx="17" cy="17" r="15.5" fill="none" stroke={C.stamp} strokeWidth="1.4" strokeDasharray="1.6 2.4" />
      <circle cx="17" cy="17" r="11.5" fill="none" stroke={C.railTextActive} strokeWidth="0.75" opacity="0.45" />
      <text x="17" y="22.5" textAnchor="middle" fontFamily="Fraunces, Georgia, serif" fontSize="14" fontWeight="600" fill={C.railTextActive}>R</text>
    </svg>
  );
}

function FullScreenMessage({ children }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: C.sub, background: C.paper, fontSize: 14, ...sans }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .lucide-loader-2 { animation: spin 0.8s linear infinite; }`}</style>
      <Loader2 size={16} />
      {children}
    </div>
  );
}
function ReportFilters({ batches, selectedKeys, setSelectedKeys }) {
  const [preset, setPreset] = useState("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showFiles, setShowFiles] = useState(false);

  const datedCount = batches.filter(b => b.periodStart && b.periodEnd).length;

  function applyPreset(id) {
    setPreset(id);
    if (id === "custom") return; // wait for both custom dates to be filled
    if (id === "all") { setSelectedKeys(new Set(batches.map(b => b.id))); return; }
    const def = DATE_PRESETS.find(p => p.id === id);
    const range = def.range();
    const matched = batchesInRange(batches, range.start, range.end);
    setSelectedKeys(new Set(matched.map(b => b.id)));
  }

  function applyCustom(start, end) {
    setCustomStart(start); setCustomEnd(end);
    if (start && end) setSelectedKeys(new Set(batchesInRange(batches, start, end).map(b => b.id)));
  }

  const toggleFile = (b) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      next.has(b.id) ? next.delete(b.id) : next.add(b.id);
      return next;
    });
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {DATE_PRESETS.map(p => (
          <button key={p.id} onClick={() => applyPreset(p.id)} style={{
            border: `1px solid ${preset === p.id ? C.emerald : C.line}`,
            background: preset === p.id ? C.emeraldSoft : "transparent",
            color: preset === p.id ? C.emerald : C.sub, padding: "6px 13px", fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}>{p.label}</button>
        ))}
        {preset === "custom" && (
          <span style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
            <input type="date" value={customStart} onChange={(e) => applyCustom(e.target.value, customEnd)}
              style={{ border: `1px solid ${C.line}`, padding: "5px 8px", fontSize: 12 }} />
            <span style={{ color: C.sub, fontSize: 12 }}>to</span>
            <input type="date" value={customEnd} onChange={(e) => applyCustom(customStart, e.target.value)}
              style={{ border: `1px solid ${C.line}`, padding: "5px 8px", fontSize: 12 }} />
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: C.sub }}>{selectedKeys.size} of {batches.length} file(s) included</span>
        <button onClick={() => setShowFiles(v => !v)} style={{ border: "none", background: "none", color: C.sub, fontSize: 11.5, cursor: "pointer", textDecoration: "underline" }}>
          {showFiles ? "Hide" : "Select files individually"}
        </button>
      </div>
      {datedCount < batches.length && (
        <div style={{ fontSize: 11.5, color: C.amber, marginTop: 6 }}>
          {batches.length - datedCount} file(s) have no confirmed reporting period, so date filters skip them — use "Select files individually" to include them.
        </div>
      )}
      {showFiles && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
          {batches.map(b => {
            const on = selectedKeys.has(b.id);
            return (
              <button key={b.id} onClick={() => toggleFile(b)} style={{
                border: `1px solid ${on ? C.emerald : C.line}`, background: on ? C.emeraldSoft : "transparent",
                color: on ? C.emerald : C.sub, padding: "5px 11px", fontSize: 11.5, cursor: "pointer",
              }}>{on ? <CheckCircle2 size={11} style={{ verticalAlign: -1, marginRight: 4 }} /> : null}{b.filename}</button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================ Upload tab */
function UploadTab({ pendingFiles, setPendingFiles, handleFiles, parseAllPending, confirmSave, cancelPreview, previewData, setPreviewData, processing, fileInputRef, hasHistory }) {
  const [dragOver, setDragOver] = useState(false);

  function updatePeriod(index, field, value) {
    setPreviewData(prev => {
      const parsedBatches = prev.parsedBatches.map((b, i) => i === index ? { ...b, [field]: value } : b);
      return { ...prev, parsedBatches };
    });
  }

  if (previewData) {
    const { agg, blockCounts, parsedBatches } = previewData;
    return (
      <>
        <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 20px" }}>Review before saving</h1>
        <Panel>
          <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5 }}>
            Nothing has been saved yet. Check these totals against the sheet's own numbers before confirming —
            this is the point where a parsing problem is cheap to catch, not after it's part of your reports.
          </div>
        </Panel>
        <Panel title="Reporting period">
          <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 12 }}>
            This is what drives date filters and trends — not when you upload, but the actual week/month this
            data covers. Confirm or correct it for each file below.
          </div>
          {parsedBatches.map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < parsedBatches.length - 1 ? `1px solid ${C.line}` : "none" }}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{b.filename}</div>
              <input type="date" value={b.periodStart || ""} onChange={(e) => updatePeriod(i, "periodStart", e.target.value)}
                style={{ border: `1px solid ${C.line}`, padding: "6px 8px", fontSize: 12.5 }} />
              <span style={{ color: C.sub, fontSize: 12 }}>to</span>
              <input type="date" value={b.periodEnd || ""} onChange={(e) => updatePeriod(i, "periodEnd", e.target.value)}
                style={{ border: `1px solid ${C.line}`, padding: "6px 8px", fontSize: 12.5 }} />
              <span style={{ fontSize: 11, color: b.periodConfidence?.includes("sheet") ? C.emerald : C.amber, whiteSpace: "nowrap" }}>
                {b.periodConfidence}
              </span>
            </div>
          ))}
        </Panel>
        <div className="kpi-row" style={{ display: "flex", gap: 14, marginBottom: 20 }}>
          <Kpi label="Agents" value={agg.agents.length} />
          <Kpi label="Total Stake" value={nairaShort(agg.totals.stake)} />
          <Kpi label="Total Commission" value={nairaShort(agg.totals.commission)} />
          <Kpi label="Total Bonus" value={nairaShort(agg.totals.monthlyBonus)} />
        </div>
        <Panel title="Rows parsed per block">
          {blockCounts.map((b, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{b.filename} <span style={{ color: C.sub, fontWeight: 400 }}>({b.totalRows} rows total)</span></div>
              {Object.entries(b.counts).map(([block, count]) => (
                <div key={block} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0 3px 12px", color: C.sub }}>
                  <span>{block}</span><span style={nums}>{count}</span>
                </div>
              ))}
            </div>
          ))}
        </Panel>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={cancelPreview} disabled={processing} style={{
            flex: 1, background: "transparent", color: C.sub, border: `1px solid ${C.line}`, padding: "11px 0",
            fontSize: 13.5, fontWeight: 600, cursor: "pointer",
          }}>Cancel</button>
          <button onClick={confirmSave} disabled={processing} style={{
            flex: 2, background: C.emerald, color: "#fff", borderRadius: 8, border: "none", padding: "11px 0",
            fontSize: 13.5, fontWeight: 600, cursor: processing ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: processing ? 0.7 : 1,
          }}>
            {processing ? <Loader2 size={15} /> : <>Looks right — confirm &amp; save <CheckCircle2 size={15} /></>}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 20px" }}>Upload &amp; Process</h1>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? C.emerald : C.line}`, background: dragOver ? C.emeraldSoft : C.panel,
          padding: "40px 20px", textAlign: "center", cursor: "pointer", marginBottom: 20,
        }}>
        <Upload size={22} color={C.sub} style={{ marginBottom: 10 }} />
        <div style={{ fontSize: 14, fontWeight: 600 }}>Drop this week's raw CSV exports here</div>
        <div style={{ fontSize: 12.5, color: C.sub, marginTop: 4 }}>
          Globalbet Virtual, Luckyball &amp; Luckygreek, Luckyball Monthly Bonus, Sports, Sport Monthly Bonus — any combination, any order
        </div>
        <input ref={fileInputRef} type="file" multiple accept=".csv" style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)} />
      </div>

      {pendingFiles.length > 0 && (
        <Panel title={`${pendingFiles.length} file(s) ready to process`}>
          {pendingFiles.map((pf, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.line}`, fontSize: 13 }}>
              <div>
                <div style={{ fontWeight: 500 }}>{pf.name}</div>
                <div style={{ fontSize: 11.5, color: pf.detectedType ? C.emerald : C.brick, marginTop: 2 }}>
                  {pf.detectedType ? `Detected: ${FILE_TYPE_LABELS[pf.detectedType]}` : "Couldn't detect file type — filename doesn't match a known pattern, skipping"}
                </div>
              </div>
              <button onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}
                style={{ border: "none", background: "none", cursor: "pointer", color: C.sub }}>
                <X size={15} />
              </button>
            </div>
          ))}
          <button onClick={parseAllPending} disabled={processing} style={{
            marginTop: 14, width: "100%", background: C.navy, color: "#fff", borderRadius: 8, border: "none",
            padding: "11px 0", fontSize: 13.5, fontWeight: 600, cursor: processing ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: processing ? 0.7 : 1,
          }}>
            {processing ? <><Loader2 size={15} /> Cleaning &amp; calculating…</> : <>Clean &amp; preview <Eye size={15} /></>}
          </button>
        </Panel>
      )}
      {!hasHistory && pendingFiles.length === 0 && (
        <div style={{ fontSize: 12.5, color: C.sub }}>Once you've processed your first files, the Overview, Agents, Products and States tabs turn into a real reporting dashboard built on your cleaned data.</div>
      )}
    </>
  );
}

/* ============================================================ Reporting helpers (shared by Overview) */
const CHANNEL_LABELS = { branch: "Branch", online: "Online", company_shop: "Company Shop", unknown: "Unassigned / House" };
function channelBreakdown(agents) {
  const byChannel = new Map();
  for (const a of agents) {
    const ch = a.channel || "unknown";
    if (!byChannel.has(ch)) byChannel.set(ch, { channel: ch, agents: 0, stake: 0, commission: 0 });
    const c = byChannel.get(ch);
    c.agents += 1; c.stake += a.stake || 0; c.commission += a.sourceCommission || 0;
  }
  return Array.from(byChannel.values()).sort((a, b) => b.stake - a.stake);
}
const CHANNEL_COLORS = { branch: C.emerald, online: C.amber, company_shop: C.navy, unknown: C.sub };
const TREND_LINE_COLORS = [C.emerald, C.amber, C.brick, C.navy, C.sub];

/* ============================================================ Reports (consolidated: Overview/Agents/Products/States/Trends) */
function SlicerGroup({ label, options, selected, onToggle, labels }) {
  if (!options || options.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", color: C.sub, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 340 }}>
        {options.map(opt => {
          const on = selected.has(opt);
          return (
            <button key={opt} onClick={() => onToggle(opt)} style={{
              padding: "4px 10px", border: `1px solid ${on ? C.emerald : C.line}`, background: on ? C.emeraldSoft : "transparent",
              color: on ? C.emerald : C.sub, fontSize: 11.5, cursor: "pointer",
            }}>{(labels && labels[opt]) || opt}</button>
          );
        })}
      </div>
    </div>
  );
}

const REPORT_VIEWS = [
  ["overview", "Overview"], ["agents", "Agents"], ["products", "Products"], ["states", "States"], ["trends", "Trends"],
];

function ReportsTab({ batches, selectedKeys, setSelectedKeys, rules, adjustments, trends, series }) {
  const [view, setView] = useState("overview");
  const [slicerProducts, setSlicerProducts] = useState(new Set());
  const [slicerStates, setSlicerStates] = useState(new Set());
  const [slicerChannels, setSlicerChannels] = useState(new Set());

  if (batches.length === 0) return <EmptyState />;

  const selectedBatches = batches.filter(b => selectedKeys.has(b.id));
  // Unsliced, date-filtered only -- drives the slicer option lists themselves,
  // so choosing a product doesn't make the other slicer's own options vanish.
  const dateOnlyAgg = aggregateBatches(selectedBatches, rules, adjustments);
  const slicedBatches = filterBatchesForSlicers(selectedBatches, { products: slicerProducts, states: slicerStates, channels: slicerChannels });
  const agg = aggregateBatches(slicedBatches, rules, adjustments);

  const toggleSetValue = (setter) => (value) => setter(prev => {
    const next = new Set(prev);
    next.has(value) ? next.delete(value) : next.add(value);
    return next;
  });
  const activeSlicerCount = slicerProducts.size + slicerStates.size + slicerChannels.size;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ ...serif, fontSize: 30, fontWeight: 500, margin: "0 0 10px" }}>Reports</h1>
        <div style={{ display: "flex", gap: 6 }}>
          {REPORT_VIEWS.map(([id, label]) => (
            <button key={id} onClick={() => setView(id)} style={{
              padding: "7px 16px", border: `1px solid ${view === id ? C.navy : C.line}`,
              background: view === id ? C.navy : C.panel, color: view === id ? "#fff" : C.sub,
              fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            }}>{label}</button>
          ))}
        </div>
      </div>

      <ReportFilters batches={batches} selectedKeys={selectedKeys} setSelectedKeys={setSelectedKeys} />

      <Panel>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: activeSlicerCount ? 12 : 0 }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <SlicerGroup label="Product" options={dateOnlyAgg.products.map(p => p.name)} selected={slicerProducts} onToggle={toggleSetValue(setSlicerProducts)} />
            <SlicerGroup label="State" options={dateOnlyAgg.states.map(s => s.state)} selected={slicerStates} onToggle={toggleSetValue(setSlicerStates)} />
            <SlicerGroup label="Channel" options={Object.keys(CHANNEL_LABELS)} labels={CHANNEL_LABELS} selected={slicerChannels} onToggle={toggleSetValue(setSlicerChannels)} />
          </div>
          {activeSlicerCount > 0 && (
            <button onClick={() => { setSlicerProducts(new Set()); setSlicerStates(new Set()); setSlicerChannels(new Set()); }}
              style={{ border: "none", background: "none", color: C.sub, fontSize: 11.5, cursor: "pointer", textDecoration: "underline", whiteSpace: "nowrap" }}>
              Clear filters ({activeSlicerCount})
            </button>
          )}
        </div>
      </Panel>

      {view === "overview" && <OverviewTab agg={agg} trends={trends} series={series} hasData={true} />}
      {view === "agents" && <AgentsTab agg={agg} trends={trends} />}
      {view === "products" && <ProductsTab agg={agg} />}
      {view === "states" && <StatesTab agg={agg} trends={trends} />}
      {view === "trends" && <TrendsTab series={series} />}
    </>
  );
}

/* ============================================================ Overview */
function OverviewTab({ agg, trends, series, hasData }) {
  if (!hasData) return <EmptyState />;
  const lossProducts = agg.products.filter(p => p.profit < 0);
  const topState = agg.states[0], topProduct = agg.products[0];
  const channels = channelBreakdown(agg.agents);
  const zeroCommissionOnline = agg.agents.filter(a => a.channel === "online" && (a.sourceCommission || 0) === 0).length;
  const trendTypes = series ? Object.keys(series).filter(t => series[t].length > 1) : [];
  return (
    <>
      <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 20px" }}>Overview</h1>
      <div className="kpi-row" style={{ display: "flex", gap: 14, marginBottom: 20 }}>
        <Kpi label="Total Stake" value={nairaShort(agg.totals.stake)} />
        <Kpi label="Total Payout" value={nairaShort(agg.totals.payout)} />
        <Kpi label="Net Profit" value={nairaShort(agg.totals.profit)} negative={agg.totals.profit < 0} />
        <Kpi label="Commission (per sheet)" value={nairaShort(agg.totals.commission)} />
      </div>

      {lossProducts.length > 0 && (
        <Panel>
          <div style={{ display: "flex", gap: 12 }}>
            <AlertTriangle size={18} color={C.brick} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
              <strong>{lossProducts.map(p => p.name).join(", ")}</strong> {lossProducts.length === 1 ? "is" : "are"} running a net loss
              this period — payouts exceeded stake by {nairaShort(Math.abs(lossProducts.reduce((s, p) => s + p.profit, 0)))}.
            </div>
          </div>
        </Panel>
      )}

      <Panel title="Sales by product">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={agg.products} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid stroke={C.line} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: C.sub }} axisLine={false} tickLine={false} tickFormatter={nairaShort} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: C.ink }} axisLine={false} tickLine={false} width={130} />
            <Tooltip formatter={(v) => naira(v)} contentStyle={{ fontSize: 12, border: `1px solid ${C.line}` }} />
            <Bar dataKey="stake" fill={C.emerald} barSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <div style={{ display: "flex", gap: 20, marginBottom: 20 }}>
        <Panel title="By channel" style={{ flex: 1 }}>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={channels} dataKey="stake" nameKey="channel" innerRadius={38} outerRadius={62} paddingAngle={2}>
                {channels.map((c) => <Cell key={c.channel} fill={CHANNEL_COLORS[c.channel] || C.sub} />)}
              </Pie>
              <Tooltip formatter={(v) => naira(v)} contentStyle={{ fontSize: 12, border: `1px solid ${C.line}` }} />
            </PieChart>
          </ResponsiveContainer>
          {channels.map(c => (
            <div key={c.channel} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12.5, borderBottom: `1px solid ${C.line}` }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: CHANNEL_COLORS[c.channel] || C.sub, display: "inline-block" }} />
                {CHANNEL_LABELS[c.channel] || c.channel} <span style={{ color: C.sub }}>({c.agents})</span>
              </span>
              <span style={{ ...nums, fontWeight: 600 }}>{nairaShort(c.stake)}</span>
            </div>
          ))}
          {zeroCommissionOnline > 0 && (
            <div style={{ fontSize: 11.5, color: C.brick, marginTop: 8, display: "flex", gap: 6 }}>
              <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              {zeroCommissionOnline} online agent(s) showing ₦0 commission this period — see Formulas tab for the known issue.
            </div>
          )}
        </Panel>
        <Panel title="Top Agents" style={{ flex: 1 }}>
          {agg.agents.slice(0, 5).map(a => (
            <div key={a.username} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", fontSize: 13, borderBottom: `1px solid ${C.line}` }}>
              <span>#{a.rank} {a.username}</span>
              <TrendBadge username={a.username} trends={trends} />
            </div>
          ))}
        </Panel>
        <Panel title="At a Glance" style={{ flex: 1 }}>
          {[
            ["Agents with activity", agg.agents.length],
            ["Top state", topState ? `${topState.state} (${nairaShort(topState.stake)})` : "—"],
            ["Top product", topProduct ? `${topProduct.name} (${nairaShort(topProduct.stake)})` : "—"],
            ["Trend data available", trends.hasEnoughData ? "Yes — 2+ weeks uploaded" : "Not yet — upload a 2nd week of the same product"],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", fontSize: 13, borderBottom: `1px solid ${C.line}` }}>
              <span style={{ color: C.sub }}>{k}</span>
              <span style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
            </div>
          ))}
        </Panel>
      </div>

      {trendTypes.length > 0 && (
        <Panel title="Stake over time" right={<span style={{ fontSize: 11.5, color: C.sub }}>by product, across all uploaded periods</span>}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart margin={{ left: 4 }}>
              <CartesianGrid stroke={C.line} vertical={false} />
              <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} tick={{ fontSize: 11, fill: C.sub }} axisLine={{ stroke: C.line }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: C.sub }} axisLine={false} tickLine={false} tickFormatter={nairaShort} />
              <Tooltip formatter={(v) => naira(v)} contentStyle={{ fontSize: 12, border: `1px solid ${C.line}` }} />
              {trendTypes.map((type, i) => (
                <Line key={type} data={series[type]} dataKey="stake" name={PRODUCT_LABELS[type] || type}
                  type="monotone" stroke={TREND_LINE_COLORS[i % TREND_LINE_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      )}
    </>
  );
}

function TrendBadge({ username, trends }) {
  const t = trends.agentTrend[username.toLowerCase()];
  if (!t || t.deltaPct === null || t.deltaPct === undefined) return <span style={{ ...nums, color: C.sub, fontSize: 12 }}>—</span>;
  const up = t.deltaPct >= 0;
  const flat = Math.abs(t.deltaPct) < 0.5;
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown;
  const color = flat ? C.sub : up ? C.emerald : C.brick;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color, fontSize: 12, ...nums }}>
      <Icon size={11} /> {Math.abs(t.deltaPct).toFixed(1)}%
    </span>
  );
}

function EmptyState({ title = "Nothing here yet", description = "Head to Upload & Process to bring in your first sheet.", icon: Icon = FileSpreadsheet }) {
  return (
    <Panel>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "36px 20px", textAlign: "center" }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12, background: C.stampSoft, display: "flex",
          alignItems: "center", justifyContent: "center", marginBottom: 14,
        }}>
          <Icon size={22} color={C.navy} strokeWidth={1.75} />
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: C.sub, maxWidth: 340, lineHeight: 1.5 }}>{description}</div>
      </div>
    </Panel>
  );
}

/* ============================================================ Agents */
function AgentsTab({ agg, trends }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() =>
    agg.agents.filter(a => a.username.toLowerCase().includes(q.toLowerCase()) || a.state.toLowerCase().includes(q.toLowerCase())),
    [q, agg.agents]);
  const { sorted, sortKey, sortDir, toggleSort } = useSort(filtered, "stake", "desc");
  if (agg.agents.length === 0) return <EmptyState />;
  const dash = (v) => v === null || v === undefined ? "—" : naira(v);
  return (
    <>
      <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 20px" }}>Agent Breakdown</h1>
      <Panel title={`${agg.agents.length} agents with activity`} right={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.line}`, padding: "4px 8px" }}>
            <Search size={13} color={C.sub} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agent or state"
              style={{ border: "none", outline: "none", fontSize: 12.5, width: 160, background: "transparent" }} />
          </div>
          <button onClick={() => downloadCSV("robustic_agent_breakdown.csv", sorted, [
            { label: "Rank", get: a => a.rank }, { label: "Agent", get: a => a.username }, { label: "State", get: a => a.state },
            { label: "Channel", get: a => a.channel }, { label: "Products", get: a => a.products.join("; ") },
            { label: "Tickets", get: a => Math.round(a.tickets) },
            { label: "Stake", get: a => a.stake.toFixed(2) }, { label: "Avg Stake", get: a => a.avgStake !== null ? a.avgStake.toFixed(2) : "" },
            { label: "Payout", get: a => a.payout.toFixed(2) }, { label: "Profit", get: a => a.profit.toFixed(2) },
            { label: "Commission", get: a => a.sourceCommission.toFixed(2) },
            { label: "Bonus", get: a => a.bonus ? a.bonus.toFixed(2) : "" }, { label: "Palliative", get: a => a.palliative ? a.palliative.toFixed(2) : "" },
            { label: "Gift", get: a => a.gift ? a.gift.toFixed(2) : "" }, { label: "Monthly Bonus", get: a => a.monthlyBonus.toFixed(2) },
            { label: "Total Earnings", get: a => a.totalEarnings !== null ? a.totalEarnings.toFixed(2) : "" },
            { label: "Balance", get: a => a.balance !== null ? a.balance.toFixed(2) : "" },
            { label: "Formula Verified", get: a => a.allVerified ? "Yes" : "Check mismatch" },
            { label: "Manually Adjusted", get: a => a.hasAdjustment ? "Yes" : "" },
          ])} style={{
            display: "flex", alignItems: "center", gap: 6, border: "none", background: C.emerald, color: "#fff", borderRadius: 8,
            padding: "7px 13px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
          }}><Download size={13} /> Export CSV</button>
        </div>
      }>
        <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 10 }}>
          Bonus/Palliative/Gift/Avg Stake/Total Earnings are Globalbet-specific — shown as "—" for other products.
          Commission already reflects the confirmed uplift where one applies, so it doesn't need its own separate column.
        </div>
        <div style={{ maxHeight: 560, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1280 }}>
            <thead style={{ position: "sticky", top: 0, background: C.panel }}>
              <tr style={{ textAlign: "left", color: C.sub, fontSize: 11.5 }}>
                <th>Rank</th>
                <SortableTh label="Agent" field="username" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="State" field="state" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Stake" field="stake" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Avg Stake" field="avgStake" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Payout" field="payout" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Profit" field="profit" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Commission" field="sourceCommission" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Bonus" field="bonus" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Palliative" field="palliative" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Gift" field="gift" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Total Earnings" field="totalEarnings" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th>Trend</th>
                <th>Products</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 150).map(a => (
                <tr key={a.username}>
                  <td style={{ padding: "8px", borderBottom: `1px solid ${C.line}`, color: C.sub }}>#{a.rank}</td>
                  <td style={{ ...mono, padding: "8px", borderBottom: `1px solid ${C.line}`, fontWeight: 500, fontSize: 12.5, whiteSpace: "nowrap" }}>{a.username}</td>
                  <td style={{ padding: "8px", borderBottom: `1px solid ${C.line}`, color: C.sub }}>{a.state}</td>
                  <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}` }}>{naira(a.stake)}</td>
                  <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}`, color: C.sub }}>{dash(a.avgStake)}</td>
                  <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}` }}>{naira(a.payout)}</td>
                  <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}`, color: a.profit < 0 ? C.brick : C.ink }}>{naira(a.profit)}</td>
                  <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}` }}>{naira(a.sourceCommission)}</td>
                  <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}`, color: C.sub }}>{a.bonus ? naira(a.bonus) : "—"}</td>
                  <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}`, color: C.sub }}>{a.palliative ? naira(a.palliative) : "—"}</td>
                  <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}`, color: C.sub }}>{a.gift ? naira(a.gift) : "—"}</td>
                  <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}`, fontWeight: 600 }}>{dash(a.totalEarnings)}</td>
                  <td style={{ padding: "8px", borderBottom: `1px solid ${C.line}` }}><TrendBadge username={a.username} trends={trends} /></td>
                  <td style={{ padding: "8px", borderBottom: `1px solid ${C.line}`, color: C.sub, fontSize: 11.5, whiteSpace: "nowrap" }}>{a.products.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 150 && <div style={{ fontSize: 12, color: C.sub, marginTop: 10 }}>Showing first 150 of {filtered.length} — refine your search to narrow further.</div>}
      </Panel>
    </>
  );
}

/* ============================================================ Products */
const PIE_COLORS = [C.emerald, C.amber, C.navy, C.sub, "#7A8B99"];
function ProductsTab({ agg }) {
  const { sorted, sortKey, sortDir, toggleSort } = useSort(agg.products, "stake", "desc");
  if (agg.products.length === 0) return <EmptyState />;
  return (
    <>
      <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 20px" }}>Product Performance</h1>
      <div style={{ display: "flex", gap: 20 }}>
        <Panel title="Share of stake by product" style={{ flex: 1 }}>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={agg.products} dataKey="stake" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {agg.products.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => naira(v)} contentStyle={{ fontSize: 12, border: `1px solid ${C.line}` }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Product performance" style={{ flex: 1.4 }}>
          {agg.products.map((p, i) => (
            <div key={p.name} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span>{p.name}</span><span style={nums}>{nairaShort(p.stake)}</span>
              </div>
              <div style={{ background: C.line, height: 6, marginBottom: 4 }}>
                <div style={{ width: `${Math.min(100, (p.stake / agg.products[0].stake) * 100)}%`, background: PIE_COLORS[i % PIE_COLORS.length], height: 6 }} />
              </div>
              <div style={{ fontSize: 11.5, color: p.profit < 0 ? C.brick : C.sub }}>
                Profit: {naira(p.profit)} {p.profit < 0 && "(payouts exceeded stake)"} · Commission: {naira(p.commission)}
              </div>
            </div>
          ))}
        </Panel>
      </div>

      <Panel title="All products — full detail" right={
        <button onClick={() => downloadCSV("robustic_product_breakdown.csv", sorted, [
          { label: "Product", get: p => p.name }, { label: "Agents", get: p => p.agentCount },
          { label: "Tickets", get: p => Math.round(p.tickets) }, { label: "Stake", get: p => p.stake.toFixed(2) },
          { label: "Payout", get: p => p.payout.toFixed(2) }, { label: "Profit", get: p => p.profit.toFixed(2) },
          { label: "Commission", get: p => p.commission.toFixed(2) },
        ])} style={{
          display: "flex", alignItems: "center", gap: 6, border: "none", background: C.emerald, color: "#fff", borderRadius: 8,
          padding: "7px 13px", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}><Download size={13} /> Export CSV</button>
      }>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: C.sub, fontSize: 11.5 }}>
              <SortableTh label="Product" field="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortableTh label="Agents" field="agentCount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortableTh label="Tickets" field="tickets" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortableTh label="Stake" field="stake" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortableTh label="Payout" field="payout" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortableTh label="Profit" field="profit" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortableTh label="Commission" field="commission" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => (
              <tr key={p.name}>
                <td style={{ padding: "8px", borderBottom: `1px solid ${C.line}`, fontWeight: 500 }}>{p.name}</td>
                <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}` }}>{p.agentCount}</td>
                <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}` }}>{Math.round(p.tickets).toLocaleString()}</td>
                <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}` }}>{naira(p.stake)}</td>
                <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}` }}>{naira(p.payout)}</td>
                <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}`, color: p.profit < 0 ? C.brick : C.ink }}>{naira(p.profit)}</td>
                <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}`, fontWeight: 600 }}>{naira(p.commission)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

/* ============================================================ States */
function StatesTab({ agg, trends }) {
  const withAvg = agg.states.map(s => ({ ...s, avgPerAgent: s.stake / Math.max(1, s.agentCount) }));
  const { sorted, sortKey, sortDir, toggleSort } = useSort(withAvg, "stake", "desc");
  if (agg.states.length === 0) return <EmptyState />;
  return (
    <>
      <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 20px" }}>State Performance</h1>
      <Panel title="All states — click a column to sort" right={
        <button onClick={() => downloadCSV("robustic_state_breakdown.csv", sorted, [
          { label: "State", get: s => s.state }, { label: "Agents", get: s => s.agentCount },
          { label: "Stake", get: s => s.stake.toFixed(2) }, { label: "Payout", get: s => s.payout.toFixed(2) },
          { label: "Profit", get: s => s.profit.toFixed(2) }, { label: "Avg per Agent", get: s => s.avgPerAgent.toFixed(2) },
          { label: "Commission", get: s => s.commission.toFixed(2) },
        ])} style={{
          display: "flex", alignItems: "center", gap: 6, border: "none", background: C.emerald, color: "#fff", borderRadius: 8,
          padding: "7px 13px", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}><Download size={13} /> Export CSV</button>
      }>
        <div style={{ maxHeight: 560, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ position: "sticky", top: 0, background: C.panel }}>
              <tr style={{ textAlign: "left", color: C.sub, fontSize: 11.5 }}>
                <SortableTh label="State" field="state" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Agents" field="agentCount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Stake" field="stake" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Payout" field="payout" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Profit" field="profit" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Avg / agent" field="avgPerAgent" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh label="Commission" field="commission" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(s => {
                const t = trends.stateTrend[s.state];
                return (
                  <tr key={s.state}>
                    <td style={{ padding: "8px", borderBottom: `1px solid ${C.line}`, fontWeight: 500 }}>{s.state}</td>
                    <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}` }}>{s.agentCount}</td>
                    <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}` }}>{naira(s.stake)}</td>
                    <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}` }}>{naira(s.payout)}</td>
                    <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}`, color: s.profit < 0 ? C.brick : C.ink }}>{naira(s.profit)}</td>
                    <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}` }}>{naira(s.avgPerAgent)}</td>
                    <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}` }}>{naira(s.commission)}</td>
                    <td style={{ padding: "8px", borderBottom: `1px solid ${C.line}` }}>
                      {t && t.deltaPct !== null && t.deltaPct !== undefined ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, ...nums, color: Math.abs(t.deltaPct) < 0.5 ? C.sub : (t.deltaPct > 0 ? C.emerald : C.brick) }}>
                          {Math.abs(t.deltaPct) < 0.5 ? <Minus size={11} /> : (t.deltaPct > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                          {Math.abs(t.deltaPct).toFixed(1)}%
                        </span>
                      ) : <span style={{ ...nums, color: C.sub, fontSize: 12 }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/* ============================================================ Needs Attention */
function LowActivityTab({ agg, trends, onCall }) {
  if (agg.agents.length === 0) return <EmptyState />;
  const active = agg.agents.filter(a => a.stake > 0);
  let list;
  if (trends.hasEnoughData) {
    list = active.filter(a => {
      const t = trends.agentTrend[a.username.toLowerCase()];
      return t && t.deltaPct !== null && t.deltaPct <= -30;
    }).sort((a, b) => trends.agentTrend[a.username.toLowerCase()].deltaPct - trends.agentTrend[b.username.toLowerCase()].deltaPct);
  } else {
    const threshold = active.length ? [...active].sort((a, b) => a.stake - b.stake)[Math.floor(active.length * 0.1)].stake : 0;
    list = active.filter(a => a.stake <= threshold).sort((a, b) => a.stake - b.stake);
  }
  return (
    <>
      <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 20px" }}>Needs Attention</h1>
      <Panel>
        <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5 }}>
          {trends.hasEnoughData
            ? "Showing agents down 30% or more vs. their previous upload of the same product — real period-over-period comparison."
            : "Only one upload per product so far, so there's no trend to compare against yet. Showing the bottom 10% of active agents by stake this period instead — upload a second week of the same product to unlock real decline tracking."}
        </div>
      </Panel>
      <Panel title={`${list.length} agent(s) flagged`}>
        {list.slice(0, 60).map(a => {
          const t = trends.agentTrend[a.username.toLowerCase()];
          return (
            <div key={a.username} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 14px", borderLeft: `3px solid ${C.amber}`, background: C.amberSoft, marginBottom: 8,
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{a.username} <span style={{ color: C.sub, fontWeight: 400 }}>· {a.state}</span></div>
                <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>
                  Stake: {naira(a.stake)} · {Math.round(a.tickets)} tickets · {a.products.join(", ")}
                  {t && t.deltaPct !== null && <> · <span style={{ color: C.brick, fontWeight: 600 }}>{t.deltaPct.toFixed(1)}% vs prior period</span></>}
                </div>
              </div>
              <button onClick={() => onCall(a)} style={{
                display: "flex", alignItems: "center", gap: 6, border: "none", background: C.navy, color: "#fff", borderRadius: 8,
                padding: "7px 14px", fontSize: 12.5, cursor: "pointer", flexShrink: 0,
              }}>
                <Phone size={13} /> Log call
              </button>
            </div>
          );
        })}
      </Panel>
    </>
  );
}

/* ============================================================ Trends */
const PRODUCT_LABELS = {
  GB: "Globalbet Virtual", EB: "Luckyball & Luckygreek", EB_MB: "Luckyball Monthly Bonus",
  SP: "Sports (weekly)", SP_MB: "Sport Monthly Bonus",
};
function TrendsTab({ series }) {
  const [metric, setMetric] = useState("stake");
  const types = Object.keys(series).filter(t => series[t].length > 0);
  if (types.length === 0) return <><h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 20px" }}>Trends</h1><EmptyState /></>;
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 }}>
        <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: 0 }}>Trends</h1>
        <div style={{ display: "flex", border: `1px solid ${C.line}`, overflow: "hidden" }}>
          {["stake", "profit", "commission"].map(m => (
            <button key={m} onClick={() => setMetric(m)} style={{
              padding: "6px 14px", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 500, textTransform: "capitalize",
              background: metric === m ? C.navy : "transparent", color: metric === m ? "#fff" : C.sub,
            }}>{m}</button>
          ))}
        </div>
      </div>
      {types.map(type => {
        const data = series[type];
        return (
          <Panel key={type} title={PRODUCT_LABELS[type] || type} right={
            <span style={{ fontSize: 11.5, color: C.sub }}>{data.length} upload{data.length !== 1 ? "s" : ""}</span>
          }>
            {data.length < 2 ? (
              <div style={{ fontSize: 13, color: C.sub }}>Only one upload so far for this product — upload another week to see a trend line here.</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data}>
                  <CartesianGrid stroke={C.line} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: C.sub }} axisLine={{ stroke: C.line }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: C.sub }} axisLine={false} tickLine={false} tickFormatter={nairaShort} />
                  <Tooltip formatter={(v) => naira(v)} labelFormatter={(l, p) => p && p[0] ? p[0].payload.filename : l} contentStyle={{ fontSize: 12, border: `1px solid ${C.line}` }} />
                  <Line type="monotone" dataKey={metric} stroke={metric === "profit" ? C.navy : C.emerald} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Panel>
        );
      })}
    </>
  );
}

/* ============================================================ Call log modal */
function CallModal({ agent, onClose, onSave }) {
  const [form, setForm] = useState({ reason: "", agentFeedback: "", actionRequired: "", followUpDate: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm(prev => ({ ...prev, [k]: e.target.value }));

  async function handleSave() {
    setSaving(true);
    const record = {
      id: `${Date.now()}`, agentUsername: agent.username, agentState: agent.state,
      contactedAt: new Date().toISOString(), status: "open", ...form,
    };
    await onSave(record);
    setSaving(false);
    onClose();
  }

  const fields = [
    ["reason", "Reason for low activity"],
    ["agentFeedback", "Agent feedback"], ["actionRequired", "Action required"],
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,23,31,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
      <div style={{ background: C.panel, width: 440, border: `1px solid ${C.line}`, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Log call — {agent.username}</div>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={16} /></button>
        </div>
        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 14 }}>
            {agent.state} · Stake this period {naira(agent.stake)} · {Math.round(agent.tickets)} tickets
          </div>
          {fields.map(([key, label], i) => (
            <div key={key} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ width: 16, height: 16, borderRadius: "50%", background: C.navy, color: "#fff", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                {label}
              </div>
              <input value={form[key]} onChange={set(key)} style={{ width: "100%", border: `1px solid ${C.line}`, padding: "7px 9px", fontSize: 13, boxSizing: "border-box" }} />
            </div>
          ))}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ width: 16, height: 16, borderRadius: "50%", background: C.navy, color: "#fff", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>4</span>
              Follow-up date
            </div>
            <input type="date" value={form.followUpDate} onChange={set("followUpDate")} style={{ width: "100%", border: `1px solid ${C.line}`, padding: "7px 9px", fontSize: 13, boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 4 }}>Internal notes</div>
            <textarea value={form.notes} onChange={set("notes")} rows={2} style={{ width: "100%", border: `1px solid ${C.line}`, padding: "7px 9px", fontSize: 13, boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }} />
          </div>
          <button onClick={handleSave} disabled={saving} style={{
            width: "100%", background: C.navy, color: "#fff", borderRadius: 8, border: "none", padding: "10px 0", fontSize: 13,
            fontWeight: 600, cursor: saving ? "default" : "pointer", display: "flex", alignItems: "center",
            justifyContent: "center", gap: 6, opacity: saving ? 0.7 : 1,
          }}>
            {saving ? <Loader2 size={14} /> : <>Save intervention <CheckCircle2 size={14} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ Follow-ups */
function FollowUpsTab({ interventions, updateStatus, removeIntervention }) {
  const [filter, setFilter] = useState("open");
  const list = interventions
    .filter(i => filter === "all" || i.status === filter)
    .sort((a, b) => (a.followUpDate || "9999").localeCompare(b.followUpDate || "9999"));
  const openCount = interventions.filter(i => i.status === "open").length;

  if (interventions.length === 0) {
    return (
      <>
        <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 20px" }}>Follow-ups</h1>
        <Panel><div style={{ fontSize: 13.5, color: C.sub }}>No calls logged yet — log one from the Needs Attention tab.</div></Panel>
      </>
    );
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 }}>
        <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: 0 }}>Follow-ups</h1>
        <div style={{ display: "flex", border: `1px solid ${C.line}`, overflow: "hidden" }}>
          {["open", "resolved", "all"].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: "6px 14px", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 500, textTransform: "capitalize",
              background: filter === f ? C.navy : "transparent", color: filter === f ? "#fff" : C.sub,
            }}>{f}</button>
          ))}
        </div>
      </div>
      <Panel title={`${list.length} record(s)`} right={<span style={{ fontSize: 11.5, color: C.sub }}>{openCount} open overall</span>}>
        {list.map(rec => {
          const overdue = rec.status === "open" && rec.followUpDate && rec.followUpDate < new Date().toISOString().slice(0, 10);
          return (
            <div key={rec.id} style={{
              padding: "12px 14px", marginBottom: 8,
              borderLeft: `3px solid ${rec.status === "open" ? (overdue ? C.brick : C.amber) : C.emerald}`,
              background: rec.status === "open" ? (overdue ? C.brickSoft : C.amberSoft) : C.emeraldSoft,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {rec.agentUsername} <span style={{ color: C.sub, fontWeight: 400 }}>· {rec.agentState}</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>
                    Logged {new Date(rec.contactedAt).toLocaleDateString()} by {rec.contactedBy || "—"}
                    {rec.followUpDate && <> · Follow up {rec.followUpDate}{overdue && <strong style={{ color: C.brick }}> (overdue)</strong>}</>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {rec.status === "open" && (
                    <button onClick={() => updateStatus(rec, "resolved")} style={{ border: `1px solid ${C.line}`, background: C.panel, color: C.ink, padding: "5px 10px", fontSize: 11.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                      <Check size={12} /> Resolve
                    </button>
                  )}
                  <button onClick={() => removeIntervention(rec)} style={{ border: "none", background: "none", cursor: "pointer", color: C.sub }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {rec.reason && <div style={{ fontSize: 12.5, marginTop: 6 }}><strong>Reason:</strong> {rec.reason}</div>}
              {rec.agentFeedback && <div style={{ fontSize: 12.5, marginTop: 3 }}><strong>Feedback:</strong> {rec.agentFeedback}</div>}
              {rec.actionRequired && <div style={{ fontSize: 12.5, marginTop: 3 }}><strong>Action:</strong> {rec.actionRequired}</div>}
              {rec.notes && <div style={{ fontSize: 12, color: C.sub, marginTop: 3 }}>{rec.notes}</div>}
            </div>
          );
        })}
      </Panel>
    </>
  );
}

/* ============================================================ Clean Export */
function AdjustmentModal({ mismatch, onClose, onSave }) {
  const [amount, setAmount] = useState(String(mismatch.calculated ?? ""));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave() {
    setError(null);
    const value = parseFloat(amount);
    if (isNaN(value) || value < 0) { setError("Enter a valid amount."); return; }
    if (!reason.trim()) { setError("A reason is required — this becomes part of the audit trail."); return; }
    setSaving(true);
    try {
      await onSave({ adjustedCommission: value, reason: reason.trim() });
      onClose();
    } catch (e) {
      setError(e.message || "Couldn't save this adjustment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,23,31,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
      <div style={{ background: C.panel, width: 460, border: `1px solid ${C.line}`, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Adjust — {mismatch.agent}</div>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={16} /></button>
        </div>
        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 14, lineHeight: 1.5 }}>
            {mismatch.block} ({mismatch.type || "no type"}) — sheet shows <strong>{naira(mismatch.source)}</strong>,
            formula suggests <strong>{naira(mismatch.calculated)}</strong>. This corrects only this one agent, this one
            line, for this one period — it doesn't change the rule or anyone else's numbers.
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 4 }}>Corrected commission (₦)</div>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
              style={{ width: "100%", border: `1px solid ${C.line}`, padding: "7px 9px", fontSize: 13, boxSizing: "border-box", ...nums }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 4 }}>Reason (required — kept for audit)</div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="e.g. Sheet showed ₦0 despite real stake — confirmed data error, correcting to 7% formula value"
              style={{ width: "100%", border: `1px solid ${C.line}`, padding: "7px 9px", fontSize: 13, boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }} />
          </div>
          {error && <div style={{ fontSize: 12, color: C.brick, marginBottom: 12 }}>{error}</div>}
          <button onClick={handleSave} disabled={saving} style={{
            width: "100%", background: C.navy, color: "#fff", borderRadius: 8, border: "none", padding: "10px 0", fontSize: 13,
            fontWeight: 600, cursor: saving ? "default" : "pointer", display: "flex", alignItems: "center",
            justifyContent: "center", gap: 6, opacity: saving ? 0.7 : 1,
          }}>
            {saving ? <Loader2 size={14} /> : <>Save adjustment <CheckCircle2 size={14} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExportTab({ agg, canAdjust, userId, refreshAdjustments, logActivityFn }) {
  const [adjusting, setAdjusting] = useState(null); // the mismatch being adjusted, or null
  const [removingId, setRemovingId] = useState(null);

  async function handleSaveAdjustment({ adjustedCommission, reason }) {
    await addManualAdjustment({
      batchId: adjusting.batchId, agentUsername: adjusting.agent, sourceBlock: adjusting.block,
      originalCommission: adjusting.source, adjustedCommission, reason,
    }, userId);
    await logActivityFn("manual_adjustment",
      `Adjusted ${adjusting.agent} (${adjusting.block}) from ${naira(adjusting.source)} to ${naira(adjustedCommission)} — ${reason}`,
      userId);
    await refreshAdjustments();
  }
  async function handleRemoveAdjustment(adj) {
    if (!adj.id) return;
    setRemovingId(adj.id);
    try {
      await deleteManualAdjustment(adj.id);
      await logActivityFn("manual_adjustment", `Removed adjustment for ${adj.agent} (${adj.block}) — reverted to sheet value`, userId);
      await refreshAdjustments();
    } finally {
      setRemovingId(null);
    }
  }

  if (agg.agents.length === 0) return <EmptyState />;
  return (
    <>
      <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 20px" }}>Clean Export</h1>
      <Panel>
        <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5 }}>
          This is the cleaned data for the period selected above, using each agent's own commission and bonus figures
          exactly as they appear in the source sheet — that's the number that gets paid. The formula shown on the
          Formulas tab is kept only as a cross-check to catch data-entry errors, not to override what's on the sheet.
          Download this and pay from your own systems — this dashboard only prepares the numbers, it doesn't move any money.
        </div>
      </Panel>

      {agg.stats.mismatchCount > 0 && (
        <Panel>
          <div style={{ display: "flex", gap: 12 }}>
            <AlertTriangle size={18} color={C.amber} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13, color: C.sub }}>
              {agg.stats.mismatchCount} line item(s) don't match the formula that fits the rest of their tier — the
              sheet's value is still what's used and exported below, this is just a flag worth a second look, not
              an error correction.
              {" "}{agg.stats.verifiedCount} matched the formula cleanly, {agg.stats.unverifiedCount} have no
              independently-derived formula to check against (source value used, as always).
              {agg.stats.adjustedCount > 0 && <> {agg.stats.adjustedCount} were manually corrected — see below.</>}
            </div>
          </div>
        </Panel>
      )}

      <Panel title={`${agg.agents.length} agents — clean data ready`} right={
        <button onClick={() => downloadCSV("robustic_clean_export.csv", agg.agents, [
          { label: "Agent", get: a => a.username }, { label: "State", get: a => a.state },
          { label: "Products", get: a => a.products.join("; ") },
          { label: "Tickets", get: a => Math.round(a.tickets) },
          { label: "Stake", get: a => a.stake.toFixed(2) }, { label: "Payout", get: a => a.payout.toFixed(2) },
          { label: "Profit", get: a => a.profit.toFixed(2) },
          { label: "Commission (per sheet — payable)", get: a => a.sourceCommission.toFixed(2) },
          { label: "Commission (formula check)", get: a => a.calcCommission.toFixed(2) },
          { label: "Monthly Bonus", get: a => a.monthlyBonus.toFixed(2) },
          { label: "Total", get: a => (a.sourceCommission + a.monthlyBonus).toFixed(2) },
          { label: "Formula Verified", get: a => a.allVerified ? "Yes" : "Check mismatch" },
          { label: "Manually Adjusted", get: a => a.hasAdjustment ? "Yes" : "" },
          { label: "Bonus", get: a => a.bonus ? a.bonus.toFixed(2) : "" },
          { label: "Palliative", get: a => a.palliative ? a.palliative.toFixed(2) : "" },
          { label: "Gift", get: a => a.gift ? a.gift.toFixed(2) : "" },
          { label: "Total Earnings (Globalbet only)", get: a => a.totalEarnings !== null ? a.totalEarnings.toFixed(2) : "" },
          { label: "Balance (Globalbet only)", get: a => a.balance !== null ? a.balance.toFixed(2) : "" },
          { label: "Avg Stake (Globalbet only)", get: a => a.avgStake !== null ? a.avgStake.toFixed(2) : "" },
        ])} style={{
          display: "flex", alignItems: "center", gap: 6, border: "none", background: C.emerald, color: "#fff", borderRadius: 8,
          padding: "7px 14px", fontSize: 12.5, cursor: "pointer",
        }}><Download size={13} /> Download CSV</button>
      }>
        <div style={{ maxHeight: 480, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ position: "sticky", top: 0, background: C.panel }}>
              <tr style={{ textAlign: "left", color: C.sub, fontSize: 11.5 }}>
                {["Agent", "State", "Stake", "Commission", "Bonus", "Total", ""].map(h => (
                  <th key={h} style={{ padding: "6px 8px", borderBottom: `1px solid ${C.line}`, fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agg.agents.slice(0, 200).map(a => (
                <tr key={a.username}>
                  <td style={{ ...mono, padding: "8px", borderBottom: `1px solid ${C.line}`, fontWeight: 500, fontSize: 12.5 }}>{a.username}</td>
                  <td style={{ padding: "8px", borderBottom: `1px solid ${C.line}`, color: C.sub }}>{a.state}</td>
                  <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}` }}>{naira(a.stake)}</td>
                  <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}` }}>{naira(a.sourceCommission)}</td>
                  <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}` }}>{a.monthlyBonus ? naira(a.monthlyBonus) : "—"}</td>
                  <td style={{ ...nums, padding: "8px", borderBottom: `1px solid ${C.line}`, fontWeight: 600 }}>{naira(a.sourceCommission + a.monthlyBonus)}</td>
                  <td style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {a.hasAdjustment ? <StatusBadge tone="amber">Adjusted</StatusBadge>
                      : a.allVerified ? <StatusBadge tone="green">Verified</StatusBadge>
                      : <StatusBadge tone="red">Check mismatch</StatusBadge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {agg.adjustments.length > 0 && (
        <Panel title="Manual adjustments applied">
          {agg.adjustments.map((adj, i) => (
            <div key={i} style={{ fontSize: 12.5, padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div>
                  <strong style={{ color: C.ink }}>{adj.agent}</strong>
                  <span style={{ color: C.sub }}> — {adj.block}: {naira(adj.original)} → <strong>{naira(adj.adjusted)}</strong></span>
                  <div style={{ color: C.sub, marginTop: 2 }}>{adj.reason}</div>
                  <div style={{ color: C.sub, fontSize: 11, marginTop: 2 }}>
                    {adj.createdBy}{adj.createdAt ? ` · ${new Date(adj.createdAt).toLocaleDateString()}` : ""}
                  </div>
                </div>
                {canAdjust && adj.id && (
                  <button onClick={() => handleRemoveAdjustment(adj)} disabled={removingId === adj.id}
                    style={{ border: "none", background: "none", color: C.sub, cursor: "pointer", flexShrink: 0 }}>
                    {removingId === adj.id ? <Loader2 size={13} /> : <Trash2 size={13} />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </Panel>
      )}

      {agg.mismatches.length > 0 && (
        <Panel title="Formula mismatches">
          {agg.mismatches.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 12.5, padding: "7px 0", borderBottom: `1px solid ${C.line}`, color: C.sub }}>
              <div>
                <strong style={{ color: C.ink }}>{m.agent}</strong> — {m.block} ({m.type || "no type"}): source {naira(m.source)} vs calculated {naira(m.calculated)} ({m.diffPct !== null ? `${m.diffPct.toFixed(1)}%` : ""})
              </div>
              {canAdjust && (
                <button onClick={() => setAdjusting(m)} style={{
                  border: `1px solid ${C.line}`, background: C.panel, color: C.ink, padding: "4px 10px", fontSize: 11.5,
                  cursor: "pointer", flexShrink: 0,
                }}>Adjust</button>
              )}
            </div>
          ))}
        </Panel>
      )}

      {adjusting && (
        <AdjustmentModal mismatch={adjusting} onClose={() => setAdjusting(null)} onSave={handleSaveAdjustment} />
      )}
    </>
  );
}

/* ============================================================ History */
function HistoryTab({ batches, removeBatch }) {
  return (
    <>
      <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 20px" }}>Upload History</h1>
      <Panel title={`${batches.length} file(s) saved`}>
        {batches.length === 0 && <div style={{ fontSize: 13, color: C.sub }}>Nothing uploaded yet.</div>}
        {[...batches].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)).map((b) => (
          <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}`, fontSize: 13 }}>
            <div>
              <div style={{ fontWeight: 500 }}>{b.filename}</div>
              <div style={{ fontSize: 11.5, color: C.sub }}>{FILE_TYPE_LABELS[b.type]} · {new Date(b.uploadedAt).toLocaleString()} · {b.items.length} rows</div>
            </div>
            {removeBatch && (
              <button onClick={() => removeBatch(b)} style={{ border: "none", background: "none", cursor: "pointer", color: C.brick }}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </Panel>
    </>
  );
}

/* ============================================================ Formulas */
function FormulasTab() {
  const rows = [
    { block: "Luckyball / Luckygreek / Rocket Man (weekly)", formula: "Per-agent Type field: sale(X%) → X% of stake; profit(X%) → X% of profit", status: "confirmed", note: "Zero variance against every sampled agent" },
    { block: "Luckyball Monthly Bonus", formula: "Same Type-based rule as above", status: "confirmed", note: "Zero variance" },
    { block: "Globalbet Virtual — 40%-tier agents", formula: "40% of profit — value read from Block A's own commission column", status: "confirmed", note: "Zero variance, independently verified against real agent rows" },
    { block: "Globalbet Virtual — UP-10%-tier agents", formula: "Selections-per-ticket sliding scale (4%–10% of stake), calculated by AccessBET's own system — value read from the tier block's own commission column, NOT Block A", status: "external", note: "Verified exactly: for 290 real agents across two separate weeks, this tier's commission + bonus + palliative + gift equals the sheet's own Total Earnings figure to the cent, zero exceptions. (A first attempt at this fix read the wrong column and silently changed nothing -- caught by testing against Total Earnings instead of just comparing two commission columns to each other.)" },
    { block: "Sports — 35% tier", formula: "35% of profit", status: "confirmed", note: "Zero variance on every row with positive profit" },
    { block: "Sports — POOL tier", formula: "15% of profit", status: "tentative", note: "Only 3 samples — treat as provisional" },
    { block: "Sports — UP-30% tier", formula: "Selections-per-ticket sliding scale (1%–30% of profit) + a monthly bonus (30% of monthly profit minus that month's commissions), calculated by AccessBET's own system", status: "external", note: "Structure partially confirmed: about 1 in 5 tested agents matched an allowed percentage almost exactly, but some agents showed ratios above the stated 30% maximum — worth checking with the platform. Selections-per-ticket isn't in this export, so this can't be independently re-derived here; the sheet's own commission value is trusted as-is." },
    { block: "Sports — 3rd Party tier", formula: "Not yet confirmed", status: "unverified", note: "Empty in every upload until the week of 15-09-2026, which had its first single agent — still too little data to test a formula against" },
    { block: "Sports base block", formula: "Deliberately not used as a line item", status: "confirmed", note: "Reconciles exactly to the report's own grand total once the house row is excluded — it's left out specifically because it re-lists the same agents already captured via the 35%/UP-30%/3rd Party/Pool tiers, and including both would double-count every agent" },
    { block: "Sport Monthly Bonus — base", formula: "Settled/stake/payout/profit/commission read directly", status: "confirmed", note: "Reconciles exactly to the report's own grand total once the 000 ONLINE house row is excluded" },
    { block: "Sport Monthly Bonus — tier sections (ABOVE 100 TICKETS, etc.)", formula: "Bonus read directly from the M.BONUS column", status: "confirmed", note: "These sections re-list the same agents' base numbers verbatim for tier categorization — only their bonus figure is used, to avoid double-counting stake already counted in the base block" },
  ];
  const badge = (status) => {
    const map = {
      confirmed: [C.emerald, C.emeraldSoft, <ShieldCheck size={13} />],
      external: [C.stamp, C.amberSoft, <ShieldCheck size={13} />],
      tentative: [C.amber, C.amberSoft, <AlertTriangle size={13} />],
      unverified: [C.amber, C.amberSoft, <AlertTriangle size={13} />],
      excluded: [C.brick, C.brickSoft, <ShieldAlert size={13} />],
    };
    const [color, bg, icon] = map[status];
    const label = status === "external" ? "Calculated externally" : status;
    return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color, background: bg, padding: "2px 8px", fontSize: 11, fontWeight: 600, textTransform: "capitalize" }}>{icon}{label}</span>;
  };
  return (
    <>
      <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 20px" }}>Formula Reference</h1>
      <Panel title="What the system calculates, and how confident it is">
        {rows.map((r, i) => (
          <div key={i} style={{ padding: "12px 0", borderBottom: i < rows.length - 1 ? `1px solid ${C.line}` : "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{r.block}</span>
              {badge(r.status)}
            </div>
            <div style={{ fontSize: 13, color: C.ink }}>{r.formula}</div>
            <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{r.note}</div>
          </div>
        ))}
      </Panel>
      <Panel title="Two patterns worth a closer look">
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 3 }}>Two branch agents paid exactly +10% above formula</div>
          <div style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.5 }}>
            0120fc-gwa-tonybet1 and 0120ni-taf-tonybet2 (both profit(50%) type on Luckyball) were paid exactly 10% more
            than the formula produces — consistent both times, not random. Possibly an undocumented bonus tier
            (matches the "UP-10%" label seen in Globalbet Virtual) rather than an error.
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 3 }}>Online-channel agents show ₦0 commission</div>
          <div style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.5 }}>
            Every "elb-" (online) agent checked carries a real Type and real profit/stake, but the source commission
            column reads ₦0. Systematic across the whole online channel — worth confirming whether online agents
            are paid through a separate mechanism, or whether this is a real payroll gap.
          </div>
        </div>
      </Panel>
    </>
  );
}

/* ============================================================ shared pieces */
/* ============================================================ Team (admin only) */
const ROLE_DESCRIPTIONS = {
  admin: "Full access, including managing the team",
  finance: "Upload, export, view reports, manage follow-ups",
  manager: "View reports, manage follow-ups -- no upload or export",
  viewer: "Read-only access to reports",
};

/* ============================================================ Rules (admin only) */
function RulesTab({ ruleRows, setRuleRows, setRules, userId, logActivityFn, refreshActivity, batches }) {
  const [editing, setEditing] = useState({}); // id -> { rate, override }
  const [saving, setSaving] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRule, setNewRule] = useState({ source_block: "", label: "", basis: "profit", rate: "", override_source: false });
  const [addError, setAddError] = useState(null);
  const [adding, setAdding] = useState(false);

  // Reference helper: every block currently in the system, and for Type-based
  // blocks, the actual Type strings seen in uploaded data -- so an admin adding
  // a targeted rule can copy the exact key rather than guessing at it.
  const knownBlocks = new Set();
  const typesByBlock = {};
  for (const b of batches) {
    for (const item of b.items) {
      knownBlocks.add(item.sourceBlock);
      if (item.commissionType) {
        (typesByBlock[item.sourceBlock] ||= new Set()).add(item.commissionType);
      }
    }
  }

  function startEdit(rule) {
    setEditing(prev => ({ ...prev, [rule.id]: { rate: String(Math.round(rule.rate * 1000) / 10), override: rule.override_source } }));
  }
  function cancelEdit(id) {
    setEditing(prev => { const next = { ...prev }; delete next[id]; return next; });
  }
  async function saveEdit(rule) {
    const draft = editing[rule.id];
    const pct = parseFloat(draft.rate);
    if (isNaN(pct) || pct < 0 || pct > 100) return;
    const newRate = pct / 100;
    setSaving(prev => ({ ...prev, [rule.id]: true }));
    try {
      await updateCommissionRule(rule.id, { rate: newRate, override_source: draft.override }, userId);
      const updatedRow = { ...rule, rate: newRate, override_source: draft.override };
      setRuleRows(prev => prev.map(r => r.id === rule.id ? updatedRow : r));
      setRules(prev => ({ ...prev, [rule.source_block]: { basis: rule.basis, rate: newRate, confidence: rule.confidence, override: draft.override } }));
      const changeDesc = draft.override
        ? `Set ${rule.label} to ${pct}% and turned override ON -- this now determines what's exported`
        : `Set ${rule.label} to ${pct}% (audit-check only)`;
      await logActivityFn("update_rule", changeDesc, userId);
      refreshActivity();
      cancelEdit(rule.id);
    } finally {
      setSaving(prev => { const next = { ...prev }; delete next[rule.id]; return next; });
    }
  }

  async function submitNewRule() {
    setAddError(null);
    const pct = parseFloat(newRule.rate);
    if (!newRule.source_block.trim()) { setAddError("Rule key is required."); return; }
    if (!newRule.label.trim()) { setAddError("Label is required."); return; }
    if (isNaN(pct) || pct < 0 || pct > 100) { setAddError("Rate must be a number between 0 and 100."); return; }
    setAdding(true);
    try {
      const rate = pct / 100;
      await addCommissionRule({
        source_block: newRule.source_block.trim(), label: newRule.label.trim(),
        basis: newRule.basis, rate, confidence: "custom", override_source: newRule.override_source,
      }, userId);
      const { rules: freshRules, rows: freshRows } = await loadCommissionRules();
      setRules(freshRules);
      setRuleRows(freshRows);
      await logActivityFn("update_rule", `Added new rule "${newRule.label}" (${newRule.source_block}, ${pct}%${newRule.override_source ? ", override ON" : ""})`, userId);
      refreshActivity();
      setNewRule({ source_block: "", label: "", basis: "profit", rate: "", override_source: false });
      setShowAddForm(false);
    } catch (e) {
      setAddError(e.message || "Couldn't save this rule.");
    } finally {
      setAdding(false);
    }
  }

  const activeOverrides = ruleRows.filter(r => r.override_source);

  return (
    <>
      <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 20px" }}>Commission Rules</h1>
      <Panel>
        <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5 }}>
          Every rule has an <strong>Override</strong> switch, off by default. <strong>Off</strong>: the rule is just
          a cross-check against the sheet's own commission — it flags disagreement, never changes what's paid.
          <strong> On</strong>: the calculated value from this rule replaces the sheet's value for this
          product/tier in every report and export, starting immediately. Use this when a rate has genuinely
          changed and the sheet you're uploading doesn't reflect it yet.
        </div>
      </Panel>

      {activeOverrides.length > 0 && (
        <Panel>
          <div style={{ display: "flex", gap: 12 }}>
            <AlertTriangle size={18} color={C.stamp} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13, color: C.ink }}>
              <strong>{activeOverrides.length} rule(s) are currently overriding the sheet:</strong>{" "}
              {activeOverrides.map(r => r.label).join(", ")}. These are actively changing what gets exported.
            </div>
          </div>
        </Panel>
      )}

      <Panel title={`${ruleRows.length} rule(s)`} right={
        <button onClick={() => setShowAddForm(v => !v)} style={{ border: `1px solid ${C.line}`, background: "none", padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
          {showAddForm ? "Cancel" : "+ Add rule"}
        </button>
      }>
        {showAddForm && (
          <div style={{ border: `1px solid ${C.line}`, padding: 14, marginBottom: 16, background: C.paper }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 3 }}>Rule key (source block, optionally ::Type)</div>
                <input value={newRule.source_block} onChange={(e) => setNewRule(p => ({ ...p, source_block: e.target.value }))}
                  placeholder="e.g. GB:BLOCK_A or EB:LUCKYBALL::profit (50%)"
                  style={{ ...mono, width: "100%", border: `1px solid ${C.line}`, padding: "7px 9px", fontSize: 12, boxSizing: "border-box" }} />
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 3 }}>Label</div>
                <input value={newRule.label} onChange={(e) => setNewRule(p => ({ ...p, label: e.target.value }))}
                  style={{ width: "100%", border: `1px solid ${C.line}`, padding: "7px 9px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 3 }}>Basis</div>
                <select value={newRule.basis} onChange={(e) => setNewRule(p => ({ ...p, basis: e.target.value }))}
                  style={{ width: "100%", border: `1px solid ${C.line}`, padding: "7px 9px", fontSize: 13 }}>
                  <option value="profit">profit</option>
                  <option value="stake">stake</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 3 }}>Rate (%)</div>
                <input type="number" value={newRule.rate} onChange={(e) => setNewRule(p => ({ ...p, rate: e.target.value }))}
                  style={{ width: "100%", border: `1px solid ${C.line}`, padding: "7px 9px", fontSize: 13, boxSizing: "border-box" }} />
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={newRule.override_source} onChange={(e) => setNewRule(p => ({ ...p, override_source: e.target.checked }))} />
              Turn override ON immediately (this rate will replace the sheet's value on save)
            </label>
            {addError && <div style={{ color: C.brick, fontSize: 12, marginBottom: 8 }}>{addError}</div>}
            <button onClick={submitNewRule} disabled={adding} style={{ border: "none", background: C.navy, color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 12.5, cursor: "pointer" }}>
              {adding ? <Loader2 size={13} /> : "Save rule"}
            </button>

            {Object.keys(typesByBlock).length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
                <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 6 }}>Types seen in your uploaded data (copy the exact key to target one):</div>
                {Object.entries(typesByBlock).map(([block, types]) => (
                  <div key={block} style={{ fontSize: 11.5, marginBottom: 3 }}>
                    <span style={{ ...mono, color: C.ink }}>{block}</span>:{" "}
                    {Array.from(types).map(t => <span key={t} style={{ ...mono, color: C.sub, marginRight: 8 }}>{block}::{t}</span>)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {ruleRows.map(rule => {
          const isEditing = rule.id in editing;
          const draft = editing[rule.id];
          return (
            <div key={rule.id} style={{
              padding: "12px 0", borderBottom: `1px solid ${C.line}`,
              borderLeft: rule.override_source ? `3px solid ${C.stamp}` : "3px solid transparent", paddingLeft: 10,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{rule.label}</div>
                  <div style={{ ...mono, fontSize: 11, color: C.sub, marginTop: 2 }}>
                    {rule.source_block} · basis: {rule.basis} · {rule.confidence}
                  </div>
                </div>
                {isEditing ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="number" value={draft.rate} onChange={(e) => setEditing(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], rate: e.target.value } }))}
                      style={{ width: 70, border: `1px solid ${C.line}`, padding: "6px 8px", fontSize: 13 }} />
                    <span style={{ fontSize: 13, color: C.sub }}>%</span>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: C.sub, cursor: "pointer" }}>
                      <input type="checkbox" checked={draft.override} onChange={(e) => setEditing(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], override: e.target.checked } }))} />
                      Override
                    </label>
                    <button onClick={() => saveEdit(rule)} disabled={saving[rule.id]} style={{ border: "none", background: C.emerald, color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
                      {saving[rule.id] ? <Loader2 size={12} /> : "Save"}
                    </button>
                    <button onClick={() => cancelEdit(rule.id)} style={{ border: `1px solid ${C.line}`, background: "none", padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {rule.override_source && (
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: "#fff", background: C.stamp, padding: "2px 7px", borderRadius: 3 }}>OVERRIDE ON</span>
                    )}
                    <span style={{ ...serif, ...nums, fontSize: 18 }}>{(rule.rate * 100).toFixed(1)}%</span>
                    <button onClick={() => startEdit(rule)} style={{ border: `1px solid ${C.line}`, background: "none", padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Edit</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </Panel>
    </>
  );
}

/* ============================================================ Activity log */
const ACTION_LABELS = {
  upload: "Uploaded a file", delete_upload: "Deleted an upload", role_change: "Changed a role",
  log_followup: "Logged a call", resolve_followup: "Resolved a follow-up", reopen_followup: "Reopened a follow-up",
  delete_followup: "Deleted a follow-up", update_rule: "Changed a commission rule",
};
function ActivityTab({ activityLog }) {
  return (
    <>
      <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 20px" }}>Activity</h1>
      {activityLog.length === 0 ? (
        <Panel><div style={{ fontSize: 13.5, color: C.sub }}>No activity recorded yet.</div></Panel>
      ) : (
        <Panel title={`Last ${activityLog.length} action(s)`}>
          <div style={{ maxHeight: 600, overflowY: "auto" }}>
            {activityLog.map(entry => (
              <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.line}`, fontSize: 13 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{entry.actorName}</span>{" "}
                  <span style={{ color: C.sub }}>{ACTION_LABELS[entry.action] || entry.action}</span>
                  {entry.details && <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{entry.details}</div>}
                </div>
                <div style={{ fontSize: 11.5, color: C.sub, whiteSpace: "nowrap", flexShrink: 0, marginLeft: 12 }}>
                  {new Date(entry.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

function UsersTab({ currentUserId, refreshActivity }) {
  const [profiles, setProfiles] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getAllProfiles().then(setProfiles).catch(e => setError(e.message));
  }, []);

  async function changeRole(userId, role) {
    const target = profiles.find(p => p.id === userId);
    setProfiles(prev => prev.map(p => p.id === userId ? { ...p, role } : p));
    try {
      await updateProfileRole(userId, role);
      await logActivity("role_change", `Set ${target?.name || userId}'s role to ${role}`, currentUserId);
      refreshActivity && refreshActivity();
    }
    catch (e) { setError(e.message); }
  }

  return (
    <>
      <h1 style={{ ...serif, fontSize: 28, fontWeight: 500, margin: "0 0 20px" }}>Team</h1>
      <Panel>
        <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5 }}>
          New sign-ups start as Viewer automatically. To add someone, have them sign up (or create their
          account in Supabase Authentication → Users), then set their role here. Access is enforced by the
          database itself, not just this screen -- a role change here takes effect immediately.
        </div>
      </Panel>
      {error && <Panel><div style={{ color: C.brick, fontSize: 13 }}>{error}</div></Panel>}
      <Panel title={profiles ? `${profiles.length} team member(s)` : "Loading…"}>
        {profiles && profiles.map(p => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name} {p.id === currentUserId && <span style={{ color: C.sub, fontWeight: 400 }}>(you)</span>}</div>
              <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{p.email}</div>
            </div>
            <select value={p.role} onChange={(e) => changeRole(p.id, e.target.value)} style={{
              border: `1px solid ${C.line}`, padding: "6px 10px", fontSize: 12.5, background: C.panel, cursor: "pointer",
            }}>
              {Object.keys(ROLE_DESCRIPTIONS).map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        ))}
      </Panel>
      <Panel title="What each role can do">
        {Object.entries(ROLE_DESCRIPTIONS).map(([role, desc]) => (
          <div key={role} style={{ display: "flex", gap: 10, padding: "6px 0", fontSize: 13 }}>
            <span style={{ fontWeight: 600, textTransform: "capitalize", width: 70, flexShrink: 0 }}>{role}</span>
            <span style={{ color: C.sub }}>{desc}</span>
          </div>
        ))}
      </Panel>
    </>
  );
}

/* ============================================================ sorting helpers */
function useSort(list, defaultKey, defaultDir = "desc") {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);
  const sorted = useMemo(() => {
    const copy = [...list];
    copy.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (typeof av === "string") { av = av.toLowerCase(); bv = (bv || "").toLowerCase(); }
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return sortDir === "asc" ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
    });
    return copy;
  }, [list, sortKey, sortDir]);
  function toggleSort(key) {
    if (key === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }
  return { sorted, sortKey, sortDir, toggleSort };
}
function SortableTh({ label, field, sortKey, sortDir, onSort }) {
  const active = field === sortKey;
  return (
    <th onClick={() => onSort(field)} style={{
      fontWeight: active ? 800 : 700, cursor: "pointer", userSelect: "none", color: active ? C.navy : C.sub,
    }}>
      {label}{active && (sortDir === "asc" ? " ↑" : " ↓")}
    </th>
  );
}

function Kpi({ label, value, negative }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px 18px", flex: 1 }}>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 8, fontWeight: 600 }}>{label}</div>
      <div style={{ ...mono, fontSize: 24, fontWeight: 700, color: negative ? C.brick : C.ink }}>{value}</div>
    </div>
  );
}
function StatusBadge({ tone = "neutral", children }) {
  const tones = {
    green: { bg: C.emeraldSoft, fg: C.emerald }, amber: { bg: C.amberSoft, fg: C.amber },
    red: { bg: C.brickSoft, fg: C.brick }, indigo: { bg: C.stampSoft, fg: C.navy },
    neutral: { bg: "#F0F1F5", fg: C.sub },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 700, padding: "3px 9px",
      borderRadius: 6, background: t.bg, color: t.fg, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}
function Panel({ title, right, children, style }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 20, overflow: "hidden", ...style }}>
      {title && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${C.line}`, background: "#FAFBFC" }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
          {right}
        </div>
      )}
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  );
}
