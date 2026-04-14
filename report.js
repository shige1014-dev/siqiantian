// report.js — 生成每日新闻表格，直接供你喂给零零
import fs from "fs";

const INPUT_FILE = "./news_raw.json";
const OUTPUT_FILE = `./daily_report_${new Date().toISOString().slice(0,10)}.md`;

const CATEGORY_TRACK = {
  "投资人动向": "人轨",
  "科技突破": "天轨",
  "宏观拐点": "天轨",
};

function summarize(title, desc) {
  // 提取核心信息——去掉冗余，保留关键词
  const combined = `${title}. ${desc}`.slice(0, 200);
  return combined.replace(/\s+/g, " ").trim();
}

async function main() {
  if (!fs.existsSync(INPUT_FILE)) { console.log("先跑 node fetch.js"); process.exit(1); }
  const news = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));

  if (news.length === 0) { console.log("没有新新闻"); process.exit(0); }

  const date = new Date().toISOString().slice(0,10);
  let md = `# 零零每日信号表 ${date}\n\n`;
  md += `> 共 ${news.length} 条新闻，按类别整理。选择有价值的告诉零零。\n\n`;

  // 按类别分组
  const grouped = {};
  for (const item of news) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  for (const [category, items] of Object.entries(grouped)) {
    const track = CATEGORY_TRACK[category] ?? "天轨";
    md += `## ${category}（${track}）\n\n`;
    md += `| 核心内容 | 相关股票 | 来源 |\n`;
    md += `|---------|---------|------|\n`;
    for (const item of items) {
      const content = item.title.slice(0, 60);
      const stocks = item.stocks?.length ? item.stocks.join(", ") : "—";
      const source = item.source;
      md += `| ${content} | ${stocks} | ${source} |\n`;
    }
    md += "\n";
  }

  md += `---\n`;
  md += `\n## 喂给零零的格式\n\n`;
  md += `直接把上面的表格发给零零，或者选择最重要的几条说：\n\n`;
  md += `> "今天有几条重要信号：[粘贴内容]，结合当前三轨状态告诉我你的判断。"\n`;

  fs.writeFileSync(OUTPUT_FILE, md, "utf8");
  console.log(`\n✓ 报告生成：${OUTPUT_FILE}`);
  console.log(md);
}
main().catch(console.error);
