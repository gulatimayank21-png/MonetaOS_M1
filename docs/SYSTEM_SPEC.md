MonetaOS M1: Technical & Product Architecture Documentation
1. Executive Summary & Product Architecture
MonetaOS M1 is a client-side quantitative screening and backtesting platform built for the Indian equity universe (Nifty 500 constituents + tracked historical demotions).
Core Problem Solved
Server Cost & Latency: Traditional quantitative screeners require high-tier cloud instances running continuous relational database queries. MonetaOS executes all technical indicators, scans, and backtests directly within the browser thread via WebAssembly (SQLite Wasm).
Exchange Bot Detection: NSE actively blocks automated cloud runner IPs (AWS, Azure, GitHub Actions) targeting internal JSON API endpoints. MonetaOS circumvents this by consuming public static exchange-cleared Bhavcopy archives hosted on NSE’s content delivery network.
Key Value Pillars
$0 Operational Footprint: GitHub Actions performs the daily ETL at no cost, GitHub Pages serves static files as an edge CDN, and the user's browser provides all storage and compute.
Survivorship-Bias-Free Modeling: Incorporates explicit constituent lifespans via stock_market_lifespan, preserving historical candles for demoted and renamed equities.
Offline-First Resilience: The local SQLite database stores multi-year historical candles (2015–Present) in persistent browser storage (IndexedDB / OPFS), requiring network connectivity only for daily incremental updates.
2. Technical System Topologies
The system operates across three tiers:
[ Tier 1: Cloud ETL ]             [ Tier 2: Edge CDN ]           [ Tier 3: Browser Engine ]
  NSE CDN Archive                   GitHub Pages CDN               Client Browser
 (UDiFF ZIP Files)                 (Rolling Payloads)              (Wasm + Web Worker)
         |                                 |                                |
         v                                 |                                |
+------------------+                       |                                |
|  GitHub Actions  |                       |                                |
| (daily_sync.yml) |                       |                                |
|  18:30 IST Cron  |                       |                                |
+--------+---------+                       |                                |
         |                                 |                                |
         | Uploads ./public Assets         |                                |
         +-------------------------------->+                                |
                                   latest_deltas.json                       |
                                           |                                |
                                           | EOD Catch-Up Fetch             |
                                           +------------------------------->+
                                                                     [ dbWorker.ts ]
                                                                            |
                                                                   +--------v-------+
                                                                   |  sqlite3.wasm  |
                                                                   | (IndexedDB/OPFS|
                                                                   +--------+-------+
                                                                            |
                                                                   +--------v-------+
                                                                   | React Front-End|
                                                                   | (Zustand/UI)   |
                                                                   +----------------+

Component Responsibility Matrix
Layer
Component
Function
ETL Runner
scripts/sync_bhavcopy.py
Python 3.11 engine on Ubuntu runners. Fetches static UDiFF archives, cleans columns, normalizes series, filters Cash Equities, and rolls a 7-day window.
Edge Distribution
GitHub Pages (gh-pages)
Distributes rolling JSON bundles (latest_deltas.json, corporate_alerts.json) via CDN with zero rate-limiting.
Client Database Worker
dbWorker.ts (SQLite Wasm)
Executes heavy analytical SQL queries and delta sync operations on a separate Web Worker thread to prevent UI freezing.
Client Persistence
IndexedDB / OPFS
Stores the local binary image of nifty500_historical.db, persisting daily updates across reloads.

3. Data Pipelines & Synchronization Workflows
3.1 Cloud ETL Flow (GitHub Actions)
Triggered via CRON every Monday–Friday at 13:00 UTC (18:30 IST):
Date Resolution: Converts UTC time to Indian Standard Time (UTC + 5:30) to ensure exact local market day matching.
Rolling Window Inspection: Iterates backward through the last 7 calendar days. Skips Saturdays and Sundays automatically.
Static Archive Retrieval: Targets the official UDiFF file format:
[https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0](https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0)_<YYYYMMDD>_F_0000.csv.zip
In-Memory Extraction: Uses io.BytesIO and zipfile to unpack CSV files in memory without disk I/O overhead.
Data Normalization:
Keeps only series EQ (standard equity) and BE (trade-to-trade / surveillance).
Normalizes UDiFF headers (TckrSymb, OpnPric, HghPric, LwPric, ClsPric, TtlTradgVol) into canonical OHLCV fields.
Corporate Action Polling: Checks active split, bonus, and merger notices.
Asset Deployment: Commits bundled records to ./public and triggers actions/deploy-pages@v4.
3.2 Client-Side Ingestion & Audit Sequence
When the application opens:
Baseline Assessment:
SQL
SELECT MAX(trade_date) AS max_date FROM daily_ohlcv;




Fetch Payload: Downloads latest_deltas.json?t=<timestamp> to bypass browser cache.
Date Filtering: Filters payload records where trade_date > max_local_date.
Constituent Audit (Set Difference):
Retrieves all tracked symbols:
SQL
SELECT symbol FROM stock_market_lifespan WHERE market_status = 'ACTIVE_TODAY';




Calculates missing symbols per incoming date:
$$\text{missingSymbols} = \text{expectedSymbols} \setminus \text{receivedSymbols}$$
If any tracked symbols are absent, logs a warning to console.warn and displays an interactive UI drawer.
Atomic UPSERT:
Valid records are executed in a single atomic database transaction:
SQL
BEGIN TRANSACTION;
INSERT INTO daily_ohlcv (symbol, trade_date, open, high, low, close, volume)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(symbol, trade_date) DO UPDATE SET
    open = excluded.open,
    high = excluded.high,
    low = excluded.low,
    close = excluded.close,
    volume = excluded.volume;
COMMIT;




Persistence Flush: Exports the SQLite binary into browser IndexedDB.
4. Database Schema Reference
4.1 daily_ohlcv
SQL
CREATE TABLE IF NOT EXISTS daily_ohlcv (
    symbol TEXT NOT NULL,
    trade_date TEXT NOT NULL,       -- ISO-8601: YYYY-MM-DD
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume INTEGER NOT NULL,
    PRIMARY KEY (symbol, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_ohlcv_symbol_date ON daily_ohlcv(symbol, trade_date);
CREATE INDEX IF NOT EXISTS idx_ohlcv_date ON daily_ohlcv(trade_date);

4.2 stock_market_lifespan
SQL
CREATE TABLE IF NOT EXISTS stock_market_lifespan (
    symbol TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    isin TEXT UNIQUE NOT NULL,
    market_status TEXT NOT NULL,    -- 'ACTIVE_TODAY', 'DEMOTED_N500', 'DELISTED', 'SUSPENDED'
    effective_from TEXT NOT NULL,   -- Date introduced into tracked universe
    effective_to TEXT,              -- NULL if active today
    rebranded_to TEXT,              -- Target ticker if renamed
    notes TEXT
);

5. Strategy Implementation Pattern
Because MonetaOS uses SQLite 3.25+, analytical calculations utilize native SQL window functions instead of client-side JavaScript loops.
Example: Volume Breakout with 52-Week High Confirmation
SQL
WITH HistoricalContext AS (
    SELECT 
        symbol,
        trade_date,
        close,
        volume,
        MAX(high) OVER (
            PARTITION BY symbol 
            ORDER BY trade_date 
            ROWS BETWEEN 252 PRECEDING AND 1 PRECEDING
        ) AS high_52w,
        AVG(volume) OVER (
            PARTITION BY symbol 
            ORDER BY trade_date 
            ROWS BETWEEN 20 PRECEDING AND 1 PRECEDING
        ) AS avg_vol_20d
    FROM daily_ohlcv
    WHERE trade_date >= date('now', '-380 days')
)
SELECT 
    symbol,
    trade_date,
    close,
    high_52w,
    volume,
    avg_vol_20d,
    ROUND(((close - high_52w) / high_52w) * 100, 2) AS breakout_pct
FROM HistoricalContext
WHERE trade_date = (SELECT MAX(trade_date) FROM daily_ohlcv)
  AND close > high_52w
  AND volume >= (2.0 * avg_vol_20d)
ORDER BY breakout_pct DESC;

6. Failure Modes & Recovery Runbooks
1. Exchange Holiday / Zero Records
Symptom: latest_deltas.json returns "total_record_count": 0 or missing days.
Root Cause: NSE publishes no Bhavcopy on recognized market holidays (e.g., Ganesh Chaturthi).
Mitigation: The Python script safely catches HTTP 404 responses from nsearchives without failing the workflow. The rolling 7-day window ensures previously synced trading sessions remain intact.
2. Missing Constituent Alerts
Symptom: UI displays: "⚠️ Data Sync Warning: X stocks had missing candle data".
Root Cause: A company was suspended, halted due to circuit filters, moved outside series EQ/BE, or changed its ticker name.
Action: Check console.warn for the missing ticker list. If a stock underwent a corporate name change, record the new symbol and update rebranded_to in stock_market_lifespan.
3. Semi-Annual Reconstitution (March & September)
Symptom: 15–25 newly inducted Nifty 500 stocks are ignored by client ingestion.
Root Cause: The browser database only imports stocks listed as ACTIVE_TODAY in stock_market_lifespan.
Action:
Add newly inducted stocks to stock_market_lifespan with market_status = 'ACTIVE_TODAY'.
Move excluded stocks to market_status = 'DEMOTED_N500'.
Backfill historical candles for new additions.
Tag a new release (v2.1.0) on GitHub. MonetaOS will detect the tag change and pull the updated database baseline automatically.

