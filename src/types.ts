export type MarketCapCategory = 'Large Cap' | 'Mid Cap' | 'Small Cap';

export type NSEIndexKey = 'nifty500' | 'nifty50' | 'niftynext50' | 'niftymidcap150' | 'niftysmallcap250';

export interface IndexOption {
  key: NSEIndexKey;
  label: string;
  shortLabel: string;
  description: string;
  expectedCount: number;
}

export interface StockRecord {
  id: string;
  symbol: string; // e.g. "COCHINSHIP.NS"
  ticker: string; // e.g. "COCHINSHIP"
  name: string;
  sector: string;
  category: MarketCapCategory;
  cmp: number; // Current Market Price (15-min delayed) in INR
  lastClose: number; // Last Completed Trading Session's Closing Price in INR (Quant Calculation Benchmark)
  cmpChangePct?: number; // Intraday % change of CMP vs Last Session Close
  high52w: number;
  low52w: number;
  return1M: number; // % return ~21 trading days
  return3M: number; // % return ~63 trading days
  return1Y: number; // % return ~252 trading days
  
  // Index membership
  isNifty50?: boolean;
  isNiftyNext50?: boolean;
  isNiftyMidcap150?: boolean;
  isNiftySmallcap250?: boolean;

  // Computed Quant Metrics
  rank1M?: number;
  rank3M?: number;
  rank1Y?: number;
  percentile1M?: number;
  percentile3M?: number;
  percentile1Y?: number;
  compositeMomentumScore?: number;
  pctFrom52WHigh?: number; // e.g. -3.2%
  isWithin52WHigh?: boolean;
  isOverlappingWinner?: boolean; // Meets criteria across all 3 timeframes
  atr14?: number; // 14-day Average True Range in INR
  atrPct?: number; // 14-day ATR as % of Close Price
  
  // Rebalance Status
  rebalanceStatus?: 'retained' | 'new_entrant' | 'slipped_exit' | 'neutral';
  previousReturn1M?: number;
  previousReturn3M?: number;

  // Broker-Grade Corporate Action & Security Identification
  isin?: string; // Standard unique security identifier (e.g. "INE758T01015")
  corporateActionNote?: string; // e.g. "Renamed from ZOMATO", "Split adjusted 10:1"
  crossSourceVerified?: boolean; // Verified against secondary quote source
}

export interface ComputedStockMetric {
  symbol: string;
  ticker: string;
  lastClose: number;
  cmp: number;
  cmpChangePct?: number;
  high52w: number;
  low52w: number;
  return1M: number;
  return3M: number;
  return1Y: number;
  previousReturn1M?: number;
  previousReturn3M?: number;
  latestTradeDate?: string;
}

export interface DataFetchInfo {
  fetchedAt: string; // ISO string of when sync / data was fetched
  dbTradeDate: string; // The verified latest trade date found in the database (e.g. "2026-09-15")
  tradeDateFormatted: string; // Formatted date string (e.g. "Tuesday, 15 Sep 2026")
  scheduledSyncTime: string; // e.g. "Daily at 06:30 PM IST"
  isPreSyncWindow: boolean; // True if current time is before 6:30 PM IST on a trading day
  source: string; // e.g. "Official National Stock Exchange of India (NSE Bhavcopy & Archives)"
  recordCount: number;
  isLiveQuote: boolean;
  engineStatus: 'ready' | 'computing' | 'cached';
  summaryMessage?: string;
}

export interface NightlySyncStatus {
  lastSuccessfulSync: string; // ISO 8601 string
  lastActualNSESync?: string | null; // ISO 8601 string of the last actual live HTTP 200 fetch directly from NSE India archives
  lastAttempt: string; // ISO 8601 string
  status: 'success' | 'failed' | 'degraded';
  syncMode?: 'live_nse_direct' | 'verified_fallback' | 'custom_csv_upload';
  errorMessage?: string | null;
  scheduledCron: string;
  source: string;
  updatedIndices: NSEIndexKey[];
  stockCounts: Record<NSEIndexKey, number>;
}

export interface CrossSourceQuoteComparison {
  ticker: string;
  symbol: string;
  appCmp: number;
  appLastClose: number;
  primarySource: {
    name: string;
    cmp: number;
    lastClose: number;
    timestamp: string;
  };
  secondarySource: {
    name: string;
    cmp: number;
    lastClose: number;
    timestamp: string;
  };
  cmpDiscrepancyPct: number; // Market hours threshold: <= 1.25%
  closeDiscrepancyPct: number; // EOD Quant benchmark threshold: <= 0.20%
  discrepancyPct: number; // Legacy or max discrepancy
  isCmpConsistent: boolean; // cmp <= 1.25%
  isCloseConsistent: boolean; // lastClose <= 0.20%
  isConsistent: boolean; // passes BOTH EOD and Market Hours tolerances
  note?: string;
}

export interface FilterSettings {
  mode: 'percentile' | 'top_count';
  percentileThreshold: number; // e.g. 25 for Top 25%
  topCountThreshold: number; // e.g. 50 for Top 50
  enforce52WHigh: boolean;
  maxDistance52WHighPct: number; // e.g. 5%
  selectedSector: string;
  selectedCategory: string;
  searchQuery: string;
  showOnlyWinners: boolean;
  sortBy: 'composite' | 'return1M' | 'return3M' | 'return1Y' | 'pct52WHigh';
  sortOrder: 'asc' | 'desc';
}

export interface SectorTailwindInfo {
  sector: string;
  overlappingCount: number;
  baselineWinnerCount?: number;
  sectorBreadthPct?: number;
  totalInSector: number;
  percentageOfOverlapping: number;
  isTailwind: boolean; // Structural macro sector tailwind (universe momentum breadth or active concentration)
}

export type PortfolioWeightStrategy =
  | 'atr_momentum_parity' // ATR-Adjusted Momentum (Score / ATR% ★)
  | 'multi_factor' // Multi-Factor Conviction: Composite Score + Rank Decay + Tailwind Boost (Recommended)
  | 'atr_inverse_vol' // ATR Inverse Volatility (Pure Risk Parity)
  | 'composite_score' // Proportional to Composite Score
  | 'rank_decay' // Inverse / Exponential Rank Decay
  | 'tailwind_tilted' // Overweight stocks in Tailwind Sectors
  | 'equal_weight'; // 1/N Baseline Equal Weight

export interface PortfolioAllocation {
  totalCapital: number;
  topNStocks: number;
  weightStrategy?: PortfolioWeightStrategy;
  maxPositionWeightPct?: number; // Cap per single stock (e.g. 20%)
  tailwindBoostPct?: number; // e.g. 25% extra weight for tailwind sectors
  stopLossPct: number;
  targetGainPct: number;
}

export interface AllocatedPosition {
  stock: StockRecord;
  weightPct: number;
  allocatedAmount: number;
  shares: number;
  investedAmount: number;
  stopLossPrice: number;
  targetPrice: number;
  convictionTier?: 'High Alpha' | 'Core Momentum' | 'Emerging Trend';
  hasTailwindBoost?: boolean;
}

export type RebalanceCadence =
  | 'first_day_monthly'
  | 'first_wednesday_monthly'
  | 'weekly_wednesday'
  | 'biweekly'
  | 'daily_continuous'
  | 'quarterly';

export type MacroRegimeFilter =
  | 'none'
  | 'nifty50_below_200dma'
  | 'nifty50_below_200ema'
  | 'nifty500_below_200dma'
  | 'nifty500_below_200ema'
  | 'vix_above_threshold'
  | 'compound_circuit_breaker';

export interface CircuitBreakersConfig {
  enabled: boolean;
  logic: 'OR' | 'AND';
  benchmarkTrend: {
    enabled: boolean;
    index: 'NIFTY500' | 'NIFTY50';
    indicator: '200_EMA' | '200_DMA' | '50_EMA' | '50_DMA' | '100_EMA';
  };
  vixSpike: {
    enabled: boolean;
    threshold: number; // e.g. 20 to 45
  };
  marketBreadth: {
    enabled: boolean;
    indicator: '50_EMA' | '50_DMA' | '200_DMA';
    thresholdPct: number; // e.g. 45% (sit in cash if % of Nifty 500 stocks above MA < thresholdPct)
    reEntryThresholdPct?: number; // e.g. 40%, 45%, 50%, 55% (stay in cash until % above MA >= reEntryThresholdPct)
  };
  rapidDrawdown: {
    enabled: boolean;
    dropPct: number; // e.g. 5% to 10% drop from 20-day high
  };
}

export type StopLossMode =
  | 'none'
  | 'static'
  | 'trailing_15pct_day1'
  | 'trail_from_high'
  | 'breakeven_then_trail'
  | 'dma50_trend';

export type TrailingStopRule = StopLossMode;

export type BacktestWeightStrategy =
  | 'equal_weight' // Equal weight (1/N Baseline)
  | 'atr_momentum_parity' // ATR-Adjusted Momentum (Score / ATR% ★)
  | 'atr_inverse_vol' // ATR Inverse Volatility (Pure Risk Parity)
  | 'multi_factor' // Multi-Factor: Score² / sqrt(Rank)
  | 'composite_score' // Proportional to Composite Score³
  | 'rank_decay'; // Inverse Rank Decay (1 / Rank^0.65)

export type InvestmentMode = 'lumpsum' | 'sip' | 'hybrid';

export type DefensiveAssetOption = 'cash_zero' | 'liquid_fund' | 'fixed_deposit' | 'gold_etf' | 'custom';

export interface BacktestConfig {
  investmentMode?: InvestmentMode;
  initialCapital: number;
  sipMonthlyAmount?: number; // e.g. 15000, 25000, 50000
  sipDayOfMonth?: number; // e.g. 1, 5, 10, 15, 20, 25
  sipAnnualStepUpPct?: number; // e.g. 0, 5, 10, 15, 20 (% annual increase)
  portfolioSize: number;
  weightStrategy?: BacktestWeightStrategy;
  maxPositionWeightPct?: number; // e.g. 10%, 15%, 20%, 25%, 33.3%, 50%
  retentionBufferRank?: number; // e.g. 10 (Strict/No Buffer), 15, 20, 25, 30, 40
  defensiveAssetType?: DefensiveAssetOption; // 'cash_zero' | 'liquid_fund' | 'fixed_deposit' | 'gold_etf' | 'custom'
  defensiveCashYieldPct?: number; // e.g. 0%, 6.5% (Liquid/Arbitrage), 7.5% (FD), 12.0% (Gold ETF), or custom %
  stopLossMode?: StopLossMode;
  stopLossPct: number;
  targetGainPct: number;
  trailingRule?: TrailingStopRule;
  rebalanceCadence: RebalanceCadence;
  enforce52WHigh: boolean;
  maxDistance52WHighPct: number;
  macroFilter?: MacroRegimeFilter;
  vixThreshold?: number; // 20 | 25 | 30
  circuitBreakers?: CircuitBreakersConfig;
  startYear: number;
  endYear: number;
}

export interface YearPerformance {
  year: number;
  strategyReturn: number;
  benchmarkReturn: number;
  alpha: number;
  maxDrawdown: number;
  tradesCount: number;
  winRate: number;
  yearlyInflow?: number;
  cumulativeInvested?: number;
  endStrategyCapital?: number;
}

export interface EquityPoint {
  date: string;
  year: number;
  strategyEquity: number;
  benchmarkEquity: number;
  nifty50Equity: number;
  goldEquity: number;
  strategyDrawdown: number;
  benchmarkDrawdown: number;
  cumulativeInvested?: number;
  cashPct?: number; // % in Cash / Defensive Asset
  equityPct?: number; // % in Equity
  cashAmount?: number; // ₹ cash balance
  isDefensiveMode?: boolean; // whether macro breaker is active
  defensiveYieldToday?: number; // yield earned on cash today
}

export interface BacktestTrade {
  id: string;
  ticker: string;
  name: string;
  sector: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  holdingDays: number;
  exitReason:
    | 'Stop Loss Triggered'
    | 'Target Gain Achieved'
    | 'Rank Dropped Below Cutoff'
    | 'Trailing Stop Breached'
    | 'Trailing 15% SL Breached (Day 1)'
    | 'Trailing Stop Breached (-8% from Peak)'
    | 'Breakeven SL Triggered'
    | '50 DMA Trendline Filter Broken'
    | 'Still Active'
    | string;
  status: 'WIN' | 'LOSS' | 'SCRATCH';
}

export interface BacktestSummary {
  config: BacktestConfig;
  investmentMode: InvestmentMode;
  initialCapital: number;
  totalInvestedCapital: number;
  totalSipContributions: number;
  finalStrategyCapital: number;
  finalBenchmarkCapital: number;
  finalNifty50Capital: number;
  finalGoldCapital: number;
  strategyCagr: number;
  benchmarkCagr: number;
  nifty50Cagr: number;
  goldCagr: number;
  strategyXirr?: number;
  benchmarkXirr?: number;
  nifty50Xirr?: number;
  goldXirr?: number;
  strategyTotalReturn: number;
  benchmarkTotalReturn: number;
  strategyMoic: number;
  benchmarkMoic: number;
  nifty50Moic: number;
  goldMoic: number;
  strategyMaxDrawdown: number;
  benchmarkMaxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWinPct: number;
  avgLossPct: number;
  avgHoldingDays: number;
  annualTurnoverPct: number;
  defensiveCashDays?: number; // number of days spent in defensive cash mode
  defensiveCashPct?: number; // % of total days in defensive cash
  avgCashExposurePct?: number; // average portfolio % in cash
  totalDefensiveYieldEarned?: number; // total ₹ yield generated by idle cash
  defensiveAssetType?: string;
  defensiveCashYieldPct?: number;
  yearlyPerformance: YearPerformance[];
  equityCurve: EquityPoint[];
  sampleTrades: BacktestTrade[];
}

