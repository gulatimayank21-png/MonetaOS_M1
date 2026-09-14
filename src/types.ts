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
  
  // Rebalance Status
  rebalanceStatus?: 'retained' | 'new_entrant' | 'slipped_exit' | 'neutral';
  previousReturn1M?: number;
  previousReturn3M?: number;

  // Broker-Grade Corporate Action & Security Identification
  isin?: string; // Standard unique security identifier (e.g. "INE758T01015")
  corporateActionNote?: string; // e.g. "Renamed from ZOMATO", "Split adjusted 10:1"
  crossSourceVerified?: boolean; // Verified against secondary quote source
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
  totalInSector: number;
  percentageOfOverlapping: number;
  isTailwind: boolean; // >= 4 or >= 20% of winners
}

export interface PortfolioAllocation {
  totalCapital: number;
  topNStocks: number;
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

export interface BacktestConfig {
  initialCapital: number;
  portfolioSize: number;
  maxPositionWeightPct?: number; // e.g. 10%, 15%, 20%, 25%, 33.3%, 50%
  retentionBufferRank?: number; // e.g. 10 (Strict/No Buffer), 15, 20, 25, 30, 40
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
  initialCapital: number;
  finalStrategyCapital: number;
  finalBenchmarkCapital: number;
  finalNifty50Capital: number;
  finalGoldCapital: number;
  strategyCagr: number;
  benchmarkCagr: number;
  nifty50Cagr: number;
  goldCagr: number;
  strategyTotalReturn: number;
  benchmarkTotalReturn: number;
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
  yearlyPerformance: YearPerformance[];
  equityCurve: EquityPoint[];
  sampleTrades: BacktestTrade[];
}

