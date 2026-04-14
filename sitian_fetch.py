"""
司天官 — 三轨数据采集
天轨: yfinance (VIX/TNX/DXY)
地轨: fredapi (FEDFUNDS/UNRATE/M2SL/CPIAUCSL)
人轨: alternative.me (恐贪指数)
"""

import json
import os
from datetime import datetime, timezone

# --- 依赖检查 ---
try:
    import yfinance as yf
except ImportError:
    raise SystemExit("缺少依赖: pip install yfinance")

try:
    from fredapi import Fred
except ImportError:
    raise SystemExit("缺少依赖: pip install fredapi")

try:
    import urllib.request
except ImportError:
    raise SystemExit("urllib不可用")

# --- 配置 ---
FRED_API_KEY = os.getenv("FRED_API_KEY", "1f877ab126da43f6aed6b8d759f9e143")

# 阈值定义
THRESHOLDS = {
    "VIX":     {"warn": 25, "critical": 35},
    "TNX_1d":  {"warn": 0.15},   # 单日变动bp
    "DXY_7d":  {"warn": 1.5},    # 单周变动%
    "fear_greed": {"extreme_fear": 20, "extreme_greed": 80},
}


def status(value, warn, critical=None):
    if critical and value >= critical:
        return "critical"
    if value >= warn:
        return "warning"
    return "normal"


# ── 天轨 ──────────────────────────────────────────
def fetch_heaven():
    result = {}
    tickers = {"VIX": "^VIX", "TNX": "^TNX", "DXY": "DX-Y.NYB"}
    for name, symbol in tickers.items():
        try:
            t = yf.Ticker(symbol)
            hist = t.history(period="5d")
            if hist.empty:
                result[name] = {"error": "no data"}
                continue
            last = float(hist["Close"].iloc[-1])
            prev = float(hist["Close"].iloc[-2]) if len(hist) > 1 else last
            delta_1d = round(last - prev, 4)

            if name == "VIX":
                st = status(last,
                            THRESHOLDS["VIX"]["warn"],
                            THRESHOLDS["VIX"]["critical"])
            else:
                st = "normal"

            result[name] = {
                "value": round(last, 4),
                "delta_1d": delta_1d,
                "status": st
            }
        except Exception as e:
            result[name] = {"error": str(e)}
    return result


# ── 地轨 ──────────────────────────────────────────
def fetch_earth():
    fred = Fred(api_key=FRED_API_KEY)
    series = {
        "FEDFUNDS": "联邦基金利率",
        "UNRATE":   "失业率",
        "M2SL":     "M2货币供应",
        "CPIAUCSL": "CPI"
    }
    result = {}
    for code, label in series.items():
        try:
            s = fred.get_series(code)
            last_val = round(float(s.dropna().iloc[-1]), 4)
            prev_val = round(float(s.dropna().iloc[-2]), 4)
            delta = round(last_val - prev_val, 4)
            result[code] = {
                "label": label,
                "value": last_val,
                "delta": delta,
                "status": "normal"
            }
        except Exception as e:
            result[code] = {"error": str(e)}
    return result


# ── 人轨 ──────────────────────────────────────────
def fetch_human():
    try:
        url = "https://api.alternative.me/fng/?limit=2&format=json"
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())["data"]
        today = data[0]
        value = int(today["value"])
        label = today["value_classification"]

        if value <= THRESHOLDS["fear_greed"]["extreme_fear"]:
            st = "extreme_fear"
        elif value >= THRESHOLDS["fear_greed"]["extreme_greed"]:
            st = "extreme_greed"
        else:
            st = "normal"

        return {
            "fear_greed": {
                "value": value,
                "label": label,
                "status": st
            }
        }
    except Exception as e:
        return {"fear_greed": {"error": str(e)}}


# ── 阈值判断 ──────────────────────────────────────
def evaluate_alert(heaven, earth, human):
    alerts = []

    vix = heaven.get("VIX", {})
    if vix.get("status") == "critical":
        alerts.append({"track": "天轨", "indicator": "VIX", "level": "CRITICAL"})
    elif vix.get("status") == "warning":
        alerts.append({"track": "天轨", "indicator": "VIX", "level": "WARNING"})

    fg = human.get("fear_greed", {})
    if fg.get("status") in ("extreme_fear", "extreme_greed"):
        alerts.append({"track": "人轨", "indicator": "fear_greed", "level": "WARNING"})

    if len(alerts) >= 2:
        return "CRITICAL", alerts
    elif len(alerts) == 1:
        return "WARNING", alerts
    return "ROUTINE", []


# ── 主函数 ────────────────────────────────────────
def run():
    print("司天官启动 — 三轨采集中...\n")

    heaven = fetch_heaven()
    print(f"天轨 ✓  VIX={heaven.get('VIX',{}).get('value','ERR')}  "
          f"TNX={heaven.get('TNX',{}).get('value','ERR')}  "
          f"DXY={heaven.get('DXY',{}).get('value','ERR')}")

    earth = fetch_earth()
    print(f"地轨 ✓  FFR={earth.get('FEDFUNDS',{}).get('value','ERR')}  "
          f"UNRATE={earth.get('UNRATE',{}).get('value','ERR')}  "
          f"M2={earth.get('M2SL',{}).get('value','ERR')}")

    human = fetch_human()
    print(f"人轨 ✓  恐贪={human.get('fear_greed',{}).get('value','ERR')}  "
          f"({human.get('fear_greed',{}).get('label','')})\n")

    mode, alerts = evaluate_alert(heaven, earth, human)

    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "reporter": "司天官",
        "mode": mode,
        "alert_level": mode,
        "heaven_track": heaven,
        "earth_track": earth,
        "human_track": human,
        "alerts": alerts,
        "summary": "三轨常态，无异动。" if mode == "ROUTINE" else f"异动检测：{alerts}",
        "action_required": mode != "ROUTINE"
    }

    print(json.dumps(report, ensure_ascii=False, indent=2))

    # 输出到文件（供n8n/零零读取）
    out_path = os.path.join(os.path.dirname(__file__), "sitian_report.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n报告已写入: {out_path}")


if __name__ == "__main__":
    run()
