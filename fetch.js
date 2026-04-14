// fetch.js v3 — 含Google翻译
import fs from "fs";
import https from "https";
import http from "http";

const FEEDS = [
  { url: "https://news.google.com/rss/search?q=macro+economy+capital+cycle+2026&hl=en&gl=US&ceid=US:en", label: "Google-Macro", category: "宏观拐点" },
  { url: "https://news.google.com/rss/search?q=technology+paradigm+shift+AI+2026&hl=en&gl=US&ceid=US:en", label: "Google-TechShift", category: "科技突破" },
  { url: "https://news.google.com/rss/search?q=Federal+Reserve+rate+policy&hl=en&gl=US&ceid=US:en", label: "Google-Fed", category: "宏观拐点" },
  { url: "https://news.google.com/rss/search?q=AI+paradigm+investment+2026&hl=en&gl=US&ceid=US:en", label: "Google-AI", category: "科技突破" },
  { url: "https://news.google.com/rss/search?q=semiconductor+chip+supply+export+control&hl=en&gl=US&ceid=US:en", label: "Google-Chip", category: "地轨信号" },
  { url: "https://news.google.com/rss/search?q=AI+infrastructure+datacenter+capex&hl=en&gl=US&ceid=US:en", label: "Google-Infra", category: "地轨信号" },
  { url: "https://news.google.com/rss/search?q=China+semiconductor+domestic+substitution&hl=zh-CN&gl=CN&ceid=CN:zh-Hans", label: "Google-ChinaChip", category: "地轨信号" },
  { url: "https://news.google.com/rss/search?q=energy+transition+grid+renewable&hl=en&gl=US&ceid=US:en", label: "Google-Energy", category: "地轨信号" },
  { url: "https://news.google.com/rss/search?q=stock+market+retail+investor+sentiment&hl=en&gl=US&ceid=US:en", label: "Google-Sentiment", category: "人轨情绪" },
  { url: "https://news.google.com/rss/search?q=bitcoin+crypto+market+2026&hl=en&gl=US&ceid=US:en", label: "Google-Crypto", category: "人轨情绪" },
  { url: "https://news.google.com/rss/search?q=A股+散户+情绪&hl=zh-CN&gl=CN&ceid=CN:zh-Hans", label: "Google-AShare", category: "人轨情绪" },
];

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
  "SPY": ["federal reserve","fed","interest rate","inflation"],
  "GLD": ["gold","safe haven"],
  "OIL": ["oil","crude","opec"],
};

const CACHE_FILE = "./cache.json";
const OUTPUT_FILE = "./news_raw.json";
const MAX_PER_FEED = 5;

// Google Translate 免费接口
function translate(text) {
  // 中文内容不翻译
  if (/[\u4e00-\u9fff]/.test(text)) return Promise.resolve(text);
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

function findStocks(text) {
  const lower = text.toLowerCase();
  return Object.entries(STOCK_MAP)
    .filter(([_, kws]) => kws.some(kw => lower.includes(kw)))
    .map(([ticker]) => ticker);
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { headers: { "User-Agent": "Mozilla/5.0 ZeroZero-Feeder/3.0" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) { fetchUrl(res.headers.location).then(resolve).catch(reject); return; }
      let data = ""; res.on("data", c => data += c); res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function parseRSS(xml, feed) {
  const items = [], re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const title = (b.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || b.match(/<title>(.*?)<\/title>/))?.[1]?.trim() ?? "";
    const desc = (b.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || b.match(/<description>(.*?)<\/description>/))?.[1]?.replace(/<[^>]+>/g,"").trim().slice(0,200) ?? "";
    const link = b.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? "";
    if (title && title.length > 15) {
      items.push({ title, description: desc, link, source: feed.label, category: feed.category });
    }
    if (items.length >= MAX_PER_FEED) break;
  }
  return items;
}

async function main() {
  const cache = fs.existsSync(CACHE_FILE) ? new Set(JSON.parse(fs.readFileSync(CACHE_FILE,"utf8"))) : new Set();
  const raw = [];

  for (const feed of FEEDS) {
    try {
      process.stdout.write(`[${feed.category}] ${feed.label}... `);
      const xml = await fetchUrl(feed.url);
      const items = parseRSS(xml, feed).filter(i => !cache.has(i.link));
      raw.push(...items);
      items.forEach(i => cache.add(i.link));
      console.log(`${items.length} 条`);
    } catch(e) { console.log(`失败: ${e.message}`); }
  }

  // 翻译标题 + 匹配股票
  console.log(`\n翻译中...`);
  const all = [];
  for (let i = 0; i < raw.length; i++) {
    process.stdout.write(`\r翻译 ${i+1}/${raw.length}...`);
    const item = raw[i];
    const titleZh = await translate(item.title);
    const stocks = findStocks(item.title + " " + (item.description ?? ""));
    all.push({ ...item, titleZh, stocks });
    await new Promise(r => setTimeout(r, 100)); // 避免限速
  }

  console.log(`\n`);
  fs.writeFileSync(CACHE_FILE, JSON.stringify([...cache].slice(-5000)), "utf8");
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(all, null, 2), "utf8");
  console.log(`完成：${all.length} 条 | 天轨/地轨/人轨混合`);
}

main().catch(console.error);
