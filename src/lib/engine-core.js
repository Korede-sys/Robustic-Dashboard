
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
  const s = String(v).trim().replace(/,/g, "");
  if (s === "" || s === "-") return null;
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

/* ============================================================ block parsers
   Column offsets ported 1:1 from the parser validated against real exports. */
function get(row, i) {
  if (i === null || i === undefined || i === "") return "";
  return i < row.length ? row[i] : "";
}

function parseGB(rows) {
  const items = [], supplemental = [];
  // Block A is the true, complete per-agent total (stake/payout/profit/commission).
  // Block B and TIER_UP10 were confirmed, against the real file, to re-list the SAME
  // agents' SAME numbers verbatim -- they exist to show which commission tier each
  // agent falls into, not to report separate activity. Counting them as separate line
  // items double-counts real stake. Only TIER_UP10's bonus/palliative/gift columns are
  // genuinely new information, so those are still captured as supplemental payments.
  for (const row of rows.slice(3)) {
    const u = String(get(row, 1)).trim();
    if (!u) continue;
    items.push({
      agentUsername: u, sourceBlock: "GB:BLOCK_A",
      tickets: money(get(row, 2)), stake: money(get(row, 3)), payout: money(get(row, 4)),
      profit: money(get(row, 9)), commissionAmount: money(get(row, 10)), commissionType: null,
      balance: null, isHouse: isHouseAgent(u),
    });
  }
  for (const row of rows.slice(3)) {
    const u = String(get(row, 30)).trim();
    if (!u || isHouseAgent(u)) continue;
    const b = money(get(row, 41)), p = money(get(row, 42)), g = money(get(row, 43));
    if (b) supplemental.push({ agentUsername: u, type: "bonus", amount: b });
    if (p) supplemental.push({ agentUsername: u, type: "palliative", amount: p });
    if (g) supplemental.push({ agentUsername: u, type: "gift", amount: g });
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
   being wired in here — see the Formulas tab for the evidence. */
const TYPE_RULE_BLOCKS = new Set(["EB:LUCKYBALL", "EB:LUCKYGREECK", "EB:ROCKET_MAN", "EB_MB:BASE"]);
const CONFIRMED_BLOCK_RULES = {
  "SP:35PCT": { basis: "profit", rate: 0.35, confidence: "confirmed" },
  "SP:POOL": { basis: "profit", rate: 0.15, confidence: "tentative (only 3 samples)" },
};
const STRUCTURALLY_TRUSTED = new Set([
  "EB:LUCKYBALL", "EB:LUCKYGREECK", "EB:ROCKET_MAN", "EB_MB:BASE",
  "SP:35PCT", "SP:UP30PCT", "SP:3RD_PARTY", "SP:POOL",
  "GB:BLOCK_A",
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

function computeCommission(item) {
  let rule = null;
  if (item.sourceBlock in CONFIRMED_BLOCK_RULES) {
    rule = CONFIRMED_BLOCK_RULES[item.sourceBlock];
  } else if (TYPE_RULE_BLOCKS.has(item.sourceBlock)) {
    const r = parseTypeRate(item.commissionType);
    if (r) rule = { ...r, confidence: "confirmed (per-agent Type)" };
  }
  if (!rule) return { calc: item.commissionAmount, confidence: "unverified — no confirmed formula, using source value", verified: null };
  const base = rule.basis === "stake" ? item.stake : item.profit;
  if (base === null || base === undefined) return { calc: item.commissionAmount, confidence: rule.confidence, verified: null };
  const calc = Math.max(0, base * rule.rate);
  const src = item.commissionAmount ?? 0;
  const diff = src - calc;
  const diffPct = calc ? (diff / calc) * 100 : (src === 0 ? 0 : null);
  const verified = Math.abs(diff) <= 1 || (diffPct !== null && Math.abs(diffPct) <= 0.5);
  return { calc, confidence: rule.confidence, verified, diff, diffPct };
}

/* ============================================================ aggregation */
function aggregateBatches(batches) {
  const agentMap = new Map();
  const productAgg = new Map();
  const stateAgg = new Map();
  const mismatches = [];
  let verifiedCount = 0, unverifiedCount = 0, mismatchCount = 0;

  const PRODUCT_OF = (block) => {
    if (block.startsWith("GB:")) return "Globalbet Virtual";
    if (block === "EB:LUCKYBALL") return "Luckyball";
    if (block === "EB:LUCKYGREECK") return "Luckygreek";
    if (block === "EB:ROCKET_MAN") return "Rocket Man";
    if (block === "EB_MB:BASE") return "Luckyball (Monthly)";
    if (block.startsWith("SP_MB:")) return "Sports (Monthly)";
    if (block.startsWith("SP:")) return "Sports";
    return "Other";
  };

  for (const batch of batches) {
    for (const item of batch.items) {
      if (EXCLUDED_BLOCKS.has(item.sourceBlock) || !STRUCTURALLY_TRUSTED.has(item.sourceBlock)) continue;
      if (item.isHouse) continue;
      const { calc, confidence, verified, diff, diffPct } = computeCommission(item);
      if (verified === true) verifiedCount++;
      else if (verified === false) { mismatchCount++; mismatches.push({ agent: item.agentUsername, block: item.sourceBlock, type: item.commissionType, source: item.commissionAmount, calculated: calc, diff, diffPct, batch: batch.filename }); }
      else unverifiedCount++;

      const key = item.agentUsername.toLowerCase();
      const meta = decodeAgent(item.agentUsername);
      if (!agentMap.has(key)) {
        agentMap.set(key, {
          username: item.agentUsername, state: meta.stateName, channel: meta.channel,
          tickets: 0, stake: 0, payout: 0, profit: 0, sourceCommission: 0, calcCommission: 0,
          monthlyBonus: 0, products: new Set(), allVerified: true,
        });
      }
      const a = agentMap.get(key);
      a.tickets += item.tickets || 0; a.stake += item.stake || 0; a.payout += item.payout || 0;
      a.profit += item.profit || 0; a.sourceCommission += item.commissionAmount || 0;
      a.calcCommission += calc || 0;
      if (verified === false) a.allVerified = false;
      const prod = PRODUCT_OF(item.sourceBlock);
      a.products.add(prod);

      if (!productAgg.has(prod)) productAgg.set(prod, { name: prod, stake: 0, payout: 0, profit: 0, commission: 0 });
      const p = productAgg.get(prod);
      p.stake += item.stake || 0; p.payout += item.payout || 0; p.profit += item.profit || 0; p.commission += item.commissionAmount || 0;

      const st = meta.stateName || "Unknown";
      if (!stateAgg.has(st)) stateAgg.set(st, { state: st, stake: 0, payout: 0, profit: 0, commission: 0, agents: new Set() });
      const s = stateAgg.get(st);
      s.stake += item.stake || 0; s.payout += item.payout || 0; s.profit += item.profit || 0; s.commission += item.commissionAmount || 0;
      s.agents.add(key);
    }
    for (const supp of batch.supplemental) {
      if (supp.type !== "monthly_bonus") continue;
      const key = supp.agentUsername.toLowerCase();
      if (!agentMap.has(key)) continue;
      agentMap.get(key).monthlyBonus += supp.amount || 0;
    }
  }

  const agents = Array.from(agentMap.values()).map(a => ({ ...a, products: Array.from(a.products) }))
    .sort((a, b) => b.stake - a.stake).map((a, i) => ({ ...a, rank: i + 1 }));
  const products = Array.from(productAgg.values()).sort((a, b) => b.stake - a.stake);
  const states = Array.from(stateAgg.values()).map(s => ({ ...s, agentCount: s.agents.size }))
    .sort((a, b) => b.stake - a.stake);

  return {
    agents, products, states, mismatches,
    stats: { verifiedCount, unverifiedCount, mismatchCount },
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
  for (const t in byType) byType[t].sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt));

  const agentTrend = {};
  let hasEnoughData = false;

  const stakeByAgent = (batch) => {
    const m = {};
    for (const item of batch.items) {
      if (EXCLUDED_BLOCKS.has(item.sourceBlock) || !STRUCTURALLY_TRUSTED.has(item.sourceBlock) || item.isHouse) continue;
      const key = item.agentUsername.toLowerCase();
      m[key] = (m[key] || 0) + (item.stake || 0);
    }
    return m;
  };

  for (const type in byType) {
    const list = byType[type];
    if (list.length < 2) continue;
    hasEnoughData = true;
    const latestM = stakeByAgent(list[list.length - 1]);
    const prevM = stakeByAgent(list[list.length - 2]);
    const agents = new Set([...Object.keys(latestM), ...Object.keys(prevM)]);
    for (const u of agents) {
      if (!agentTrend[u]) agentTrend[u] = { latestStake: 0, prevStake: 0 };
      agentTrend[u].latestStake += latestM[u] || 0;
      agentTrend[u].prevStake += prevM[u] || 0;
    }
  }
  for (const u in agentTrend) {
    const t = agentTrend[u];
    t.deltaPct = t.prevStake > 0 ? ((t.latestStake - t.prevStake) / t.prevStake) * 100 : (t.latestStake > 0 ? null : 0);
  }
  return { hasEnoughData, agentTrend };
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
  PARSERS, detectFileType, aggregateBatches, computeCommission, computeTrends, computeBatchSeries,
  decodeAgent, money, toCSV, EXCLUDED_BLOCKS, STRUCTURALLY_TRUSTED,
};
