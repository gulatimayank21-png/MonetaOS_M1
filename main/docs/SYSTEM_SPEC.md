# System Specification & Architecture Guide

## 1. Executive Overview
**MonetaOS M1 / Nifty 500 Super-Trend Quant Engine** is an institutional-grade quantitative momentum screening, backtesting, and portfolio rebalancing platform. It evaluates the Nifty 500 universe across multiple lookback windows (1-Month, 3-Month, 1-Year), tracks 52-week high proximity, isolates sector tailwinds, and simulates long-term compounding strategies with daily automated price synchronization.

---

## 2. Core Quantitative Logic

### 2.1 Multi-Timeframe Super-Trend Filter
- **Ranking Engine**: Computes exact percentile and numerical rankings across all 500 constituents across three discrete lookbacks:
  - **1-Month Return ($R_{1M}$)**: Short-term momentum impulse.
  - **3-Month Return ($R_{3M}$)**: Intermediate trend persistence.
  - **1-Year Return ($R_{1Y}$)**: Macro secular trend strength.
- **Percentile Thresholds**: Configurable at 10% (Default ★), 15%, 20%, 25%, 33%, or custom count (e.g. Top 50).
- **52-Week High Proximity Thresholds**: User-selectable proximity tolerances: $\le 5\%$, $\le 8\%$, $\le 10\%$, $\le 12\%$, and $\le 15\%$.
- **Retention Buffer (Rank Hysteresis)**: Selectable buffers: Top 10 (Strict), Top 15, Top 20, Top 25 (Default), Top 30, Top 35 (Optimal ★), Top 40 (Wide), and Top 50 (Relaxed).
- **Overlapping Winner Criterion**: A constituent qualifies if and only if:
  $$\text{Rank}_{1M} \le K \quad \land \quad \text{Rank}_{3M} \le K \quad \land \quad \text{Rank}_{1Y} \le K \quad \land \quad \left|\frac{\text{CMP} - 52\text{W High}}{52\text{W High}}\right| \le \text{ProximityThreshold}$$
  where $K$ is the cutoff threshold (e.g., Top 10% = Rank $\le 50$).

### 2.2 Sector Tailwind Identification
A **Tailwind** denotes institutional sector-wide accumulation and leadership rather than single-stock anomalies.
- **Sector Momentum Scoring**:
  $$\text{Sector Score} = (\text{Active Winners} \times 10) + (\text{Macro Baseline Leaders} \times 4) + (\text{Sector Breadth \%} \times 0.5) + (\text{Avg Sector Momentum} \times 0.1)$$
- **Strict Qualification Rules**:
  1. **Top 3 Sectors Only**: At most, only the top 2–3 leading sectors across the universe can hold the Tailwind designation.
  2. **Minimum Concentration**: Must hold $\ge 2$ active winners under the current filter, or $\ge 20\%$ of total index winners, or $\ge 4$ high-conviction macro baseline leaders with $\ge 12\%$ sector breadth.

### 2.3 Composite Momentum Scoring
$$\text{Score} = (0.20 \times \text{Percentile}_{1M}) + (0.35 \times \text{Percentile}_{3M}) + (0.45 \times \text{Percentile}_{1Y}) + \text{ProximityBonus}$$

### 2.4 Multi-Factor Portfolio Sizing & ATR Volatility Weighting Models
To overcome the naive limitations of equal weighting ($1/N$) and mitigate portfolio drawdowns during momentum exhaustion phases, the quant engine and backtest simulator support dynamic, volatility-adjusted position weighting strategies:

#### Supported Strategies:
1. **ATR-Adjusted Momentum Parity (Recommended ★)**:
   $$\text{RawWeight}_i = \frac{(\text{Score}_i / 100)^{1.5}}{\max(0.8\%, \text{ATR\%}_i)} \times \frac{1}{\sqrt{\text{Rank}_i}} \times \text{TailwindMultiplier}_i$$
   Balances raw momentum leadership with normalized volatility risk and sector tailwinds.
2. **ATR Inverse Volatility (Pure Risk Parity)**:
   $$\text{RawWeight}_i = \frac{1}{\max(0.8\%, \text{ATR\%}_i)}$$
3. **Multi-Factor Conviction Weighted**:
   $$\text{RawWeight}_i = \left(\frac{\text{Score}_i}{100}\right)^2 \times \frac{1}{\sqrt{\text{Rank}_i}} \times \text{TailwindMultiplier}_i$$
4. **Composite Score Weighted ($S_i^3$)**: Sizes positions strictly by the cubic spread of normalized composite scores.
5. **Rank-Decay Tiered ($1/\text{Rank}^{0.65}$)**:
   - **Formula**:
     $$\text{RawWeight}_i = \frac{1}{\text{Rank}_i^{0.65}}$$
   - **Normalizing**:
     $$\text{NormalizedWeight}_i = \frac{\text{RawWeight}_i}{\sum_{j=1}^{M} \text{RawWeight}_j}$$
     where $M \le N$ is the number of currently qualifying stocks ($N = \text{Portfolio Slots}$).
   - **Interaction with Portfolio Slots & Max Cap**:
     - Automatically adapts to any number of qualified holdings (whether 3 stocks or 10 stocks).
     - If any stock exceeds the user-configured **Max Cap per Stock** (e.g. 20%), the excess weight is capped and iteratively redistributed across the remaining un-capped stocks in rank order.
6. **Tailwind-Dominant**: Overweights constituents in institutional leader sectors by up to 2.2x.
7. **Equal-Weight ($1/N$)**: Baseline benchmark for comparison.
8. **Risk Management & Position Caps**: Enforces single-stock maximum limits (e.g. 10%, 15%, 20%, 25%, 30%, 33%, 50%) across customizable portfolio slot counts (5, 8, 10, 15, 20, 25 slots) with 5-iteration proportional redistribution. All weighting strategies are unified across both the 10-Year Real Data Backtester and the Step 5 Portfolio Allocator.

### 2.5 Capital Ingestion Architecture (Lumpsum, Pure SIP & Hybrid Ingestion)
- **Investment Modes**:
  1. **Lumpsum Only**: Fixed initial corpus (e.g., ₹10 Lakhs) compounded over the full 10-year span.
  2. **Pure Recurring SIP**: Zero initial capital ($C_0 = 0$), ingesting a fixed monthly amount (e.g., ₹25,000/month) on a designated day of each month (e.g., Day 1). Ingested cash sits in liquid strategy cash and is systematically deployed into top-ranked momentum constituents during the next scheduled rebalance.
  3. **Hybrid Mode**: Combines starting base capital (e.g., ₹5 Lakhs) with ongoing monthly SIP contributions.
- **Annual Step-Up**: User-configurable percentage (e.g., +10% per year) applied automatically every January (e.g., Year 1: ₹25,000/mo, Year 2: ₹27,500/mo, Year 3: ₹30,250/mo).
- **Money-Weighted Performance (XIRR & MOIC)**:
  - Exact daily cash flow tracking: Outflows ($-\text{SIP}_t$) on injection dates, ending portfolio NAV ($+\text{NAV}_T$) at terminal date.
  - Solves for internal rate of return $r$ using Newton-Raphson:
    $$\sum_{k=0}^{P} \frac{F_k}{(1 + r)^{(t_k - t_0)/365.25}} = 0$$
  - **MOIC (Multiple on Invested Capital)**:
    $$\text{MOIC} = \frac{\text{Final Strategy Capital}}{\text{Total Invested Capital}}$$

### 2.6 Multi-Condition Macro Circuit Breakers & Market Breadth Re-Entry Hysteresis
To protect portfolio equity during market crashes, bear markets, and volatile sideways churn, the system incorporates modular macro circuit breakers with asymmetric exit and re-entry hysteresis:
1. **Benchmark Trend Breaker**: Exits to 100% Cash when Nifty 500 / Nifty 50 trades below key moving averages (100 EMA, 200 EMA, 200 DMA, 50 EMA, 50 DMA).
2. **India VIX Volatility Spike**: Exits when India VIX surpasses user thresholds (e.g., > 25 or > 30).
3. **Market Breadth Breakdown & Re-Entry Confirmation Gate**:
   - **Exit Threshold**: Liquidates active equity holdings into cash when the percentage of Nifty 500 stocks above 50 EMA (or 50 DMA, 200 DMA) drops below the exit threshold ($< 40\%, < 45\%, < 50\%, < 55\%$).
   - **Re-Entry Hysteresis Gate**: To prevent whipsaw during sideways markets where breadth fluctuates repeatedly around 40–45%, the engine requires breadth to confirm recovery by rising to or above a higher customizable Re-Entry Gate ($\ge 40\%, \ge 45\%, \ge 50\%, \ge 55\%$) before deploying cash back into equity.
   - **Multi-Rule Conjunction**: The re-entry gate is an *additional* confirmation constraint, not a standalone trigger; re-entry only occurs when the re-entry breadth threshold is met **AND** all other active macro conditions (Benchmark MA, VIX, etc.) are fully clear.
4. **20-Day Index Velocity Drop**: Catches rapid selloffs when Nifty 500 drops $> 6\%$ from its 20-day high.

### 2.7 Idle Cash & Defensive Asset Deployment (Yield During Cash Phases & Opportunity Cost Offset)
To eliminate cash drag during macro circuit breaker lockouts (100% Cash) or open portfolio slots, the backtest simulator models realistic yield accretion on idle capital:
- **Asset Class Options**:
  1. **Liquid Funds / Arbitrage Mutual Funds**: Default at 6.5% p.a. (Overnight/Liquidcase/LIQUIDBEES).
  2. **Fixed Deposits (FD)**: Benchmark at 7.5% p.a. (1-Year Senior Debt / Bank Term Deposit).
  3. **Domestic Gold ETF**: Historical rate at 12.0% p.a. (GOLDBEES / Sovereign Gold Bonds).
  4. **Pure Idle Cash**: 0.0% p.a. (Trading ledger baseline).
  5. **Custom Yield Rate**: Configurable between 0% and 30% p.a.
- **Daily Compounding Yield Mechanics**:
  $$\text{DailyYield}_t = \text{Cash}_t \times \left( (1 + \text{AnnualRate})^{1/252} - 1 \right)$$
- **Visual Asset & Cash Exposure Analysis**:
  - Dedicated stacked area chart tab: **"Cash & Asset Exposure (Equity vs Cash %)"** tracking daily active equity allocation vs. defensive cash buffer.
  - Tracks total days in defensive cash, percentage of timeline in 100% cash, average cash exposure percentage, and cumulative defensive interest generated.

---

## 3. Data Pipeline & Nightly Synchronization

### 3.1 Database Baseline Release v2.1.0 & Client Bootstrap
- **Target Baseline Release**: `v2.1.0` (`nifty500_historical.db.zip`).
- **Cache Invalidation & Storage Upgrade**: Evaluates `moneta_db_version` and legacy `moneta_db_release_tag`. If not equal to `v2.1.0`, local IndexedDB / OPFS storage is automatically cleared and re-seeded from the release ZIP asset.
- **Decompression Engine**: Uses high-performance WebAssembly/JavaScript decompressor `fflate` (`unzipSync`) inside the Web Worker to extract `nifty500_historical.db` before mounting into the SQLite WASM instance.

### 3.2 Macro Daily Ingestion (`macro_daily`)
- **Schema**:
  ```sql
  CREATE TABLE IF NOT EXISTS macro_daily (
      trade_date TEXT NOT NULL,
      index_name TEXT NOT NULL,
      open REAL,
      high REAL,
      low REAL,
      close REAL,
      volume REAL,
      PRIMARY KEY (trade_date, index_name)
  );
  CREATE INDEX IF NOT EXISTS idx_macro_daily_date ON macro_daily(trade_date);
  CREATE INDEX IF NOT EXISTS idx_macro_daily_index ON macro_daily(index_name);
  ```
- **Direct Macro Binding**: NIFTY 50, NIFTY 500, INDIA VIX, GOLDBEES, and LIQUIDBEES historical series are queried directly from `macro_daily`, replacing synthetic index estimation with real exchange data.
- **Daily EOD Delta Synchronization**: Ingests delta feeds containing both individual stock candles and daily `macro_data` points with atomic upserts into SQLite.

---

## 4. UI Architecture & Components

- **`StockTable.tsx`**: High-density interactive universe view with multi-timeframe sorting, visual momentum badges, 52W proximity indicators, and Sector Tailwind tags.
- **`QuantFilters.tsx`**: Filter controls for percentile thresholds, absolute counts, 52W high proximity tolerance, and sector isolation.
- **`MetricCards.tsx`**: Top-level quant statistics summarizing overlapping count, average returns across timeframes, and dominant sector tailwind.
- **`BacktestSimulatorModal.tsx`**: Multi-year historical simulation engine calculating CAGR, XIRR, MOIC, Sharpe ratio, Max Drawdown, monthly returns heatmap, live Web Worker simulation execution, and trade transaction logs with clean real-data controls.
- **`PortfolioBuilderModal.tsx`**: Equal-weight / risk-parity portfolio constructor with rebalancing rules and export capabilities.

---

## 5. Maintenance Protocol
Whenever modifications are made to quantitative rules, data structures, filter mechanics, or architectural components, **this document must be updated in sync** to preserve complete architectural alignment.
