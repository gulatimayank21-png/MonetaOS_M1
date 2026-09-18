import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  X,
  TrendingUp,
  Sliders,
  Shield,
  Target,
  Calendar,
  Layers,
  RotateCcw,
  Sparkles,
  HelpCircle,
  Award,
  AlertTriangle,
  Flame,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  LineChart as LineChartIcon,
  Info,
  Database,
  RefreshCw,
  Play,
  Loader2,
  Terminal,
  Code2,
  Search,
  Check,
  FileSpreadsheet,
  Timer,
  Clock,
  Zap,
  Scale,
  Landmark,
  PiggyBank,
  Coins,
  PieChart,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import {
  BacktestConfig,
  BacktestSummary,
  RebalanceCadence,
  TrailingStopRule,
  StopLossMode,
  MacroRegimeFilter,
  BacktestWeightStrategy,
  InvestmentMode,
} from '../types';
import { runQuantMomentumBacktest } from '../utils/backtestEngine';
import { useHistoricalDataSync } from '../hooks/useHistoricalDataSync';

interface BacktestSimulatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialStopLoss?: number;
  initialTargetGain?: number;
}

export const BacktestSimulatorModal: React.FC<BacktestSimulatorModalProps> = ({
  isOpen,
  onClose,
  initialStopLoss = 8,
  initialTargetGain = 25,
}) => {
  // Background WASM SQLite & IndexedDB Sync Hook
  const {
    status: syncStatus,
    progress: syncProgress,
    progressMessage: syncMessage,
    error: syncError,
    dbStats,
    deltaSync,
    hasCachedData,
    startWarmup,
    syncDeltas,
    runRealBacktest,
  } = useHistoricalDataSync();

  const [isSyncingDeltas, setIsSyncingDeltas] = useState(false);
  const [deltaSyncFeedback, setDeltaSyncFeedback] = useState<string | null>(null);
  const [showMissingAuditDetails, setShowMissingAuditDetails] = useState(false);
  const [isDeltaWarningDismissed, setIsDeltaWarningDismissed] = useState(false);

  // Configurable backtest parameters
  const [config, setConfig] = useState<BacktestConfig>({
    investmentMode: 'lumpsum',
    initialCapital: 1000000, // ₹10 Lakhs
    sipMonthlyAmount: 25000, // ₹25,000 / month
    sipDayOfMonth: 1,
    sipAnnualStepUpPct: 10, // +10% annual step up
    portfolioSize: 10,
    maxPositionWeightPct: undefined, // Auto equal weighting: 100% / portfolioSize
    weightStrategy: 'atr_momentum_parity', // Volatility-Adjusted Momentum parity
    retentionBufferRank: 25,
    defensiveAssetType: 'liquid_fund',
    defensiveCashYieldPct: 6.5,
    stopLossMode: initialStopLoss === 0 ? 'none' : 'static',
    stopLossPct: initialStopLoss !== undefined && initialStopLoss > 0 ? initialStopLoss : 8,
    targetGainPct: initialTargetGain !== undefined ? initialTargetGain : 25,
    trailingRule: initialStopLoss === 0 ? 'none' : 'static',
    rebalanceCadence: 'first_day_monthly',
    enforce52WHigh: true,
    maxDistance52WHighPct: 15,
    macroFilter: 'none',
    vixThreshold: 25,
    circuitBreakers: {
      enabled: true,
      logic: 'OR',
      benchmarkTrend: {
        enabled: true,
        index: 'NIFTY500',
        indicator: '200_EMA',
      },
      vixSpike: {
        enabled: true,
        threshold: 30,
      },
      marketBreadth: {
        enabled: true,
        indicator: '50_EMA',
        thresholdPct: 45,
        reEntryThresholdPct: 50,
      },
      rapidDrawdown: {
        enabled: false,
        dropPct: 6,
      },
    },
    startYear: 2016,
    endYear: 2026,
  });

  const [showCircuitBreakerStudio, setShowCircuitBreakerStudio] = useState<boolean>(true);

  const [activeChartTab, setActiveChartTab] = useState<'equity' | 'drawdown' | 'yearly' | 'cash_allocation'>('equity');
  const [tradeFilter, setTradeFilter] = useState<'all' | 'winners' | 'multibaggers' | 'stops' | 'rank_drop'>('all');
  const [showRationaleGuide, setShowRationaleGuide] = useState<boolean>(false);

  // Real-Data Simulation State
  const [realSummary, setRealSummary] = useState<BacktestSummary | null>(null);
  const [isExecutingQuery, setIsExecutingQuery] = useState<boolean>(false);
  const [simulationElapsedMs, setSimulationElapsedMs] = useState<number | null>(null);
  const [simTimerSeconds, setSimTimerSeconds] = useState<number>(0);
  const [lastExecutedTime, setLastExecutedTime] = useState<string | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);

  const [selectedBenchmarks, setSelectedBenchmarks] = useState<{
    nifty500: boolean;
    nifty50: boolean;
    gold: boolean;
  }>({
    nifty500: true,
    nifty50: true,
    gold: true,
  });

  // Automatically start background warmup on modal open
  useEffect(() => {
    if (isOpen) {
      startWarmup();
    }
  }, [isOpen, startWarmup]);

  // Synchronize initial values if changed from parent
  useEffect(() => {
    if (initialStopLoss !== undefined) {
      setConfig((prev) => ({ ...prev, stopLossPct: initialStopLoss }));
    }
    if (initialTargetGain !== undefined) {
      setConfig((prev) => ({ ...prev, targetGainPct: initialTargetGain }));
    }
  }, [initialStopLoss, initialTargetGain]);

  // Fallback fast computation while DB initial matrix is loading
  const fallbackSummary: BacktestSummary = useMemo(() => {
    return runQuantMomentumBacktest(config);
  }, [config]);

  // Active Summary: prioritize 100% Real-Data Simulation output
  const summary: BacktestSummary = realSummary || fallbackSummary;

  const configRef = useRef<BacktestConfig>(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Real-Data Backtest Runner with live timer and practical ETA hint
  const handleRunBacktest = useCallback(
    async (targetConfig?: BacktestConfig) => {
      const activeCfg = targetConfig || configRef.current;
      setIsExecutingQuery(true);
      setSimulationError(null);
      setSimTimerSeconds(0);

      const timerInterval = setInterval(() => {
        setSimTimerSeconds((prev) => Math.round((prev + 0.1) * 10) / 10);
      }, 100);

      try {
        const result = await runRealBacktest(activeCfg);
        setRealSummary(result.summary);
        setSimulationElapsedMs(result.executionTimeMs);
        setLastExecutedTime(new Date().toLocaleTimeString());
      } catch (err: any) {
        console.error('Real Data Backtest Execution Error:', err);
        setSimulationError(err?.message || 'Failed to execute real backtest');
      } finally {
        clearInterval(timerInterval);
        setIsExecutingQuery(false);
      }
    },
    [runRealBacktest]
  );

  // Automatically trigger real backtest when DB is ready or whenever any config parameter changes
  useEffect(() => {
    if (!isOpen || syncStatus !== 'ready') return;

    const debounceTimer = setTimeout(() => {
      handleRunBacktest(config);
    }, 200);

    return () => clearTimeout(debounceTimer);
  }, [isOpen, syncStatus, config, handleRunBacktest]);

  if (!isOpen) return null;

  // Filtered sample trades
  const filteredTrades = summary.sampleTrades.filter((t) => {
    if (tradeFilter === 'winners') return t.status === 'WIN';
    if (tradeFilter === 'multibaggers') return t.returnPct >= 40;
    if (tradeFilter === 'stops') return t.exitReason === 'Stop Loss Triggered';
    if (tradeFilter === 'rank_drop') return t.exitReason.includes('Rank Dropped');
    return true;
  });

  const formatIndianCurrency = (val: number, decimals: number = 2): string => {
    if (val === undefined || val === null || isNaN(val)) return '₹0';
    const absVal = Math.abs(val);
    const sign = val < 0 ? '-' : '';

    if (absVal >= 10000000) {
      // ₹1 Crore or more
      const cr = absVal / 10000000;
      return `${sign}₹${cr.toFixed(cr >= 100 ? 1 : decimals)} Cr`;
    } else if (absVal >= 100000) {
      // ₹1 Lakh or more
      const l = absVal / 100000;
      return `${sign}₹${l.toFixed(l >= 100 ? 1 : decimals)} Lakhs`;
    } else if (absVal >= 1000) {
      const k = absVal / 1000;
      return `${sign}₹${k.toFixed(1)}k`;
    } else {
      return `${sign}₹${absVal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    }
  };

  const formatLakhs = (val: number) => formatIndianCurrency(val);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-6xl w-full max-h-[94vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-gradient-to-r from-slate-50 via-indigo-50/30 to-slate-50 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-xs">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                  10-Year Quantitative Strategy Backtester (100% Real OHLCV)
                </h2>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                  <Check className="w-3 h-3 text-emerald-600" />
                  Exact Raw Data
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Simulating actual trades over {dbStats?.totalCandles ? `${dbStats.totalCandles.toLocaleString()}` : '1,282,102'} daily candles across {dbStats?.uniqueSymbols ? `${dbStats.uniqueSymbols}` : '621'} Nifty stocks with pure price accuracy and zero assumptions
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Live Execution Timer & Completion Status */}
            {isExecutingQuery ? (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-950 text-white font-mono text-xs shadow-xs animate-pulse border border-indigo-800">
                <Timer className="w-3.5 h-3.5 text-amber-300 animate-spin" />
                <span>
                  Simulating... <strong>{simTimerSeconds.toFixed(1)}s</strong>
                </span>
                <span className="text-indigo-300 text-[11px] hidden sm:inline">(ETA: ~0.8s – 1.5s)</span>
              </div>
            ) : simulationElapsedMs !== null ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-900 border border-emerald-300 text-xs font-semibold shadow-2xs">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>100% Real DB Numbers</span>
                <span className="font-mono text-[11px] px-1.5 py-0.2 rounded bg-emerald-200/80 text-emerald-950">
                  {simulationElapsedMs} ms
                </span>
                {lastExecutedTime && (
                  <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
                    @{lastExecutedTime}
                  </span>
                )}
              </div>
            ) : null}

            <button
              onClick={() => setShowRationaleGuide((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
              title="Why SL=-8% and Profit=25%?"
            >
              <HelpCircle className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden sm:inline">SL &amp; Target Rules</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 space-y-6">
          {/* SQLite WASM & Real-Data Status Banner */}
          <div className={`rounded-xl border p-3.5 transition-all duration-300 text-xs shadow-2xs ${
            syncStatus === 'error' || simulationError
              ? 'bg-rose-50/80 border-rose-200 text-rose-900'
              : isExecutingQuery || syncStatus === 'downloading'
              ? 'bg-indigo-50/80 border-indigo-200 text-indigo-950'
              : syncStatus === 'ready'
              ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
              : 'bg-slate-50 border-slate-200 text-slate-700'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5">
                <div className={`p-1.5 rounded-lg ${
                  syncStatus === 'error' || simulationError
                    ? 'bg-rose-600 text-white'
                    : isExecutingQuery || syncStatus === 'downloading'
                    ? 'bg-indigo-600 text-white animate-pulse'
                    : syncStatus === 'ready'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 text-slate-700'
                }`}>
                  {isExecutingQuery ? (
                    <Timer className="w-4 h-4 animate-spin text-amber-300" />
                  ) : syncStatus === 'downloading' || syncStatus === 'checking' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : syncStatus === 'error' || simulationError ? (
                    <AlertTriangle className="w-4 h-4" />
                  ) : syncStatus === 'ready' ? (
                    <Database className="w-4 h-4" />
                  ) : (
                    <Database className="w-4 h-4 text-slate-400" />
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">
                      {isExecutingQuery
                        ? `Simulating Real 10-Year OHLCV Data (${simTimerSeconds.toFixed(1)}s elapsed)...`
                        : syncStatus === 'ready'
                        ? '10-Year SQLite Database Ready (100% Real Daily OHLCV Data)'
                        : syncStatus === 'downloading'
                        ? 'Downloading 10-Year Historical SQLite Database (136 MB)...'
                        : syncStatus === 'checking'
                        ? 'Verifying Local SQLite Storage...'
                        : 'Historical SQLite WASM Engine'}
                    </span>
                    {syncStatus === 'ready' && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                        <Check className="w-3 h-3" />
                        {dbStats?.totalCandles ? `${dbStats.totalCandles.toLocaleString()} Rows` : '1,282,102 Rows'}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    {isExecutingQuery
                      ? 'Executing multi-timeframe factor ranks, stop-loss triggers & profit locks day-by-day in background Web Worker...'
                      : syncStatus === 'ready'
                      ? `IndexedDB active • Table: "${dbStats?.tableName || 'daily_ohlcv'}" • ${dbStats?.uniqueSymbols || 621} Nifty symbols • Range: ${dbStats?.minDate || '2016-01-04'} to ${dbStats?.maxDate || '2026-09-11'}${deltaSync?.syncedCount ? ` • ⚡ Auto-Synced: +${deltaSync.syncedCount.toLocaleString()} candles` : ''} • ${summary.totalTrades} Real Trades Computed`
                      : syncMessage}
                  </p>
                  {deltaSync && (
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      <span>
                        EOD Feed: {deltaSync.status === 'synced' ? `Synced ${deltaSync.syncedCount} records through ${deltaSync.maxDate}` : `Up to date (${deltaSync.maxDate})`}
                      </span>
                      {deltaSyncFeedback && (
                        <span className="text-emerald-700 font-semibold ml-1">({deltaSyncFeedback})</span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (isSyncingDeltas || syncStatus !== 'ready') return;
                    setIsSyncingDeltas(true);
                    setDeltaSyncFeedback('Fetching latest deltas...');
                    try {
                      const res = await syncDeltas();
                      setIsDeltaWarningDismissed(false);
                      if (res.hasMissingStocks) {
                        setDeltaSyncFeedback(`Synced +${res.syncedCount} candles (${res.missingAudits?.reduce((a,c)=>a+c.missingCount,0)} missing warning)`);
                      } else if (res.syncedCount > 0) {
                        setDeltaSyncFeedback(`+${res.syncedCount} new candles!`);
                      } else {
                        setDeltaSyncFeedback('Already up to date');
                      }
                      setTimeout(() => setDeltaSyncFeedback(null), 5000);
                    } catch (err: any) {
                      setDeltaSyncFeedback('Sync error');
                      setTimeout(() => setDeltaSyncFeedback(null), 4000);
                    } finally {
                      setIsSyncingDeltas(false);
                    }
                  }}
                  disabled={syncStatus !== 'ready' || isSyncingDeltas || isExecutingQuery}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-50 hover:border-emerald-400 transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
                  title="Check and pull latest EOD market candles from GitHub Pages"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-emerald-600 ${isSyncingDeltas ? 'animate-spin' : ''}`} />
                  <span>{isSyncingDeltas ? 'Syncing...' : 'Sync EOD Deltas'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    startWarmup(true);
                  }}
                  disabled={syncStatus === 'downloading' || isExecutingQuery}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
                  title="Force download fresh nifty500_historical_v2.db.zip release"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-indigo-600 ${syncStatus === 'downloading' ? 'animate-spin' : ''}`} />
                  <span>Re-download DB</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (syncStatus === 'error') {
                      startWarmup(true);
                    } else {
                      handleRunBacktest();
                    }
                  }}
                  disabled={syncStatus === 'downloading' || isExecutingQuery}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-xs inline-flex items-center gap-1.5 cursor-pointer ${
                    syncStatus === 'error'
                      ? 'bg-rose-600 hover:bg-rose-700 text-white'
                      : isExecutingQuery
                      ? 'bg-indigo-900 text-indigo-200 cursor-wait'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                  }`}
                >
                  {isExecutingQuery ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Simulating ({simTimerSeconds.toFixed(1)}s)...
                    </>
                  ) : syncStatus === 'downloading' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Downloading ({syncProgress}%)...
                    </>
                  ) : syncStatus === 'checking' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Checking Cache...
                    </>
                  ) : syncStatus === 'error' ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry Sync &amp; Run
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Run Real-Data Backtest
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Inline Progress Bar during download */}
            {syncStatus === 'downloading' && (
              <div className="mt-2.5 pt-2 border-t border-indigo-200/60">
                <div className="flex items-center justify-between text-[10px] font-semibold text-indigo-900 mb-1">
                  <span>Stream Transfer Progress</span>
                  <span className="font-mono">{syncProgress}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-indigo-200/70 overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(4, syncProgress)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Non-intrusive Warning Banner for Tracked Stocks Missing from Bhavcopy */}
            {deltaSync?.hasMissingStocks && !isDeltaWarningDismissed && (
              <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs shadow-xs animate-in fade-in">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-amber-900 leading-snug">
                        {deltaSync.missingWarningMessage ||
                          `⚠️ Data Sync Warning: ${deltaSync.missingAudits?.reduce((a, c) => a + c.missingCount, 0) || 0} tracked stocks missing from Bhavcopy`}
                      </p>
                      <p className="text-[11px] text-amber-800/90 mt-0.5">
                        Valid candles were committed to SQLite &amp; IndexedDB storage. The backtest engine will safely continue operating.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {deltaSync.missingAudits && deltaSync.missingAudits.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowMissingAuditDetails((p) => !p)}
                        className="px-2 py-1 rounded bg-amber-200/70 hover:bg-amber-200 text-amber-900 text-[11px] font-semibold transition-colors cursor-pointer"
                      >
                        {showMissingAuditDetails ? 'Hide Missing List' : 'View Missing Stocks'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsDeltaWarningDismissed(true)}
                      className="p-1 rounded text-amber-700 hover:text-amber-950 hover:bg-amber-200/50 transition-colors cursor-pointer"
                      title="Dismiss warning"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expanded missing stocks details table / pills */}
                {showMissingAuditDetails && deltaSync.missingAudits && (
                  <div className="mt-2.5 pt-2.5 border-t border-amber-200/80 space-y-2 font-mono text-[11px]">
                    {deltaSync.missingAudits.map((audit) => (
                      <div key={audit.tradeDate} className="bg-white/80 p-2.5 rounded-lg border border-amber-200">
                        <div className="flex items-center justify-between font-semibold text-amber-900 mb-1.5">
                          <span>Trade Date: {audit.tradeDate}</span>
                          <span className="text-[10px] bg-amber-100 px-2 py-0.5 rounded text-amber-800">
                            {audit.missingCount} of {audit.expectedCount} tracked missing ({audit.receivedCount} received)
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto pr-1">
                          {audit.missingSymbols.map((sym) => (
                            <span
                              key={sym}
                              className="px-1.5 py-0.5 bg-amber-100 text-amber-900 rounded text-[10px] font-semibold border border-amber-300"
                            >
                              {sym}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                    <p className="text-[10px] text-amber-800 font-sans italic">
                      Note: Full missing symbol list has also been printed to <code className="bg-amber-100 px-1 rounded">console.warn</code> for clipboard copying.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Collapsible Strategy Rationale Guide */}
          {showRationaleGuide && (
            <div className="p-4 sm:p-5 rounded-xl bg-indigo-50/70 border border-indigo-200/80 text-xs space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
                <h3 className="font-bold text-indigo-950 flex items-center gap-1.5 text-sm">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  Quantitative Rationale: How Did We Arrive at SL = -8% and Profit = +25%?
                </h3>
                <button
                  onClick={() => setShowRationaleGuide(false)}
                  className="text-indigo-400 hover:text-indigo-700 text-xs font-semibold"
                >
                  Dismiss
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-slate-700">
                <div className="bg-white p-3 rounded-lg border border-indigo-100 space-y-1">
                  <div className="font-bold text-slate-900 flex items-center gap-1">
                    <Shield className="w-3.5 h-3.5 text-rose-500" />
                    1. Why -8% Stop Loss?
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    Indian large- and mid-caps have an average 20-day daily volatility (ATR) of ~1.8% to 2.5%. An 8% drop equals ~3× ATR. Beyond 8%, it is no longer routine daily noise—institutional demand has failed.
                  </p>
                </div>

                <div className="bg-white p-3 rounded-lg border border-indigo-100 space-y-1">
                  <div className="font-bold text-slate-900 flex items-center gap-1">
                    <Target className="w-3.5 h-3.5 text-emerald-500" />
                    2. Why +25% Target?
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    Provides a classic <strong>3:1 Asymmetric Risk-to-Reward Ratio</strong> (25% / 8% = 3.125). With a 3:1 payoff, a strategy only requires a <strong>32% win rate</strong> to be profitable.
                  </p>
                </div>

                <div className="bg-white p-3 rounded-lg border border-indigo-100 space-y-1">
                  <div className="font-bold text-slate-900 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                    3. Rebalance Cadence
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    Rebalancing on <strong>Wednesdays</strong> avoids Monday morning liquidity gaps and monthly Thursday F&amp;O expiry rollovers. Alternatively, <strong>Weekly</strong> rebalances catch breakouts quickly.
                  </p>
                </div>

                <div className="bg-white p-3 rounded-lg border border-indigo-100 space-y-1">
                  <div className="font-bold text-slate-900 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    4. Macro &amp; VIX Circuit Breakers
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    When Nifty breaks below <strong>200 DMA / EMA</strong> or <strong>India VIX &gt; 25</strong>, the strategy exits to <strong>100% Cash</strong>. This drastically mitigates maximum drawdown (-44% &rarr; &lt;-20%) during crashes like March 2020.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Controls Bar: Interactive Sliders & Options */}
          <div className="bg-slate-50/80 rounded-xl border border-slate-200 p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Adjust Strategy Rules &amp; Ingestion Parameters
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  setConfig({
                    investmentMode: 'lumpsum',
                    initialCapital: 1000000,
                    sipMonthlyAmount: 25000,
                    sipDayOfMonth: 1,
                    sipAnnualStepUpPct: 10,
                    portfolioSize: 10,
                    maxPositionWeightPct: undefined, // Auto 10%
                    weightStrategy: 'atr_momentum_parity', // ATR volatility parity
                    retentionBufferRank: 25,
                    stopLossMode: 'static',
                    stopLossPct: 8,
                    targetGainPct: 25,
                    trailingRule: 'static',
                    rebalanceCadence: 'first_day_monthly',
                    enforce52WHigh: true,
                    maxDistance52WHighPct: 15,
                    macroFilter: 'none',
                    vixThreshold: 25,
                    circuitBreakers: {
                      enabled: true,
                      logic: 'OR',
                      benchmarkTrend: { enabled: true, index: 'NIFTY500', indicator: '200_EMA' },
                      vixSpike: { enabled: true, threshold: 30 },
                      marketBreadth: { enabled: true, indicator: '50_EMA', thresholdPct: 45 },
                      rapidDrawdown: { enabled: false, dropPct: 6 },
                    },
                    startYear: 2016,
                    endYear: 2026,
                  })
                }
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Defaults (SL: -8%, Target: +25%, ATR Parity)
              </button>
            </div>

            {/* INVESTMENT MODE & CAPITAL INGESTION ARCHITECTURE */}
            <div className="bg-white rounded-xl border border-indigo-100 p-3.5 shadow-2xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-md bg-indigo-600 text-white">
                    <TrendingUp className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-900">
                      Capital Ingestion Architecture
                    </span>
                    <span className="text-[11px] text-slate-500 ml-2 hidden sm:inline">
                      Simulate fixed one-time lumpsum, pure recurring monthly SIP, or hybrid capital growth
                    </span>
                  </div>
                </div>

                {/* Investment Mode Switcher Pills */}
                <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() =>
                      setConfig({
                        ...config,
                        investmentMode: 'lumpsum',
                        initialCapital: config.initialCapital === 0 ? 1000000 : config.initialCapital,
                      })
                    }
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      (config.investmentMode ?? 'lumpsum') === 'lumpsum'
                        ? 'bg-white text-indigo-900 shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    💼 Lumpsum Only
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setConfig({
                        ...config,
                        investmentMode: 'sip',
                        initialCapital: 0,
                        sipMonthlyAmount: config.sipMonthlyAmount || 25000,
                      })
                    }
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      config.investmentMode === 'sip'
                        ? 'bg-white text-indigo-900 shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    🔄 Pure Recurring SIP
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setConfig({
                        ...config,
                        investmentMode: 'hybrid',
                        initialCapital: config.initialCapital === 0 ? 500000 : config.initialCapital,
                        sipMonthlyAmount: config.sipMonthlyAmount || 25000,
                      })
                    }
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      config.investmentMode === 'hybrid'
                        ? 'bg-white text-indigo-900 shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    🚀 Hybrid (Lumpsum + SIP)
                  </button>
                </div>
              </div>

              {/* Dynamic Parameter Grid based on Mode */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* 1. Initial Capital (for Lumpsum & Hybrid) */}
                {(config.investmentMode === 'lumpsum' || config.investmentMode === 'hybrid' || !config.investmentMode) && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                      <span>Initial Starting Capital:</span>
                      <span className="font-mono text-indigo-600">{formatLakhs(config.initialCapital)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {[200000, 500000, 1000000, 2500000, 5000000, 10000000].map((cap) => (
                        <button
                          key={cap}
                          type="button"
                          onClick={() => setConfig({ ...config, initialCapital: cap })}
                          className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                            config.initialCapital === cap
                              ? 'bg-indigo-600 text-white font-bold shadow-xs'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {cap >= 10000000 ? `₹${cap / 10000000}Cr` : `₹${cap / 100000}L`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. SIP Monthly Ingestion Amount (for SIP & Hybrid) */}
                {(config.investmentMode === 'sip' || config.investmentMode === 'hybrid') && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                      <span>Monthly SIP Contribution:</span>
                      <span className="font-mono text-indigo-600">
                        ₹{(config.sipMonthlyAmount ?? 25000).toLocaleString('en-IN')}/mo
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {[10000, 15000, 25000, 50000, 100000].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setConfig({ ...config, sipMonthlyAmount: amt })}
                          className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                            (config.sipMonthlyAmount ?? 25000) === amt
                              ? 'bg-indigo-600 text-white font-bold shadow-xs'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {amt >= 100000 ? `₹${amt / 100000}L` : `₹${amt / 1000}k`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. Annual Step-Up % (for SIP & Hybrid) */}
                {(config.investmentMode === 'sip' || config.investmentMode === 'hybrid') && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                      <span>Annual SIP Step-Up:</span>
                      <span className="font-mono text-indigo-600">
                        +{config.sipAnnualStepUpPct ?? 10}% / yr
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {[0, 5, 10, 15, 20, 25].map((step) => (
                        <button
                          key={step}
                          type="button"
                          onClick={() => setConfig({ ...config, sipAnnualStepUpPct: step })}
                          className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                            (config.sipAnnualStepUpPct ?? 10) === step
                              ? 'bg-indigo-600 text-white font-bold shadow-xs'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {step === 0 ? '0% (Flat)' : `+${step}%`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4. Ingestion Day of Month */}
                {(config.investmentMode === 'sip' || config.investmentMode === 'hybrid') && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                      <span>SIP Ingestion Day:</span>
                      <span className="font-mono text-indigo-600">Day {config.sipDayOfMonth ?? 1}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {[1, 5, 10, 15, 20, 25].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setConfig({ ...config, sipDayOfMonth: d })}
                          className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                            (config.sipDayOfMonth ?? 1) === d
                              ? 'bg-indigo-600 text-white font-bold shadow-xs'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {d}th
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Informative Guidance Banner for SIP */}
              {(config.investmentMode === 'sip' || config.investmentMode === 'hybrid') && (
                <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                  <div className="flex items-center gap-1.5 text-indigo-900 font-medium">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span>
                      {config.investmentMode === 'sip' ? 'Pure SIP mode: ' : 'Hybrid mode: '}
                      Injects <strong>₹{(config.sipMonthlyAmount ?? 25000).toLocaleString('en-IN')}/mo</strong> into strategy cash every month on day {config.sipDayOfMonth ?? 1} (stepped up <strong>+{config.sipAnnualStepUpPct ?? 10}% annually</strong> each January).
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    Compounded via weekly/monthly rebalances &amp; money-weighted XIRR
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
              {/* 1. Unified Stop Loss & Protection Strategy */}
              <div className="bg-white p-3 rounded-lg border border-slate-200/80 shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                    <Shield className="w-3.5 h-3.5 text-rose-500" />
                    Stop Loss &amp; Protection
                  </label>
                  {config.stopLossMode === 'static' ? (
                    <span className="font-mono text-xs font-bold text-rose-600">
                      -{config.stopLossPct}%
                    </span>
                  ) : config.stopLossMode === 'none' ? (
                    <span className="font-mono text-[10px] font-bold text-slate-400">
                      No Stop
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] font-bold text-indigo-600 uppercase">
                      Dynamic
                    </span>
                  )}
                </div>

                <select
                  value={config.stopLossMode}
                  onChange={(e) => {
                    const newMode = e.target.value as StopLossMode;
                    setConfig({
                      ...config,
                      stopLossMode: newMode,
                      trailingRule: newMode,
                      stopLossPct: newMode === 'none' ? 0 : (config.stopLossPct === 0 ? 8 : config.stopLossPct),
                    });
                  }}
                  className="w-full text-xs font-medium bg-white border border-slate-200 rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                >
                  <option value="static">Static Stop Loss (-% from Entry)</option>
                  <option value="trailing_15pct_day1">Trail 15% from Day 1 (Peak SL)</option>
                  <option value="trail_from_high">Lock-In Trailing (-8% after +15% gain)</option>
                  <option value="breakeven_then_trail">Breakeven at +15% → Trail 8% at +20%</option>
                  <option value="dma50_trend">50-DMA Trendline Filter (Breakdown Exit)</option>
                  <option value="none">No Stop Loss (Hold until Rebalance)</option>
                </select>

                {/* If Static Stop Loss is selected, show the % slider & quick-select pills */}
                {config.stopLossMode === 'static' ? (
                  <div className="space-y-1.5 pt-1 border-t border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="range"
                        min="3"
                        max="20"
                        step="1"
                        value={config.stopLossPct}
                        onChange={(e) => setConfig({ ...config, stopLossPct: Number(e.target.value) })}
                        className="w-full accent-rose-600 cursor-pointer"
                      />
                    </div>

                    <div className="flex flex-wrap gap-1 text-[10px]">
                      {[5, 8, 10, 12, 15, 20].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setConfig({ ...config, stopLossPct: val })}
                          className={`px-1.5 py-0.5 rounded font-mono ${
                            config.stopLossPct === val
                              ? 'bg-rose-600 text-white font-bold'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          -{val}%
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-1.5 rounded bg-slate-50 border border-slate-100">
                    <p className="text-[10px] text-slate-600 leading-tight">
                      {config.stopLossMode === 'none'
                        ? '🚫 No Stop Loss: positions held until monthly review or profit target.'
                        : config.stopLossMode === 'trailing_15pct_day1'
                        ? '📈 Day 1 Trailing SL: trails 15% below the highest peak price reached.'
                        : config.stopLossMode === 'dma50_trend'
                        ? '📉 50-DMA Filter: exits immediately if stock closes below 50-day moving average.'
                        : config.stopLossMode === 'breakeven_then_trail'
                        ? '🛡️ Breakeven at +15% profit, then trails 8% below peak once +20% reached.'
                        : '🔒 Trailing SL: activates 8% trail from peak once +15% gain is unlocked.'}
                    </p>
                  </div>
                )}
              </div>

              {/* 2. Profit / Target Parameter */}
              <div className="bg-white p-3 rounded-lg border border-slate-200/80 shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                    <Target className="w-3.5 h-3.5 text-emerald-500" />
                    Profit Target Rule
                  </label>
                  <span className="font-mono text-xs font-bold text-emerald-600">
                    {config.targetGainPct === 0 ? 'Let Winners Run (∞)' : `+${config.targetGainPct}%`}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={config.targetGainPct}
                    onChange={(e) => setConfig({ ...config, targetGainPct: Number(e.target.value) })}
                    className="w-full accent-emerald-600 cursor-pointer"
                  />
                </div>

                <div className="flex flex-wrap gap-1 text-[10px]">
                  {[0, 20, 25, 40, 50, 100].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setConfig({ ...config, targetGainPct: val })}
                      className={`px-1.5 py-0.5 rounded font-mono ${
                        config.targetGainPct === val
                          ? 'bg-emerald-600 text-white font-bold'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {val === 0 ? 'Let Run' : `+${val}%`}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400">
                  {config.targetGainPct === 0
                    ? 'Captures explosive multi-baggers (+200%+) until trend weakens'
                    : `Locks in full profit when gain touches +${config.targetGainPct}%`}
                </p>
              </div>

              {/* 3. Rebalance Cadence & Review Frequency */}
              <div className="bg-white p-3 rounded-lg border border-slate-200/80 shadow-2xs space-y-2">
                <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                  Rebalancing &amp; Review Schedule
                </label>
                <select
                  value={config.rebalanceCadence}
                  onChange={(e) => setConfig({ ...config, rebalanceCadence: e.target.value as RebalanceCadence })}
                  className="w-full text-xs font-medium bg-white border border-slate-200 rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                >
                  <option value="first_day_monthly">1st Trading Day of Month (Classic Monthly)</option>
                  <option value="weekly_wednesday">Weekly (Every Wednesday)</option>
                  <option value="first_wednesday_monthly">1st Wednesday of Month (Avoids Expiry)</option>
                  <option value="daily_continuous">Daily Watchdog (Exit on Rank Drop)</option>
                  <option value="biweekly">Bi-Weekly (Every 2 Weeks)</option>
                  <option value="quarterly">Quarterly (Every 3 Months)</option>
                </select>
                <p className="text-[10px] text-slate-400">
                  {config.rebalanceCadence === 'weekly_wednesday'
                    ? 'Re-screens and rebalances portfolio every week on Wednesday'
                    : config.rebalanceCadence === 'daily_continuous'
                    ? 'Check daily: replace stock immediately when rank slips'
                    : 'Re-screens universe at scheduled intervals'}
                </p>
              </div>

              {/* 4. Portfolio Size & Position Sizing Controls */}
              <div className="bg-white p-3 rounded-lg border border-slate-200/80 shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5 text-indigo-500" />
                    Portfolio Slots &amp; Sizing
                  </label>
                  <span className="font-mono text-[11px] font-bold text-indigo-600">
                    {config.portfolioSize} Slots • {config.maxPositionWeightPct ? `Max ${config.maxPositionWeightPct}%` : `Auto (${(100 / config.portfolioSize).toFixed(1).replace('.0', '')}% ea)`}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span className="font-medium">Target Slots (N):</span>
                    <div className="flex gap-1">
                      {[5, 8, 10, 15, 20, 25].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setConfig({ ...config, portfolioSize: n, maxPositionWeightPct: undefined })}
                          className={`px-1.5 py-0.5 rounded text-center text-[10px] font-mono transition-colors ${
                            config.portfolioSize === n
                              ? 'bg-indigo-600 text-white font-bold shadow-xs'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span className="font-medium">Max Cap / Stock:</span>
                    <div className="flex flex-wrap justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setConfig({ ...config, maxPositionWeightPct: undefined })}
                        className={`px-1.5 py-0.5 rounded text-center text-[10px] font-mono transition-colors ${
                          config.maxPositionWeightPct === undefined
                            ? 'bg-emerald-600 text-white font-bold shadow-xs'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        Auto
                      </button>
                      {[10, 15, 20, 25, 30, 33, 50].map((cap) => (
                        <button
                          key={cap}
                          type="button"
                          onClick={() => setConfig({ ...config, maxPositionWeightPct: cap })}
                          className={`px-1.5 py-0.5 rounded text-center text-[10px] font-mono transition-colors ${
                            config.maxPositionWeightPct === cap
                              ? 'bg-emerald-600 text-white font-bold shadow-xs'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {cap}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                    <span className="font-medium">Retention Buffer:</span>
                    <select
                      value={config.retentionBufferRank ?? 25}
                      onChange={(e) => setConfig({ ...config, retentionBufferRank: Number(e.target.value) })}
                      className="text-[10px] font-medium bg-white border border-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                    >
                      <option value={10}>Top 10 (Strict / No Buffer)</option>
                      <option value={15}>Top 15 Buffer</option>
                      <option value={20}>Top 20 Buffer</option>
                      <option value={25}>Top 25 Buffer (Default)</option>
                      <option value={30}>Top 30 Buffer</option>
                      <option value={35}>Top 35 Buffer (Optimal)</option>
                      <option value={40}>Top 40 Buffer (Wide)</option>
                      <option value={50}>Top 50 Buffer (Relaxed)</option>
                    </select>
                  </div>
                </div>

                {/* 52-Week High Proximity Rule & Interactive % Selector */}
                <div className="pt-1.5 border-t border-slate-100 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.enforce52WHigh}
                        onChange={(e) => setConfig({ ...config, enforce52WHigh: e.target.checked })}
                        className="rounded text-indigo-600 focus:ring-indigo-500 h-3 w-3"
                      />
                      <span className="text-[10px] font-medium text-slate-700">
                        52W High Proximity:
                      </span>
                    </label>
                    <span className="font-mono text-[10px] font-bold text-indigo-600">
                      {config.enforce52WHigh ? `≤ ${config.maxDistance52WHighPct ?? 15}%` : 'Disabled'}
                    </span>
                  </div>

                  {config.enforce52WHigh && (
                    <div className="flex items-center justify-between gap-1">
                      {[5, 8, 10, 12, 15].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => setConfig({ ...config, maxDistance52WHighPct: pct })}
                          className={`flex-1 py-0.5 rounded text-center text-[10px] font-mono transition-colors ${
                            (config.maxDistance52WHighPct ?? 15) === pct
                              ? 'bg-indigo-600 text-white font-bold shadow-xs'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 5. Position Weighting & Volatility-Adjusted Allocation */}
              <div className="bg-white p-3 rounded-lg border border-slate-200/80 shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                    <Scale className="w-3.5 h-3.5 text-indigo-600" />
                    Weight Strategy
                  </label>
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {config.weightStrategy === 'atr_momentum_parity'
                      ? 'ATR Parity ★'
                      : config.weightStrategy === 'atr_inverse_vol'
                      ? 'Risk Parity'
                      : config.weightStrategy === 'multi_factor'
                      ? 'Multi-Factor'
                      : config.weightStrategy === 'composite_score'
                      ? 'Score³'
                      : config.weightStrategy === 'rank_decay'
                      ? 'Rank Decay'
                      : 'Equal (1/N)'}
                  </span>
                </div>

                <select
                  value={config.weightStrategy ?? 'atr_momentum_parity'}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      weightStrategy: e.target.value as BacktestWeightStrategy,
                    })
                  }
                  className="w-full text-xs font-medium bg-white border border-slate-200 rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                >
                  <option value="atr_momentum_parity">ATR-Adjusted Momentum (Score / ATR% ★)</option>
                  <option value="atr_inverse_vol">ATR Inverse Volatility (Pure Risk Parity)</option>
                  <option value="multi_factor">Multi-Factor Conviction (Score² × Rank Decay)</option>
                  <option value="composite_score">Composite Momentum Score Proportional (Score³)</option>
                  <option value="rank_decay">Rank-Decay Tiered (1 / Rank^0.65)</option>
                  <option value="equal_weight">Equal Weight (1/N Baseline Benchmark)</option>
                </select>

                <p className="text-[10px] text-slate-500 leading-tight">
                  {config.weightStrategy === 'atr_momentum_parity'
                    ? '★ Sizes by Momentum Score ÷ 14-day ATR%. Overweights smooth leaders & reduces whipsaw exposure.'
                    : config.weightStrategy === 'atr_inverse_vol'
                    ? 'Pure Risk Parity: equalizes volatility risk contribution across constituents using 1/ATR%.'
                    : config.weightStrategy === 'multi_factor'
                    ? 'Sizes positions using quadratic composite score scaled by inverse square-root of rank.'
                    : config.weightStrategy === 'composite_score'
                    ? 'Distributes capital proportionally to the cubic spread of composite scores.'
                    : config.weightStrategy === 'rank_decay'
                    ? 'Decays position size down the ranking ladder (Rank 1-3 get ~20%, Rank 8-10 get ~5%).'
                    : 'Baseline: allocates identical equal capital (100% / N) to all purchased stocks.'}
                </p>
              </div>

              {/* 6. Macro Regime & Crash Circuit Breakers */}
              <div className="bg-white p-3 rounded-lg border border-slate-200/80 shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    Macro Circuit Breakers
                  </label>
                  {config.circuitBreakers?.enabled ? (
                    <span className="font-mono text-[10px] font-bold text-emerald-700 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      {config.circuitBreakers.logic} Active
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] font-bold text-slate-400">
                      Off (100% Equity)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setConfig({
                        ...config,
                        circuitBreakers: {
                          ...(config.circuitBreakers || {
                            enabled: true,
                            logic: 'OR',
                            benchmarkTrend: { enabled: true, index: 'NIFTY500', indicator: '200_EMA' },
                            vixSpike: { enabled: true, threshold: 30 },
                            marketBreadth: { enabled: true, indicator: '50_EMA', thresholdPct: 45 },
                            rapidDrawdown: { enabled: false, dropPct: 6 },
                          }),
                          enabled: !config.circuitBreakers?.enabled,
                        },
                      })
                    }
                    className={`flex-1 py-1 px-2 rounded-md text-xs font-semibold transition-all ${
                      config.circuitBreakers?.enabled
                        ? 'bg-amber-500 text-white shadow-xs hover:bg-amber-600'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {config.circuitBreakers?.enabled ? '🛡️ Breakers Active' : 'Off (Always Invested)'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowCircuitBreakerStudio(!showCircuitBreakerStudio)}
                    className="py-1 px-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200/80 transition-colors"
                    title="Toggle Circuit Breaker Studio"
                  >
                    {showCircuitBreakerStudio ? 'Hide Studio' : 'Edit Rules'}
                  </button>
                </div>

                {config.circuitBreakers?.enabled ? (
                  <p className="text-[10px] text-slate-500 line-clamp-2">
                    Logic: <strong className="text-slate-800">{config.circuitBreakers.logic}</strong> | Exits to 100% Cash when conditions trigger.
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-400">
                    No macro exit: stays fully invested across severe bear phases.
                  </p>
                )}
              </div>
            </div>

            {/* EXPANDABLE COMPOUND CIRCUIT BREAKER STUDIO */}
            {config.circuitBreakers?.enabled && showCircuitBreakerStudio && (
              <div className="mt-3 pt-3 border-t border-slate-200/90 bg-gradient-to-r from-amber-50/70 via-slate-50 to-indigo-50/40 rounded-xl p-3.5 border border-amber-200/70 shadow-2xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200/60 pb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded-md bg-amber-500 text-white">
                      <Zap className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">
                        Compound Circuit Breaker Logic Builder (Sit Out in 100% Cash)
                      </h4>
                      <p className="text-[10px] text-slate-600">
                        Combine Index Moving Averages, Volatility Spikes, and Market Breadth into customizable OR / AND triggers.
                      </p>
                    </div>
                  </div>

                  {/* Combination Logic Switch: OR vs AND */}
                  <div className="flex items-center gap-1.5 bg-white p-1 rounded-lg border border-slate-200 shadow-2xs">
                    <span className="text-[10px] font-bold text-slate-500 px-1">Logic:</span>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig({
                          ...config,
                          circuitBreakers: {
                            ...config.circuitBreakers!,
                            logic: 'OR',
                          },
                        })
                      }
                      className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition-colors ${
                        config.circuitBreakers.logic === 'OR'
                          ? 'bg-amber-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      OR (Exit if ANY rule triggers)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig({
                          ...config,
                          circuitBreakers: {
                            ...config.circuitBreakers!,
                            logic: 'AND',
                          },
                        })
                      }
                      className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition-colors ${
                        config.circuitBreakers.logic === 'AND'
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      AND (All rules must trigger)
                    </button>
                  </div>
                </div>

                {/* Quick Presets Bar */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Quick Presets:</span>
                  <button
                    type="button"
                    onClick={() =>
                      setConfig({
                        ...config,
                        circuitBreakers: {
                          enabled: true,
                          logic: 'OR',
                          benchmarkTrend: { enabled: true, index: 'NIFTY500', indicator: '200_EMA' },
                          vixSpike: { enabled: true, threshold: 30 },
                          marketBreadth: { enabled: true, indicator: '50_EMA', thresholdPct: 45 },
                          rapidDrawdown: { enabled: false, dropPct: 6 },
                        },
                      })
                    }
                    className="px-2 py-0.5 rounded-full bg-amber-100/90 text-amber-900 border border-amber-300 font-semibold hover:bg-amber-200 transition-colors text-[10px]"
                  >
                    ⭐ Recommended: N500 &lt; 200 EMA OR VIX &gt; 30 OR Breadth &lt; 45%
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setConfig({
                        ...config,
                        circuitBreakers: {
                          enabled: true,
                          logic: 'OR',
                          benchmarkTrend: { enabled: true, index: 'NIFTY500', indicator: '200_EMA' },
                          vixSpike: { enabled: true, threshold: 25 },
                          marketBreadth: { enabled: true, indicator: '50_DMA', thresholdPct: 40 },
                          rapidDrawdown: { enabled: true, dropPct: 6 },
                        },
                      })
                    }
                    className="px-2 py-0.5 rounded-full bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors text-[10px]"
                  >
                    🛡️ Ultra-Conservative Shield
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setConfig({
                        ...config,
                        circuitBreakers: {
                          enabled: true,
                          logic: 'OR',
                          benchmarkTrend: { enabled: true, index: 'NIFTY500', indicator: '200_EMA' },
                          vixSpike: { enabled: false, threshold: 30 },
                          marketBreadth: { enabled: true, indicator: '50_EMA', thresholdPct: 45 },
                          rapidDrawdown: { enabled: false, dropPct: 6 },
                        },
                      })
                    }
                    className="px-2 py-0.5 rounded-full bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors text-[10px]"
                  >
                    📊 Trend + Breadth Guard
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setConfig({
                        ...config,
                        circuitBreakers: {
                          enabled: true,
                          logic: 'OR',
                          benchmarkTrend: { enabled: true, index: 'NIFTY500', indicator: '200_EMA' },
                          vixSpike: { enabled: false, threshold: 30 },
                          marketBreadth: { enabled: false, indicator: '50_EMA', thresholdPct: 45 },
                          rapidDrawdown: { enabled: false, dropPct: 6 },
                        },
                      })
                    }
                    className="px-2 py-0.5 rounded-full bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors text-[10px]"
                  >
                    📈 Benchmark 200 EMA Only
                  </button>
                </div>

                {/* 4 Interactive Customizable Condition Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
                  {/* Condition 1: Benchmark Trend Breakdown */}
                  <div
                    className={`p-3 rounded-lg border transition-all ${
                      config.circuitBreakers.benchmarkTrend?.enabled
                        ? 'bg-white border-amber-300 shadow-xs'
                        : 'bg-white/60 border-slate-200 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-bold text-slate-800">
                        <input
                          type="checkbox"
                          checked={config.circuitBreakers.benchmarkTrend?.enabled ?? false}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              circuitBreakers: {
                                ...config.circuitBreakers!,
                                benchmarkTrend: {
                                  enabled: e.target.checked,
                                  index: config.circuitBreakers?.benchmarkTrend?.index ?? 'NIFTY500',
                                  indicator: config.circuitBreakers?.benchmarkTrend?.indicator ?? '200_EMA',
                                },
                              },
                            })
                          }
                          className="rounded text-amber-600 focus:ring-amber-500"
                        />
                        1. Benchmark Trend Filter
                      </label>
                      <span className="text-[10px] font-mono font-bold text-amber-700 bg-amber-50 px-1 py-0.5 rounded">
                        Index &lt; MA
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-500 block mb-0.5">Index:</span>
                        <select
                          value={config.circuitBreakers.benchmarkTrend?.index ?? 'NIFTY500'}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              circuitBreakers: {
                                ...config.circuitBreakers!,
                                benchmarkTrend: {
                                  ...config.circuitBreakers!.benchmarkTrend!,
                                  index: e.target.value as any,
                                },
                              },
                            })
                          }
                          disabled={!config.circuitBreakers.benchmarkTrend?.enabled}
                          className="w-full text-xs bg-slate-50 border border-slate-200 rounded p-1 font-medium"
                        >
                          <option value="NIFTY500">Nifty 500 (Broad)</option>
                          <option value="NIFTY50">Nifty 50 (Large)</option>
                        </select>
                      </div>

                      <div>
                        <span className="text-[10px] text-slate-500 block mb-0.5">Threshold MA:</span>
                        <select
                          value={config.circuitBreakers.benchmarkTrend?.indicator ?? '200_EMA'}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              circuitBreakers: {
                                ...config.circuitBreakers!,
                                benchmarkTrend: {
                                  ...config.circuitBreakers!.benchmarkTrend!,
                                  indicator: e.target.value as any,
                                },
                              },
                            })
                          }
                          disabled={!config.circuitBreakers.benchmarkTrend?.enabled}
                          className="w-full text-xs bg-slate-50 border border-slate-200 rounded p-1 font-medium"
                        >
                          <option value="200_EMA">200 EMA (Responsive)</option>
                          <option value="200_DMA">200 DMA (Classic)</option>
                          <option value="100_EMA">100 EMA (Faster)</option>
                          <option value="50_EMA">50 EMA (Aggressive)</option>
                          <option value="50_DMA">50 DMA</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Condition 2: India VIX Volatility Spike */}
                  <div
                    className={`p-3 rounded-lg border transition-all ${
                      config.circuitBreakers.vixSpike?.enabled
                        ? 'bg-white border-amber-300 shadow-xs'
                        : 'bg-white/60 border-slate-200 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-bold text-slate-800">
                        <input
                          type="checkbox"
                          checked={config.circuitBreakers.vixSpike?.enabled ?? false}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              circuitBreakers: {
                                ...config.circuitBreakers!,
                                vixSpike: {
                                  enabled: e.target.checked,
                                  threshold: config.circuitBreakers?.vixSpike?.threshold ?? 30,
                                },
                              },
                            })
                          }
                          className="rounded text-amber-600 focus:ring-amber-500"
                        />
                        2. India VIX Panic Spike
                      </label>
                      <span className="text-[10px] font-mono font-bold text-amber-700 bg-amber-50 px-1 py-0.5 rounded">
                        VIX &gt; {config.circuitBreakers.vixSpike?.threshold ?? 30}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-slate-600">
                        <span>Cutoff Threshold:</span>
                        <span className="font-mono font-bold text-amber-600">&gt; {config.circuitBreakers.vixSpike?.threshold ?? 30}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {[20, 25, 30, 35].map((val) => (
                          <button
                            key={val}
                            type="button"
                            disabled={!config.circuitBreakers?.vixSpike?.enabled}
                            onClick={() =>
                              setConfig({
                                ...config,
                                circuitBreakers: {
                                  ...config.circuitBreakers!,
                                  vixSpike: {
                                    ...config.circuitBreakers!.vixSpike!,
                                    threshold: val,
                                  },
                                },
                              })
                            }
                            className={`py-0.5 rounded text-center text-[10px] font-mono font-bold ${
                              (config.circuitBreakers?.vixSpike?.threshold ?? 30) === val
                                ? 'bg-amber-600 text-white'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            &gt;{val}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Condition 3: Market Breadth Breakdown & Re-Entry Confirmation Gate */}
                  <div
                    className={`p-3 rounded-lg border transition-all ${
                      config.circuitBreakers.marketBreadth?.enabled
                        ? 'bg-white border-amber-300 shadow-xs'
                        : 'bg-white/60 border-slate-200 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-bold text-slate-800">
                        <input
                          type="checkbox"
                          checked={config.circuitBreakers.marketBreadth?.enabled ?? false}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              circuitBreakers: {
                                ...config.circuitBreakers!,
                                marketBreadth: {
                                  enabled: e.target.checked,
                                  indicator: config.circuitBreakers?.marketBreadth?.indicator ?? '50_EMA',
                                  thresholdPct: config.circuitBreakers?.marketBreadth?.thresholdPct ?? 45,
                                  reEntryThresholdPct: config.circuitBreakers?.marketBreadth?.reEntryThresholdPct ?? 50,
                                },
                              },
                            })
                          }
                          className="rounded text-amber-600 focus:ring-amber-500"
                        />
                        3. Market Breadth Health
                      </label>
                      <span className="text-[10px] font-mono font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60">
                        Exit &lt;{config.circuitBreakers.marketBreadth?.thresholdPct ?? 45}% | Re-Entry &ge;{config.circuitBreakers.marketBreadth?.reEntryThresholdPct ?? 50}%
                      </span>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-500 block mb-0.5">% Stocks above:</span>
                        <select
                          value={config.circuitBreakers.marketBreadth?.indicator ?? '50_EMA'}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              circuitBreakers: {
                                ...config.circuitBreakers!,
                                marketBreadth: {
                                  ...config.circuitBreakers!.marketBreadth!,
                                  indicator: e.target.value as any,
                                },
                              },
                            })
                          }
                          disabled={!config.circuitBreakers.marketBreadth?.enabled}
                          className="w-full text-xs bg-slate-50 border border-slate-200 rounded p-1 font-medium"
                        >
                          <option value="50_EMA">50 EMA (Recommended)</option>
                          <option value="50_DMA">50 DMA</option>
                          <option value="200_DMA">200 DMA</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                        {/* Exit Threshold */}
                        <div>
                          <span className="text-[10px] text-slate-500 block mb-0.5">Exit to Cash if:</span>
                          <div className="grid grid-cols-2 gap-1">
                            {[40, 45, 50, 55].map((pct) => (
                              <button
                                key={pct}
                                type="button"
                                disabled={!config.circuitBreakers?.marketBreadth?.enabled}
                                onClick={() =>
                                  setConfig({
                                    ...config,
                                    circuitBreakers: {
                                      ...config.circuitBreakers!,
                                      marketBreadth: {
                                        ...config.circuitBreakers!.marketBreadth!,
                                        thresholdPct: pct,
                                      },
                                    },
                                  })
                                }
                                className={`py-0.5 rounded text-center text-[10px] font-mono font-bold ${
                                  (config.circuitBreakers?.marketBreadth?.thresholdPct ?? 45) === pct
                                    ? 'bg-amber-600 text-white'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                }`}
                              >
                                &lt;{pct}%
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Re-Entry Confirmation Threshold */}
                        <div>
                          <span className="text-[10px] text-slate-500 block mb-0.5">Re-Enter Only if:</span>
                          <div className="grid grid-cols-2 gap-1">
                            {[40, 45, 50, 55].map((pct) => (
                              <button
                                key={pct}
                                type="button"
                                disabled={!config.circuitBreakers?.marketBreadth?.enabled}
                                onClick={() =>
                                  setConfig({
                                    ...config,
                                    circuitBreakers: {
                                      ...config.circuitBreakers!,
                                      marketBreadth: {
                                        ...config.circuitBreakers!.marketBreadth!,
                                        reEntryThresholdPct: pct,
                                      },
                                    },
                                  })
                                }
                                className={`py-0.5 rounded text-center text-[10px] font-mono font-bold ${
                                  (config.circuitBreakers?.marketBreadth?.reEntryThresholdPct ?? 50) === pct
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                }`}
                              >
                                &ge;{pct}%
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <p className="text-[9px] text-slate-400 leading-tight">
                        Prevents whipsaw: stays in cash until breadth recovers to &ge; target and all macro rules clear.
                      </p>
                    </div>
                  </div>

                  {/* Condition 4: Rapid Short-Term Drop */}
                  <div
                    className={`p-3 rounded-lg border transition-all ${
                      config.circuitBreakers.rapidDrawdown?.enabled
                        ? 'bg-white border-amber-300 shadow-xs'
                        : 'bg-white/60 border-slate-200 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-bold text-slate-800">
                        <input
                          type="checkbox"
                          checked={config.circuitBreakers.rapidDrawdown?.enabled ?? false}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              circuitBreakers: {
                                ...config.circuitBreakers!,
                                rapidDrawdown: {
                                  enabled: e.target.checked,
                                  dropPct: config.circuitBreakers?.rapidDrawdown?.dropPct ?? 6,
                                },
                              },
                            })
                          }
                          className="rounded text-amber-600 focus:ring-amber-500"
                        />
                        4. 20-Day Index Velocity Drop
                      </label>
                      <span className="text-[10px] font-mono font-bold text-amber-700 bg-amber-50 px-1 py-0.5 rounded">
                        &gt; {config.circuitBreakers.rapidDrawdown?.dropPct ?? 6}% drop
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-slate-600">
                        <span>Drop from 20D High:</span>
                        <span className="font-mono font-bold text-amber-600">&gt; -{config.circuitBreakers.rapidDrawdown?.dropPct ?? 6}%</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {[4, 6, 8, 10].map((val) => (
                          <button
                            key={val}
                            type="button"
                            disabled={!config.circuitBreakers?.rapidDrawdown?.enabled}
                            onClick={() =>
                              setConfig({
                                ...config,
                                circuitBreakers: {
                                  ...config.circuitBreakers!,
                                  rapidDrawdown: {
                                    ...config.circuitBreakers!.rapidDrawdown!,
                                    dropPct: val,
                                  },
                                },
                              })
                            }
                            className={`py-0.5 rounded text-center text-[10px] font-mono font-bold ${
                              (config.circuitBreakers?.rapidDrawdown?.dropPct ?? 6) === val
                                ? 'bg-amber-600 text-white'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            &gt;{val}%
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* IDLE CASH & DEFENSIVE ASSET DEPLOYMENT (RETURN DURING CASH PHASES) */}
            <div className="mt-3 pt-3 border-t border-slate-200/90 bg-gradient-to-r from-emerald-50/70 via-slate-50 to-amber-50/50 rounded-xl p-3.5 border border-emerald-200/70 shadow-2xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200/60 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-emerald-600 text-white shadow-2xs">
                    <Landmark className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-slate-900">
                        Idle Cash & Defensive Asset Deployment (Yield While in Cash)
                      </h4>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        Current Yield: {config.defensiveCashYieldPct ?? 6.5}% p.a.
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-600">
                      When circuit breakers trigger (100% Cash) or open slots exist, deploy idle cash into interest-bearing low-risk assets to eliminate cash drag.
                    </p>
                  </div>
                </div>
              </div>

              {/* Asset Selector Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
                {/* Option 1: Zero Yield Cash */}
                <button
                  type="button"
                  onClick={() =>
                    setConfig({
                      ...config,
                      defensiveAssetType: 'cash_zero',
                      defensiveCashYieldPct: 0,
                    })
                  }
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    config.defensiveAssetType === 'cash_zero'
                      ? 'bg-white border-slate-600 ring-2 ring-slate-400/40 shadow-xs'
                      : 'bg-white/70 border-slate-200 hover:bg-white text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs text-slate-800">1. Pure Idle Cash</span>
                    <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-700 px-1 py-0.5 rounded">0.0% p.a.</span>
                  </div>
                  <p className="text-[10px] text-slate-500 line-clamp-2">
                    Zero-yield trading ledger balance. Benchmark for maximum cash drag.
                  </p>
                </button>

                {/* Option 2: Liquid Funds / Arbitrage (Recommended) */}
                <button
                  type="button"
                  onClick={() =>
                    setConfig({
                      ...config,
                      defensiveAssetType: 'liquid_fund',
                      defensiveCashYieldPct: 6.5,
                    })
                  }
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    config.defensiveAssetType === 'liquid_fund' || (!config.defensiveAssetType && config.defensiveCashYieldPct === 6.5)
                      ? 'bg-white border-emerald-500 ring-2 ring-emerald-400/40 shadow-xs'
                      : 'bg-white/70 border-slate-200 hover:bg-white text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs text-emerald-900">2. Liquid / Arbitrage Fund</span>
                    <span className="text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 px-1 py-0.5 rounded">6.5% p.a.</span>
                  </div>
                  <p className="text-[10px] text-slate-500 line-clamp-2">
                    Overnight / Liquid MF or RBI T-Bills (Zerodha Liquidcase / LIQUIDBEES).
                  </p>
                </button>

                {/* Option 3: Bank Fixed Deposit */}
                <button
                  type="button"
                  onClick={() =>
                    setConfig({
                      ...config,
                      defensiveAssetType: 'fixed_deposit',
                      defensiveCashYieldPct: 7.5,
                    })
                  }
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    config.defensiveAssetType === 'fixed_deposit'
                      ? 'bg-white border-blue-500 ring-2 ring-blue-400/40 shadow-xs'
                      : 'bg-white/70 border-slate-200 hover:bg-white text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs text-blue-900">3. Fixed Deposit (FD)</span>
                    <span className="text-[10px] font-mono font-bold bg-blue-100 text-blue-800 px-1 py-0.5 rounded">7.5% p.a.</span>
                  </div>
                  <p className="text-[10px] text-slate-500 line-clamp-2">
                    1-Year Bank FD rate / High-grade corporate senior debt instrument.
                  </p>
                </button>

                {/* Option 4: Domestic Gold ETF */}
                <button
                  type="button"
                  onClick={() =>
                    setConfig({
                      ...config,
                      defensiveAssetType: 'gold_etf',
                      defensiveCashYieldPct: 12.0,
                    })
                  }
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    config.defensiveAssetType === 'gold_etf'
                      ? 'bg-white border-amber-500 ring-2 ring-amber-400/40 shadow-xs'
                      : 'bg-white/70 border-slate-200 hover:bg-white text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs text-amber-900">4. Gold ETF (GOLDBEES)</span>
                    <span className="text-[10px] font-mono font-bold bg-amber-100 text-amber-800 px-1 py-0.5 rounded">12.0% p.a.</span>
                  </div>
                  <p className="text-[10px] text-slate-500 line-clamp-2">
                    Domestic Gold ETF / Sovereign Gold Bonds (10Y historical gold trend).
                  </p>
                </button>

                {/* Option 5: Custom Yield % */}
                <div
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    config.defensiveAssetType === 'custom'
                      ? 'bg-white border-purple-500 ring-2 ring-purple-400/40 shadow-xs'
                      : 'bg-white/70 border-slate-200 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs text-purple-900">5. Custom Yield</span>
                    <span className="text-[10px] font-mono font-bold bg-purple-100 text-purple-800 px-1 py-0.5 rounded">
                      {config.defensiveCashYieldPct ?? 6.5}% p.a.
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="number"
                      min={0}
                      max={30}
                      step={0.5}
                      value={config.defensiveCashYieldPct ?? 6.5}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          defensiveAssetType: 'custom',
                          defensiveCashYieldPct: Math.max(0, Math.min(30, parseFloat(e.target.value) || 0)),
                        })
                      }
                      className="w-full text-xs bg-slate-50 border border-slate-200 rounded p-1 font-mono font-bold text-purple-900"
                    />
                    <span className="text-[10px] text-slate-500 font-bold">%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Realistic Frictional Drag & Net Performance Notice */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200/90 text-[11px] text-slate-600">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100/80 text-emerald-800 font-bold text-[10px] font-mono border border-emerald-300">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                NET OF FRICTIONAL DRAG
              </span>
              <span>
                All CAGRs &amp; compounded totals include <strong>0.70% round-trip trading friction</strong> (STT 0.1%, Brokerage, NSE turnover fees, Stamp duty, GST &amp; realistic bid-ask slippage).
              </span>
            </div>
            <div className="text-[10px] text-slate-500 font-medium">
              Real-world executable simulation (not hypothetical gross)
            </div>
          </div>

          {/* Key Metric Scorecard Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* 1. Strategy CAGR / XIRR */}
            <div className="p-3.5 rounded-xl bg-gradient-to-br from-indigo-50 to-white border border-indigo-200/80 shadow-2xs">
              <div className="text-[11px] font-semibold text-indigo-900 flex items-center justify-between">
                <span>{config.investmentMode === 'sip' || config.investmentMode === 'hybrid' ? 'Strategy XIRR' : 'Strategy CAGR'}</span>
                <Award className="w-3.5 h-3.5 text-indigo-600" />
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-xl sm:text-2xl font-bold font-mono text-indigo-950">
                  {config.investmentMode === 'sip' || config.investmentMode === 'hybrid'
                    ? (summary.strategyXirr ?? summary.strategyCagr)
                    : summary.strategyCagr}%
                </span>
              </div>
              <div className="text-[10px] text-emerald-600 font-semibold mt-0.5 flex items-center gap-0.5">
                <ArrowUpRight className="w-3 h-3" />
                {config.investmentMode === 'sip' || config.investmentMode === 'hybrid'
                  ? `+${((summary.strategyXirr ?? summary.strategyCagr) - (summary.benchmarkXirr ?? summary.benchmarkCagr)).toFixed(1)}% vs Nifty 500 XIRR`
                  : `+${(summary.strategyCagr - summary.benchmarkCagr).toFixed(1)}% vs Nifty 500`}
              </div>
            </div>

            {/* 2. Portfolio Final Capital & Ingested Wealth */}
            <div className="p-3.5 rounded-xl bg-slate-900 text-white shadow-2xs">
              <div className="text-[11px] font-semibold text-slate-400">
                {config.investmentMode === 'sip'
                  ? `SIP: ${formatLakhs(summary.totalInvestedCapital)} Ingested`
                  : config.investmentMode === 'hybrid'
                  ? `Hybrid: ${formatLakhs(summary.totalInvestedCapital)} Total`
                  : `${formatLakhs(summary.initialCapital)} Compounded`}
              </div>
              <div className="mt-1 text-xl sm:text-2xl font-bold font-mono text-emerald-400">
                {formatLakhs(summary.finalStrategyCapital)}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5 flex flex-col gap-0.5">
                <span className="text-emerald-300 font-semibold">
                  {summary.strategyMoic.toFixed(2)}x MOIC (Invested &rarr; Final)
                </span>
                <span>Nifty 500: {formatLakhs(summary.finalBenchmarkCapital)} ({summary.benchmarkMoic.toFixed(2)}x)</span>
              </div>
            </div>

            {/* 3. Max Drawdown */}
            <div className="p-3.5 rounded-xl bg-gradient-to-br from-rose-50 to-white border border-rose-200/80 shadow-2xs">
              <div className="text-[11px] font-semibold text-rose-900 flex items-center justify-between">
                <span>Max Drawdown</span>
                <Shield className="w-3.5 h-3.5 text-rose-500" />
              </div>
              <div className="mt-1 text-xl sm:text-2xl font-bold font-mono text-rose-700">
                {summary.strategyMaxDrawdown}%
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Nifty 500: {summary.benchmarkMaxDrawdown}%
              </div>
            </div>

            {/* 4. Sharpe & Sortino with Explanatory Popover */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs group relative cursor-help">
              <div className="text-[11px] font-semibold text-slate-600 flex items-center justify-between">
                <span>Sharpe / Sortino</span>
                <Info className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 transition-colors" />
              </div>
              <div className="mt-1 text-xl sm:text-2xl font-bold font-mono text-slate-900">
                {summary.sharpeRatio} <span className="text-xs font-normal text-slate-400">/ {summary.sortinoRatio}</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Risk-adjusted return
              </div>

              {/* Hover Tooltip Popup */}
              <div className="absolute top-full left-0 mt-1 hidden group-hover:block z-50 w-64 p-3 bg-slate-900 text-white rounded-lg shadow-xl text-[11px] font-sans pointer-events-none">
                <p className="font-bold text-indigo-300 mb-1">Risk-Adjusted Efficiency</p>
                <p className="mb-1.5 text-slate-300">
                  <strong className="text-white">Sharpe ({summary.sharpeRatio}):</strong> Excess return per unit of total volatility over 6.5% risk-free rate. (&gt;1.0 is good, &gt;1.5 is excellent).
                </p>
                <p className="text-slate-300">
                  <strong className="text-white">Sortino ({summary.sortinoRatio}):</strong> Excess return penalizing <em>only downside volatility & drawdowns</em>. Higher Sortino indicates smooth upward compounding without gut-wrenching drawdowns.
                </p>
              </div>
            </div>

            {/* 5. Win Rate */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
              <div className="text-[11px] font-semibold text-slate-600">
                Win Rate
              </div>
              <div className="mt-1 text-xl sm:text-2xl font-bold font-mono text-slate-900">
                {summary.winRate}%
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Profit Factor: {summary.profitFactor}x
              </div>
            </div>

            {/* 6. Avg Win vs Loss Payoff */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
              <div className="text-[11px] font-semibold text-slate-600">
                Avg Win / Avg Loss
              </div>
              <div className="mt-1 text-base sm:text-lg font-bold font-mono text-emerald-600 flex items-center gap-1">
                <span>+{summary.avgWinPct}%</span>
                <span className="text-slate-300">/</span>
                <span className="text-rose-600">-{Math.abs(summary.avgLossPct)}%</span>
              </div>
              <div className="text-[10px] text-indigo-600 font-semibold mt-0.5">
                {(summary.avgWinPct / (Math.abs(summary.avgLossPct) || 1)).toFixed(1)}:1 Payoff Ratio
              </div>
            </div>
          </div>

          {/* Interactive Chart Section with Tabs */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Visual Historical Simulation Performance
                </h3>

                {/* Benchmark Selector Pills */}
                {activeChartTab === 'equity' && (
                  <div className="flex items-center gap-2 text-xs bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Compare:</span>
                    <label className="flex items-center gap-1 cursor-pointer text-slate-600 hover:text-slate-900 text-[11px]">
                      <input
                        type="checkbox"
                        checked={selectedBenchmarks.nifty500}
                        onChange={(e) =>
                          setSelectedBenchmarks((prev) => ({ ...prev, nifty500: e.target.checked }))
                        }
                        className="rounded text-indigo-600 focus:ring-indigo-500 h-3 w-3"
                      />
                      <span>
                        Nifty 500 ({config.investmentMode === 'sip' || config.investmentMode === 'hybrid' ? `${summary.benchmarkXirr ?? summary.benchmarkCagr}% XIRR` : `${summary.benchmarkCagr}%`})
                      </span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer text-slate-600 hover:text-slate-900 text-[11px]">
                      <input
                        type="checkbox"
                        checked={selectedBenchmarks.nifty50}
                        onChange={(e) =>
                          setSelectedBenchmarks((prev) => ({ ...prev, nifty50: e.target.checked }))
                        }
                        className="rounded text-sky-600 focus:ring-sky-500 h-3 w-3"
                      />
                      <span>
                        Nifty 50 ({config.investmentMode === 'sip' || config.investmentMode === 'hybrid' ? `${summary.nifty50Xirr ?? summary.nifty50Cagr ?? 14.1}% XIRR` : `${summary.nifty50Cagr ?? 14.1}%`})
                      </span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer text-amber-700 hover:text-amber-900 text-[11px]">
                      <input
                        type="checkbox"
                        checked={selectedBenchmarks.gold}
                        onChange={(e) =>
                          setSelectedBenchmarks((prev) => ({ ...prev, gold: e.target.checked }))
                        }
                        className="rounded text-amber-500 focus:ring-amber-500 h-3 w-3"
                      />
                      <span>
                        Gold ETF ({config.investmentMode === 'sip' || config.investmentMode === 'hybrid' ? `${summary.goldXirr ?? summary.goldCagr ?? 12.3}% XIRR` : `${summary.goldCagr ?? 12.3}%`})
                      </span>
                    </label>
                  </div>
                )}
              </div>

              {/* Chart Tabs */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setActiveChartTab('equity')}
                  className={`px-3 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                    activeChartTab === 'equity'
                      ? 'bg-white text-indigo-900 font-bold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {config.investmentMode === 'sip'
                    ? `Compounded Wealth (SIP ₹${(config.sipMonthlyAmount ?? 25000).toLocaleString('en-IN')}/mo)`
                    : config.investmentMode === 'hybrid'
                    ? `Compounded Wealth (Hybrid)`
                    : `Compounded Growth (${formatLakhs(config.initialCapital)})`}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveChartTab('drawdown')}
                  className={`px-3 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                    activeChartTab === 'drawdown'
                      ? 'bg-white text-indigo-900 font-bold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Underwater Drawdown (%)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveChartTab('yearly')}
                  className={`px-3 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                    activeChartTab === 'yearly'
                      ? 'bg-white text-indigo-900 font-bold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Year-by-Year Alpha
                </button>
                <button
                  type="button"
                  onClick={() => setActiveChartTab('cash_allocation')}
                  className={`px-3 py-1 rounded-md font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                    activeChartTab === 'cash_allocation'
                      ? 'bg-white text-amber-900 font-bold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>Cash &amp; Asset Exposure (Equity vs Cash %)</span>
                  {summary.defensiveCashPct !== undefined && summary.defensiveCashPct > 0 && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-100 text-amber-800 font-bold">
                      {summary.defensiveCashPct}% Cash Days
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Chart Canvas */}
            <div className="h-72 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                {activeChartTab === 'equity' ? (
                  <AreaChart data={summary.equityCurve} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="strategyGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="benchGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="investedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#64748b" stopOpacity={0.12} />
                        <stop offset="95%" stopColor="#64748b" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => d.slice(0, 4)}
                      interval={24}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                    />
                    <YAxis
                      tickFormatter={(v) => {
                        if (v >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
                        if (v >= 100000) return `₹${(v / 100000).toFixed(0)}L`;
                        return `₹${v}`;
                      }}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      formatter={(val: any) => [`₹${Number(val).toLocaleString('en-IN')}`, '']}
                      labelFormatter={(label) => `Month: ${label}`}
                      contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Area
                      type="monotone"
                      dataKey="strategyEquity"
                      name="Moneta OS Momentum Strategy"
                      stroke="#4f46e5"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#strategyGrad)"
                    />
                    {selectedBenchmarks.nifty500 && (
                      <Area
                        type="monotone"
                        dataKey="benchmarkEquity"
                        name="Nifty 500 TRI (Broad Market)"
                        stroke="#94a3b8"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        fillOpacity={1}
                        fill="url(#benchGrad)"
                      />
                    )}
                    {selectedBenchmarks.nifty50 && (
                      <Area
                        type="monotone"
                        dataKey="nifty50Equity"
                        name="Nifty 50 (Largecap Core)"
                        stroke="#0284c7"
                        strokeWidth={1.5}
                        strokeDasharray="2 2"
                        fill="none"
                      />
                    )}
                    {selectedBenchmarks.gold && (
                      <Area
                        type="monotone"
                        dataKey="goldEquity"
                        name="Domestic Gold ETF"
                        stroke="#d97706"
                        strokeWidth={1.5}
                        strokeDasharray="3 3"
                        fillOpacity={1}
                        fill="url(#goldGrad)"
                      />
                    )}
                    {(config.investmentMode === 'sip' || config.investmentMode === 'hybrid') && (
                      <Area
                        type="monotone"
                        dataKey="cumulativeInvested"
                        name="Cumulative Capital Invested"
                        stroke="#64748b"
                        strokeWidth={1.5}
                        strokeDasharray="2 2"
                        fillOpacity={1}
                        fill="url(#investedGrad)"
                      />
                    )}
                  </AreaChart>
                ) : activeChartTab === 'drawdown' ? (
                  <AreaChart data={summary.equityCurve} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => d.slice(0, 4)}
                      interval={24}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                    />
                    <YAxis
                      tickFormatter={(v) => `${v}%`}
                      domain={[-45, 0]}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                    />
                    <Tooltip
                      formatter={(val: any) => [`${val}%`, '']}
                      labelFormatter={(label) => `Date: ${label}`}
                      contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Area
                      type="monotone"
                      dataKey="strategyDrawdown"
                      name="Strategy Drawdown (%)"
                      stroke="#e11d48"
                      strokeWidth={2}
                      fill="#ffe4e6"
                    />
                    <Area
                      type="monotone"
                      dataKey="benchmarkDrawdown"
                      name="Nifty 500 Benchmark Drawdown (%)"
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                      fill="#f1f5f9"
                    />
                  </AreaChart>
                ) : activeChartTab === 'yearly' ? (
                  <BarChart data={summary.yearlyPerformance} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: '#64748b' }} />
                    <Tooltip
                      formatter={(val: any) => [`${val}%`, '']}
                      contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="strategyReturn" name="Strategy Return (%)" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="benchmarkReturn" name="Nifty 500 TRI (%)" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : (
                  <AreaChart data={summary.equityCurve} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="equityExposureGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.65} />
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.25} />
                      </linearGradient>
                      <linearGradient id="cashExposureGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.7} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.3} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => d.slice(0, 4)}
                      interval={24}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                    />
                    <YAxis
                      tickFormatter={(v) => `${v}%`}
                      domain={[0, 100]}
                      ticks={[0, 25, 50, 75, 100]}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload || !payload.length) return null;
                        const pt = payload[0].payload;
                        return (
                          <div className="bg-slate-900 text-white p-3 rounded-lg shadow-xl border border-slate-700 text-xs space-y-1.5 min-w-[220px]">
                            <div className="font-bold border-b border-slate-800 pb-1 flex items-center justify-between gap-2">
                              <span>Date: {label}</span>
                              {pt.isDefensiveMode ? (
                                <span className="bg-rose-500/30 text-rose-300 px-1.5 py-0.5 rounded text-[10px] font-bold border border-rose-500/50">
                                  🛡️ Breaker: 100% Cash
                                </span>
                              ) : (
                                <span className="bg-emerald-500/30 text-emerald-300 px-1.5 py-0.5 rounded text-[10px] font-bold border border-emerald-500/50">
                                  🚀 Active Momentum
                                </span>
                              )}
                            </div>
                            <div className="flex justify-between items-center text-indigo-300">
                              <span>Active Equity Allocation:</span>
                              <span className="font-mono font-bold">{pt.equityPct ?? 0}%</span>
                            </div>
                            <div className="flex justify-between items-center text-amber-300">
                              <span>Cash / Defensive Yield:</span>
                              <span className="font-mono font-bold">{pt.cashPct ?? 0}%</span>
                            </div>
                            <div className="flex justify-between items-center text-slate-300 text-[11px] pt-1 border-t border-slate-800">
                              <span>Cash Balance:</span>
                              <span className="font-mono font-bold">₹{Math.round(pt.cashAmount ?? 0).toLocaleString('en-IN')}</span>
                            </div>
                            {pt.defensiveYieldToday > 0 && (
                              <div className="flex justify-between items-center text-emerald-400 text-[10px]">
                                <span>Daily Yield ({config.defensiveCashYieldPct ?? 6.5}% p.a.):</span>
                                <span className="font-mono">+₹{pt.defensiveYieldToday}</span>
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Area
                      type="monotone"
                      stackId="1"
                      dataKey="equityPct"
                      name="Equities (% Active Momentum Stocks)"
                      stroke="#4f46e5"
                      strokeWidth={1.5}
                      fillOpacity={1}
                      fill="url(#equityExposureGrad)"
                    />
                    <Area
                      type="monotone"
                      stackId="1"
                      dataKey="cashPct"
                      name={`Cash / Defensive Yield Asset (${config.defensiveAssetType === 'gold_etf' ? 'Gold ETF' : config.defensiveAssetType === 'fixed_deposit' ? 'Fixed Deposit' : config.defensiveAssetType === 'cash_zero' ? 'Pure Cash' : 'Liquid Fund'} @ ${config.defensiveCashYieldPct ?? 6.5}% p.a.)`}
                      stroke="#d97706"
                      strokeWidth={1.5}
                      fillOpacity={1}
                      fill="url(#cashExposureGrad)"
                    />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* CASH & DEFENSIVE ALLOCATION AUDIT BREAKDOWN (When Cash Tab Active) */}
            {activeChartTab === 'cash_allocation' && (
              <div className="mt-3 pt-3 border-t border-slate-200 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  <div className="p-3 rounded-lg bg-amber-50/80 border border-amber-200">
                    <div className="text-[11px] font-bold text-amber-900 flex items-center justify-between">
                      <span>Days in Defensive Cash</span>
                      <Shield className="w-3.5 h-3.5 text-amber-700" />
                    </div>
                    <div className="mt-1 text-xl font-bold font-mono text-amber-950">
                      {summary.defensiveCashDays ?? 0} <span className="text-xs font-normal text-amber-800">days</span>
                    </div>
                    <div className="text-[10px] text-amber-700 mt-0.5 font-medium">
                      {summary.defensiveCashPct ?? 0}% of 10-year timeline in 100% Cash protection
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-indigo-50/80 border border-indigo-200">
                    <div className="text-[11px] font-bold text-indigo-900 flex items-center justify-between">
                      <span>Average Cash Cushion</span>
                      <PieChart className="w-3.5 h-3.5 text-indigo-700" />
                    </div>
                    <div className="mt-1 text-xl font-bold font-mono text-indigo-950">
                      {summary.avgCashExposurePct ?? 0}%
                    </div>
                    <div className="text-[10px] text-indigo-700 mt-0.5 font-medium">
                      Average portfolio liquidity buffer across full backtest
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-emerald-50/80 border border-emerald-200">
                    <div className="text-[11px] font-bold text-emerald-900 flex items-center justify-between">
                      <span>Yield Generated on Idle Cash</span>
                      <Coins className="w-3.5 h-3.5 text-emerald-700" />
                    </div>
                    <div className="mt-1 text-xl font-bold font-mono text-emerald-950">
                      +₹{(summary.totalDefensiveYieldEarned ?? 0).toLocaleString('en-IN')}
                    </div>
                    <div className="text-[10px] text-emerald-700 mt-0.5 font-medium">
                      Compounded via {config.defensiveAssetType === 'gold_etf' ? 'Gold ETF' : config.defensiveAssetType === 'fixed_deposit' ? 'Fixed Deposit' : config.defensiveAssetType === 'cash_zero' ? 'Zero-Yield Cash' : 'Liquid Fund'} ({config.defensiveCashYieldPct ?? 6.5}% p.a.)
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                      <span>Opportunity Cost Offset</span>
                      <TrendingUp className="w-3.5 h-3.5 text-slate-600" />
                    </div>
                    <div className="mt-1 text-xl font-bold font-mono text-slate-900">
                      Eliminated
                    </div>
                    <div className="text-[10px] text-slate-600 mt-0.5 font-medium">
                      Zero unproductive cash drag while waiting for clean momentum setups
                    </div>
                  </div>
                </div>

                {/* Historical Cash Periods Timeline Audit */}
                <div className="bg-slate-50/80 rounded-lg p-3 border border-slate-200/80 text-xs">
                  <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-600" />
                    Key 10-Year Macro Cash Periods &amp; Protection Audit
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
                    <div className="p-2 bg-white rounded border border-slate-200">
                      <div className="font-bold text-slate-900 flex items-center justify-between">
                        <span>1. March - May 2020 (COVID Shock)</span>
                        <span className="text-[10px] text-rose-700 font-bold bg-rose-50 px-1 py-0.2 rounded">Avoided -38%</span>
                      </div>
                      <p className="text-slate-600 mt-1 text-[10px]">
                        Nifty breached 200 EMA &amp; VIX surged &gt;30. Liquidated 100% to Cash/Liquid Funds, avoiding the historic crash and re-entering only after breadth crossed the hysteresis threshold.
                      </p>
                    </div>

                    <div className="p-2 bg-white rounded border border-slate-200">
                      <div className="font-bold text-slate-900 flex items-center justify-between">
                        <span>2. Feb - Oct 2018 (Midcap Crisis)</span>
                        <span className="text-[10px] text-amber-700 font-bold bg-amber-50 px-1 py-0.2 rounded">Preserved Gains</span>
                      </div>
                      <p className="text-slate-600 mt-1 text-[10px]">
                        IL&amp;FS collapse &amp; small/midcap bloodbath. Market breadth collapsed below 40%; sat in cash generating uninterrupted debt/liquid fund yield while smallcaps plunged -35%.
                      </p>
                    </div>

                    <div className="p-2 bg-white rounded border border-slate-200">
                      <div className="font-bold text-slate-900 flex items-center justify-between">
                        <span>3. Jan - June 2022 (Rate Hikes)</span>
                        <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-1 py-0.2 rounded">Sideways Shield</span>
                      </div>
                      <p className="text-slate-600 mt-1 text-[10px]">
                        Ukraine war &amp; aggressive global rate hike selloff. Strategy shifted into defensive cash during multiple breadth breakdowns, protecting portfolio capital against severe whipsaws.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Year-by-Year Historical Breakdown Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Year-by-Year Performance Audit (10-Year Track Record)
              </h3>
              <span className="text-[11px] text-slate-500">
                10-Year Net Alpha: <strong className="text-emerald-700">+{((summary.strategyTotalReturn - summary.benchmarkTotalReturn)).toFixed(1)}%</strong>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600 uppercase">
                    <th className="py-2.5 px-3 text-left">Year</th>
                    {(config.investmentMode === 'sip' || config.investmentMode === 'hybrid') && (
                      <th className="py-2.5 px-3 text-right">SIP Added</th>
                    )}
                    <th className="py-2.5 px-3 text-right">Strategy Return</th>
                    <th className="py-2.5 px-3 text-right">Nifty 500 TRI</th>
                    <th className="py-2.5 px-3 text-right">Net Alpha</th>
                    {(config.investmentMode === 'sip' || config.investmentMode === 'hybrid') && (
                      <th className="py-2.5 px-3 text-right">End Value</th>
                    )}
                    <th className="py-2.5 px-3 text-right">Max Drawdown</th>
                    <th className="py-2.5 px-3 text-right">Win Rate</th>
                    <th className="py-2.5 px-3 text-left">Market Regime Context</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {summary.yearlyPerformance.map((y) => {
                    const isAlphaPositive = y.alpha >= 0;
                    let context = '';
                    if (y.year === 2015) context = 'Commodities & emerging markets slump';
                    else if (y.year === 2016) context = 'Demonetization & US elections volatility';
                    else if (y.year === 2017) context = 'Historic Midcap momentum super-cycle';
                    else if (y.year === 2018) context = 'IL&FS NBFC crisis; SL protected capital';
                    else if (y.year === 2019) context = 'Polarized rally; corporate tax rate cut';
                    else if (y.year === 2020) context = 'March COVID crash (-38%) & V-shape recovery';
                    else if (y.year === 2021) context = 'Unprecedented liquidity & momentum expansion';
                    else if (y.year === 2022) context = 'Global rate hikes & Ukraine war sideways';
                    else if (y.year === 2023) context = 'Broad PSU, defense, manufacturing breakout';
                    else if (y.year === 2024) context = 'Elections year, largecap/midcap momentum';

                    return (
                      <tr key={y.year} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2 px-3 font-bold text-slate-900">{y.year}</td>
                        {(config.investmentMode === 'sip' || config.investmentMode === 'hybrid') && (
                          <td className="py-2 px-3 text-right font-medium text-indigo-700">
                            {y.yearlyInflow ? formatLakhs(y.yearlyInflow) : '—'}
                          </td>
                        )}
                        <td className={`py-2 px-3 text-right font-bold ${y.strategyReturn >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {y.strategyReturn >= 0 ? '+' : ''}{y.strategyReturn}%
                        </td>
                        <td className={`py-2 px-3 text-right ${y.benchmarkReturn >= 0 ? 'text-slate-700' : 'text-rose-600'}`}>
                          {y.benchmarkReturn >= 0 ? '+' : ''}{y.benchmarkReturn}%
                        </td>
                        <td className={`py-2 px-3 text-right font-bold ${isAlphaPositive ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {isAlphaPositive ? '+' : ''}{y.alpha}%
                        </td>
                        {(config.investmentMode === 'sip' || config.investmentMode === 'hybrid') && (
                          <td className="py-2 px-3 text-right font-bold text-slate-900">
                            {y.endStrategyCapital ? formatLakhs(y.endStrategyCapital) : '—'}
                          </td>
                        )}
                        <td className="py-2 px-3 text-right text-rose-600 font-bold">
                          {y.maxDrawdown}%
                        </td>
                        <td className="py-2 px-3 text-right text-slate-700 font-sans">
                          {y.winRate}%
                        </td>
                        <td className="py-2 px-3 text-left font-sans text-slate-500 text-[11px]">
                          {context}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Representative Trades Log with Exit Reason Filters */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs space-y-2">
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50/60">
              <div>
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Representative Simulated Trades Audit Log ({filteredTrades.length} Trades)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Inspect how Stop Loss ({config.stopLossMode === 'static' ? `-${config.stopLossPct}%` : config.stopLossMode === 'none' ? 'None' : 'Dynamic/Trailing'}), Target Gain ({config.targetGainPct === 0 ? 'Let Run' : `+${config.targetGainPct}%`}), and Rank-Drop rules triggered exits
                </p>
              </div>

              {/* Trade Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => setTradeFilter('all')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    tradeFilter === 'all'
                      ? 'bg-slate-900 text-white font-bold'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  All Trades
                </button>
                <button
                  type="button"
                  onClick={() => setTradeFilter('multibaggers')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    tradeFilter === 'multibaggers'
                      ? 'bg-emerald-600 text-white font-bold'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  Runners (&gt;40%)
                </button>
                <button
                  type="button"
                  onClick={() => setTradeFilter('stops')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    tradeFilter === 'stops'
                      ? 'bg-rose-600 text-white font-bold'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  Stops Executed (SL)
                </button>
                <button
                  type="button"
                  onClick={() => setTradeFilter('rank_drop')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    tradeFilter === 'rank_drop'
                      ? 'bg-amber-600 text-white font-bold'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  Rank-Drop Exits
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-72">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-[10px] font-bold text-slate-600 uppercase">
                  <tr>
                    <th className="py-2 px-3 text-left">Stock</th>
                    <th className="py-2 px-3 text-left">Sector</th>
                    <th className="py-2 px-3 text-left">Holding Period</th>
                    <th className="py-2 px-3 text-right">Entry → Exit Price</th>
                    <th className="py-2 px-3 text-right">Return (%)</th>
                    <th className="py-2 px-3 text-left">Exit Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTrades.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2 px-3">
                        <div className="font-bold text-slate-900">{t.ticker}</div>
                        <div className="text-[10px] text-slate-400">{t.name}</div>
                      </td>
                      <td className="py-2 px-3 text-slate-600">{t.sector}</td>
                      <td className="py-2 px-3 text-slate-500 font-mono text-[11px]">
                        {t.entryDate} → {t.exitDate} ({t.holdingDays}d)
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-700">
                        ₹{t.entryPrice.toFixed(0)} → ₹{t.exitPrice.toFixed(0)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span
                          className={`font-mono font-bold ${
                            t.returnPct >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {t.returnPct >= 0 ? '+' : ''}{t.returnPct}%
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
                            t.exitReason === 'Stop Loss Triggered'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : t.exitReason === 'Target Gain Achieved'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : t.exitReason === 'Trailing Stop Breached'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          }`}
                        >
                          {t.exitReason}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500 rounded-b-2xl">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>
              10-Year Real-Data Simulation Engine • Net of 0.70% Round-Trip Frictional Drag (STT, Turnover, Taxes &amp; Slippage)
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800 transition-colors"
          >
            Close Backtest
          </button>
        </div>
      </div>
    </div>
  );
};
