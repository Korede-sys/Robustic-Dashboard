
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

// Confirmed, real, payable agents whose usernames don't match any of the
// coding patterns decodeAgent otherwise looks for -- added one at a time,
// only after direct confirmation. This is NOT a general relaxation of the
// "unrecognized format = excluded" rule; broadening that would risk quietly
// paying genuine house/aggregate rows like "000 ONLINE" or "AccessBET" as
// if they were agents. "yin76" -- confirmed: a real Sports agent with no
// encoded state/branch in their username.
const CONFIRMED_EXCEPTION_AGENTS = new Set(["yin76"]);

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
  // Explicit, one-at-a-time exceptions: usernames confirmed as real, payable
  // agents despite not matching any coding pattern above (see
  // CONFIRMED_EXCEPTION_AGENTS at module scope for why this stays narrow).
  if (CONFIRMED_EXCEPTION_AGENTS.has(username.toLowerCase())) {
    return { username, onboardedMonth: null, stateCode: null, stateName: "Unknown", branchCode: null, channel: "branch" };
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

function parseGBFinancialOverview(rows) {
  // Walks the tree in file order. Confirmed policy (reversed from an earlier
  // decision in this same system): cashier sub-accounts (e.g.
  // "ugocalis-cashier1" under "...-ugocalis") are NOT paid commission and
  // their stake does NOT count toward the parent agent's total -- only each
  // agent's own row does, matching AccessBET's own summary row and the
  // legacy flat export exactly. So cashier rows are simply skipped here,
  // the same as any other row that isn't itself a recognized agent/shop --
  // no rollup, no addTo. elb- prefixed rows are online-channel agents, paid
  // through a separate process -- also excluded. The very first entity in
  // the file is the reseller-level rollup (e.g. "AccessBET") -- not a
  // payable agent, skipped too.
  const byAgent = new Map();
  let sawRoot = false;

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    const currency = String(get(row, 4)).trim();
    if (!currency.toLowerCase().startsWith("total in")) continue;
    const nextRow = rows[i + 1];
    if (!nextRow || String(get(nextRow, 4)).trim() !== "NGN") continue;
    const rawUsername = stripTreePrefix(get(row, 0));
    i++; // consumed the NGN row either way

    if (!sawRoot) { sawRoot = true; continue; }
    // Online agents now DO count toward stake/payout/profit reporting totals
    // (confirmed: this makes the app's total match AccessBET's own row
    // exactly, since that row includes online activity) -- but they still
    // never get paid: isOnlineUsername no longer skips the row here, relying
    // instead on the centralized policy in aggregateBatches that forces their
    // payable commission to zero and excludes them from bonus/palliative/gift,
    // regardless of what the sheet shows. Stake counts, payment doesn't.
    if (!AGENT_USERNAME_RE.test(rawUsername) && !isOnlineUsername(rawUsername)) continue;

    const tickets = money(get(row, 3)), stake = money(get(nextRow, 5)), payout = money(get(nextRow, 6));
    const profit = money(get(nextRow, 17)), commission = money(get(nextRow, 15));
    const key = rawUsername.toLowerCase();
    byAgent.set(key, {
      agentUsername: rawUsername, sourceBlock: "GB:FIN_OVERVIEW",
      tickets: tickets || 0, stake: stake || 0, payout: payout || 0, profit: profit || 0, commissionAmount: commission || 0,
      commissionType: null, balance: null, isHouse: isHouseAgent(rawUsername),
      totalEarnings: null, avgStake: null,
    });
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
    const tier10Tickets = money(get(row, 31)), tier10Stake = money(get(row, 32)), tier10Profit = money(get(row, 38));
    const commUplift = money(get(row, 40));
    // Bonus (weekly "fuel money"): confirmed formula, verified 147/149
    // against the real reference dataset -- both remaining exceptions
    // already explained (001fc-gwa-spareshop has the same internally
    // inconsistent sheet data flagged for Palliative/Gift; elb-6fatima23 is
    // an online agent, already correctly zeroed by the existing
    // online-exclusion policy downstream regardless of what this computes).
    // The two documented tiers (by ticket count, by stake/sales) are each
    // determined INDEPENDENTLY -- not requiring both to land in the same
    // bracket -- and the paid bonus is the LOWER of the two. Confirmed
    // against real data: an agent can have enough tickets to reach the
    // 15,000 tier but only enough stake to reach the 9,000 tier, and gets
    // paid 9,000, not 15,000 -- the ticket count alone is not sufficient.
    const TICKET_TIERS = [[800, 2500], [1000, 4500], [1200, 6000], [1500, 7000], [2000, 9000], [2500, 15000]];
    const SALES_TIERS = [[150000, 2500], [200000, 4500], [300000, 6000], [400000, 7000], [500000, 9000], [800000, 15000]];
    const tierOf = (value, tiers) => { let result = 0; for (const [threshold, amt] of tiers) if ((value || 0) >= threshold) result = amt; return result; };
    const b = Math.min(tierOf(tier10Tickets, TICKET_TIERS), tierOf(tier10Stake, SALES_TIERS));
    if (b) supplemental.push({ agentUsername: u, type: "bonus", amount: b });
    // Palliative: confirmed formula, verified 136/137 exact against a real
    // 150-agent reference (the one exception has an internal inconsistency
    // in the source sheet itself -- its own uplifted commission is LOWER
    // than its base commission, backwards from every other row, so it's
    // being treated as a data error in the source, not a formula miss).
    // Eligibility: stake >= 200,000 AND tickets >= 800 (both from this same
    // tier10 row, not Block A's figures). When eligible: 50% of this row's
    // own Profit, minus the uplifted commission, minus Bonus, floored at 0,
    // capped at 10,000. Computed here rather than read from the sheet --
    // this is the whole point of confirming the formula: no manual work
    // needed to get this number going forward.
    const palEligible = (tier10Stake || 0) >= 200000 && (tier10Tickets || 0) >= 800;
    const palRaw = palEligible ? 0.5 * (tier10Profit || 0) - (commUplift || 0) - (b || 0) : 0;
    const p = palEligible ? Math.min(10000, Math.max(0, palRaw)) : 0;
    if (p) supplemental.push({ agentUsername: u, type: "palliative", amount: p });
    // Gift: confirmed formula, verified 136/137 against the same real
    // reference dataset. A shared ceiling of MIN(20000, 35% x this row's
    // own Profit - Commission(1.10%)) covers Palliative + Gift together --
    // Palliative takes its share first (already computed above, capped at
    // 10,000 on its own separate 50% formula), and Gift is whatever's left
    // of the 20,000 ceiling after that. No separate eligibility gate needed
    // here -- Palliative's own eligibility already determines how much of
    // the ceiling it consumes, and Gift naturally gets the full ceiling
    // when Palliative was 0 (ineligible or profit too low to reach 10,000).
    const giftCeiling = Math.min(20000, Math.max(0, 0.35 * (tier10Profit || 0) - (commUplift || 0)));
    const g = Math.max(0, giftCeiling - p);
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
  // moneyWin (the raw "MoneyWin" column, one before "payout"/"MoneyPayout")
  // is captured so Reports can show a real Total Wins vs. Total Payout vs.
  // Pending Payout split -- confirmed against real per-agent rows: the two
  // are usually identical, but genuinely differ for some agents (a real,
  // not-yet-settled difference), so this is an honest figure, not a
  // fabricated split. Only wired up for these three products because
  // that's what was actually verified; Globalbet/Sports don't get a
  // moneyWin field here and fall back to "not available" rather than a
  // guessed number.
  const blocks = [
    ["LUCKYBALL", { username: 1, tickets: 2, stake: 3, moneyWin: 4, payout: 5, profit: 6, commission: 7, type: 8 }],
    ["LUCKYGREECK", { username: 13, tickets: 14, stake: 15, moneyWin: 16, payout: 17, profit: 18, commission: 19, bonus: 20, balance: 21, type: 23 }],
    ["ROCKET_MAN", { username: 27, tickets: 28, stake: 29, moneyWin: 30, payout: 31, profit: 32, commission: 33, type: 34 }],
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
        moneyWin: cols.moneyWin !== undefined ? money(get(row, cols.moneyWin)) : null,
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
  // Monthly bonus formula confirmed against real August 2026 data: exactly
  // 10% of total commission received, zero mismatches across every agent
  // tested. The sheet's own supplemental column (read below) already
  // reflects this exactly, so no separate calculation is needed here --
  // this comment documents WHY these numbers are correct, not a TODO.
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
  // Monthly bonus formula confirmed against real August 2026 data: exactly
  // (30% x Profit) - Commission, applied unconditionally to every agent --
  // no minimum-ticket floor, no zero-floor (a loss-making agent gets a
  // negative monthly bonus, confirmed against real negative examples).
  // Verified 196/196 exact matches, zero mismatches. The five blocks
  // extracted below (ABOVE_100, ALL_100_AND_BELOW, OTHER_STATES, AKWA_IBOM,
  // AKWA_IBOM_ABOVE_100) already correctly capture every agent's value
  // computed this way, including the Akwa-Ibom-specific segments -- no
  // separate calculation needed, this documents WHY these numbers are
  // correct, not a TODO.
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
function aggregateBatches(batches, blockRules = DEFAULT_BLOCK_RULES, adjustments = [], fortyPercentAgents = new Set(), noSupplementalAgents = new Set()) {
  const agentMap = new Map();
  const productAgg = new Map();
  const stateAgg = new Map();
  const mismatches = [];
  const appliedAdjustments = [];
  const adjustmentMap = new Map();
  for (const adj of adjustments) adjustmentMap.set(adjustmentKey(adj.batchId, adj.agentUsername, adj.sourceBlock), adj);
  let verifiedCount = 0, unverifiedCount = 0, mismatchCount = 0, overrideCount = 0, adjustedCount = 0;

  const PRODUCT_OF = productOf;

  // Globalbet-specific: cashier sub-account money no longer rolls into either
  // format (confirmed reversal -- cashier commission isn't actually paid), so
  // the tree-hierarchy export (GB:FIN_OVERVIEW) and the legacy flat export
  // (GB:BLOCK_A) now report the SAME agent-own-row number for the same
  // agent. That means uploading both for the same period would double-count
  // if both were allowed to contribute -- so when both are present, the
  // legacy file is treated as authoritative (it's also the only source for
  // Bonus/Palliative/Gift) and the tree file's contribution for that same
  // agent is suppressed, the mirror image of the priority this used to have
  // before the reversal.
  const legacyCoveredGBAgents = new Set();
  for (const batch of batches) {
    for (const item of batch.items) {
      if (item.sourceBlock === "GB:BLOCK_A") legacyCoveredGBAgents.add(item.agentUsername.toLowerCase());
    }
  }

  for (const batch of batches) {
    for (const item of batch.items) {
      if (EXCLUDED_BLOCKS.has(item.sourceBlock) || !STRUCTURALLY_TRUSTED.has(item.sourceBlock)) continue;
      if (item.isHouse) continue;
      if (item.sourceBlock === "GB:FIN_OVERVIEW" && legacyCoveredGBAgents.has(item.agentUsername.toLowerCase())) continue;
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
      // Confirmed against 29/29 real agents, exact match: Globalbet agents
      // on the "40% on profit" plan are paid MAX(0, 40% x Profit) --
      // NOT the sheet's own Commission column, which reflects a different
      // (lower) calculation entirely. This actively replaces the sheet's
      // value for these specific agents, the same way the online-exclusion
      // policy does -- both are confirmed business rules that override what
      // the sheet shows, not just a cross-check. Scoped to Globalbet blocks
      // only (GB:BLOCK_A / GB:FIN_OVERVIEW); the plan concept doesn't apply
      // to other products.
      const isFortyPercentPlan = fortyPercentAgents.has(item.agentUsername.toLowerCase())
        && (item.sourceBlock === "GB:BLOCK_A" || item.sourceBlock === "GB:FIN_OVERVIEW") && !adjustment;
      const payableCommission = adjustment ? adjustment.adjustedCommission
        : isOnlinePolicyZero ? 0
        : isFortyPercentPlan ? Math.max(0, 0.40 * (item.profit || 0))
        : isOverride ? calc : (item.commissionAmount || 0);
      if (adjustment) {
        adjustedCount++;
        appliedAdjustments.push({
          id: adjustment.id, agent: item.agentUsername, block: item.sourceBlock, batch: batch.filename, batchId: batch.id,
          original: adjustment.originalCommission, adjusted: adjustment.adjustedCommission,
          reason: adjustment.reason, createdBy: adjustment.createdBy, createdAt: adjustment.createdAt,
        });
      } else if (isFortyPercentPlan) verifiedCount++;
      else if (isOverride) overrideCount++;
      else if (verified === true) verifiedCount++;
      else if (verified === false) { mismatchCount++; mismatches.push({ agent: item.agentUsername, block: item.sourceBlock, type: item.commissionType, source: item.commissionAmount, calculated: calc, diff, diffPct, batch: batch.filename, batchId: batch.id }); }
      else unverifiedCount++;

      const key = item.agentUsername.toLowerCase();
      if (!agentMap.has(key)) {
        agentMap.set(key, {
          username: item.agentUsername, state: meta.stateName, channel: meta.channel,
          tickets: 0, stake: 0, payout: 0, profit: 0, sourceCommission: 0, calcCommission: 0,
          monthlyBonus: 0, bonus: 0, palliative: 0, gift: 0, products: new Set(), allVerified: true, hasOverride: false, hasAdjustment: false,
          totalEarnings: null, balance: null, avgStake: null, onFortyPercentPlan: fortyPercentAgents.has(key),
          onNoSupplementalPlan: noSupplementalAgents.has(key), moneyWin: 0, hasMoneyWinData: false, commissionType: null,
        });
      }
      const a = agentMap.get(key);
      a.tickets += item.tickets || 0; a.stake += item.stake || 0; a.payout += item.payout || 0;
      a.profit += item.profit || 0; a.sourceCommission += payableCommission;
      if (item.moneyWin !== null && item.moneyWin !== undefined) { a.moneyWin += item.moneyWin; a.hasMoneyWinData = true; }
      if (item.commissionType) a.commissionType = item.commissionType;
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

      if (!productAgg.has(prod)) productAgg.set(prod, { name: prod, tickets: 0, stake: 0, payout: 0, profit: 0, commission: 0, agents: new Set() });
      const p = productAgg.get(prod);
      p.tickets += item.tickets || 0; p.stake += item.stake || 0; p.payout += item.payout || 0; p.profit += item.profit || 0; p.commission += payableCommission;
      p.agents.add(key);

      const st = meta.stateName || "Unknown";
      if (!stateAgg.has(st)) stateAgg.set(st, { state: st, stake: 0, payout: 0, profit: 0, commission: 0, agents: new Set() });
      const s = stateAgg.get(st);
      s.stake += item.stake || 0; s.payout += item.payout || 0; s.profit += item.profit || 0; s.commission += payableCommission;
      s.agents.add(key);
    }
  }
  // Separate top-level pass, after every batch's items have built the full
  // agentMap -- not nested inside the items loop above. Supplemental payments
  // (bonus/palliative/gift/monthly_bonus) need their agent to already exist
  // in agentMap, and with the Globalbet tree+legacy merge, the batch that
  // creates an agent's entry (the tree file) and the batch carrying their
  // bonus (the legacy file) can be uploaded, and therefore processed, in
  // either order -- this ensures a bonus is never silently dropped just
  // because its batch happened to be processed before the one with the
  // matching stake/commission items.
  for (const batch of batches) {
    for (const supp of batch.supplemental) {
      // Every supplemental payment type counts toward monthlyBonus (the combined
      // total used everywhere else) -- but bonus/palliative/gift are also tracked
      // individually so each can be checked against the sheet on its own, not just
      // as one blended number. Online agents are excluded here too, confirmed
      // explicitly: the "no commission for online accounts" policy covers every
      // payment type, not just the per-transaction commission -- so a bonus line
      // for an elb- agent is real money in the sheet but zero here, same as
      // their commission, not paid through this system at all.
      const key = supp.agentUsername.toLowerCase();
      if (!agentMap.has(key)) continue;
      const a = agentMap.get(key);
      if (a.channel === "online") continue;
      // Confirmed: agents on either Globalbet plan type ("40% on profit" or
      // "no_supplemental_pay") get NO Bonus/Palliative/Gift at all --
      // verified against real data for the 40% plan; no_supplemental_pay is
      // a confirmed negotiated arrangement (001fc-gwa-spareshop) with the
      // same effective treatment for supplemental pay, but normal weekly
      // commission (unlike the 40% plan, which also overrides commission --
      // see the isFortyPercentPlan check above, computed independently of
      // this exclusion).
      if (fortyPercentAgents.has(key) || noSupplementalAgents.has(key)) continue;
      const amt = supp.amount || 0;
      a.monthlyBonus += amt;
      if (supp.type === "bonus") a.bonus += amt;
      else if (supp.type === "palliative") a.palliative += amt;
      else if (supp.type === "gift") a.gift += amt;
    }
  }

  const agents = Array.from(agentMap.values()).map(a => ({ ...a, products: Array.from(a.products) }))
    .sort((a, b) => b.stake - a.stake).map((a, i) => ({ ...a, rank: i + 1 }));
  const products = Array.from(productAgg.values()).map(p => ({ ...p, agentCount: p.agents.size }))
    .sort((a, b) => b.stake - a.stake);
  const states = Array.from(stateAgg.values()).map(s => ({ ...s, agentCount: s.agents.size }))
    .sort((a, b) => b.stake - a.stake);

  return {
    agents, products, states, mismatches, adjustments: appliedAdjustments,
    stats: { verifiedCount, unverifiedCount, mismatchCount, overrideCount, adjustedCount },
    totals: {
      stake: agents.reduce((s, a) => s + a.stake, 0), payout: agents.reduce((s, a) => s + a.payout, 0),
      profit: agents.reduce((s, a) => s + a.profit, 0), commission: agents.reduce((s, a) => s + a.sourceCommission, 0),
      monthlyBonus: agents.reduce((s, a) => s + a.monthlyBonus, 0),
      moneyWin: agents.reduce((s, a) => s + a.moneyWin, 0),
      hasMoneyWinData: agents.some(a => a.hasMoneyWinData),
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

/* ============================================================ inactive agents & drop-in-sales (confirmed rules) */
// Confirmed: "inactive" = zero stake for the 2 most recent periods of a
// product, but with real activity at some earlier point -- distinguishes a
// genuinely-gone-quiet agent from one who simply never had activity (an
// unknown/new username isn't "inactive", it's just absent). "Drop in
// sales" = stake fell 10%+ vs the immediately preceding period -- reuses
// the exact same per-agent, per-product period ordering as computeTrends,
// so the two stay consistent with each other and with the Overview trend
// badges rather than silently drifting apart with their own logic.
function computeInactiveAndDropAgents(batches, inactivePeriods = 2, dropPct = 10) {
  const byType = {};
  for (const b of batches) (byType[b.type] ||= []).push(b);
  const sortKey = (b) => new Date(b.periodStart || b.uploadedAt);
  for (const t in byType) byType[t].sort((a, b) => sortKey(a) - sortKey(b));

  const stakeByAgent = (batch) => {
    const byAgent = {};
    for (const item of batch.items) {
      if (EXCLUDED_BLOCKS.has(item.sourceBlock) || !STRUCTURALLY_TRUSTED.has(item.sourceBlock) || item.isHouse) continue;
      const key = item.agentUsername.toLowerCase();
      byAgent[key] = (byAgent[key] || 0) + (item.stake || 0);
    }
    return byAgent;
  };

  const inactive = [], dropped = [];
  for (const type in byType) {
    const list = byType[type];
    if (list.length < inactivePeriods + 1) continue; // need history before the inactive window to confirm they were ever real
    const periodsWithStake = list.map(b => ({ batch: b, stake: stakeByAgent(b) }));
    const recentWindow = periodsWithStake.slice(-inactivePeriods);
    const beforeWindow = periodsWithStake.slice(0, -inactivePeriods);

    const everActive = new Set();
    for (const p of beforeWindow) for (const u in p.stake) if (p.stake[u] > 0) everActive.add(u);

    for (const u of everActive) {
      const zeroThroughout = recentWindow.every(p => !(p.stake[u] > 0));
      if (zeroThroughout) {
        const lastActive = [...beforeWindow].reverse().find(p => p.stake[u] > 0);
        inactive.push({ username: u, product: type, periodsInactive: inactivePeriods, lastActivePeriodEnd: lastActive?.batch.periodEnd || null });
      }
    }

    if (list.length >= 2) {
      const latest = periodsWithStake[periodsWithStake.length - 1].stake;
      const prev = periodsWithStake[periodsWithStake.length - 2].stake;
      const agents = new Set([...Object.keys(latest), ...Object.keys(prev)]);
      for (const u of agents) {
        const latestStake = latest[u] || 0, prevStake = prev[u] || 0;
        if (prevStake <= 0) continue; // no prior stake means no meaningful "drop" to measure
        const deltaPct = ((latestStake - prevStake) / prevStake) * 100;
        if (deltaPct <= -dropPct) {
          dropped.push({ username: u, product: type, prevStake, latestStake, deltaPct });
        }
      }
    }
  }
  return { inactive, dropped };
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
  computeInactiveAndDropAgents,
};
