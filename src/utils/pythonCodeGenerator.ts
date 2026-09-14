export function generateStreamlitScript(params: {
  percentileThreshold: number;
  maxDistance52WHighPct: number;
  enforce52WHigh: boolean;
}): string {
  return `"""
Nifty 500 Multi-Timeframe Momentum Quant Screener
Based on Relative Strength & Persistence across 1M, 3M, and 1Y periods.

Run locally:
1. pip install streamlit yfinance pandas numpy
2. streamlit run app.py
"""

import streamlit as st
import pandas as pd
import yfinance as yf
import numpy as np
from datetime import datetime

st.set_page_config(
    page_title="Moneta OS - Systematic Investing",
    page_icon="📈",
    layout="wide",
)

st.title("🎯 Moneta OS — Multi-Timeframe Momentum Engine")
st.markdown("""
**The Super-Trend Quant Strategy**: When a stock ranks in the Top tier across 
**1-Month** (retail/speculative heat), **3-Months** (institutional trend), and 
**1-Year** (structural macro trend), it indicates sustained **relative strength** and **momentum persistence**.
""")

# Sidebar Controls
st.sidebar.header("Quant Parameters")
percentile_cutoff = st.sidebar.slider(
    "Super-Trend Cutoff (Top %)",
    min_value=5,
    max_value=50,
    value=${params.percentileThreshold},
    step=5,
    help="Top percentile required in each of 1M, 3M, and 1Y periods."
)

filter_52w = st.sidebar.checkbox(
    "Enforce 52-Week High Rule", 
    value=${params.enforce52WHigh ? 'True' : 'False'},
    help="Price must be within threshold of 52-week high to avoid overhead resistance."
)
dist_52w_pct = st.sidebar.slider(
    "Max Distance from 52-Week High (%)",
    min_value=1.0,
    max_value=15.0,
    value=${params.maxDistance52WHighPct.toFixed(1)},
    step=0.5
)

@st.cache_data(ttl=3600)
def load_nifty500_symbols():
    url = "https://archives.nseindia.com/content/indices/ind_nifty500list.csv"
    try:
        df = pd.read_csv(url)
        df['YF_Symbol'] = df['Symbol'] + ".NS"
        return df
    except Exception as e:
        st.warning(f"Error fetching official NSE CSV ({e}). Using sample Nifty 50 constituents.")
        sample_symbols = [
            "TRENT", "COCHINSHIP", "MAZDOCK", "BEL", "HAL", "DIXON", "SOLARINDS",
            "PERSISTENT", "ETERNAL", "KALYANKJIL", "TMPV", "SUZLON", "POLYCAB",
            "CUMMINSIND", "RELIANCE", "TCS", "HDFCBANK", "INFY", "BHARTIARTL", "LT"
        ]
        return pd.DataFrame({
            "Company Name": sample_symbols,
            "Industry": ["Various"] * len(sample_symbols),
            "Symbol": sample_symbols,
            "YF_Symbol": [s + ".NS" for s in sample_symbols]
        })

n500_df = load_nifty500_symbols()
st.sidebar.info(f"Loaded {len(n500_df)} constituents from Nifty 500 universe.")

if st.button("🚀 Run Multi-Timeframe Momentum Scan", type="primary"):
    with st.spinner("Downloading price history and computing momentum vectors..."):
        symbols = n500_df['YF_Symbol'].tolist()[:100] # Scan batch (adjust as needed)
        
        data = yf.download(symbols, period="1y", interval="1d", group_by='ticker', progress=False)
        
        results = []
        for _, row in n500_df.iterrows():
            sym = row['YF_Symbol']
            ticker_plain = row['Symbol']
            try:
                if len(symbols) == 1:
                    hist = data
                else:
                    if sym not in data.columns.levels[0]:
                        continue
                    hist = data[sym]
                
                closes = hist['Adj Close'].dropna()
                if len(closes) < 65:
                    continue
                
                # Quant Anchor: Last completed trading session's close (EOD)
                last_close = float(closes.iloc[-1])
                high_52w = float(closes.max())
                
                # Trading day offsets: ~21 for 1M, ~63 for 3M, first for 1Y
                idx_1m = max(0, len(closes) - 21)
                idx_3m = max(0, len(closes) - 63)
                
                ret_1m = ((last_close / closes.iloc[idx_1m]) - 1.0) * 100.0
                ret_3m = ((last_close / closes.iloc[idx_3m]) - 1.0) * 100.0
                ret_1y = ((last_close / closes.iloc[0]) - 1.0) * 100.0
                
                dist_52w = ((last_close - high_52w) / high_52w) * 100.0
                
                # Current Market Price (indicative 15-min delayed)
                cmp_delayed = float(hist['Close'].iloc[-1]) if 'Close' in hist.columns else last_close
                cmp_chg_pct = ((cmp_delayed - last_close) / last_close) * 100.0 if last_close > 0 else 0.0
                
                results.append({
                    "Symbol": ticker_plain,
                    "Company": row['Company Name'],
                    "Industry": row.get('Industry', 'Unknown'),
                    "Last Close (₹)": round(last_close, 2),
                    "CMP (15m Delay) (₹)": round(cmp_delayed, 2),
                    "Intraday Chg (%)": round(cmp_chg_pct, 2),
                    "52W High (₹)": round(high_52w, 2),
                    "From 52W High (%)": round(dist_52w, 2),
                    "1M Return (%)": round(ret_1m, 2),
                    "3M Return (%)": round(ret_3m, 2),
                    "1Y Return (%)": round(ret_1y, 2),
                })
            except Exception:
                continue
        
        res_df = pd.DataFrame(results)
        
        if not res_df.empty:
            total_stocks = len(res_df)
            cutoff_k = max(1, int(total_stocks * (percentile_cutoff / 100.0)))
            
            # Identify Top stocks in each category
            top_1m = set(res_df.nlargest(cutoff_k, '1M Return (%)')['Symbol'])
            top_3m = set(res_df.nlargest(cutoff_k, '3M Return (%)')['Symbol'])
            top_1y = set(res_df.nlargest(cutoff_k, '1Y Return (%)')['Symbol'])
            
            # Find the overlap (stocks appearing in all three)
            overlap_stocks = top_1m & top_3m & top_1y
            
            # Apply 52W High rule
            winners_df = res_df[res_df['Symbol'].isin(overlap_stocks)].copy()
            if filter_52w:
                winners_df = winners_df[winners_df['From 52W High (%)'].abs() <= dist_52w_pct]
            
            # Sort by combined momentum score
            winners_df['Quant Score'] = (
                winners_df['1M Return (%)'].rank(pct=True) * 0.3 +
                winners_df['3M Return (%)'].rank(pct=True) * 0.35 +
                winners_df['1Y Return (%)'].rank(pct=True) * 0.35
            ) * 100.0
            winners_df = winners_df.sort_values(by='Quant Score', ascending=False)
            
            # Metrics Display
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Universe Analyzed", total_stocks)
            c2.metric("Super-Trend Winners", len(winners_df))
            top_sector = winners_df['Industry'].mode()[0] if not winners_df.empty else "N/A"
            c3.metric("Dominant Sector", top_sector)
            avg_1y = f"{winners_df['1Y Return (%)'].mean():.1f}%" if not winners_df.empty else "0%"
            c4.metric("Avg 1Y Winner Return", avg_1y)
            
            st.subheader(f"🏆 Multi-Timeframe Winners (Top {percentile_cutoff}% Overlap)")
            st.dataframe(
                winners_df.style.format({
                    "Last Close (₹)": "₹{:,.2f}",
                    "CMP (15m Delay) (₹)": "₹{:,.2f}",
                    "Intraday Chg (%)": "{:+.2f}%",
                    "52W High (₹)": "₹{:,.2f}",
                    "From 52W High (%)": "{:+.2f}%",
                    "1M Return (%)": "{:+.2f}%",
                    "3M Return (%)": "{:+.2f}%",
                    "1Y Return (%)": "{:+.2f}%",
                    "Quant Score": "{:.1f}",
                }),
                use_container_width=True
            )
            
            # Equal Weight Portfolio Allocator
            st.markdown("### 💼 Equal-Weight Portfolio Allocation (Step 5)")
            capital = st.number_input("Portfolio Capital (INR)", min_value=50000, value=1000000, step=50000)
            if not winners_df.empty:
                top_n = min(10, len(winners_df))
                alloc_df = winners_df.head(top_n).copy()
                capital_per_stock = capital / top_n
                alloc_df['Allocation (₹)'] = capital_per_stock
                alloc_df['Shares to Buy'] = (capital_per_stock / alloc_df['CMP (₹)']).astype(int)
                alloc_df['Actual Investment (₹)'] = alloc_df['Shares to Buy'] * alloc_df['CMP (₹)']
                alloc_df['Stop Loss (-8%)'] = alloc_df['CMP (₹)'] * 0.92
                st.table(alloc_df[['Symbol', 'CMP (₹)', 'Shares to Buy', 'Actual Investment (₹)', 'Stop Loss (-8%)']])
`;
}
