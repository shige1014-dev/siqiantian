import os, json, urllib.request, urllib.parse
from datetime import datetime, timezone
import yfinance as yf
from fredapi import Fred

FRED_API_KEY = os.environ["FRED_API_KEY"]
BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]

def fetch_heaven():
    result = {}
    for name, symbol in {"VIX":"^VIX","TNX":"^TNX","DXY":"DX-Y.NYB"}.items():
        try:
            hist = yf.Ticker(symbol).history(period="5d")
            last = float(hist["Close"].iloc[-1])
            prev = float(hist["Close"].iloc[-2]) if len(hist)>1 else last
            st = "critical" if name=="VIX" and last>=35 else "warning" if name=="VIX" and last>=25 else "normal"
            result[name] = {"value":round(last,4),"delta_1d":round(last-prev,4),"status":st}
        except Exception as e:
            result[name] = {"error":str(e)}
    return result

def fetch_earth():
    fred = Fred(api_key=FRED_API_KEY)
    result = {}
    for code,label in {"FEDFUNDS":"联邦基金利率","UNRATE":"失业率","M2SL":"M2货币供应","CPIAUCSL":"CPI"}.items():
        try:
            s = fred.get_series(code).dropna()
            last,prev = float(s.iloc[-1]),float(s.iloc[-2])
            result[code] = {"label":label,"value":round(last,4),"delta":round(last-prev,4),"status":"normal"}
        except Exception as e:
            result[code] = {"error":str(e)}
    return result

def fetch_human():
    try:
        with urllib.request.urlopen("https://api.alternative.me/fng/?limit=2&format=json",timeout=10) as r:
            data = json.loads(r.read())["data"][0]
        v = int(data["value"])
        st = "extreme_fear" if v<=20 else "extreme_greed" if v>=80 else "normal"
        return {"fear_greed":{"value":v,"label":data["value_classification"],"status":st}}
    except Exception as e:
        return {"fear_greed":{"error":str(e)}}

def send_telegram(text):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    data = urllib.parse.urlencode({"chat_id":CHAT_ID,"text":text,"parse_mode":"Markdown"}).encode()
    urllib.request.urlopen(url,data=data,timeout=10)

def main():
    print("诗歌启动...")
    heaven = fetch_heaven()
    earth = fetch_earth()
    human = fetch_human()

    alerts = []
    vix = heaven.get("VIX",{})
    if vix.get("status")=="critical": alerts.append({"track":"天轨","level":"CRITICAL"})
    elif vix.get("status")=="warning": alerts.append({"track":"天轨","level":"WARNING"})
    fg = human.get("fear_greed",{})
    if fg.get("status") in ("extreme_fear","extreme_greed"): alerts.append({"track":"人轨","level":"WARNING"})

    mode = "CRITICAL" if len(alerts)>=2 else "WARNING" if len(alerts)==1 else "ROUTINE"
    icon = "🔴" if mode=="CRITICAL" else "⚠️" if mode=="WARNING" else "✅"

    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "reporter": "诗歌",
        "mode": mode,
        "heaven_track": heaven,
        "earth_track": earth,
        "human_track": human,
        "alerts": alerts,
        "action_required": mode!="ROUTINE"
    }

    print(json.dumps(report, ensure_ascii=False, indent=2))

    if mode != "ROUTINE":
        msg = f"{icon} *诗歌奏报*\n级别: `{mode}`\n\n*天轨* VIX:`{heaven.get('VIX',{}).get('value','ERR')}` TNX:`{heaven.get('TNX',{}).get('value','ERR')}`\n*地轨* FFR:`{earth.get('FEDFUNDS',{}).get('value','ERR')}%` UNRATE:`{earth.get('UNRATE',{}).get('value','ERR')}%`\n*人轨* 恐贪:`{fg.get('value','ERR')}` — {fg.get('label','')}"
        send_telegram(msg)
        print("✅ Telegram推送成功")
    else:
        print("常态，无需推送")

if __name__ == "__main__":
    main()


def fetch_news_sentiment():
    """接入新闻情绪"""
    try:
        import news_sentiment
        return news_sentiment.analyze_market_sentiment()
    except Exception as e:
        return {"error": str(e), "label": "neutral", "sentiment_score": 0}
