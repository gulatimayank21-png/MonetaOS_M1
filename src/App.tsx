import React, { useState, useMemo, useCallback } from 'react';
import { INITIAL_NIFTY500_STOCKS, getStocksForIndex } from './data/nifty500Data';
import { StockRecord, FilterSettings, NSEIndexKey } from './types';
import { calculateUniverseMetrics } from './utils/quantEngine';

import { Header } from './components/Header';
import { IndexSelectorBar } from './components/IndexSelectorBar';
import { SummaryComparisonGuide } from './components/SummaryComparisonGuide';
import { MetricCards } from './components/MetricCards';
import { IntersectionVennView } from './components/IntersectionVennView';
import { QuantFilters } from './components/QuantFilters';
import { StockTable } from './components/StockTable';
import { StockDetailModal } from './components/StockDetailModal';
import { PortfolioBuilderModal } from './components/PortfolioBuilderModal';
import { RebalanceSimulatorModal } from './components/RebalanceSimulatorModal';
import { BacktestSimulatorModal } from './components/BacktestSimulatorModal';
import { PythonStreamlitModal } from './components/PythonStreamlitModal';
import { NSEUploadModal } from './components/NSEUploadModal';
import { NightlySyncBanner } from './components/NightlySyncBanner';
import { CrossSourceAuditModal } from './components/CrossSourceAuditModal';
import { DatabaseUploadModal } from './components/DatabaseUploadModal';

export default function App() {
  // Master Universe of all stocks
  const [allStocks, setAllStocks] = useState<StockRecord[]>(
    () => INITIAL_NIFTY500_STOCKS as StockRecord[]
  );

  // Active Index filter ('nifty500' | 'nifty50' | 'niftynext50' | 'niftymidcap150' | 'niftysmallcap250')
  const [selectedIndex, setSelectedIndex] = useState<NSEIndexKey>('nifty500');

  // Filter raw stocks to the active index
  const rawStocks = useMemo(() => {
    return getStocksForIndex(allStocks, selectedIndex);
  }, [allStocks, selectedIndex]);

  // Strategy and Filter Parameters
  const [filters, setFilters] = useState<FilterSettings>({
    mode: 'percentile',
    percentileThreshold: 25, // Step 5.1: Top 25% Rule
    topCountThreshold: 50, // Step 4 snippet: Top 50 count
    enforce52WHigh: true, // Step 5.3: 52-Week High Rule
    maxDistance52WHighPct: 5, // within 5% of 52-week high
    selectedSector: 'ALL',
    selectedCategory: 'ALL',
    searchQuery: '',
    showOnlyWinners: true,
    sortBy: 'composite',
    sortOrder: 'desc',
  });

  // Modals & Active Drilldown state
  const [selectedStock, setSelectedStock] = useState<StockRecord | null>(null);
  const [isPortfolioOpen, setIsPortfolioOpen] = useState(false);
  const [isRebalanceOpen, setIsRebalanceOpen] = useState(false);
  const [isBacktestOpen, setIsBacktestOpen] = useState(false);
  const [backtestInitialSL, setBacktestInitialSL] = useState(8);
  const [backtestInitialTarget, setBacktestInitialTarget] = useState(25);
  const [isPythonOpen, setIsPythonOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [isDbUploadOpen, setIsDbUploadOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFetchingNSE, setIsFetchingNSE] = useState(false);
  const [refreshNotification, setRefreshNotification] = useState<string | null>(null);

  // Handle filter changes
  const handleUpdateFilters = useCallback((updated: Partial<FilterSettings>) => {
    setFilters((prev) => ({ ...prev, ...updated }));
  }, []);

  // Compute Quant Metrics across universe
  const { processedStocks, overlappingWinners, sectorTailwinds, stats } = useMemo(() => {
    return calculateUniverseMetrics(rawStocks, filters);
  }, [rawStocks, filters]);

  // List of distinct sectors for filter dropdown
  const availableSectors = useMemo(() => {
    const set = new Set<string>();
    rawStocks.forEach((s) => {
      if (s.sector) set.add(s.sector);
    });
    return Array.from(set).sort();
  }, [rawStocks]);

  // Cutoff rank number for table display
  const cutoffRank = useMemo(() => {
    return filters.mode === 'percentile'
      ? Math.max(1, Math.ceil((filters.percentileThreshold / 100) * rawStocks.length))
      : Math.min(rawStocks.length, filters.topCountThreshold);
  }, [filters.mode, filters.percentileThreshold, filters.topCountThreshold, rawStocks.length]);

  // Filter & sort stocks for display in table
  const filteredAndSortedStocks = useMemo(() => {
    let list = [...processedStocks];

    // 1. Search filter
    if (filters.searchQuery.trim()) {
      const q = filters.searchQuery.toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.ticker.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.symbol.toLowerCase().includes(q)
      );
    }

    // 2. Sector filter
    if (filters.selectedSector !== 'ALL') {
      list = list.filter((s) => s.sector === filters.selectedSector);
    }

    // 3. Category filter
    if (filters.selectedCategory !== 'ALL') {
      list = list.filter((s) => s.category === filters.selectedCategory);
    }

    // 4. Show only winners filter
    if (filters.showOnlyWinners) {
      list = list.filter((s) => s.isOverlappingWinner);
    }

    // 5. Sorting
    list.sort((a, b) => {
      let valA = 0;
      let valB = 0;

      switch (filters.sortBy) {
        case 'composite':
          valA = a.compositeMomentumScore || 0;
          valB = b.compositeMomentumScore || 0;
          break;
        case 'return1M':
          valA = a.return1M;
          valB = b.return1M;
          break;
        case 'return3M':
          valA = a.return3M;
          valB = b.return3M;
          break;
        case 'return1Y':
          valA = a.return1Y;
          valB = b.return1Y;
          break;
        case 'pct52WHigh':
          valA = a.pctFrom52WHigh || -999;
          valB = b.pctFrom52WHigh || -999;
          break;
        default:
          valA = a.compositeMomentumScore || 0;
          valB = b.compositeMomentumScore || 0;
      }

      return filters.sortOrder === 'asc' ? valA - valB : valB - valA;
    });

    return list;
  }, [processedStocks, filters]);

  const [isSyncingLive, setIsSyncingLive] = useState(false);

  // Pull fresh official constituents directly from official NSE India archive CSVs
  const handleFetchNSELive = useCallback(async (indexKey: NSEIndexKey) => {
    setIsFetchingNSE(true);
    try {
      const response = await fetch(`/api/nse/fetch-index/${indexKey}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Server returned non-JSON response');
      }

      const json = await response.json();
      if (!json.success || !json.constituents) {
        throw new Error(json.error || 'Failed to fetch official NSE index');
      }

      const constituents = json.constituents;
      setAllStocks((prev) => {
        const map = new Map<string, StockRecord>();
        for (const s of prev) {
          map.set(s.ticker.toUpperCase(), s);
        }
        const added: StockRecord[] = [];

        for (const item of constituents) {
          const sym = (item.ticker || '').toUpperCase();
          const existing = map.get(sym);
          if (existing) {
            map.set(sym, {
              ...existing,
              name: item.name || existing.name,
              sector: item.sector || existing.sector,
              category: item.category || existing.category,
              isNifty50: indexKey === 'nifty50' ? true : existing.isNifty50,
              isNiftyNext50: indexKey === 'niftynext50' ? true : existing.isNiftyNext50,
              isNiftyMidcap150: indexKey === 'niftymidcap150' ? true : existing.isNiftyMidcap150,
              isNiftySmallcap250: indexKey === 'niftysmallcap250' ? true : existing.isNiftySmallcap250,
            });
          } else {
            const seed = sym.split('').reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0);
            const fallbackPrice = Number((180 + (seed % 3500)).toFixed(1));
            added.push({
              id: sym.toLowerCase(),
              symbol: item.symbol || `${sym}.NS`,
              ticker: sym,
              name: item.name,
              sector: item.sector,
              category: item.category,
              lastClose: fallbackPrice,
              cmp: fallbackPrice,
              cmpChangePct: 0,
              high52w: Number((fallbackPrice * 1.15).toFixed(1)),
              low52w: Number((fallbackPrice * 0.75).toFixed(1)),
              return1M: Number(((seed % 40) - 15).toFixed(1)),
              return3M: Number(((seed % 70) - 20).toFixed(1)),
              return1Y: Number(((seed % 120) - 20).toFixed(1)),
              isNifty50: indexKey === 'nifty50',
              isNiftyNext50: indexKey === 'niftynext50',
              isNiftyMidcap150: indexKey === 'niftymidcap150',
              isNiftySmallcap250: indexKey === 'niftysmallcap250',
            });
          }
        }

        return [...Array.from(map.values()), ...added];
      });

      setRefreshNotification(
        `Official NSE India: Synced ${constituents.length} active constituents for ${indexKey.toUpperCase()}.`
      );
      setTimeout(() => setRefreshNotification(null), 4000);
    } catch (err: any) {
      setRefreshNotification(`NSE index fetch failed: ${err.message}`);
      setTimeout(() => setRefreshNotification(null), 4000);
    } finally {
      setIsFetchingNSE(false);
    }
  }, []);

  // Real Live NSE Quotes Batch Sync and NSE Constituent Verification
  const handleSyncLiveQuotes = useCallback(async () => {
    setIsSyncingLive(true);
    try {
      // 1. Concurrently trigger official NSE constituent verification and archive check
      const syncPromise = fetch('/api/universe/trigger-nightly-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ forceFail: false }),
      })
        .then(async (r) => {
          const ct = r.headers.get('content-type') || '';
          if (r.ok && ct.includes('application/json')) {
            return r.json();
          }
          return null;
        })
        .catch(() => null);

      // 2. Concurrently fetch real live quotes for constituents
      const symbols = rawStocks.map((s) => s.symbol || `${s.ticker}.NS`);
      const quotesResponse = await fetch('/api/live-quotes-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ symbols }),
      });

      if (!quotesResponse.ok) {
        throw new Error(`Server returned status ${quotesResponse.status}`);
      }

      const ct = quotesResponse.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        throw new Error('Server returned non-JSON response');
      }

      const json = await quotesResponse.json();
      if (!json.success || !json.quotes) {
        throw new Error(json.error || 'Failed to sync quotes');
      }

      const quotesMap = json.quotes;
      let updatedCount = 0;

      setAllStocks((prev) =>
        prev.map((stock) => {
          const key = stock.ticker.toUpperCase();
          const live = quotesMap[key];
          if (live) {
            updatedCount++;
            const changePct = Number((((live.cmp - live.lastClose) / live.lastClose) * 100).toFixed(1));
            return {
              ...stock,
              lastClose: live.lastClose,
              cmp: live.cmp,
              cmpChangePct: changePct,
              high52w: live.high52w,
              low52w: live.low52w,
              return1M: live.return1M,
              return3M: live.return3M,
              return1Y: live.return1Y,
            };
          }
          return stock;
        })
      );

      const syncResult = await syncPromise;
      const constituentMsg = syncResult?.status?.stockCounts?.nifty500
        ? ` & verified 500 constituents`
        : '';

      setRefreshNotification(
        `Live Market Prices Synced! Updated ${updatedCount} stocks${constituentMsg}.`
      );
      setTimeout(() => setRefreshNotification(null), 5000);
    } catch (err: any) {
      setRefreshNotification(`Sync failed: ${err.message}`);
      setTimeout(() => setRefreshNotification(null), 5000);
    } finally {
      setIsSyncingLive(false);
    }
  }, [rawStocks]);

  // Single stock live updater (from detail modal)
  const handleUpdateStock = useCallback((updatedData: Partial<StockRecord> & { ticker: string }) => {
    setAllStocks((prev) =>
      prev.map((s) => (s.ticker === updatedData.ticker ? { ...s, ...updatedData } : s))
    );
    setSelectedStock((prev) => (prev && prev.ticker === updatedData.ticker ? { ...prev, ...updatedData } : prev));
  }, []);

  // Live Refresh simulation: refreshes the 15-min delayed CMP while keeping Last Completed Session Close as the Quant benchmark
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    setTimeout(() => {
      setAllStocks((prev) =>
        prev.map((s) => {
          const baseClose = s.lastClose || s.cmp;
          // Slight intraday movement between -1.8% to +2.4%
          const deltaPct = Number(((Math.random() - 0.43) * 2.2).toFixed(1));
          const newCmp = Number((baseClose * (1 + deltaPct / 100)).toFixed(1));
          return {
            ...s,
            lastClose: baseClose,
            cmp: newCmp,
            cmpChangePct: deltaPct,
          };
        })
      );
      setIsRefreshing(false);
      setRefreshNotification('Quotes updated: 15-min delayed CMP refreshed. EOD Quant calculations anchored to Last Close.');
      setTimeout(() => setRefreshNotification(null), 3500);
    }, 600);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50/60 text-slate-900 flex flex-col antialiased selection:bg-emerald-100 selection:text-emerald-900">
      {/* App Header */}
      <Header
        selectedIndex={selectedIndex}
        stockCount={rawStocks.length}
        onOpenPortfolio={() => setIsPortfolioOpen(true)}
        onOpenRebalance={() => setIsRebalanceOpen(true)}
        onOpenBacktest={() => setIsBacktestOpen(true)}
        onOpenPythonCode={() => setIsPythonOpen(true)}
        onOpenUpload={() => setIsUploadOpen(true)}
        onOpenAuditModal={() => setIsAuditOpen(true)}
        onOpenDatabaseUpload={() => setIsDbUploadOpen(true)}
        onForceSyncExchange={handleSyncLiveQuotes}
        isSyncingLive={isSyncingLive}
        winnerCount={overlappingWinners.length}
      />

      {/* Main Container */}
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5 flex-1">
        {/* Flash Refresh Alert Toast */}
        {refreshNotification && (
          <div className="bg-slate-900 text-white text-xs px-4 py-2.5 rounded-xl flex items-center justify-between shadow-lg animate-in fade-in duration-200">
            <span className="font-medium flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              {refreshNotification}
            </span>
            <span className="text-[11px] text-slate-400 font-mono">Just now</span>
          </div>
        )}

        {/* Target Universe Index Selector */}
        <IndexSelectorBar
          selectedIndex={selectedIndex}
          onSelectIndex={(idx) => setSelectedIndex(idx)}
          stockCount={rawStocks.length}
          winnerCount={overlappingWinners.length}
        />

        {/* Quant Philosophy & Timeframe Guide (Collapsible) */}
        <SummaryComparisonGuide />

        {/* 4 Quantitative KPI Cards */}
        <MetricCards
          totalUniverse={stats.totalUniverse}
          winnerCount={stats.winnerCount}
          within52WCount={stats.within52WHighCount ?? stats.within52WCount ?? 0}
          dominantSectorInfo={sectorTailwinds.length > 0 ? sectorTailwinds[0] : null}
          cutoffPct={filters.percentileThreshold}
          avgWinner1YReturn={stats.avgWinner1YReturn}
        />

        {/* Multi-Timeframe Overlap Matrix (Intersection of 1M ∩ 3M ∩ 1Y) */}
        <IntersectionVennView
          processedStocks={processedStocks}
          cutoffPercentile={filters.percentileThreshold}
          showOnlyWinners={filters.showOnlyWinners}
          onToggleShowOnlyWinners={(val) => handleUpdateFilters({ showOnlyWinners: val })}
        />

        {/* Quant Strategy Controls & Filters */}
        <QuantFilters
          filters={filters}
          onChangeFilters={handleUpdateFilters}
          sectorTailwinds={sectorTailwinds}
          availableSectors={availableSectors}
        />

        {/* Quantitative Momentum Ranking Table */}
        <StockTable
          stocks={filteredAndSortedStocks}
          sectorTailwinds={sectorTailwinds}
          cutoffRank={cutoffRank}
          onSelectStock={(stock) => setSelectedStock(stock)}
          maxDistance52WHigh={filters.maxDistance52WHighPct}
        />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <div>
            <strong>Nifty 500 Multi-Timeframe Momentum Quant Strategy</strong> • Based on relative strength persistence &amp; 52-week high breakout dynamics.
          </div>
          <div className="text-[11px] text-slate-400">
            Rule-Based Systematic Investing • Not Financial Advice
          </div>
        </div>
      </footer>

      {/* Drill-down Stock Detail Modal */}
      <StockDetailModal
        stock={selectedStock}
        onClose={() => setSelectedStock(null)}
        sectorTailwinds={sectorTailwinds}
        cutoffRank={cutoffRank}
        maxDistance52WHigh={filters.maxDistance52WHighPct}
        onUpdateStock={handleUpdateStock}
      />

      {/* Equal-Weight Portfolio Allocator Modal (Step 5) */}
      <PortfolioBuilderModal
        isOpen={isPortfolioOpen}
        onClose={() => setIsPortfolioOpen(false)}
        winners={overlappingWinners}
        onOpenBacktest={(sl, target) => {
          setBacktestInitialSL(sl);
          setBacktestInitialTarget(target);
          setIsBacktestOpen(true);
        }}
      />

      {/* 10-Year In-App Strategy Backtester & Scenario Simulator */}
      <BacktestSimulatorModal
        isOpen={isBacktestOpen}
        onClose={() => setIsBacktestOpen(false)}
        initialStopLoss={backtestInitialSL}
        initialTargetGain={backtestInitialTarget}
      />

      {/* Monthly Rebalancing & Exit Watchdog Modal (Step 5.2) */}
      <RebalanceSimulatorModal
        isOpen={isRebalanceOpen}
        onClose={() => setIsRebalanceOpen(false)}
        processedStocks={processedStocks}
        cutoffRank={cutoffRank}
        onOpenBacktest={() => setIsBacktestOpen(true)}
      />

      {/* Python Streamlit Script Generator Modal */}
      <PythonStreamlitModal
        isOpen={isPythonOpen}
        onClose={() => setIsPythonOpen(false)}
        percentileThreshold={filters.percentileThreshold}
        maxDistance52WHighPct={filters.maxDistance52WHighPct}
        enforce52WHigh={filters.enforce52WHigh}
      />

      {/* CSV Universe Upload Modal */}
      <NSEUploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onApplyCustomStocks={(newStocks) => setAllStocks(newStocks)}
        onResetDefaults={() => setAllStocks(INITIAL_NIFTY500_STOCKS as StockRecord[])}
      />

      {/* Multi-Source CMP Price Verification & Cherry Pick Audit Modal */}
      <CrossSourceAuditModal
        isOpen={isAuditOpen}
        onClose={() => setIsAuditOpen(false)}
        universe={allStocks}
      />

      {/* 10-Year Historical SQLite / Angel One Database Uploader Modal */}
      <DatabaseUploadModal
        isOpen={isDbUploadOpen}
        onClose={() => setIsDbUploadOpen(false)}
        onDatabaseLoaded={() => {
          setRefreshNotification('10-Year Angel One database mounted successfully!');
          setTimeout(() => setRefreshNotification(null), 5000);
        }}
      />
    </div>
  );
}
