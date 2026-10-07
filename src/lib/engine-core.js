
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
// Cashier-style usernames (e.g. "gokana-cashier1") carry no state/branch code of
// their own; Xpool gives their parent, so state and channel are read from that.
function decodeItemAgent(item) {
  const own = decodeAgent(item.agentUsername);
  return own.channel === "unknown" && item.parentUsername ? decodeAgent(item.parentUsername) : own;
}
function isHouseAgent(username) {
  return decodeAgent(username).channel === "unknown";
}

/* ============================================================ file type detection */
function detectFileType(filename, headText) {
  const f = filename.toLowerCase();
  // The Xpool "Agent Breakdown" export is named after the report, not the
  // product, so it's recognised by its header row instead.
  if (headText && /^"?Agent"?\s*,\s*"?Depth"?\s*,\s*"?Scope"?\s*,\s*"?Parent"?\s*,\s*"?Bets"?/i.test(String(headText).replace(/^\uFEFF/, "").trim())) return "XP";
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

// ---- Globalbet weekly pay: one implementation, used by BOTH formats ----------
// Globalbet's own report gives each agent a base Commission. The "Up to 10%" plan
// pays that PLUS a flat 10% ("Commission (1.10%)"): verified exactly on 274 of 274
// default-plan agents across two real weekly sheets, zero exceptions.
const GB_COMMISSION_UPLIFT = 1.10;
const GB_TICKET_TIERS = [[800, 2500], [1000, 4500], [1200, 6000], [1500, 7000], [2000, 9000], [2500, 15000]];
const GB_SALES_TIERS = [[150000, 2500], [200000, 4500], [300000, 6000], [400000, 7000], [500000, 9000], [800000, 15000]];
function gbTierOf(value, tiers) { let result = 0; for (const [threshold, amt] of tiers) if ((value || 0) >= threshold) result = amt; return result; }
// Bonus (weekly "fuel money"): the LOWER of the ticket-count tier and the sales
// tier, each decided independently. Palliative: eligible at stake >= 200,000 AND
// tickets >= 800; 50% of Profit minus the uplifted commission minus Bonus, floored
// at 0, capped at 10,000. Gift: whatever is left of a shared ceiling of
// MIN(20,000, 35% of Profit minus the uplifted commission) after Palliative.
// All three verified against real sheets (see the notes in parseGBLegacyTiered).
function deriveGlobalbetSupplemental({ tickets, stake, profit, uplift }) {
  const bonus = Math.min(gbTierOf(tickets, GB_TICKET_TIERS), gbTierOf(stake, GB_SALES_TIERS));
  const palEligible = (stake || 0) >= 200000 && (tickets || 0) >= 800;
  const palRaw = palEligible ? 0.5 * (profit || 0) - (uplift || 0) - (bonus || 0) : 0;
  const palliative = palEligible ? Math.min(10000, Math.max(0, palRaw)) : 0;
  const giftCeiling = Math.min(20000, Math.max(0, 0.35 * (profit || 0) - (uplift || 0)));
  const gift = Math.max(0, giftCeiling - palliative);
  return { bonus, palliative, gift };
}

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

    // Total In is GROSS. The weekly sheet (and Globalbet's own Profit column)
    // use it NET of Reversal -- verified: sheet stake == Total In - Reversal for
    // 177 of 177 agents, whereas gross Total In matches only the 140 with no
    // reversal. Ignoring this overstated stake (and every tier that depends on
    // it) for any agent with a reversed ticket.
    const reversal = money(get(nextRow, 14));
    const tickets = money(get(row, 3)), stake = (money(get(nextRow, 5)) || 0) - (reversal || 0), payout = money(get(nextRow, 6));
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
  // What the sheet itself printed for each agent's pay, kept so the dashboard's own calculation can be checked
  // against it (a different answer is either a sheet error or a rule the dashboard doesn't know about).
  const sheetFigures = [];
  for (const row of rows.slice(3)) {
    const u = String(get(row, 30)).trim();
    if (!u || isHouseAgent(u)) continue;
    tier10ByAgent[u.toLowerCase()] = {
      commission: money(get(row, 40)), totalEarnings: money(get(row, 44)),
      balance: money(get(row, 45)), avgStake: money(get(row, 46)),
    };
    sheetFigures.push({ agentUsername: u, commission: money(get(row, 40)), bonus: money(get(row, 41)), palliative: money(get(row, 42)), gift: money(get(row, 43)), totalEarnings: money(get(row, 44)) });
    const tier10Tickets = money(get(row, 31)), tier10Stake = money(get(row, 32)), tier10Profit = money(get(row, 38));
    const commUplift = money(get(row, 40));
    // Bonus / Palliative / Gift: confirmed formulas (bonus verified 147/149, palliative
    // and gift 136/137 against real sheets; the exceptions are explained -- see
    // deriveGlobalbetSupplemental). Computed here from this tier10 row's OWN
    // tickets, stake and profit and its uplifted commission, not read from the sheet.
    const d = deriveGlobalbetSupplemental({ tickets: tier10Tickets, stake: tier10Stake, profit: tier10Profit, uplift: commUplift });
    if (d.bonus) supplemental.push({ agentUsername: u, type: "bonus", amount: d.bonus });
    if (d.palliative) supplemental.push({ agentUsername: u, type: "palliative", amount: d.palliative });
    if (d.gift) supplemental.push({ agentUsername: u, type: "gift", amount: d.gift });
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
  return { items, supplemental, sheetFigures };
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

// Xpool "Agent Breakdown" export. It is a HIERARCHY, not a flat list, so it must
// not be summed row by row: "subtree" rows are roll-ups (a parent's own sales
// PLUS all its children), "own (direct)" rows are the parent's own sales, and
// "own" rows are individual agents or cashier accounts. Taking every row
// except "subtree" gives each agent's own sales exactly once -- verified
// against a real export: it reproduces Xpool's on-screen totals to the naira
// (1,758 bets, 2,081,726 stake, 279,257.65 commission), while summing all
// rows overstates stake by about 74%. Per agent only (owner-confirmed): no
// parent/child rollup. Cashier accounts are kept under their own username,
// as Xpool reports them, with the parent recorded for later.
function parseXP(rows) {
  const header = (rows[0] || []).map(h => String(h).replace(/^\uFEFF/, "").trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const c = { agent: col("agent"), depth: col("depth"), scope: col("scope"), parent: col("parent"), bets: col("bets"),
    stake: col("stake"), payout: col("payout"), gross: col("gross profit"), comm: col("commission") };
  const missing = Object.entries(c).filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length) throw new Error(`This doesn't look like an Xpool Agent Breakdown export -- missing column(s): ${missing.join(", ")}.`);
  const num = (v) => { const n = Number(String(v ?? "").trim()); return Number.isFinite(n) ? n : 0; };
  const r2 = (n) => Math.round(n * 100) / 100;

  const items = [];
  let ownStake = 0, topStake = 0, ownBets = 0, topBets = 0;
  for (const row of rows.slice(1)) {
    const name = String(row[c.agent] ?? "").trim();
    if (!name) continue;
    const scope = String(row[c.scope] ?? "").trim().toLowerCase();
    const depth = num(row[c.depth]);
    const parent = String(row[c.parent] ?? "").trim();
    if (depth === 0) { topStake += num(row[c.stake]); topBets += num(row[c.bets]); }
    if (scope === "subtree") continue; // roll-up rows would double-count
    let agent = name, sourceAgent = null;
    if (scope === "own (direct)") { const m = /^Own sales \((.+)\)$/i.exec(name); agent = m ? m[1].trim() : parent; }
    else if (depth === 0 && scope === "own" && parent && parent.toLowerCase() !== name.toLowerCase() && /-cashier\d+$/i.test(name)) {
      // Owner decision: a cashier account's sales belong to its parent agent.
      // The original username is kept (sourceAgentUsername) so the roll-up can
      // always be traced back to exactly what Xpool reported.
      agent = parent; sourceAgent = name;
    }
    ownStake += num(row[c.stake]); ownBets += num(row[c.bets]);
    items.push({
      agentUsername: agent, sourceAgentUsername: sourceAgent,
      parentUsername: parent && parent.toLowerCase() !== agent.toLowerCase() ? parent : null,
      sourceBlock: "XP:OWN", tickets: num(row[c.bets]), stake: r2(num(row[c.stake])), payout: r2(num(row[c.payout])),
      profit: r2(num(row[c.gross])), commissionAmount: r2(num(row[c.comm])), commissionType: null, balance: null,
      moneyWin: null, isHouse: false, // cashier usernames don't match the agent pattern, but they are not "house"
    });
  }
  // Integrity guard: the agents we kept must add up to the file's own top-level
  // rows. If they don't, the export isn't shaped the way this parser assumes,
  // and importing it would silently misreport sales -- so refuse instead.
  if (Math.abs(ownStake - topStake) > 0.5 || Math.abs(ownBets - topBets) > 0.5) {
    throw new Error(`This Xpool export doesn't reconcile: per-agent rows total stake ${ownStake} / ${ownBets} bets, but its top-level rows total ${topStake} / ${topBets}. Not imported, to avoid misreporting.`);
  }
  return { items, supplemental: [] };
}

const PARSERS = { GB: parseGB, EB: parseEB, EB_MB: parseEBMB, SP: parseSP, SP_MB: parseSPMB, XP: parseXP };

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
  "XP:OWN",
]);
// Blocks whose commission the SOURCE backoffice calculates AND pays itself
// (Xpool, confirmed by the owner). That commission is reported, not payable
// by us: it's tracked separately (reportedCommission), never added to payable
// commission totals, and never put through our commission verification. Keyed
// on the block name because that's what survives a save and reload.
const PAID_BY_SOURCE_BLOCKS = new Set(["XP:OWN"]);
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
  if (block.startsWith("XP:")) return "Xpool";
  return "Other";
}
function aggregateBatches(batches, blockRules = DEFAULT_BLOCK_RULES, adjustments = [], fortyPercentAgents = new Set(), noSupplementalAgents = new Set(), overrides = [], opts = {}) {
  const agentMap = new Map();
  const productAgg = new Map();
  const stateAgg = new Map();
  const mismatches = [];
  const appliedAdjustments = [];
  const adjustmentMap = new Map();
  for (const adj of adjustments) adjustmentMap.set(adjustmentKey(adj.batchId, adj.agentUsername, adj.sourceBlock), adj);
  // Review & Adjust: a person's correction of one agent's Bonus / Palliative / Gift for ONE week.
  // Keyed by batch so it can never leak into another week of the same agent.
  const overrideKey = (batchId, agent, field) => `${batchId}|${String(agent).toLowerCase()}|${field}`;
  const overrideMap = new Map();
  for (const o of overrides) overrideMap.set(overrideKey(o.batchId, o.agentUsername, o.field), o);
  const appliedOverrides = [];
  const lines = [];   // optional per-line view for the Review page: what each source line actually pays
  let verifiedCount = 0, unverifiedCount = 0, mismatchCount = 0, overrideCount = 0, adjustedCount = 0, reportedOnlyCount = 0;

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
  // A legacy sheet suppresses the tree only for the SAME period. (It used to do so
  // across all periods, so viewing two weeks together silently dropped any week that
  // had only a tree file for an agent who had a sheet in another week.) Same period
  // means the ranges overlap by at least half of the shorter one, so a one-day
  // boundary difference still counts as the same week while adjacent weeks do not.
  // If either period is unknown the old, conservative behaviour applies (suppress).
  const dayMs = 86400000;
  const periodDays = (b) => (b.periodStart && b.periodEnd) ? Math.max(1, Math.round((new Date(b.periodEnd) - new Date(b.periodStart)) / dayMs) + 1) : null;
  const samePeriod = (x, y) => {
    const dx = periodDays(x), dy = periodDays(y);
    if (dx === null || dy === null) return true;
    const start = Math.max(new Date(x.periodStart), new Date(y.periodStart)), end = Math.min(new Date(x.periodEnd), new Date(y.periodEnd));
    const overlap = Math.max(0, Math.round((end - start) / dayMs) + 1);
    return overlap >= 0.5 * Math.min(dx, dy);
  };
  const legacyBatchesByAgent = new Map();
  for (const batch of batches) {
    for (const item of batch.items) {
      if (item.sourceBlock !== "GB:BLOCK_A") continue;
      const k = item.agentUsername.toLowerCase();
      if (!legacyBatchesByAgent.has(k)) legacyBatchesByAgent.set(k, []);
      legacyBatchesByAgent.get(k).push(batch);
    }
  }
  const coveredByLegacy = (item, batch) => (legacyBatchesByAgent.get(item.agentUsername.toLowerCase()) || []).some(lb => samePeriod(lb, batch));
  const derivedSupplemental = [];   // bonus/palliative/gift worked out for weeks that have only the tree file

  for (const batch of batches) {
    for (const item of batch.items) {
      if (EXCLUDED_BLOCKS.has(item.sourceBlock) || !STRUCTURALLY_TRUSTED.has(item.sourceBlock)) continue;
      if (item.isHouse) continue;
      if (item.sourceBlock === "GB:FIN_OVERVIEW" && coveredByLegacy(item, batch)) continue;
      const meta = decodeItemAgent(item);
      let calc, confidence, verified, diff, diffPct, isOverride;
      if (PAID_BY_SOURCE_BLOCKS.has(item.sourceBlock)) {
        // The source backoffice calculates and pays this commission itself, so
        // there's nothing here for us to verify or to pay.
        calc = item.commissionAmount;
        confidence = "paid by the source backoffice -- reported, not verified or payable here";
        verified = null; diff = undefined; diffPct = undefined; isOverride = false;
      } else if (meta.channel === "online") {
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
      const paidBySource = PAID_BY_SOURCE_BLOCKS.has(item.sourceBlock);
      const payableCommission = paidBySource ? 0 : adjustment ? adjustment.adjustedCommission
        : isOnlinePolicyZero ? 0
        : isFortyPercentPlan ? Math.max(0, 0.40 * (item.profit || 0))
        : isOverride ? calc
        : (item.sourceBlock === "GB:FIN_OVERVIEW" && !noSupplementalAgents.has(item.agentUsername.toLowerCase()))
          ? (item.commissionAmount || 0) * GB_COMMISSION_UPLIFT     // tree reports the BASE commission; the plan pays base + 10%
        : (item.commissionAmount || 0);
      if (opts.lines) lines.push({ batchId: batch.id, agent: item.agentUsername, block: item.sourceBlock, sheetCommission: item.commissionAmount || 0, payableCommission, adjusted: !!adjustment });
      if (item.sourceBlock === "GB:FIN_OVERVIEW" && !adjustment && !isFortyPercentPlan && meta.channel !== "online") {
        // Tree-only week: work out Bonus / Palliative / Gift from the tree's own figures with the
        // same verified formulas the legacy sheet path uses. The policy exclusions (online, 40% plan,
        // no_supplemental_pay) are applied once, in the supplemental pass below.
        const d = deriveGlobalbetSupplemental({ tickets: item.tickets, stake: item.stake, profit: item.profit, uplift: (item.commissionAmount || 0) * GB_COMMISSION_UPLIFT });
        for (const type of ["bonus", "palliative", "gift"]) if (d[type]) derivedSupplemental.push({ batchId: batch.id, agentUsername: item.agentUsername, type, amount: d[type] });
      }
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
      else if (paidBySource) reportedOnlyCount++;
      else unverifiedCount++;

      const key = item.agentUsername.toLowerCase();
      if (!agentMap.has(key)) {
        agentMap.set(key, {
          username: item.agentUsername, state: meta.stateName, channel: meta.channel,
          tickets: 0, stake: 0, payout: 0, profit: 0, sourceCommission: 0, calcCommission: 0,
          monthlyBonus: 0, bonus: 0, palliative: 0, gift: 0, products: new Set(), allVerified: true, hasOverride: false, hasAdjustment: false,
          totalEarnings: null, balance: null, avgStake: null, hasEdit: false, editedFields: [], hasGB: false, gbItems: 0, gbTickets: 0, gbStake: 0, gbProfit: 0, gbCommission: 0, onFortyPercentPlan: fortyPercentAgents.has(key),
          onNoSupplementalPlan: noSupplementalAgents.has(key), moneyWin: 0, hasMoneyWinData: false, commissionType: null, reportedCommission: 0,
        });
      }
      const a = agentMap.get(key);
      a.tickets += item.tickets || 0; a.stake += item.stake || 0; a.payout += item.payout || 0;
      a.profit += item.profit || 0; a.sourceCommission += payableCommission;
      if (paidBySource) a.reportedCommission += item.commissionAmount || 0;
      if (item.sourceBlock.startsWith("GB:")) { a.hasGB = true; a.gbItems++; a.gbTickets += item.tickets || 0; a.gbStake += item.stake || 0; a.gbProfit += item.profit || 0; a.gbCommission += payableCommission; }
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
  const suppEntries = [...batches.flatMap(b => b.supplemental.map(sp => ({ ...sp, batchId: b.id }))), ...derivedSupplemental];
  const batchIds = new Set(batches.map(b => b.id));
  const consumed = new Set();
  const addSupp = (a, type, amt) => {
    a.monthlyBonus += amt;
    if (type === "bonus") a.bonus += amt;
    else if (type === "palliative") a.palliative += amt;
    else if (type === "gift") a.gift += amt;
  };
  const noteOverride = (o, a, systemValue) => {
    a.hasEdit = true; if (!a.editedFields.includes(o.field)) a.editedFields.push(o.field);
    appliedOverrides.push({ id: o.id, batchId: o.batchId, agent: a.username, field: o.field, system: systemValue, override: o.overrideValue,
      original: o.originalValue, reason: o.reason, createdBy: o.createdBy, createdAt: o.createdAt });
  };
  for (const supp of suppEntries) {
    const key = supp.agentUsername.toLowerCase();
    if (!agentMap.has(key)) continue;
    const a = agentMap.get(key);
    // A person's override for this exact agent, week and payment type replaces the calculated amount and
    // beats every automatic rule below (online exclusion, 40% plan, no_supplemental_pay): it is the most
    // specific instruction there is, the same precedence a manual commission adjustment has.
    const ok = overrideKey(supp.batchId, key, supp.type);
    const ov = overrideMap.get(ok);
    if (ov) { consumed.add(ok); noteOverride(ov, a, supp.amount || 0); addSupp(a, supp.type, ov.overrideValue); continue; }
    // Every supplemental payment type counts toward monthlyBonus (the combined total used everywhere
    // else) -- but bonus/palliative/gift are also tracked individually so each can be checked on its
    // own. Online agents are excluded (the "no commission for online accounts" policy covers every
    // payment type), and so are agents on either Globalbet plan type that carries no supplemental pay
    // ("40% on profit" and "no_supplemental_pay"; the latter keeps normal weekly commission).
    if (a.channel === "online") continue;
    if (fortyPercentAgents.has(key) || noSupplementalAgents.has(key)) continue;
    addSupp(a, supp.type, supp.amount || 0);
  }
  // An override can also ADD a payment the system calculated as nothing (e.g. a one-off gift).
  for (const [ok, ov] of overrideMap) {
    if (consumed.has(ok) || !batchIds.has(ov.batchId)) continue;
    const a = agentMap.get(String(ov.agentUsername).toLowerCase());
    if (!a) continue;
    noteOverride(ov, a, 0); addSupp(a, ov.field, ov.overrideValue);
  }

  // Avg Stake / Total Earnings / Balance (Globalbet). The sheet prints these per week, but they
  // are not stored, and the sheet's value is a single week's -- so: use the sheet's figure only
  // when exactly one Globalbet week is involved and it supplied one; otherwise work them out
  // from the Globalbet-only tallies. Same identities as the sheet (verified: Total Earnings =
  // commission + bonus + palliative + gift; Balance = Profit - Total Earnings; Avg Stake =
  // stake / tickets), so the figures agree wherever both exist.
  for (const a of agentMap.values()) {
    if (!a.hasGB || a.channel === "online") continue;
    const multi = a.gbItems > 1 || a.hasEdit || a.hasAdjustment;   // an edited agent's printed total no longer applies
    if ((multi || a.avgStake === null) && a.gbTickets > 0) a.avgStake = a.gbStake / a.gbTickets;
    if (multi || a.totalEarnings === null) a.totalEarnings = a.gbCommission + a.bonus + a.palliative + a.gift;
    if (multi || a.balance === null) a.balance = a.gbProfit - a.totalEarnings;
  }

  const agents = Array.from(agentMap.values()).map(a => ({ ...a, products: Array.from(a.products) }))
    .sort((a, b) => b.stake - a.stake).map((a, i) => ({ ...a, rank: i + 1 }));
  const products = Array.from(productAgg.values()).map(p => ({ ...p, agentCount: p.agents.size }))
    .sort((a, b) => b.stake - a.stake);
  const states = Array.from(stateAgg.values()).map(s => ({ ...s, agentCount: s.agents.size }))
    .sort((a, b) => b.stake - a.stake);

  return {
    agents, products, states, mismatches, adjustments: appliedAdjustments, overrides: appliedOverrides, lines,
    stats: { verifiedCount, unverifiedCount, mismatchCount, overrideCount, adjustedCount, reportedOnlyCount },
    totals: {
      stake: agents.reduce((s, a) => s + a.stake, 0), payout: agents.reduce((s, a) => s + a.payout, 0),
      profit: agents.reduce((s, a) => s + a.profit, 0), commission: agents.reduce((s, a) => s + a.sourceCommission, 0),
      monthlyBonus: agents.reduce((s, a) => s + a.monthlyBonus, 0),
      moneyWin: agents.reduce((s, a) => s + a.moneyWin, 0),
      hasMoneyWinData: agents.some(a => a.hasMoneyWinData),
      reportedCommission: agents.reduce((s, a) => s + a.reportedCommission, 0),
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
  computeInactiveAndDropAgents, deriveGlobalbetSupplemental, GB_COMMISSION_UPLIFT,
};
