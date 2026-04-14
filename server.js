// server.js v2 — 串联版 + FinancialJuice 实时快讯 + 川普板块
import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 7076;
const DIARY_PATH = path.join(process.env.HOME, "STOCK_DIARY");

// ── 股票/人物/主题 关联词 ─────────────────────────────────
const STOCK_MAP = {
  "NVDA": ["nvidia","jensen huang","blackwell","gb200","h100","cuda"],
  "TSM": ["tsmc","taiwan semiconductor","2nm","3nm"],
  "IONQ": ["ionq","quantum","qubit"],
  "RKLB": ["rocket lab","rklb","neutron"],
  "PLTR": ["palantir","pltr"],
  "GOOGL": ["google","deepmind","gemini","alphabet"],
  "MSFT": ["microsoft","azure","openai","copilot"],
  "AMZN": ["amazon","aws","anthropic"],
  "META": ["meta","llama","zuckerberg"],
  "AMD": ["amd","mi300","lisa su"],
  "ASML": ["asml","euv"],
  "BTC": ["bitcoin","btc","crypto"],
  "ETH": ["ethereum","eth"],
  "BRK": ["berkshire","buffett"],
  "TSLA": ["tesla","elon","musk"],
  "COIN": ["coinbase"],
  "ARM": ["arm holdings"],
  "SPY": ["federal reserve","fed","interest rate","inflation"],
  "GLD": ["gold","safe haven"],
  "OIL": ["oil","crude","opec","wti","brent"],
  "XOM": ["exxon","chevron"],
  "IRAN": ["iran","hormuz","strait"],
};

const PEOPLE_MAP = {
  "黄仁勋": ["jensen huang","黄仁勋"],
  "巴菲特": ["buffett","warren","巴菲特"],
  "木头姐": ["cathie wood","ark invest","木头姐"],
  "魏哲家": ["cc wei","魏哲家"],
  "川普": ["trump","donald"],
  "鲍威尔": ["powell","jerome"],
};

const THEME_MAP = {
  "AI范式": ["artificial intelligence","ai model","llm","foundation model"],
  "半导体替代": ["chip substitution","export control","domestic chip"],
  "量子计算": ["quantum","qubit"],
  "商业航天": ["rocket","launch","satellite","space"],
  "加密货币": ["crypto","bitcoin","ethereum","blockchain"],
  "中东局势": ["iran","israel","hormuz","opec","oil attack","drone"],
  "川普政策": ["trump","tariff","trade war","executive order","truth social"],
};

const TRACK_MAP = {
  "投资人动向": "人轨",
  "科技突破": "天轨",
  "宏观拐点": "天轨",
  "地轨": "地轨",
  "个股": "地轨",
};

// ── 川普关键词 ────────────────────────────────────────────
const TRUMP_KW = [
  "trump","donald","mar-a-lago","maga","truth social",
  "tariff","trade war","executive order","white house press",
  "trump says","trump tells","trump warns","trump signs",
  "trump threatens","trump announces"
];

// ── 重要性评分 ────────────────────────────────────────────
const HIGH_KW = [
  "fed","federal reserve","interest rate","inflation","recession","gdp","cpi","nonfarm",
  "opec","oil","iran","hormuz","war","sanction","nuclear","attack","strike",
  "bitcoin","crypto","etf","halving","crash","rally","bankruptcy","collapse",
  "nvidia","semiconductor","chip","ai","tariff","trade"
];

function scoreNews(title) {
  const t = title.toLowerCase();
  let s = 3;
  HIGH_KW.forEach(k => { if (t.includes(k)) s += 1; });
  if (/break|crash|emergency|halt|urgent|breaking/.test(t)) s += 2;
  if (TRUMP_KW.some(k => t.toLowerCase().includes(k))) s += 1.5;
  return Math.min(parseFloat(s.toFixed(1)), 10);
}

function isTrump(title) {
  const t = title.toLowerCase();
  return TRUMP_KW.some(k => t.includes(k));
}

function findRelated(text, map) {
  const lower = text.toLowerCase();
  return Object.entries(map)
    .filter(([_, kws]) => kws.some(kw => lower.includes(kw)))
    .map(([name]) => name);
}

// ── Google 免费翻译 ───────────────────────────────────────
function translate(text) {
  if (/[\u4e00-\u9fff]/.test(text)) return Promise.resolve(text); // 已是中文
  return new Promise((resolve) => {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text.slice(0, 200))}`;
    const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const result = data[0].map(item => item[0]).filter(Boolean).join("");
          resolve(result || text);
        } catch { resolve(text); }
      });
    });
    req.on("error", () => resolve(text));
    req.setTimeout(5000, () => { req.destroy(); resolve(text); });
  });
}

// ── 抓取 FinancialJuice RSS ───────────────────────────────
const FJ_RSS = "https://www.financialjuice.com/feed.ashx?xy=rss";

function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("too many redirects"));
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 ZeroZero-Feeder/2.0" }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function parseRSS(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const rawTitle = (b.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || b.match(/<title>(.*?)<\/title>/))?.[1]?.trim() ?? "";
    const title = rawTitle.replace(/^FinancialJuice:\s*/i, "").trim();
    const link = b.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? "";
    const pub = b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? "";
    if (title && title.length > 10) {
      items.push({ title, titleZh: title, link, pub, score: scoreNews(title), trump: isTrump(title), stocks: findRelated(title, STOCK_MAP) });
    }
  }
  return items;
}

async function translateItems(items) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    process.stdout.write(`\r[FJ] 翻译 ${i+1}/${items.length}...`);
    const titleZh = await translate(items[i].title);
    out.push({ ...items[i], titleZh });
    await new Promise(r => setTimeout(r, 80));
  }
  process.stdout.write("\n");
  return out;
}

// ── FJ 缓存（避免重复） ───────────────────────────────────
let fjCache = { items: [], lastFetch: 0 };

async function getFJNews(force = false) {
  const now = Date.now();
  if (!force && fjCache.items.length && (now - fjCache.lastFetch) < 5 * 60 * 1000) {
    return fjCache.items;
  }
  try {
    console.log("[FJ] 抓取中...");
    const xml = await fetchUrl(FJ_RSS);
    const raw = parseRSS(xml).slice(0, 20);
    console.log(`[FJ] 抓到 ${raw.length} 条，开始翻译...`);
    const items = await translateItems(raw);
    fjCache = { items, lastFetch: now };
    console.log(`[FJ] 完成，${items.length} 条已翻译`);
    return items;
  } catch (e) {
    console.error("[FJ] 抓取失败:", e.message);
    return fjCache.items;
  }
}
// ── 写入 STOCK_DIARY ──────────────────────────────────────
function writeDiary(news) {
  if (!fs.existsSync(DIARY_PATH)) return;
  const today = new Date().toISOString().slice(0, 10);

  const signals = news.slice(0, 20).map(item => {
    const stocks = findRelated(item.title, STOCK_MAP);
    const people = findRelated(item.title, PEOPLE_MAP);
    const themes = findRelated(item.title, THEME_MAP);
    const track = TRACK_MAP[item.category] ?? "天轨";
    const stockLinks = stocks.map(s => `[[${s}]]`).join(" ");
    return {
      line: `- ${stockLinks ? stockLinks + " " : ""}${(item.titleZh || item.title).slice(0, 65)} #${track}`,
      stocks, people, themes, title: item.title, titleZh: item.titleZh, track
    };
  });

  const stocksMentioned = [...new Set(signals.flatMap(s => s.stocks))];
  const zeroPrompt = signals.slice(0, 4).map(s => `• ${(s.titleZh || s.title).slice(0, 50)}`).join("\n");

  const dailyDir = path.join(DIARY_PATH, "Daily");
  fs.mkdirSync(dailyDir, { recursive: true });
  const dailyPath = path.join(dailyDir, `${today}.md`);

  const content = `# ${today}

## 重要信号

${signals.map(s => s.line).join("\n")}

## 宏观背景

> 今日共 ${signals.length} 条信号，涉及：${stocksMentioned.map(s => `[[${s}]]`).join(" ")}

## 给零零

${zeroPrompt}

结合当前三轨状态告诉我你的判断。

## 待跟踪

- [ ] 跟进上述信号的后续验证
`;

  fs.writeFileSync(dailyPath, content, "utf8");

  for (const sig of signals) {
    for (const ticker of sig.stocks) {
      const cardPath = path.join(DIARY_PATH, "Stocks", `${ticker}.md`);
      if (!fs.existsSync(cardPath)) continue;
      let card = fs.readFileSync(cardPath, "utf8");
      const entry = `- ${today}：${(sig.titleZh || sig.title).slice(0, 60)}`;
      if (!card.includes(entry)) {
        card = card.replace(
          "<!-- 格式：- YYYY-MM-DD：核心信号一句话 #方向 -->",
          `<!-- 格式：- YYYY-MM-DD：核心信号一句话 #方向 -->\n${entry}`
        );
        fs.writeFileSync(cardPath, card, "utf8");
      }
    }
    for (const person of sig.people) {
      const cardPath = path.join(DIARY_PATH, "People", `${person}.md`);
      if (!fs.existsSync(cardPath)) continue;
      let card = fs.readFileSync(cardPath, "utf8");
      const entry = `- ${today}：${(sig.titleZh || sig.title).slice(0, 60)}`;
      if (!card.includes(entry)) {
        card = card.replace(
          "<!-- 格式：- YYYY-MM-DD：事件一句话 [[相关股票]] -->",
          `<!-- 格式：- YYYY-MM-DD：事件一句话 [[相关股票]] -->\n${entry}`
        );
        fs.writeFileSync(cardPath, card, "utf8");
      }
    }
    for (const theme of sig.themes) {
      const cardPath = path.join(DIARY_PATH, "Themes", `${theme}.md`);
      if (!fs.existsSync(cardPath)) continue;
      let card = fs.readFileSync(cardPath, "utf8");
      const entry = `- ${today}：${(sig.titleZh || sig.title).slice(0, 60)}`;
      if (!card.includes(entry)) {
        card = card.replace(
          "<!-- 格式：- YYYY-MM-DD：事件一句话 [[相关股票]] -->",
          `<!-- 格式：- YYYY-MM-DD：事件一句话 [[相关股票]] -->\n${entry}`
        );
        fs.writeFileSync(cardPath, card, "utf8");
      }
    }
  }

  return { today, count: signals.length, stocks: stocksMentioned, zeroPrompt };
}


// ── 写入重大新闻必读 → Obsidian ──────────────────────────
function writeMajorNews(major) {
  const today = new Date().toISOString().slice(0, 10);
  const filename = `${today} 重大新闻必读.md`;

  let md = `# ${today} 重大新闻必读\n\n`;
  md += `> 共 ${major.length} 条重大新闻（评分 ≥ 8），来自 FinancialJuice\n`;
  md += `> 更新时间：${new Date().toLocaleString("zh-CN")}\n\n`;

  major.forEach((n, i) => {
    const time = new Date(n.pub).toLocaleTimeString("zh-CN", {hour:"2-digit", minute:"2-digit"}) || "";
    const stocks = n.stocks?.length ? ` · ${n.stocks.join("/")}` : "";
    md += `## ${i+1}. ${n.titleZh || n.title}\n\n`;
    md += `- **评分**: ${n.score}/10${stocks}\n`;
    md += `- **时间**: ${time}\n`;
    if (n.titleZh && n.titleZh !== n.title) md += `- **原文**: ${n.title}\n`;
    if (n.trump) md += `- 🇺🇸 **川普相关**\n`;
    if (n.link) md += `- [原文链接](${n.link})\n`;
    md += `\n---\n\n`;
  });

  md += `## 给零零\n\n`;
  md += major.slice(0, 5).map(n => `• ${(n.titleZh || n.title).slice(0, 60)}`).join("\n");
  md += `\n\n结合当前三轨状态告诉我你的判断。\n`;

  // 写入 STOCK_DIARY/Daily/
  const dailyDir = path.join(DIARY_PATH, "Daily");
  let savedPath = null;
  if (fs.existsSync(DIARY_PATH)) {
    fs.mkdirSync(dailyDir, { recursive: true });
    savedPath = path.join(dailyDir, filename);
    fs.writeFileSync(savedPath, md, "utf8");
    console.log(`[重大新闻] 已写入: ${savedPath}`);
  }

  // 同时写到本地项目目录备份
  const localPath = path.join(__dirname, filename);
  fs.writeFileSync(localPath, md, "utf8");

  return { filename, savedPath, localPath };
}

// ── 主服务器 ──────────────────────────────────────────────
async function runFetch() {
  try {
    const { stdout, stderr } = await execAsync("node fetch.js", { cwd: __dirname });
    return { ok: true, output: stdout + stderr };
  } catch(e) { return { ok: false, output: e.message }; }
}

function getNews() {
  const p = path.join(__dirname, "news_raw.json");
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  // ── API: 抓取 Google 新闻 ────────────────────────────
  if (url.pathname === "/api/fetch") {
    res.setHeader("Content-Type", "application/json");
    const result = await runFetch();
    const news = getNews();
    let diary = null;
    if (result.ok && news.length) diary = writeDiary(news);
    res.end(JSON.stringify({ ...result, diary }));
    return;
  }

  // ── API: 读取 Google 新闻 ────────────────────────────
  if (url.pathname === "/api/news") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(getNews()));
    return;
  }

  // ── API: FinancialJuice 全部新闻 ─────────────────────
  if (url.pathname === "/api/fj") {
    res.setHeader("Content-Type", "application/json");
    const force = url.searchParams.get("force") === "1";
    const items = await getFJNews(force);
    res.end(JSON.stringify(items));
    return;
  }

  // ── API: 川普专区 ────────────────────────────────────
  if (url.pathname === "/api/trump") {
    res.setHeader("Content-Type", "application/json");
    const items = await getFJNews();
    const trumpNews = items.filter(n => n.trump);
    // 计算情绪
    const hawk = ["tariff","sanction","war","ban","threat","hell","attack","bomb","punish","shoot","fire","strike"];
    const dove = ["deal","agreement","negotiate","peace","lower","cut","talk","ceasefire","pause"];
    let h = 0, d = 0;
    trumpNews.forEach(n => {
      const t = n.title.toLowerCase();
      hawk.forEach(k => { if (t.includes(k)) h++; });
      dove.forEach(k => { if (t.includes(k)) d++; });
    });
    const total = h + d || 1;
    const hawkPct = Math.round(h / total * 100);
    const sentiment = hawkPct > 75 ? "极度鹰派 🦅🦅" : hawkPct > 55 ? "偏鹰派 🦅" : hawkPct > 35 ? "中性 ⚖️" : "偏鸽派 🕊";
    res.end(JSON.stringify({ items: trumpNews, hawkPct, sentiment, total: trumpNews.length }));
    return;
  }

  // ── API: 重大新闻必读 → 写入 Obsidian ───────────────
  if (url.pathname === "/api/major") {
    res.setHeader("Content-Type", "application/json");
    const items = await getFJNews();
    const major = items.filter(n => n.score >= 8);
    const result = writeMajorNews(major);
    res.end(JSON.stringify({ ok: true, count: major.length, ...result }));
    return;
  }

  // ── API: 日记 ────────────────────────────────────────
  if (url.pathname === "/api/diary") {
    res.setHeader("Content-Type", "application/json");
    const today = new Date().toISOString().slice(0, 10);
    const p = path.join(DIARY_PATH, "Daily", `${today}.md`);
    const content = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    res.end(JSON.stringify({ today, content }));
    return;
  }

  // ── 默认: 返回 index.html ────────────────────────────
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
});

server.listen(PORT, () => {
  console.log(`\n零零每日信号台 v2 已启动`);
  console.log(`浏览器访问: http://localhost:${PORT}`);
  console.log(`新增: /api/fj (FinancialJuice实时快讯)`);
  console.log(`新增: /api/trump (川普专区)\n`);
  // 启动时预热 FJ
  getFJNews(true).then(items => {
    console.log(`[FJ] 预热完成，加载 ${items.length} 条快讯`);
  }).catch(() => {});
});
