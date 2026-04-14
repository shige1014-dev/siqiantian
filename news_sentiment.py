from dotenv import load_dotenv
load_dotenv()
"""
news_sentiment.py — 新闻情绪分析
抓取财经新闻 → Claude/GPT分析情绪 → 输出情绪评分
接入诗歌人轨第三维度
"""

import os
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta

NEWS_API_KEY = os.environ.get("NEWS_API_KEY", "")

# 监测关键词（文明跃迁七赛道+宏观）
KEYWORDS = [
    "Federal Reserve", "inflation", "recession", "tariff",
    "NVDA", "quantum computing", "nuclear energy", "SpaceX",
    "AI chip", "semiconductor", "interest rate"
]

SENTIMENT_RULES = {
    # 负面词
    "negative": [
        "crash", "collapse", "recession", "crisis", "bankruptcy",
        "layoff", "tariff", "sanction", "war", "inflation spike",
        "rate hike", "sell-off", "bear", "plunge", "tumble", "fear"
    ],
    # 正面词
    "positive": [
        "rally", "surge", "breakthrough", "beat", "record",
        "cut rates", "bull", "growth", "profit", "upgrade",
        "acquisition", "partnership", "approval", "boom"
    ]
}


def fetch_news(query: str, days: int = 1) -> list:
    """从NewsAPI抓取新闻"""
    from_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    params = urllib.parse.urlencode({
        "q": query,
        "from": from_date,
        "sortBy": "relevancy",
        "language": "en",
        "pageSize": 10,
        "apiKey": NEWS_API_KEY
    })
    url = f"https://newsapi.org/v2/everything?{params}"
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            data = json.loads(r.read())
        return data.get("articles", [])
    except Exception as e:
        return []


def simple_sentiment(text: str) -> dict:
    """基于关键词的简单情绪分析"""
    text_lower = text.lower()
    neg_count = sum(1 for w in SENTIMENT_RULES["negative"] if w in text_lower)
    pos_count = sum(1 for w in SENTIMENT_RULES["positive"] if w in text_lower)

    if neg_count > pos_count:
        label = "negative"
        score = -min(neg_count / 3, 1.0)
    elif pos_count > neg_count:
        label = "positive"
        score = min(pos_count / 3, 1.0)
    else:
        label = "neutral"
        score = 0.0

    return {"label": label, "score": round(score, 2), "neg": neg_count, "pos": pos_count}


def analyze_market_sentiment() -> dict:
    """分析整体市场情绪"""
    all_articles = []

    # 抓取宏观新闻
    macro_queries = ["Federal Reserve inflation", "stock market today", "recession risk"]
    for query in macro_queries:
        articles = fetch_news(query)
        all_articles.extend(articles[:3])

    if not all_articles:
        return {
            "status": "error",
            "error": "无法获取新闻",
            "sentiment_score": 0,
            "label": "neutral"
        }

    # 分析每篇文章
    scores = []
    headlines = []
    for article in all_articles[:10]:
        title = article.get("title", "")
        description = article.get("description", "") or ""
        text = f"{title} {description}"
        result = simple_sentiment(text)
        scores.append(result["score"])
        headlines.append({
            "title": title[:80],
            "sentiment": result["label"],
            "score": result["score"]
        })

    # 综合评分
    avg_score = round(sum(scores) / len(scores), 2) if scores else 0

    if avg_score <= -0.3:
        overall_label = "bearish"
        status = "warning"
    elif avg_score >= 0.3:
        overall_label = "bullish"
        status = "normal"
    else:
        overall_label = "neutral"
        status = "normal"

    return {
        "status": status,
        "sentiment_score": avg_score,
        "label": overall_label,
        "article_count": len(headlines),
        "headlines": headlines[:5],
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


def format_for_telegram(result: dict) -> str:
    icon = "🐻" if result["label"] == "bearish" else "🐂" if result["label"] == "bullish" else "➡️"
    lines = [
        f"{icon} *新闻情绪分析*",
        f"综合评分: `{result['sentiment_score']}` — {result['label']}",
        f"分析文章: {result['article_count']}篇",
        "",
        "*热点标题:*"
    ]
    for h in result.get("headlines", [])[:3]:
        emoji = "🔴" if h["sentiment"] == "negative" else "🟢" if h["sentiment"] == "positive" else "⚪"
        lines.append(f"{emoji} {h['title']}")
    return "\n".join(lines)


if __name__ == "__main__":
    print("新闻情绪分析启动...\n")
    result = analyze_market_sentiment()
    print(json.dumps(result, ensure_ascii=False, indent=2))

    # 输出给诗歌人轨
    output_path = os.path.join(os.path.dirname(__file__), "news_sentiment.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\n情绪报告写入: {output_path}")
