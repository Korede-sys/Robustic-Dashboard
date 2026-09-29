
/* ============================================================ design tokens */
const C = {
  paper: "#F7F6F2", panel: "#FFFFFF", ink: "#14171F", sub: "#5B6472", line: "#E1DDD3",
  emerald: "#0B6E4F", emeraldSoft: "#E6F1EC", amber: "#C98A2C", amberSoft: "#FBF1E1",
  brick: "#B23A2E", brickSoft: "#FAEAE8", navy: "#1F2A3D",
};
const serif = { fontFamily: "'Fraunces', Georgia, serif" };
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

/* ============================================================ agent decoding */
const STATE_MAP = {
  ak: "Akwa Ibom", by: "Bayelsa", la: "Lagos", ka: "Kano", fc: "FCT", ab: "Abia",
  im: "Imo", de: "Delta", os: "Osun", ni: "Niger", ed: "Edo", on: "Ondo", og: "Ogun",
  en: "Enugu", oy: "Oyo", na: "Nasarawa", be: "Benue", pl: "Plateau", so: "Sokoto",
  cr: "Cross River", an: "Anambra", ek: "Ekiti", kw: "Kwara", ta: "Taraba", kt: "Katsina",
  kd: "Kaduna", jo: "Plateau", ko: "Kogi", eb: "Ebonyi",
};
const BRANCH_OVERRIDE = { jo: "Jos" };

function money(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (s === "" || s === "-") return null;
  const hasComma = s.includes(","), hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // Both separators present: whichever comes LAST is the real decimal point,
    // the other is a thousands separator and gets dropped. Handles US-style
    // "1,234.56" and European-style "51.513,55" (and multi-group thousands
    // like "78.016.891,00") the same way.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    // Comma only: a single comma followed by exactly two digits at the end is
    // a European decimal ("0,46" -> 0.46); anything else (or multiple commas)
    // is a thousands separator and gets stripped ("12,340" -> 12340).
    const isDecimal = /^-?\d+,\d{2}$/.test(s) && (s.match(/,/g) || []).length === 1;
    s = isDecimal ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function decodeAgent(username) {
  const m = /^(\d{2})(\d{2})([a-zA-Z]{2})-([a-zA-Z0-9]{2,6})-(.+)$/.exec(username);
  if (m) {
    const [, mm, yy, stateCodeRaw, branchCode] = m;
    const stateCode = stateCodeRaw.toLowerCase();
    return {
      username, onboardedMonth: `20${yy}-${mm}`, stateCode,
      stateName: STATE_MAP[stateCode] || "Unknown",
      branchCode: BRANCH_OVERRIDE[stateCode] || branchCode,
      channel: "branch",
    };
  }
  // Company shops: same "code-state-branch-suffix" shape as a regular agent,
  // but a 3-digit shop code instead of a 4-digit MMYY onboarding date (e.g.
  // "001be-zak-wukari1" -- confirmed against real data: these are company-
  // owned shops, commission-payable like any branch agent, just with no
  // onboarding-month encoded in the code). Checked after the 4-digit pattern
  // so a genuine MMYY agent is never misread as a 3-digit shop.
  const s = /^(\d{3})([a-zA-Z]{2})-([a-zA-Z0-9]{2,6})-(.+)$/.exec(username);
  if (s) {
    const [, , stateCodeRaw, branchCode] = s;
    const stateCode = stateCodeRaw.toLowerCase();
    return {
      username, onboardedMonth: null, stateCode,
      stateName: STATE_MAP[stateCode] || "Unknown",
      branchCode: BRANCH_OVERRIDE[stateCode] || branchCode,
      channel: "company_shop",
    };
  }
  if (username.toLowerCase().startsWith("elb-")) {
    return { username, onboardedMonth: null, stateCode: null, stateName: "Online", branchCode: null, channel: "online" };
  }
  return { username, onboardedMonth: null, stateCode: null, stateName: "Unknown", branchCode: null, channel: "unknown" };
}
function isHouseAgent(username) {
  return decodeAgent(username).channel === "unknown";
}

/* ============================================================ file type detection */
function detectFileType(filename) {
  const f = filename.toLowerCase();
  if (f.includes("globalbet")) return "GB";
  if ((f.includes("sport_monthly_bonus") || f.includes("sp_mb")) ) return "SP_MB";
  if (f.includes("monthly_bonus") && (f.includes("eb_mb") || f.includes("luckyball"))) return "EB_MB";
  if (f.includes("luckyball") && f.includes("luckygreek")) return "EB";
  if (f.includes("sport")) return "SP";
  return null;
}
const FILE_TYPE_LABELS = {
  GB: "Globalbet Virtual (weekly)", EB: "Luckyball & Luckygreek (weekly)",
  EB_MB: "Luckyball Monthly Bonus", SP: "Sports (weekly)", SP_MB: "Sport Monthly Bonus",
};

const MONTH_NAMES = { january:0, february:1, march:2, april:3, may:4, june:5, july:6, august:7, september:8, october:9, november:10, december:11 };
function pad2(n) { return String(n).padStart(2, "0"); }
function toISODate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function lastDayOfMonth(year, monthIndex) { return new Date(year, monthIndex + 1, 0); }

/* ============================================================ period detection
   Only Globalbet's own sheet embeds a real date range ("from 2026-08-31 to
   2026-09-07") -- every other product has nothing in the data itself, so this
   falls back to the filename's date, which is always one day AFTER the actual
   period end (it's the report-generation date, confirmed across multiple real
   files). This is a best-guess, not a certainty -- the caller should always
   let the uploader confirm or correct it before it's saved. */
function detectPeriod(filename, type, rows) {
  if (type === "GB" && rows && rows[0]) {
    const text = rows[0].join(" ");
    const m = /from\s+(\d{4}-\d{2}-\d{2}).*?to\s+(\d{4}-\d{2}-\d{2})/i.exec(text);
    if (m) return { periodStart: m[1], periodEnd: m[2], confidence: "read from the sheet itself" };
  }
  // Monthly products: filename carries "MONTH_YYYY" (e.g. "AUGUST_2026").
  if (type === "EB_MB" || type === "SP_MB") {
    const m = /([A-Za-z]+)_?\s*(\d{4})/.exec(filename);
    if (m && MONTH_NAMES[m[1].toLowerCase()] !== undefined) {
      const monthIdx = MONTH_NAMES[m[1].toLowerCase()], year = parseInt(m[2], 10);
      return {
        periodStart: toISODate(new Date(year, monthIdx, 1)),
        periodEnd: toISODate(lastDayOfMonth(year, monthIdx)),
        confidence: "guessed from filename -- please confirm",
      };
    }
    return { periodStart: null, periodEnd: null, confidence: "couldn't guess -- please enter" };
  }
  // Weekly products (GB fallback, EB, SP): filename carries a DD-MM-YYYY date,
  // which real examples confirm is generation-day = period end + 1 day.
  const m = /(\d{2})-(\d{2})-(\d{4})/.exec(filename);
  if (m) {
    const genDate = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    const periodEnd = addDays(genDate, -1);
    const periodStart = addDays(periodEnd, -7);
    return { periodStart: toISODate(periodStart), periodEnd: toISODate(periodEnd), confidence: "guessed from filename -- please confirm" };
  }
  return { periodStart: null, periodEnd: null, confidence: "couldn't guess -- please enter" };
}

/* ============================================================ block parsers
   Column offsets ported 1:1 from the parser validated against real exports. */
function get(row, i) {
  if (i === null || i === undefined || i === "") return "";
  return i < row.length ? row[i] : "";
}

function parseGB(rows) {
  if (isFinancialOverviewFormat(rows)) return parseGBFinancialOverview(rows);
  return parseGBLegacyTiered(rows);
}

/* --- New format: "Financial Overview - All players" ------------------------
   Semicolon-delimited, European number formatting (handled by money()), and
   structured as a reseller -> agent -> cashier TREE via indentation, not a
   flat per-agent list. Each entity gets two consecutive rows: one labelled
   "Total in EUR" (carries the username + ticket count), immediately followed
   by one labelled "NGN" (carries the real local-currency amounts we report
   on). Only the middle tree level -- usernames matching the same
   MMYY-state-branch-suffix pattern decodeAgent already expects (confirmed
   against a real row: "0619ab-abn-ugocalis") -- counts as an agent. Reseller
   rows above it (e.g. "AccessBET") and cashier rows below it (e.g.
   "ugocalis-cashier1") are real rows in the sheet but are not commission-
   bearing agents, so they're skipped rather than double-counting the same
   money at multiple tree levels. */
function isFinancialOverviewFormat(rows) {
  // Title text alone isn't reliable: a real file confirmed both this
  // tree-hierarchy export AND the older flat multi-block export share the
  // phrase "Financial Overview report for agent..." in their title line.
  // What's actually unique to THIS format is the "Currency" column (it's how
  // the EUR/NGN row-pairs are distinguished) -- the flat format has no such
  // column. Structural signature, not text matching, so it can't be fooled
  // by two reports that happen to share similar wording.
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    const row = rows[i];
    if (row && row.some(cell => String(cell).trim().toLowerCase() === "currency")) return true;
  }
  return false;
}
const AGENT_USERNAME_RE = /^(?:\d{2}\d{2}[a-zA-Z]{2}-[a-zA-Z0-9]{2,6}-.+|\d{3}[a-zA-Z]{2}-[a-zA-Z0-9]{2,6}-.+)$/;
function stripTreePrefix(raw) {
  return String(raw || "").replace(/^[\s|\\_]+/, "").trim();
}
function isOnlineUsername(u) { return String(u || "").toLowerCase().startsWith("elb-"); }
const CASHIER_SUFFIX_RE = /-cashier\d+$/i;

function parseGBFinancialOverview(rows) {
  // Walks the tree in file order, keeping "the most recently seen agent" as
  // context: an agent row opens a new context and starts its own totals; any
  // row that follows and does NOT itself match the agent pattern (a cashier
  // sub-account, e.g. "ugocalis-cashier1" under "...-ugocalis") is rolled
  // into that open context rather than kept separate -- confirmed business
  // rule: a cashier is the same agent's operation split across terminals,
  // not an independently payable entity. elb- prefixed rows are online-
  // channel agents, paid through a separate process -- excluded here
  // entirely, and do NOT close/replace the current branch-agent context (a
  // cashier row immediately after an online row still belongs to whichever
  // branch agent opened the context). The very first entity in the file is
  // the reseller-level rollup (e.g. "AccessBET") -- not a payable agent,
  // and explicitly does not open a context, so nothing gets wrongly
  // attributed to it if the tree ever returns to another top-level branch.
  const byAgent = new Map();
  let currentAgentKey = null;
  let sawRoot = false;

  const addTo = (item, tickets, stake, payout, profit, commission) => {
    item.tickets += tickets || 0; item.stake += stake || 0; item.payout += payout || 0;
    item.profit += profit || 0; item.commissionAmount += commission || 0;
  };

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    const currency = String(get(row, 4)).trim();
    if (!currency.toLowerCase().startsWith("total in")) continue;
    const nextRow = rows[i + 1];
    if (!nextRow || String(get(nextRow, 4)).trim() !== "NGN") continue;
    const rawUsername = stripTreePrefix(get(row, 0));
    i++; // consumed the NGN row either way

    if (!sawRoot) { sawRoot = true; continue; }
    if (isOnlineUsername(rawUsername)) {
      // Excluded entirely -- but the context has to close too: an online
      // agent can have its own "-cashierN" sub-accounts in the tree (confirmed:
      // elb-6fatima23 has three), and without resetting currentAgentKey here,
      // those cashier rows would silently fall through to whichever branch
      // agent happened to be open right before this online entry -- a real
      // bug found against real data (₦1,239,900 misattributed to an innocent
      // agent). Setting it to null means an orphaned cashier is correctly left
      // unattributed rather than guessed into the wrong agent's total.
      currentAgentKey = null;
      continue;
    }

    const tickets = money(get(row, 3)), stake = money(get(nextRow, 5)), payout = money(get(nextRow, 6));
    const profit = money(get(nextRow, 17)), commission = money(get(nextRow, 15));

    if (AGENT_USERNAME_RE.test(rawUsername)) {
      const key = rawUsername.toLowerCase();
      currentAgentKey = key;
      if (!byAgent.has(key)) {
        byAgent.set(key, {
          agentUsername: rawUsername, sourceBlock: "GB:FIN_OVERVIEW",
          tickets: 0, stake: 0, payout: 0, profit: 0, commissionAmount: 0,
          commissionType: null, balance: null, isHouse: isHouseAgent(rawUsername),
          totalEarnings: null, avgStake: null,
        });
      }
      addTo(byAgent.get(key), tickets, stake, payout, profit, commission);
    } else if (currentAgentKey && CASHIER_SUFFIX_RE.test(rawUsername)) {
      addTo(byAgent.get(currentAgentKey), tickets, stake, payout, profit, commission);
    }
    // else: a row that's neither a recognized agent nor a "-cashierN" sub-account
    // of one (e.g. an unrecognized username prefix) -- left out rather than
    // guessed into someone else's total. See the parsing notes for known cases.
  }
  return { items: Array.from(byAgent.values()), supplemental: [] };
}

function parseGBLegacyTiered(rows) {
  const items = [], supplemental = [];
  // Block A is the true, complete per-agent total for stake/payout/profit. Its own
  // commission column always carries a genuine 10% uplift for agents also on the
  // UP-10% tier -- confirmed exactly: for every agent tested across two separate
  // weeks (290 total, zero exceptions), TIER_UP10's commission column (row index 40,
  // NOT 39 -- 39 is a red herring that duplicates Block A's own commission and looks
  // right until you check it against Total Earnings) plus bonus plus palliative plus
  // gift equals the sheet's own printed Total Earnings figure exactly, to the cent.
  // Block B was confirmed to be a pure restatement of Block A with no discrepancy,
  // so it's still never used as its own source.
  const tier10ByAgent = {};
  for (const row of rows.slice(3)) {
    const u = String(get(row, 30)).trim();
    if (!u || isHouseAgent(u)) continue;
    tier10ByAgent[u.toLowerCase()] = {
      commission: money(get(row, 40)), totalEarnings: money(get(row, 44)),
      balance: money(get(row, 45)), avgStake: money(get(row, 46)),
    };
    const b = money(get(row, 41)), p = money(get(row, 42)), g = money(get(row, 43));
    if (b) supplemental.push({ agentUsername: u, type: "bonus", amount: b });
    if (p) supplemental.push({ agentUsername: u, type: "palliative", amount: p });
    if (g) supplemental.push({ agentUsername: u, type: "gift", amount: g });
  }
  for (const row of rows.slice(3)) {
    const u = String(get(row, 1)).trim();
    if (!u) continue;
    const tier10 = tier10ByAgent[u.toLowerCase()];
    const blockACommission = money(get(row, 10));
    items.push({
      agentUsername: u, sourceBlock: "GB:BLOCK_A",
      tickets: money(get(row, 2)), stake: money(get(row, 3)), payout: money(get(row, 4)),
      profit: money(get(row, 9)),
      commissionAmount: (tier10 && tier10.commission !== null) ? tier10.commission : blockACommission,
      commissionType: null, balance: tier10 ? tier10.balance : null, isHouse: isHouseAgent(u),
      totalEarnings: tier10 ? tier10.totalEarnings : null, avgStake: tier10 ? tier10.avgStake : null,
    });
  }
  return { items, supplemental };
}

function parseEB(rows) {
  const items = [], supplemental = [];
  const blocks = [
    ["LUCKYBALL", { username: 1, tickets: 2, stake: 3, payout: 5, profit: 6, commission: 7, type: 8 }],
    ["LUCKYGREECK", { username: 13, tickets: 14, stake: 15, payout: 17, profit: 18, commission: 19, bonus: 20, balance: 21, type: 23 }],
    ["ROCKET_MAN", { username: 27, tickets: 28, stake: 29, payout: 31, profit: 32, commission: 33, type: 34 }],
    ["LUCKYBALL_DUP", { username: 36, tickets: 37, stake: 38, payout: 40, profit: 41, commission: 42 }],
    ["LUCKYGREECK_DUP", { username: 45, tickets: 46, stake: 47, payout: 49, profit: 50, commission: 51 }],
    ["ROCKET_MAN_DUP", { username: 54, tickets: 55, stake: 56, payout: 58, profit: 59, commission: 60 }],
    ["COMBINED_TOTAL", { username: 63, tickets: 64, stake: 65, payout: 67, profit: 68, commission: 69 }],
  ];
  for (const row of rows.slice(2)) {
    for (const [label, cols] of blocks) {
      const u = String(get(row, cols.username)).trim();
      if (!u) continue;
      items.push({
        agentUsername: u, sourceBlock: `EB:${label}`,
        tickets: money(get(row, cols.tickets)), stake: money(get(row, cols.stake)),
        payout: money(get(row, cols.payout)), profit: money(get(row, cols.profit)),
        commissionAmount: money(get(row, cols.commission)),
        commissionType: cols.type !== undefined ? (String(get(row, cols.type)).trim() || null) : null,
        balance: cols.balance !== undefined ? money(get(row, cols.balance)) : null,
        isHouse: isHouseAgent(u),
      });
      if (cols.bonus !== undefined) {
        const b = money(get(row, cols.bonus));
        if (b) supplemental.push({ agentUsername: u, type: "bonus", amount: b });
      }
    }
  }
  return { items, supplemental };
}

function parseEBMB(rows) {
  const items = [], supplemental = [];
  for (const row of rows.slice(2)) {
    const u = String(get(row, 1)).trim();
    if (!u) continue;
    items.push({
      agentUsername: u, sourceBlock: "EB_MB:BASE",
      tickets: money(get(row, 2)), stake: money(get(row, 3)), payout: money(get(row, 5)),
      profit: money(get(row, 6)), commissionAmount: money(get(row, 7)),
      commissionType: String(get(row, 8)).trim() || null, balance: null, isHouse: isHouseAgent(u),
    });
  }
  for (const row of rows.slice(2)) {
    const u = String(get(row, 14)).trim();
    if (!u) continue;
    const amt = money(get(row, 15));
    if (amt) supplemental.push({ agentUsername: u, type: "monthly_bonus", amount: amt });
  }
  return { items, supplemental };
}

function parseSP(rows) {
  const items = [];
  const push = (row, label, cols) => {
    const u = String(get(row, cols.username)).trim();
    if (!u) return;
    items.push({
      agentUsername: u, sourceBlock: label,
      tickets: money(get(row, cols.tickets)), stake: money(get(row, cols.stake)),
      payout: money(get(row, cols.payout)), profit: money(get(row, cols.profit)),
      commissionAmount: money(get(row, cols.commission)), commissionType: null,
      balance: cols.balance !== undefined ? money(get(row, cols.balance)) : null,
      isHouse: isHouseAgent(u),
    });
  };
  for (const row of rows.slice(2)) push(row, "SP:BASE", { username: 1, tickets: 2, stake: 3, payout: 4, profit: 5, commission: 6 });
  for (const row of rows.slice(2)) push(row, "SP:POOL", { username: 44, tickets: 45, stake: 46, payout: 47, profit: 48, commission: 49 });
  for (const row of rows.slice(3)) push(row, "SP:35PCT", { username: 13, tickets: 14, stake: 15, payout: 16, profit: 17, commission: 18, balance: 19 });
  for (const row of rows.slice(3)) push(row, "SP:UP30PCT", { username: 24, tickets: 25, stake: 26, payout: 27, profit: 28, commission: 29, balance: 30 });
  for (const row of rows.slice(3)) push(row, "SP:3RD_PARTY", { username: 35, tickets: 36, stake: 37, payout: 38, profit: 39, commission: 40 });
  return { items, supplemental: [] };
}

function parseSPMB(rows) {
  const items = [], supplemental = [];
  for (const row of rows.slice(3)) {
    const u = String(get(row, 2)).trim();
    if (!u) continue;
    items.push({
      agentUsername: u, sourceBlock: "SP_MB:BASE",
      tickets: money(get(row, 3)), stake: money(get(row, 4)), payout: money(get(row, 5)),
      profit: money(get(row, 6)), commissionAmount: money(get(row, 7)), commissionType: null,
      balance: null, isHouse: isHouseAgent(u),
    });
  }
  const bonusBlocks = [
    ["ABOVE_100", 4, { name: 14, bonus: 20 }],
    ["ALL_100_AND_BELOW", 4, { name: 26, bonus: 32 }],
    ["OTHER_STATES", 4, { name: 39, bonus: 45 }],
    ["AKWA_IBOM", 4, { name: 48, bonus: 54 }],
    ["AKWA_IBOM_ABOVE_100", 4, { name: 57, bonus: 63 }],
  ];
  for (const [, start, cols] of bonusBlocks) {
    for (const row of rows.slice(start)) {
      const u = String(get(row, cols.name)).trim();
      if (!u || isHouseAgent(u)) continue;
      const b = money(get(row, cols.bonus));
      if (b) supplemental.push({ agentUsername: u, type: "monthly_bonus", amount: b });
    }
  }
  return { items, supplemental };
}

const PARSERS = { GB: parseGB, EB: parseEB, EB_MB: parseEBMB, SP: parseSP, SP_MB: parseSPMB };

/* ============================================================ commission engine
   Formulas below were empirically confirmed against your real August/September
   data (median ratio with ~0 variance across every agent in the block) before
   being wired in here — see the Formulas tab for the evidence. These are the
   DEFAULTS, used as a fallback if no live rules are supplied by the caller.
   The deployed app always passes the current rules from the commission_rules
   table, so an admin editing a rate there takes effect without a code change. */
const TYPE_RULE_BLOCKS = new Set(["EB:LUCKYBALL", "EB:LUCKYGREECK", "EB:ROCKET_MAN", "EB_MB:BASE"]);
const DEFAULT_BLOCK_RULES = {
  "SP:35PCT": { basis: "profit", rate: 0.35, confidence: "confirmed" },
  "SP:POOL": { basis: "profit", rate: 0.15, confidence: "tentative (only 3 samples)" },
};
const STRUCTURALLY_TRUSTED = new Set([
  "EB:LUCKYBALL", "EB:LUCKYGREECK", "EB:ROCKET_MAN", "EB_MB:BASE",
  "SP:35PCT", "SP:UP30PCT", "SP:3RD_PARTY", "SP:POOL",
  "GB:BLOCK_A", "GB:FIN_OVERVIEW",
  "SP_MB:BASE",
]);
const EXCLUDED_BLOCKS = new Set([
  "SP:BASE", "EB:LUCKYBALL_DUP", "EB:LUCKYGREECK_DUP", "EB:ROCKET_MAN_DUP", "EB:COMBINED_TOTAL",
]);

function parseTypeRate(t) {
  if (!t) return null;
  const m = /(sale|sales|profit)\s*\((\d+(?:\.\d+)?)%\)/i.exec(t);
  if (!m) return null;
  return { basis: m[1].toLowerCase().startsWith("sale") ? "stake" : "profit", rate: parseFloat(m[2]) / 100 };
}

function computeCommission(item, blockRules = DEFAULT_BLOCK_RULES) {
  // Lookup priority: an exact "block::type" rule (targets one specific per-agent
  // rate, e.g. "EB:LUCKYBALL::profit (50%)") beats a whole-block rule, which
  // beats the default per-agent Type parsing, which beats "no formula known."
  let rule = null;
  const compositeKey = item.commissionType ? `${item.sourceBlock}::${item.commissionType}` : null;
  if (compositeKey && compositeKey in blockRules) {
    rule = blockRules[compositeKey];
  } else if (item.sourceBlock in blockRules) {
    rule = blockRules[item.sourceBlock];
  } else if (TYPE_RULE_BLOCKS.has(item.sourceBlock)) {
    const r = parseTypeRate(item.commissionType);
    if (r) rule = { ...r, confidence: "confirmed (per-agent Type)", override: false };
  }
  if (!rule) return { calc: item.commissionAmount, confidence: "unverified — no confirmed formula, using source value", verified: null, isOverride: false };

  const base = rule.basis === "stake" ? item.stake : item.profit;
  if (base === null || base === undefined) return { calc: item.commissionAmount, confidence: rule.confidence, verified: null, isOverride: false };
  const calc = Math.max(0, base * rule.rate);
  const src = item.commissionAmount ?? 0;
  const diff = src - calc;
  const diffPct = calc ? (diff / calc) * 100 : (src === 0 ? 0 : null);
  const verified = Math.abs(diff) <= 1 || (diffPct !== null && Math.abs(diffPct) <= 0.5);
  return { calc, confidence: rule.confidence, verified, diff, diffPct, isOverride: !!rule.override };
}

/* ============================================================ aggregation */
function adjustmentKey(batchId, agentUsername, sourceBlock) {
  return `${batchId}::${String(agentUsername).toLowerCase()}::${sourceBlock}`;
}
function productOf(block) {
  if (block.startsWith("GB:")) return "Globalbet Virtual";
  if (block === "EB:LUCKYBALL") return "Luckyball";
  if (block === "EB:LUCKYGREECK") return "Luckygreek";
  if (block === "EB:ROCKET_MAN") return "Rocket Man";
  if (block === "EB_MB:BASE") return "Luckyball (Monthly)";
  if (block.startsWith("SP_MB:")) return "Sports (Monthly)";
  if (block.startsWith("SP:")) return "Sports";
  return "Other";
}
function aggregateBatches(batches, blockRules = DEFAULT_BLOCK_RULES, adjustments = []) {
  const agentMap = new Map();
  const productAgg = new Map();
  const stateAgg = new Map();
  const mismatches = [];
  const appliedAdjustments = [];
  const adjustmentMap = new Map();
  for (const adj of adjustments) adjustmentMap.set(adjustmentKey(adj.batchId, adj.agentUsername, adj.sourceBlock), adj);
  let verifiedCount = 0, unverifiedCount = 0, mismatchCount = 0, overrideCount = 0, adjustedCount = 0;

  const PRODUCT_OF = productOf;

  for (const batch of batches) {
    for (const item of batch.items) {
      if (EXCLUDED_BLOCKS.has(item.sourceBlock) || !STRUCTURALLY_TRUSTED.has(item.sourceBlock)) continue;
      if (item.isHouse) continue;
      const meta = decodeAgent(item.agentUsername);
      let calc, confidence, verified, diff, diffPct, isOverride;
      if (meta.channel === "online") {
        // Business rule, confirmed directly, not something a rate formula can express:
        // online-channel (elb-) agents are never paid commission on this product,
        // regardless of their stake or profit. So there's nothing to cross-check
        // against a formula here -- the sheet's ₦0 is correct, not a mismatch, and
        // flagging it as one was a false positive the formula had no way to know
        // to avoid. (Separate from *how* online agents get paid elsewhere -- see
        // Globalbet, where they're excluded from this pipeline entirely because
        // they're paid through a different process.)
        calc = item.commissionAmount;
        confidence = "not applicable — online agents aren't paid commission on this product";
        verified = null; diff = undefined; diffPct = undefined; isOverride = false;
      } else {
        ({ calc, confidence, verified, diff, diffPct, isOverride } = computeCommission(item, blockRules));
      }
      // The payable commission, in priority order: a manual adjustment (someone
      // looked at exactly this line and corrected it, with a reason on record)
      // beats the "online agents aren't paid" policy, which beats a rule
      // override (a whole product/type recalculated), which beats the sheet's
      // own value. Online is enforced here -- not left to each parser -- so it
      // holds for every product the same way, even if a future sheet ever
      // shows a nonzero commission for an online agent (confirmed policy:
      // "we don't pay commission to account with Elb or online," stated
      // generally, not product-by-product). Stake/payout/profit still count
      // for online agents, so their activity stays visible in reporting --
      // only the payable commission is forced to zero.
      const adjustment = adjustmentMap.get(adjustmentKey(batch.id, item.agentUsername, item.sourceBlock));
      const isOnlinePolicyZero = meta.channel === "online" && !adjustment;
      const payableCommission = adjustment ? adjustment.adjustedCommission
        : isOnlinePolicyZero ? 0
        : isOverride ? calc : (item.commissionAmount || 0);
      if (adjustment) {
        adjustedCount++;
        appliedAdjustments.push({
          id: adjustment.id, agent: item.agentUsername, block: item.sourceBlock, batch: batch.filename, batchId: batch.id,
          original: adjustment.originalCommission, adjusted: adjustment.adjustedCommission,
          reason: adjustment.reason, createdBy: adjustment.createdBy, createdAt: adjustment.createdAt,
        });
      } else if (isOverride) overrideCount++;
      else if (verified === true) verifiedCount++;
      else if (verified === false) { mismatchCount++; mismatches.push({ agent: item.agentUsername, block: item.sourceBlock, type: item.commissionType, source: item.commissionAmount, calculated: calc, diff, diffPct, batch: batch.filename, batchId: batch.id }); }
      else unverifiedCount++;

      const key = item.agentUsername.toLowerCase();
      if (!agentMap.has(key)) {
        agentMap.set(key, {
          username: item.agentUsername, state: meta.stateName, channel: meta.channel,
          tickets: 0, stake: 0, payout: 0, profit: 0, sourceCommission: 0, calcCommission: 0,
          monthlyBonus: 0, bonus: 0, palliative: 0, gift: 0, products: new Set(), allVerified: true, hasOverride: false, hasAdjustment: false,
          totalEarnings: null, balance: null, avgStake: null,
        });
      }
      const a = agentMap.get(key);
      a.tickets += item.tickets || 0; a.stake += item.stake || 0; a.payout += item.payout || 0;
      a.profit += item.profit || 0; a.sourceCommission += payableCommission;
      a.calcCommission += calc || 0;
      if (verified === false && !isOverride && !adjustment) a.allVerified = false;
      if (isOverride) a.hasOverride = true;
      if (adjustment) a.hasAdjustment = true;
      // GB-specific extras, carried straight from the sheet -- only Globalbet items
      // set these, so they stay null for every other product.
      if (item.totalEarnings !== undefined && item.totalEarnings !== null) a.totalEarnings = item.totalEarnings;
      if (item.balance !== undefined && item.balance !== null) a.balance = item.balance;
      if (item.avgStake !== undefined && item.avgStake !== null) a.avgStake = item.avgStake;
      const prod = PRODUCT_OF(item.sourceBlock);
      a.products.add(prod);

      if (!productAgg.has(prod)) productAgg.set(prod, { name: prod, stake: 0, payout: 0, profit: 0, commission: 0 });
      const p = productAgg.get(prod);
      p.stake += item.stake || 0; p.payout += item.payout || 0; p.profit += item.profit || 0; p.commission += payableCommission;

      const st = meta.stateName || "Unknown";
      if (!stateAgg.has(st)) stateAgg.set(st, { state: st, stake: 0, payout: 0, profit: 0, commission: 0, agents: new Set() });
      const s = stateAgg.get(st);
      s.stake += item.stake || 0; s.payout += item.payout || 0; s.profit += item.profit || 0; s.commission += payableCommission;
      s.agents.add(key);
    }
    for (const supp of batch.supplemental) {
      // Every supplemental payment type counts toward monthlyBonus (the combined
      // total used everywhere else) -- but bonus/palliative/gift are also tracked
      // individually so each can be checked against the sheet on its own, not just
      // as one blended number.
      const key = supp.agentUsername.toLowerCase();
      if (!agentMap.has(key)) continue;
      const a = agentMap.get(key);
      const amt = supp.amount || 0;
      a.monthlyBonus += amt;
      if (supp.type === "bonus") a.bonus += amt;
      else if (supp.type === "palliative") a.palliative += amt;
      else if (supp.type === "gift") a.gift += amt;
    }
  }

  const agents = Array.from(agentMap.values()).map(a => ({ ...a, products: Array.from(a.products) }))
    .sort((a, b) => b.stake - a.stake).map((a, i) => ({ ...a, rank: i + 1 }));
  const products = Array.from(productAgg.values()).sort((a, b) => b.stake - a.stake);
  const states = Array.from(stateAgg.values()).map(s => ({ ...s, agentCount: s.agents.size }))
    .sort((a, b) => b.stake - a.stake);

  return {
    agents, products, states, mismatches, adjustments: appliedAdjustments,
    stats: { verifiedCount, unverifiedCount, mismatchCount, overrideCount, adjustedCount },
    totals: {
      stake: agents.reduce((s, a) => s + a.stake, 0), payout: agents.reduce((s, a) => s + a.payout, 0),
      profit: agents.reduce((s, a) => s + a.profit, 0), commission: agents.reduce((s, a) => s + a.sourceCommission, 0),
      monthlyBonus: agents.reduce((s, a) => s + a.monthlyBonus, 0),
    },
  };
}

/* ============================================================ trends
   Real week-over-week movement, computed once a product type has 2+ uploaded
   batches. With only one batch of a type, trend data simply isn't available yet. */
function computeTrends(batches) {
  const byType = {};
  for (const b of batches) (byType[b.type] ||= []).push(b);
  // Sort by the real reporting period now that we have one, not upload order --
  // someone uploading an older week's file after a newer one shouldn't scramble
  // which period counts as "latest" for trend comparison.
  const sortKey = (b) => new Date(b.periodStart || b.uploadedAt);
  for (const t in byType) byType[t].sort((a, b) => sortKey(a) - sortKey(b));

  const agentTrend = {};
  const stateTrend = {};
  let hasEnoughData = false;

  const stakeByAgentAndState = (batch) => {
    const byAgent = {}, byState = {};
    for (const item of batch.items) {
      if (EXCLUDED_BLOCKS.has(item.sourceBlock) || !STRUCTURALLY_TRUSTED.has(item.sourceBlock) || item.isHouse) continue;
      const key = item.agentUsername.toLowerCase();
      byAgent[key] = (byAgent[key] || 0) + (item.stake || 0);
      const state = decodeAgent(item.agentUsername).stateName || "Unknown";
      byState[state] = (byState[state] || 0) + (item.stake || 0);
    }
    return { byAgent, byState };
  };

  for (const type in byType) {
    const list = byType[type];
    if (list.length < 2) continue;
    hasEnoughData = true;
    const latest = stakeByAgentAndState(list[list.length - 1]);
    const prev = stakeByAgentAndState(list[list.length - 2]);

    const agents = new Set([...Object.keys(latest.byAgent), ...Object.keys(prev.byAgent)]);
    for (const u of agents) {
      if (!agentTrend[u]) agentTrend[u] = { latestStake: 0, prevStake: 0 };
      agentTrend[u].latestStake += latest.byAgent[u] || 0;
      agentTrend[u].prevStake += prev.byAgent[u] || 0;
    }
    const states = new Set([...Object.keys(latest.byState), ...Object.keys(prev.byState)]);
    for (const s of states) {
      if (!stateTrend[s]) stateTrend[s] = { latestStake: 0, prevStake: 0 };
      stateTrend[s].latestStake += latest.byState[s] || 0;
      stateTrend[s].prevStake += prev.byState[s] || 0;
    }
  }
  for (const u in agentTrend) {
    const t = agentTrend[u];
    t.deltaPct = t.prevStake > 0 ? ((t.latestStake - t.prevStake) / t.prevStake) * 100 : (t.latestStake > 0 ? null : 0);
  }
  for (const s in stateTrend) {
    const t = stateTrend[s];
    t.deltaPct = t.prevStake > 0 ? ((t.latestStake - t.prevStake) / t.prevStake) * 100 : (t.latestStake > 0 ? null : 0);
  }
  return { hasEnoughData, agentTrend, stateTrend };
}

/* ============================================================ per-batch time series (for trend charts) */
function computeBatchSeries(batches) {
  const byType = {};
  for (const b of batches) (byType[b.type] ||= []).push(b);
  for (const t in byType) byType[t].sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt));

  const series = {};
  for (const type in byType) {
    series[type] = byType[type].map((batch) => {
      let stake = 0, payout = 0, profit = 0, commission = 0;
      for (const item of batch.items) {
        if (EXCLUDED_BLOCKS.has(item.sourceBlock) || !STRUCTURALLY_TRUSTED.has(item.sourceBlock) || item.isHouse) continue;
        stake += item.stake || 0; payout += item.payout || 0; profit += item.profit || 0;
        commission += item.commissionAmount || 0;
      }
      return {
        date: batch.uploadedAt, filename: batch.filename, batchId: batch.id,
        stake: Math.round(stake), payout: Math.round(payout), profit: Math.round(profit), commission: Math.round(commission),
      };
    });
  }
  return series;
}

/* ============================================================ CSV export (server-side: returns text, no DOM) */
function toCSV(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(c => c.label).join(",")];
  for (const r of rows) lines.push(columns.map(c => esc(c.get(r))).join(","));
  return lines.join("\n");
}

export {
  PARSERS, detectFileType, detectPeriod, aggregateBatches, computeCommission, computeTrends, computeBatchSeries,
  decodeAgent, money, toCSV, EXCLUDED_BLOCKS, STRUCTURALLY_TRUSTED, DEFAULT_BLOCK_RULES, adjustmentKey, productOf,
};
