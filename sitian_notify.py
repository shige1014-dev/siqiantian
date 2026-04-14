#!/usr/bin/env python3
"""
司天官 — Telegram推送
读取 sitian_report.json，action_required=true 时推送预警
"""

import json
import os
import urllib.request
import urllib.parse

# ── 配置（从环境变量读取）──────────────────────────
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
CHAT_ID   = os.getenv("TELEGRAM_CHAT_ID", "")
REPORT    = os.path.join(os.path.dirname(__file__), "sitian_report.json")


def send(text: str):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": CHAT_ID,
        "text": text,
        "parse_mode": "Markdown"
    }).encode()
    urllib.request.urlopen(url, data=data, timeout=10)


def format_message(report: dict) -> str:
    mode  = report.get("alert_level", "ROUTINE")
    heaven = report.get("heaven_track", {})
    human  = report.get("human_track", {})
    earth  = report.get("earth_track", {})
    fg     = human.get("fear_greed", {})
    ts     = report.get("timestamp", "")[:16].replace("T", " ")

    icon = "🔴" if mode == "CRITICAL" else "⚠️" if mode == "WARNING" else "✅"

    lines = [
        f"{icon} *司天官奏报* | {ts}",
        f"级别: `{mode}`",
        "",
        "*天轨*",
        f"  VIX: `{heaven.get('VIX',{}).get('value','—')}` "
        f"(Δ{heaven.get('VIX',{}).get('delta_1d','—')})",
        f"  TNX: `{heaven.get('TNX',{}).get('value','—')}%`",
        f"  DXY: `{heaven.get('DXY',{}).get('value','—')}`",
        "",
        "*地轨*",
        f"  FFR: `{earth.get('FEDFUNDS',{}).get('value','—')}%`  "
        f"UNRATE: `{earth.get('UNRATE',{}).get('value','—')}%`",
        "",
        "*人轨*",
        f"  恐贪: `{fg.get('value','—')}` — {fg.get('label','')}",
        "",
        f"📋 {report.get('summary','')}",
    ]
    return "\n".join(lines)


def main():
    if not BOT_TOKEN or not CHAT_ID:
        print("缺少 TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID")
        return

    with open(REPORT, encoding="utf-8") as f:
        report = json.load(f)

    # 仅 action_required=true 时推送（常态不打扰）
    if not report.get("action_required", False):
        print("常态报告，无需推送。")
        return

    msg = format_message(report)
    send(msg)
    print("✅ 推送成功")


if __name__ == "__main__":
    main()
