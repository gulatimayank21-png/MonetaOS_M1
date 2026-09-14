import os
import io
import json
import zipfile
import datetime
import requests
import pandas as pd

PUBLIC_DIR = "./public"
os.makedirs(PUBLIC_DIR, exist_ok=True)

# Standard browser headers required for static asset retrieval
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive"
}

def fetch_bhavcopy_deltas():
    # Testing with last active trading session: Friday Sep 11, 2026
    target_date = datetime.date(2026, 9, 11)
    date_ymd = target_date.strftime("%Y%m%d")
    
    # Official Standardized UDiFF Bhavcopy static path on nsearchives
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
        print(f"Failed to fetch Bhavcopy (HTTP Status: {res.status_code}).")
        return []

    # Read zip in memory
    try:
        with zipfile.ZipFile(io.BytesIO(res.content)) as z:
            csv_name = z.namelist()[0]
            with z.open(csv_name) as f:
                df = pd.read_csv(f)
    except Exception as e:
        print(f"Failed to decompress zip archive: {e}")
        return []

    # Clean column names
    df.columns = [c.strip() for c in df.columns]

    # UDiFF column specs:
    # TckrSymb (Ticker), SctySrs (Series), OpnPric, HghPric, LwPric, ClsPric, TtlTradgVol
    if "SctySrs" in df.columns:
        df = df[df['SctySrs'].isin(['EQ', 'BE'])].copy()
        sym_col, open_col, high_col, low_col, close_col, vol_col = (
            "TckrSymb", "OpnPric", "HghPric", "LwPric", "ClsPric", "TtlTradgVol"
        )
    else:
        # Fallback if legacy columns are present
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

def main():
    deltas = fetch_bhavcopy_deltas()
    
    output_deltas = {
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "record_count": len(deltas),
        "data": deltas
    }

    out_file = os.path.join(PUBLIC_DIR, "latest_deltas.json")
    with open(out_file, "w") as f:
        json.dump(output_deltas, f)

    print(f"Generated {len(deltas)} deltas in {out_file}")

if __name__ == "__main__":
    main()
