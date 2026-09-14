import React, { useState, useMemo } from 'react';
import { Target, CheckCircle2, ChevronDown, ChevronUp, Layers, ArrowRight, Sparkles } from 'lucide-react';
import { StockRecord } from '../types';

interface IntersectionVennViewProps {
  processedStocks: StockRecord[];
  cutoffPercentile: number;
  showOnlyWinners: boolean;
  onToggleShowOnlyWinners: (val: boolean) => void;
}

export const IntersectionVennView: React.FC<IntersectionVennViewProps> = ({
  processedStocks,
  cutoffPercentile,
  showOnlyWinners,
  onToggleShowOnlyWinners,
}) => {
  const [showVennDetails, setShowVennDetails] = useState(false);

  const total = processedStocks.length;
  if (total === 0) return null;

  const cutoffRank = Math.max(1, Math.ceil((cutoffPercentile / 100) * total));

  // Compute sorted arrays for threshold calculations
  const sorted1M = useMemo(() => [...processedStocks].sort((a, b) => b.return1M - a.return1M), [processedStocks]);
  const sorted3M = useMemo(() => [...processedStocks].sort((a, b) => b.return3M - a.return3M), [processedStocks]);
  const sorted1Y = useMemo(() => [...processedStocks].sort((a, b) => b.return1Y - a.return1Y), [processedStocks]);

  const cutoffReturn1M = sorted1M[Math.min(cutoffRank - 1, total - 1)]?.return1M ?? 0;
  const cutoffReturn3M = sorted3M[Math.min(cutoffRank - 1, total - 1)]?.return3M ?? 0;
  const cutoffReturn1Y = sorted1Y[Math.min(cutoffRank - 1, total - 1)]?.return1Y ?? 0;

  // Individual Buckets
  const top1M = useMemo(() => processedStocks.filter((s) => (s.rank1M || 999) <= cutoffRank), [processedStocks, cutoffRank]);
  const top3M = useMemo(() => processedStocks.filter((s) => (s.rank3M || 999) <= cutoffRank), [processedStocks, cutoffRank]);
  const top1Y = useMemo(() => processedStocks.filter((s) => (s.rank1Y || 999) <= cutoffRank), [processedStocks, cutoffRank]);

  // Sets for fast intersection
  const set1M = useMemo(() => new Set(top1M.map((s) => s.ticker)), [top1M]);
  const set3M = useMemo(() => new Set(top3M.map((s) => s.ticker)), [top3M]);
  const set1Y = useMemo(() => new Set(top1Y.map((s) => s.ticker)), [top1Y]);

  // Intermediate dual overlaps
  const overlap1M_3M = processedStocks.filter((s) => set1M.has(s.ticker) && set3M.has(s.ticker));
  const overlap3M_1Y = processedStocks.filter((s) => set3M.has(s.ticker) && set1Y.has(s.ticker));
  const overlap1M_1Y = processedStocks.filter((s) => set1M.has(s.ticker) && set1Y.has(s.ticker));

  // Triple intersection (1M ∩ 3M ∩ 1Y)
  const allThreeOverlap = processedStocks.filter(
    (s) => set1M.has(s.ticker) && set3M.has(s.ticker) && set1Y.has(s.ticker)
  );

  // Triple intersection + 52-Week High Rule pass (Final Super-Trend Winners)
  const superWinners = processedStocks.filter((s) => s.isOverlappingWinner);

  const avgReturn1M = (top1M.reduce((a, b) => a + b.return1M, 0) / (top1M.length || 1)).toFixed(1);
  const avgReturn3M = (top3M.reduce((a, b) => a + b.return3M, 0) / (top3M.length || 1)).toFixed(1);
  const avgReturn1Y = (top1Y.reduce((a, b) => a + b.return1Y, 0) / (top1Y.length || 1)).toFixed(1);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-200/80">
              <Target className="w-4 h-4 text-emerald-600" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">
              Multi-Timeframe Overlap Matrix
            </h3>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200/70">
              Screening Top {cutoffPercentile}% Quartile
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Stocks must qualify simultaneously across all three timeframes to eliminate transient single-period spikes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowVennDetails(!showVennDetails)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors"
          >
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span>Overlap Funnel Details</span>
            {showVennDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          <button
            id="btn-filter-sweetspot"
            onClick={() => onToggleShowOnlyWinners(!showOnlyWinners)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              showOnlyWinners
                ? 'bg-emerald-600 text-white shadow-xs hover:bg-emerald-700'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>{showOnlyWinners ? 'Showing Only Super-Trend (Filtered)' : 'Filter to Super-Trend Only'}</span>
          </button>
        </div>
      </div>

      {/* 4 Cards Grid - Clean Light Pastel Palette */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
        {/* 1M Pillar: Soft Warm Amber Pastel */}
        <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-200/80 flex flex-col justify-between hover:border-amber-300 transition-colors">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-950">1-Month Momentum</span>
              <span className="text-[10px] font-semibold text-amber-800 bg-amber-100/70 border border-amber-200/60 px-2 py-0.5 rounded-full">
                Short-Term
              </span>
            </div>
            <div className="mt-3">
              <span className="text-[11px] font-semibold text-amber-800/80 uppercase tracking-wider block">
                Cutoff Hurdle
              </span>
              <div className="text-2xl font-bold font-mono text-amber-950 mt-0.5">
                ≥ +{cutoffReturn1M}%
              </div>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-amber-200/60 text-xs text-amber-900/90 flex items-center justify-between">
            <span className="text-amber-800/80">Cohort Avg:</span>
            <span className="font-mono font-bold text-amber-950">+{avgReturn1M}%</span>
          </div>
        </div>

        {/* 3M Pillar: Soft Fresh Sky Blue Pastel */}
        <div className="p-4 rounded-xl bg-sky-50/50 border border-sky-200/80 flex flex-col justify-between hover:border-sky-300 transition-colors">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-sky-950">3-Month Momentum</span>
              <span className="text-[10px] font-semibold text-sky-800 bg-sky-100/70 border border-sky-200/60 px-2 py-0.5 rounded-full">
                Medium-Term
              </span>
            </div>
            <div className="mt-3">
              <span className="text-[11px] font-semibold text-sky-800/80 uppercase tracking-wider block">
                Cutoff Hurdle
              </span>
              <div className="text-2xl font-bold font-mono text-sky-950 mt-0.5">
                ≥ +{cutoffReturn3M}%
              </div>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-sky-200/60 text-xs text-sky-900/90 flex items-center justify-between">
            <span className="text-sky-800/80">Cohort Avg:</span>
            <span className="font-mono font-bold text-sky-950">+{avgReturn3M}%</span>
          </div>
        </div>

        {/* 1Y Pillar: Soft Lavender / Indigo Pastel */}
        <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-200/80 flex flex-col justify-between hover:border-indigo-300 transition-colors">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-950">1-Year Momentum</span>
              <span className="text-[10px] font-semibold text-indigo-800 bg-indigo-100/70 border border-indigo-200/60 px-2 py-0.5 rounded-full">
                Long-Term
              </span>
            </div>
            <div className="mt-3">
              <span className="text-[11px] font-semibold text-indigo-800/80 uppercase tracking-wider block">
                Cutoff Hurdle
              </span>
              <div className="text-2xl font-bold font-mono text-indigo-950 mt-0.5">
                ≥ +{cutoffReturn1Y}%
              </div>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-indigo-200/60 text-xs text-indigo-900/90 flex items-center justify-between">
            <span className="text-indigo-800/80">Cohort Avg:</span>
            <span className="font-mono font-bold text-indigo-950">+{avgReturn1Y}%</span>
          </div>
        </div>

        {/* Center: The Sweet Spot (Overlap): Soft Mint / Emerald Pastel */}
        <div className="p-4 rounded-xl bg-emerald-50/60 border-2 border-emerald-300 flex flex-col justify-between shadow-2xs relative">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                The Sweet Spot
              </span>
              <span className="text-[10px] font-semibold text-emerald-900 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full">
                1M ∩ 3M ∩ 1Y
              </span>
            </div>
            <div className="mt-3">
              <span className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider block">
                Super-Trend Winners
              </span>
              <div className="text-2xl font-bold font-mono text-emerald-900 mt-0.5">
                {superWinners.length} <span className="text-xs font-normal text-emerald-700">stocks qualified</span>
              </div>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-emerald-200 text-xs text-emerald-900 flex items-center justify-between font-medium">
            <span className="text-emerald-800">Triple Overlap:</span>
            <span className="font-mono font-bold text-emerald-950">{allThreeOverlap.length} stocks</span>
          </div>
        </div>
      </div>

      {/* Collapsible Overlap Funnel Details */}
      {showVennDetails && (
        <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200 text-xs space-y-3 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800 text-xs">
              Sequential Multi-Timeframe Screening Funnel
            </span>
            <span className="text-[11px] text-slate-500">
              Universe: {total} Constituents
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-center">
            <div className="bg-white p-2.5 rounded-lg border border-slate-200">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">1M ∩ 3M Overlap</span>
              <span className="text-sm font-bold font-mono text-slate-900 mt-0.5 block">{overlap1M_3M.length} stocks</span>
              <span className="text-[10px] text-slate-400">Short + Medium trend</span>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">3M ∩ 1Y Overlap</span>
              <span className="text-sm font-bold font-mono text-slate-900 mt-0.5 block">{overlap3M_1Y.length} stocks</span>
              <span className="text-[10px] text-slate-400">Medium + Long trend</span>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">1M ∩ 1Y Overlap</span>
              <span className="text-sm font-bold font-mono text-slate-900 mt-0.5 block">{overlap1M_1Y.length} stocks</span>
              <span className="text-[10px] text-slate-400">Short + Long trend</span>
            </div>
            <div className="bg-emerald-50 p-2.5 rounded-lg border border-emerald-200">
              <span className="text-[10px] font-bold text-emerald-800 uppercase block">All 3 + 52W High</span>
              <span className="text-sm font-bold font-mono text-emerald-900 mt-0.5 block">{superWinners.length} stocks</span>
              <span className="text-[10px] text-emerald-700">Zero overhead resistance</span>
            </div>
          </div>

          <p className="text-[11px] text-slate-600 bg-white p-2.5 rounded-lg border border-slate-200 leading-relaxed">
            <strong>Quant Insight:</strong> Requiring a stock to be in the top quartile of 1-Month, 3-Month, and 1-Year returns eliminates over 90% of false breakouts. Applying the 52-Week High Rule (within 5%) isolates the final high-probability trend leaders.
          </p>
        </div>
      )}
    </div>
  );
};
