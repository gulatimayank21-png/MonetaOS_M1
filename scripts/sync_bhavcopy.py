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
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

def get_nse_session():
    session = requests.Session()
    session.headers.update(HEADERS)
    # Prime session cookies by hitting the homepage first
    session.get("https://www.nseindia.com", timeout=15)
    return session

def fetch_bhavcopy_deltas(session):
    today = datetime.date.today()
    date_str = today.strftime("%d%m%Y")
    
    # Modern NSE consolidated Bhavcopy endpoint
    # Format: sec_bhavdata_full_DDMMYYYY.csv
    url = f"https://archives.nseindia.com/products/content/sec_bhavdata_full_{date_str}.csv"
    
    res = session.get(url, timeout=20)
    if res.status_code != 200:
        print(f"Bhavcopy not available for {date_str} (Status: {res.status_code}). Market may be closed or file pending.")
        return []

    df = pd.read_csv(io.StringIO(res.text))
    # Standardize column names (strip whitespace)
    df.columns = [c.strip() for c in df.columns]

    # Filter to standard cash equity series ('EQ' and surveillance 'BE')
    df = df[df['SERIES'].isin(['EQ', 'BE'])]

    deltas = []
    for _, row in df.iterrows():
        deltas.append({
            "symbol": str(row['SYMBOL']).strip(),
            "trade_date": today.strftime("%Y-%m-%d"),
            "open": float(row['OPEN_PRICE']),
            "high": float(row['HIGH_PRICE']),
            "low": float(row['LOW_PRICE']),
            "close": float(row['CLOSE_PRICE']),
            "volume": int(row['TTL_TRD_QNTY'])
        })
    return deltas

def check_corporate_actions(session):
    url = "https://www.nseindia.com/api/corporates-corporateActions?index=equities"
    alerts = []
    try:
        res = session.get(url, timeout=15)
        if res.status_code == 200:
            actions = res.json()
            for act in actions:
                subj = act.get("subject", "").lower()
                # Flag splits, bonuses, mergers, and demergers
                if any(w in subj for w in ["split", "bonus", "merger", "amalgamation", "demerger"]):
                    alerts.append({
                        "symbol": act.get("symbol"),
                        "subject": act.get("subject"),
                        "ex_date": act.get("exDate"),
                        "record_date": act.get("recDate")
                    })
    except Exception as e:
        print(f"Warning: Could not fetch corporate actions: {e}")
    return alerts

def main():
    session = get_nse_session()
    
    # 1. Fetch EOD Bhavcopy
    deltas = fetch_bhavcopy_deltas(session)
    
    # 2. Check Corporate Action Circulars
    alerts = check_corporate_actions(session)

    # 3. Export to ./public directory
    output_deltas = {
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "record_count": len(deltas),
        "data": deltas
    }
    
    output_alerts = {
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "alerts_count": len(alerts),
        "alerts": alerts
    }

    with open(os.path.join(PUBLIC_DIR, "latest_deltas.json"), "w") as f:
        json.dump(output_deltas, f)

    with open(os.path.join(PUBLIC_DIR, "corporate_alerts.json"), "w") as f:
        json.dump(output_alerts, f, indent=2)

    print(f"Generated {len(deltas)} deltas and {len(alerts)} alerts in {PUBLIC_DIR}")

if __name__ == "__main__":
    main()
