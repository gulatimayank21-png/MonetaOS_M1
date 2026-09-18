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
    "Accept": "*/*"
}

# Target Instruments
SPECIAL_ETFS = {"GOLDBEES", "LIQUIDBEES"}
TARGET_INDICES = {
    "NIFTY 50": "NIFTY 50",
    "NIFTY 500": "NIFTY 500",
    "INDIA VIX": "INDIA VIX"
}

def clean_num(val, default=0.0):
    """Safely converts string numbers with commas to float."""
    try:
        clean = str(val).replace(",", "").strip()
        return float(clean) if clean not in ["-", ""] else default
    except (ValueError, TypeError):
        return default

def get_current_ist_date() -> datetime.date:
    """Returns today's date in Indian Standard Time (UTC + 5:30)."""
    utc_now = datetime.datetime.now(datetime.timezone.utc)
    ist_now = utc_now + datetime.timedelta(hours=5, minutes=30)
    return ist_now.date()

def fetch_bhavcopy_deltas(target_date: datetime.date):
    """
    Fetches the daily static UDiFF Bhavcopy from NSE archives,
    separating cash equities from whitelisted ETFs (GOLDBEES, LIQUIDBEES).
    """
    if target_date.weekday() >= 5:
        print(f"{target_date} is a weekend. Cash market closed.")
        return [], []

    date_ymd = target_date.strftime("%Y%m%d")
    filename = f"BhavCopy_NSE_CM_0_0_0_{date_ymd}_F_0000.csv.zip"
    url = f"https://nsearchives.nseindia.com/content/cm/{filename}"
    
    print(f"Requesting static Bhavcopy from: {url}")
    try:
        res = requests.get(url, headers=HEADERS, timeout=25)
    except Exception as e:
        print(f"Bhavcopy network error: {e}")
        return [], []

    if res.status_code != 200:
        print(f"No Bhavcopy available for {target_date} (HTTP {res.status_code}). Market holiday or file not published yet.")
        return [], []

    try:
        with zipfile.ZipFile(io.BytesIO(res.content)) as z:
            csv_name = z.namelist()[0]
            with z.open(csv_name) as f:
                df = pd.read_csv(f)
    except Exception as e:
        print(f"Failed to decompress Bhavcopy archive: {e}")
        return [], []

    df.columns = [c.strip() for c in df.columns]

    # Handle standard UDiFF and fallback column schemas
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

    stock_deltas = []
    etf_deltas = []
    trade_date_str = target_date.strftime("%Y-%m-%d")

    for _, row in df.iterrows():
        try:
            symbol = str(row[sym_col]).strip()
            item = {
                "symbol": symbol,
                "trade_date": trade_date_str,
                "open": clean_num(row[open_col]),
                "high": clean_num(row[high_col]),
                "low": clean_num(row[low_col]),
                "close": clean_num(row[close_col]),
                "volume": int(clean_num(row[vol_col]))
            }

            if symbol in SPECIAL_ETFS:
                etf_deltas.append({
                    "index_name": symbol,
                    "trade_date": trade_date_str,
                    "open": item["open"],
                    "high": item["high"],
                    "low": item["low"],
                    "close": item["close"],
                    "volume": item["volume"]
                })
            else:
                stock_deltas.append(item)
        except (ValueError, TypeError):
            continue

    return stock_deltas, etf_deltas

def fetch_macro_indices_deltas(target_date: datetime.date):
    """
    Fetches official closing values for NIFTY 50, NIFTY 500, and INDIA VIX
    directly from NSE static archives with robust header discovery.
    """
    if target_date.weekday() >= 5:
        return []

    date_dmy = target_date.strftime("%d%m%Y")
    trade_date_str = target_date.strftime("%Y-%m-%d")
    
    urls = [
        f"https://nsearchives.nseindia.com/content/indices/ind_close_all_{date_dmy}.csv",
        f"https://archives.nseindia.com/content/indices/ind_close_all_{date_dmy}.csv"
    ]

    for url in urls:
        print(f"Requesting indices archive from: {url}")
        try:
            res = requests.get(url, headers=HEADERS, timeout=20)
            if res.status_code != 200:
                continue

            df = pd.read_csv(io.StringIO(res.text))
            df.columns = [c.strip() for c in df.columns]

            # Dynamic column discovery with positional fallbacks
            name_col = next((c for c in df.columns if "index" in c.lower() and "name" in c.lower()), df.columns[0])
            open_col = next((c for c in df.columns if "open" in c.lower()), df.columns[2] if len(df.columns) > 2 else None)
            high_col = next((c for c in df.columns if "high" in c.lower()), df.columns[3] if len(df.columns) > 3 else None)
            low_col = next((c for c in df.columns if "low" in c.lower()), df.columns[4] if len(df.columns) > 4 else None)
            close_col = next(
                (c for c in df.columns if any(k in c.lower() for k in ["closing", "close", "index value"])), 
                df.columns[5] if len(df.columns) > 5 else None
            )
            vol_col = next((c for c in df.columns if any(k in c.lower() for k in ["volume", "shares", "traded"])), None)

            indices_data = []
            for _, row in df.iterrows():
                raw_name = str(row[name_col]).strip().upper()
                if raw_name in TARGET_INDICES:
                    indices_data.append({
                        "index_name": TARGET_INDICES[raw_name],
                        "trade_date": trade_date_str,
                        "open": clean_num(row[open_col]) if open_col else 0.0,
                        "high": clean_num(row[high_col]) if high_col else 0.0,
                        "low": clean_num(row[low_col]) if low_col else 0.0,
                        "close": clean_num(row[close_col]),
                        "volume": int(clean_num(row[vol_col])) if vol_col else 0
                    })

            if len(indices_data) > 0:
                print(f"Successfully extracted {len(indices_data)} indices from {url}")
                return indices_data

        except Exception as e:
            print(f"Error reading indices from {url}: {e}")

    print(f"Warning: No index candles could be fetched for {target_date}.")
    return []

def fetch_corporate_action_alerts():
    """Fetches upcoming corporate actions for cash stocks and tracked ETFs."""
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
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
                sym = str(act.get("symbol", "")).strip().upper()

                if any(w in subj for w in ["split", "sub-division", "bonus", "merger", "amalgamation", "demerger"]):
                    alerts.append({
                        "symbol": sym,
                        "series": act.get("series"),
                        "subject": act.get("subject"),
                        "ex_date": act.get("exDate"),
                        "record_date": act.get("recDate"),
                        "ca_broadcast_date": act.get("bcStartDate"),
                        "is_macro_instrument": sym in SPECIAL_ETFS
                    })
    except Exception as e:
        print(f"Warning: Could not fetch corporate actions: {e}")
        
    return alerts

def main():
    target_date = get_current_ist_date()
    print(f"Executing sync for IST date: {target_date}")
    
    stock_deltas, etf_deltas = fetch_bhavcopy_deltas(target_date)
    index_deltas = fetch_macro_indices_deltas(target_date)
    all_macro_deltas = etf_deltas + index_deltas

    alerts = fetch_corporate_action_alerts()

    output_deltas = {
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "target_date": target_date.strftime("%Y-%m-%d"),
        "record_count": len(stock_deltas),
        "macro_count": len(all_macro_deltas),
        "data": stock_deltas,
        "macro_data": all_macro_deltas
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

    print(f"Saved {len(stock_deltas)} stock candles to {deltas_path}")
    print(f"Saved {len(all_macro_deltas)} macro candles (N50, N500, VIX, GOLDBEES, LIQUIDBEES) to {deltas_path}")
    print(f"Saved {len(alerts)} corporate action alerts to {alerts_path}")

if __name__ == "__main__":
    main()
