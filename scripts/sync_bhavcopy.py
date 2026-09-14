import os
import io
import json
import zipfile
import datetime
import requests
import pandas as pd

PUBLIC_DIR = "./public"
os.makedirs(PUBLIC_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive"
}

def get_current_ist_date() -> datetime.date:
    """Returns today's date in Indian Standard Time (UTC + 5:30)."""
    utc_now = datetime.datetime.now(datetime.timezone.utc)
    ist_now = utc_now + datetime.timedelta(hours=5, minutes=30)
    return ist_now.date()

def fetch_bhavcopy_deltas(target_date: datetime.date):
    # Weekday check: Monday = 0, Sunday = 6
    if target_date.weekday() >= 5:
        print(f"{target_date} is a weekend. Market closed.")
        return []

    date_ymd = target_date.strftime("%Y%m%d")
    filename = f"BhavCopy_NSE_CM_0_0_0_{date_ymd}_F_0000.csv.zip"
    url = f"https://nsearchives.nseindia.com/content/cm/{filename}"
    
    print(f"Requesting static Bhavcopy from: {url}")
    session = requests.Session()
    session.headers.update(HEADERS)
    
    try:
        res = session.get(url, timeout=25)
    except Exception as e:
        print(f"Network connection error: {e}")
        return []

    if res.status_code != 200:
        print(f"No Bhavcopy available for {target_date} (Status: {res.status_code}). Likely exchange holiday or file not published yet.")
        return []

    try:
        with zipfile.ZipFile(io.BytesIO(res.content)) as z:
            csv_name = z.namelist()[0]
            with z.open(csv_name) as f:
                df = pd.read_csv(f)
    except Exception as e:
        print(f"Failed to decompress zip archive: {e}")
        return []

    df.columns = [c.strip() for c in df.columns]

    if "SctySrs" in df.columns:
        df = df[df['SctySrs'].isin(['EQ', 'BE'])].copy()
        sym_col, open_col, high_col, low_col, close_col, vol_col = (
            "TckrSymb", "OpnPric", "HghPric", "LwPric", "ClsPric", "TtlTradgVol"
        )
    else:
        df = df[df['SERIES'].isin(['EQ', 'BE'])].copy()
        sym_col, open_col, high_col, low_col, close_col, vol_col = (
            "SYMBOL", "OPEN", "HIGH", "LOW", "CLOSE", "TOTTRDQTY"
        )

    deltas = []
    trade_date_str = target_date.strftime("%Y-%m-%d")
    for _, row in df.iterrows():
        try:
            deltas.append({
                "symbol": str(row[sym_col]).strip(),
                "trade_date": trade_date_str,
                "open": float(row[open_col]),
                "high": float(row[high_col]),
                "low": float(row[low_col]),
                "close": float(row[close_col]),
                "volume": int(row[vol_col])
            })
        except (ValueError, TypeError):
            continue

    return deltas

def fetch_corporate_action_alerts():
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-actions"
    })
    
    alerts = []
    try:
        session.get("https://www.nseindia.com/companies-listing/corporate-filings-actions", timeout=15)
        api_url = "https://www.nseindia.com/api/corporates-corporateActions?index=equities"
        res = session.get(api_url, timeout=15)
        
        if res.status_code == 200:
            actions = res.json()
            for act in actions:
                subj = str(act.get("subject", "")).lower()
                if any(w in subj for w in ["split", "sub-division", "bonus", "merger", "amalgamation", "demerger"]):
                    alerts.append({
                        "symbol": act.get("symbol"),
                        "series": act.get("series"),
                        "subject": act.get("subject"),
                        "ex_date": act.get("exDate"),
                        "record_date": act.get("recDate"),
                        "ca_broadcast_date": act.get("bcStartDate")
                    })
            print(f"Successfully collected {len(alerts)} corporate action alerts from NSE.")
        else:
            print(f"Corporate actions endpoint returned HTTP {res.status_code}.")
    except Exception as e:
        print(f"Warning: Could not fetch corporate actions: {e}")
        
    return alerts

def main():
    target_date = get_current_ist_date()
    print(f"Executing sync for IST date: {target_date}")
    
    deltas = fetch_bhavcopy_deltas(target_date)
    alerts = fetch_corporate_action_alerts()

    output_deltas = {
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "target_date": target_date.strftime("%Y-%m-%d"),
        "record_count": len(deltas),
        "data": deltas
    }

    output_alerts = {
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "alerts_count": len(alerts),
        "alerts": alerts
    }

    deltas_path = os.path.join(PUBLIC_DIR, "latest_deltas.json")
    alerts_path = os.path.join(PUBLIC_DIR, "corporate_alerts.json")

    with open(deltas_path, "w") as f:
        json.dump(output_deltas, f)

    with open(alerts_path, "w") as f:
        json.dump(output_alerts, f, indent=2)

    print(f"Saved {len(deltas)} candles to {deltas_path}")
    print(f"Saved {len(alerts)} alerts to {alerts_path}")

if __name__ == "__main__":
    main()
