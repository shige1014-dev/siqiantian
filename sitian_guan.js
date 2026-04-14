// sitian_guan.js v2 — 诗歌・三轨采集+Telegram推送
// 修复: yahoo-finance2 v3 API + node-fetch ESM兼容

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const YF = require("yahoo-finance2").default;
const yahooFinance = new YF({ suppressNotices: ["yahooSurvey"] });


const FRED_API_KEY = process.env.FRED_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// node-fetch v3是ESM，用动态import兼容CommonJS
async function _fetch(...args) {
  const { default: f } = await import("node-fetch");
  return f(...args);
}

const THRESHOLDS = {
  VIX: { warn: 25, critical: 35 },
  fear_greed: { extreme_fear: 20, extreme_greed: 80 },
};

function round(v, d = 4) { return Number(Number(v).toFixed(d)); }

function getStatus(value, warn, critical = null) {
  if (critical !== null && value >= critical) return "critical";
  if (value >= warn) return "warning";
  return "normal";
}

async function fetchHeaven() {
  const result = {};
  const tickers = { VIX: "^VIX", TNX: "^TNX", DXY: "DX-Y.NYB" };
  for (const [name, symbol] of Object.entries(tickers)) {
    try {
      const data = await yahooFinance.chart(symbol, {
        period1: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10),
        interval: "1d",
      });
      const quotes = (data?.quotes || []).filter((q) => q.close != null);
      if (!quotes.length) throw new Error("no data");
      const last = Number(quotes[quotes.length - 1].close);
      const prev = quotes.length > 1 ? Number(quotes[quotes.length - 2].close) : last;
      const st = name === "VIX" ? getStatus(last, THRESHOLDS.VIX.warn, THRESHOLDS.VIX.critical) : "normal";
      result[name] = { value: round(last), delta_1d: round(last - prev), status: st };
    } catch (e) { result[name] = { error: e.message }; }
  }
  return result;
}

async function fetchEarth() {
  const series = { FEDFUNDS: "联邦基金利率", UNRATE: "失业率", M2SL: "M2货币供应", CPIAUCSL: "CPI" };
  const result = {};
  for (const [code, label] of Object.entries(series)) {
    try {
      const url = "https://api.stlouisfed.org/fred/series/observations?" +
        new URLSearchParams({ series_id: code, api_key: FRED_API_KEY, file_type: "json", sort_order: "asc" });
      const res = await _fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const obs = (data.observations || []).filter((o) => o.value !== ".");
      if (!obs.length) throw new Error("no data");
      const last = Number(obs[obs.length - 1].value);
      const prev = obs.length > 1 ? Number(obs[obs.length - 2].value) : last;
      result[code] = { label, value: round(last), delta: round(last - prev), status: "normal" };
    } catch (e) { result[code] = { error: e.message }; }
  }
  return result;
}

async function fetchHuman() {
  try {
    const res = await _fetch("https://api.alternative.me/fng/?limit=2&format=json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const today = payload?.data?.[0];
    if (!today) throw new Error("no data");
    const value = Number(today.value);
    const label = today.value_classification;
    let st = "normal";
    if (value <= THRESHOLDS.fear_greed.extreme_fear) st = "extreme_fear";
    else if (value >= THRESHOLDS.fear_greed.extreme_greed) st = "extreme_greed";
    return { fear_greed: { value, label, status: st } };
  } catch (e) { return { fear_greed: { error: e.message } }; }
}

function evaluateAlert(heaven, earth, human) {
  const alerts = [];
  const vix = heaven?.VIX || {};
  if (vix.status === "critical") alerts.push({ track: "天轨", indicator: "VIX", level: "CRITICAL" });
  else if (vix.status === "warning") alerts.push({ track: "天轨", indicator: "VIX", level: "WARNING" });
  const fg = human?.fear_greed || {};
  if (["extreme_fear", "extreme_greed"].includes(fg.status))
    alerts.push({ track: "人轨", indicator: "fear_greed", level: "WARNING" });
  if (alerts.length >= 2) return ["CRITICAL", alerts];
  if (alerts.length === 1) return ["WARNING", alerts];
  return ["ROUTINE", []];
}

function formatMessage(report) {
  const h = report.heaven_track || {};
  const e = report.earth_track || {};
  const fg = report.human_track?.fear_greed || {};
  const icon = report.mode === "CRITICAL" ? "🔴" : report.mode === "WARNING" ? "⚠️" : "✅";
  return [
    `${icon} *诗歌奏报* | ${report.timestamp.slice(0,16).replace("T"," ")}`,
    `级别: \`${report.mode}\``,
    "",
    `*天轨*  VIX:\`${h.VIX?.value??'ERR'}\` TNX:\`${h.TNX?.value??'ERR'}\` DXY:\`${h.DXY?.value??'ERR'}\``,
    `*地轨*  FFR:\`${e.FEDFUNDS?.value??'ERR'}%\` UNRATE:\`${e.UNRATE?.value??'ERR'}%\``,
    `*人轨*  恐贪:\`${fg.value??'ERR'}\` — ${fg.label??''}`,
    "",
    `📋 ${report.summary}`,
  ].join("\n");
}

async function sendTelegram(report) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const res = await _fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: formatMessage(report), parse_mode: "Markdown" }),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
  console.log("✅ Telegram推送成功");
}

async function run() {
  console.log("诗歌启动 — 三轨采集中...\n");
  const heaven = await fetchHeaven();
  console.log(`天轨 ✓  VIX=${heaven?.VIX?.value??'ERR'}  TNX=${heaven?.TNX?.value??'ERR'}  DXY=${heaven?.DXY?.value??'ERR'}`);
  const earth = await fetchEarth();
  console.log(`地轨 ✓  FFR=${earth?.FEDFUNDS?.value??'ERR'}  UNRATE=${earth?.UNRATE?.value??'ERR'}`);
  const human = await fetchHuman();
  console.log(`人轨 ✓  恐贪=${human?.fear_greed?.value??'ERR'}  (${human?.fear_greed?.label??''})\n`);

  const [mode, alerts] = evaluateAlert(heaven, earth, human);
  const report = {
    timestamp: new Date().toISOString(),
    reporter: "诗歌",
    mode, alert_level: mode,
    heaven_track: heaven, earth_track: earth, human_track: human,
    alerts,
    summary: mode === "ROUTINE" ? "三轨常态，无异动。" : `异动：${JSON.stringify(alerts)}`,
    action_required: mode !== "ROUTINE",
  };

  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(__dirname, "sitian_report.json"), JSON.stringify(report, null, 2));
  console.log("\n报告已写入: sitian_report.json");

  if (report.action_required) await sendTelegram(report);
  else console.log("常态，无需推送");
}

run().catch((e) => { console.error("诗歌运行失败:", e); process.exit(1); });
