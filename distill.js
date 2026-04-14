// distill.js v6 — 提高英文新闻通过率
import fs from "fs";
import http from "http";

const INPUT_FILE  = "./signals_raw.json";
const OUTPUT_FILE = "./signals_distilled.json";
const MODEL       = "qwen2.5:3b";

const PHASE_VOCAB = {
  heaven: ["ai_paradigm_early_buildout","ai_paradigm_mid_cycle","capital_cycle_mid_phase","capital_cycle_late_phase","quantum_early_window","energy_transition_mid_phase"],
  earth:  ["ai_infrastructure_terrain","chip_supply_constraint","domestic_capacity_ramp","application_layer_bearing_split","regulation_boundary_shift","capacity_normalization"],
  human:  ["narrative_emergence","fomo_peak","consensus_fracture","disbelief_return","panic_release","apathy_floor"]
};

// 宽松的相关性预筛——先用关键词过滤，再送 Qwen 提纯
// 这样减少 Qwen 处理无关新闻的压力
const RELEVANT_KEYWORDS = [
  // 天轨
  /AI|artificial intelligence|machine learning|semiconductor|chip|quantum|Fed|Federal Reserve|interest rate|inflation|GDP|macro|paradigm|capital|investment|VC|IPO/i,
  // 地轨
  /supply chain|capacity|regulation|export control|infrastructure|datacenter|energy|grid|renewable|battery|manufacturing|production/i,
  // 人轨
  /market|stock|crypto|bitcoin|ethereum|sentiment|retail investor|fear|greed|narrative|hype|bubble|crash|rally|fund|ETF/i,
  // 中文
  /半导体|芯片|人工智能|量子|美联储|利率|通胀|供应链|产能|监管|基础设施|能源|散户|情绪|比特币|以太坊|市场/
];

function isRelevant(item) {
  const text = `${item.title} ${item.description ?? ""}`;
  return RELEVANT_KEYWORDS.some(kw => kw.test(text));
}

function ask(prompt) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.1, num_predict: 150 }
    }));
    const req = http.request({
      hostname: "localhost", port: 11434,
      path: "/api/generate", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": body.length }
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        try {
          const obj = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve(obj.response ?? "");
        } catch { resolve(""); }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

async function distillOne(item) {
  const phases = (PHASE_VOCAB[item.track] ?? []).join(", ");

  // 双语提示——中英文都给，提高理解率
  const prompt = `你是投资信号提纯器。分析新闻，只输出JSON。

News / 新闻:
Title: ${item.title}
Summary: ${item.description?.slice(0, 150) ?? ""}
Track / 轨道: ${item.track}
Phase options / 可选phase: ${phases}

Rules / 规则:
- If the news relates to macro economy, AI, semiconductors, energy, market sentiment, capital flows → relevant=true
- 如果新闻与宏观经济、AI、半导体、能源、市场情绪、资金流向相关 → relevant=true
- signal字段用中文写，一句话，不超过40字
- cursor_impact字段用中文写，说明对哪个游标有什么影响

Output JSON only / 只输出JSON:
{"relevant":true,"track":"${item.track}","phase":"选一个","signal":"中文一句话","confidence":0.7,"direction":"stable或strengthening或weakening","cursor_impact":"中文一句话"}`;

  try {
    const text = await ask(prompt);
    const clean = text.trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
    const m = clean.match(/\{[\s\S]*?\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]);
    if (p.relevant === false || p.relevant === "false") return null;
    if (!p.signal || p.signal.length < 5) return null;
    return {
      date: new Date().toISOString().slice(0, 10),
      source: item.source,
      track: item.track,
      phase: p.phase ?? "unknown",
      signal: p.signal,
      confidence: Number((p.confidence ?? 0.6).toFixed(2)),
      direction: p.direction ?? "stable",
      cursor_impact: p.cursor_impact ?? "",
      original_title: item.title,
      link: item.link ?? "",
      review_state: "pending",
      reality_verdict: "unresolved"
    };
  } catch { return null; }
}

function dedup(signals) {
  const kept = [];
  for (const sig of signals) {
    const dup = kept.some(k => {
      if (k.track !== sig.track) return false;
      const a = k.signal, b = sig.signal;
      let match = 0;
      for (let i = 0; i < Math.min(a.length, b.length) - 1; i++)
        if (b.includes(a.slice(i, i+2))) match++;
      return Math.min(a.length, b.length) > 4 && match / (Math.min(a.length, b.length) - 1) > 0.55;
    });
    if (!dup) kept.push(sig);
  }
  return kept;
}

async function main() {
  if (!fs.existsSync(INPUT_FILE)) { console.log("先跑 node fetch.js"); process.exit(1); }
  const raw = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));

  // 先用关键词预筛
  const prefiltered = raw.filter(isRelevant);
  console.log(`总条数：${raw.length} | 关键词预筛后：${prefiltered.length} 条`);

  const results = [];
  for (let i = 0; i < prefiltered.length; i++) {
    process.stdout.write(`\r提纯 ${i+1}/${prefiltered.length} | 通过 ${results.length} 条...`);
    const r = await distillOne(prefiltered[i]);
    if (r) results.push(r);
  }

  const deduped = dedup(results);
  console.log(`\n\n提纯通过：${results.length} | 去重后：${deduped.length}`);
  console.log(`天轨 ${deduped.filter(s=>s.track==="heaven").length} | 地轨 ${deduped.filter(s=>s.track==="earth").length} | 人轨 ${deduped.filter(s=>s.track==="human").length}`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(deduped, null, 2), "utf8");
}

main().catch(console.error);
