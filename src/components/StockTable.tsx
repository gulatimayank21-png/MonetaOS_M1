import React, { useState } from 'react';
import { Copy, Check, ChevronRight, AlertTriangle, Sparkles, ExternalLink, HelpCircle, Info } from 'lucide-react';
import { StockRecord, SectorTailwindInfo } from '../types';

interface StockTableProps {
  stocks: StockRecord[];
  sectorTailwinds: SectorTailwindInfo[];
  cutoffRank: number;
  onSelectStock: (stock: StockRecord) => void;
  maxDistance52WHigh: number;
}

export const StockTable: React.FC<StockTableProps> = ({
  stocks,
  sectorTailwinds,
  cutoffRank,
  onSelectStock,
  maxDistance52WHigh,
}) => {
  const [copiedSymbol, setCopiedSymbol] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [showRankBadges, setShowRankBadges] = useState<boolean>(false);

  const totalPages = Math.ceil(stocks.length / pageSize) || 1;
  const validCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (validCurrentPage - 1) * pageSize;
  const paginatedStocks = stocks.slice(startIndex, startIndex + pageSize);

  const copyToClipboard = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedSymbol(text);
    setTimeout(() => setCopiedSymbol(null), 2000);
  };

  const getRankBadgeClass = (rank?: number) => {
    if (!rank) return 'bg-slate-50 text-slate-600 border-slate-200';
    if (rank <= cutoffRank) {
      return 'bg-emerald-50 text-emerald-800 border-emerald-200/80 font-semibold';
    }
    return 'bg-slate-50 text-slate-600 border-slate-200';
  };

  const formatPercentileLabel = (p?: number) => {
    if (p === undefined || p === null) return '';
    if (p >= 99) return 'Top 1%';
    if (p >= 95) return 'Top 5%';
    if (p >= 90) return 'Top 10%';
    if (p >= 75) return 'Top 25%';
    return `${p.toFixed(0)}%ile`;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50/50">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Quant Momentum Rankings ({stocks.length} Stocks Displayed)
          </h3>
          <span className="text-[11px] text-slate-500 font-medium">
            Cutoff: Top #{cutoffRank}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {/* Toggle for Rank & Percentile Badges */}
          <button
            type="button"
            onClick={() => setShowRankBadges((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all border shadow-2xs ${
              showRankBadges
                ? 'bg-indigo-600 text-white border-indigo-700'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
            }`}
            title="Toggle percentile rankings (#rank and Top %ile) inside momentum columns"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                showRankBadges ? 'bg-white animate-pulse' : 'bg-slate-400'
              }`}
            />
            <span>{showRankBadges ? 'Ranks: Visible' : 'Show Ranks & Percentiles'}</span>
          </button>

          <div className="h-4 w-px bg-slate-200 hidden sm:block" />

          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Super-Trend
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            Near Cutoff
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            Exit Signal
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider bg-slate-50/80">
              <th className="py-2.5 px-3">Stock / Symbol</th>
              <th className="py-2.5 px-3">Sector &amp; Cap</th>
              <th className="py-2.5 px-3 text-right" title="Last Completed Trading Session Closing Price — Basis of all Quant momentum metrics">Last Close (₹)</th>
              <th className="py-2.5 px-3 text-right" title="Current Market Price (15-min delayed) with intraday change vs last close">CMP (15m Delay)</th>
              <th className="py-2.5 px-3 text-right">52W Proximity</th>
              <th className="py-2.5 px-3 text-right">
                <div className="relative group/scoreHead inline-flex items-center gap-1 cursor-help">
                  <span>Composite Score</span>
                  <HelpCircle className="w-3.5 h-3.5 text-slate-400 group-hover/scoreHead:text-indigo-600 transition-colors" />
                  {/* Calculation Tooltip */}
                  <div className="hidden group-hover/scoreHead:block absolute right-0 top-full mt-1.5 w-68 p-3 bg-slate-900 text-white text-[11px] rounded-xl shadow-xl z-50 text-left normal-case font-normal border border-slate-700/80 leading-relaxed animate-in fade-in">
                    <span className="font-bold text-emerald-400 block mb-1">
                      Composite Momentum Score (0–100)
                    </span>
                    <p className="text-slate-300 text-[11px]">
                      Blended multi-timeframe percentile ranking calculated across all active constituents:
                    </p>
                    <div className="font-mono text-[10px] bg-slate-800 p-1.5 rounded-md border border-slate-700 my-1.5 text-emerald-300">
                      Score = (0.30 × P₁ₘ) + (0.35 × P₃ₘ) + (0.35 × P₁ᵧ)
                    </div>
                    <ul className="text-slate-400 text-[10px] space-y-0.5 list-disc pl-3 mt-1">
                      <li><strong className="text-slate-200">30% 1M:</strong> Short-term breakout velocity</li>
                      <li><strong className="text-slate-200">35% 3M:</strong> Institutional swing persistence</li>
                      <li><strong className="text-slate-200">35% 1Y:</strong> Structural long-term trend leadership</li>
                    </ul>
                  </div>
                </div>
              </th>
              <th className="py-2.5 px-3 text-right">1M Momentum</th>
              <th className="py-2.5 px-3 text-right">3M Momentum</th>
              <th className="py-2.5 px-3 text-right">1Y Momentum</th>
              <th className="py-2.5 px-3 text-center">Quant Status</th>
              <th className="py-2.5 px-2 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {stocks.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-12 text-center text-slate-400">
                  <div className="max-w-xs mx-auto space-y-2">
                    <p className="font-semibold text-slate-600">No stocks match your current filter</p>
                    <p className="text-xs text-slate-400">
                      Try relaxing the Super-Trend cutoff or unchecking &quot;Show Only Winners&quot;.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedStocks.map((stock) => {
                const tailwind = sectorTailwinds.find((st) => st.sector === stock.sector);
                const isTailwindSector = tailwind?.isTailwind;
                const dist52W = stock.pctFrom52WHigh || 0;
                const isWithin52W = Math.abs(dist52W) <= maxDistance52WHigh;
                const baseClose = stock.lastClose || stock.cmp;

                return (
                  <tr
                    key={stock.id}
                    onClick={() => onSelectStock(stock)}
                    className={`hover:bg-slate-50/80 cursor-pointer transition-colors group ${
                      stock.isOverlappingWinner ? 'bg-emerald-50/20' : ''
                    } ${stock.rebalanceStatus === 'slipped_exit' ? 'bg-rose-50/20' : ''}`}
                  >
                    {/* Stock Symbol & Name */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-900 text-xs">
                              {stock.ticker}
                            </span>
                            <button
                              onClick={(e) => copyToClipboard(stock.symbol, e)}
                              className="text-slate-400 hover:text-slate-600 p-0.5 rounded hover:bg-slate-200 transition-colors"
                              title={`Copy ${stock.symbol} for yfinance/broker`}
                            >
                              {copiedSymbol === stock.symbol ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[160px]">
                            {stock.name}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Sector & Cap */}
                    <td className="py-3 px-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1 text-[11px] text-slate-800 font-medium">
                          <span className="truncate max-w-[150px]">{stock.sector}</span>
                          {isTailwindSector && (
                            <span
                              className="text-[9px] font-semibold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded-sm border border-purple-200 shrink-0"
                              title={`Sector Tailwind: ${stock.sector} shows robust sector-wide momentum (${tailwind?.baselineWinnerCount || 0} macro leaders in universe, ${tailwind?.overlappingCount || 0} in active filter)`}
                            >
                              Tailwind
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {stock.category}
                        </div>
                      </div>
                    </td>

                    {/* Last Session Close (Quant Calculation Anchor) */}
                    <td className="py-3 px-3 text-right">
                      <div className="font-mono font-bold text-slate-900">
                        ₹{baseClose.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      </div>
                      <div className="text-[9px] text-slate-400 font-mono tracking-tight" title="Quant strategy calculations use this official session close">
                        EOD Close
                      </div>
                    </td>

                    {/* CMP (15-min delayed) with Intraday Movement */}
                    <td className="py-3 px-3 text-right">
                      <div className="font-mono font-bold text-slate-800">
                        ₹{stock.cmp.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      </div>
                      <div className="flex items-center justify-end gap-1 mt-0.5">
                        <span
                          className={`text-[9px] font-mono font-semibold px-1 rounded ${
                            (stock.cmpChangePct || 0) >= 0
                              ? 'text-emerald-700 bg-emerald-50'
                              : 'text-rose-700 bg-rose-50'
                          }`}
                        >
                          {(stock.cmpChangePct || 0) >= 0 ? '+' : ''}
                          {(stock.cmpChangePct || 0).toFixed(1)}%
                        </span>
                        <span className="text-[9px] text-slate-400 font-mono" title="15-min delayed market quote">
                          15m
                        </span>
                      </div>
                    </td>

                    {/* 52W Proximity */}
                    <td className="py-3 px-3 text-right">
                      <div className="flex flex-col items-end">
                        <span
                          className={`font-mono font-bold text-xs ${
                            isWithin52W ? 'text-emerald-700' : 'text-slate-600'
                          }`}
                        >
                          {dist52W >= 0 ? 'At 52W High' : `${dist52W.toFixed(1)}%`}
                        </span>
                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                          <div
                            className={`h-full rounded-full ${
                              isWithin52W ? 'bg-emerald-500' : 'bg-slate-400'
                            }`}
                            style={{
                              width: `${Math.max(10, 100 - Math.min(100, Math.abs(dist52W) * 4))}%`,
                            }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Composite Momentum Score (Weighted Blended Relative Strength) */}
                    <td className="py-3 px-3 text-right">
                      <div className="relative group/score inline-block text-right cursor-help">
                        <div className="flex flex-col items-end">
                          <span
                            className={`font-mono font-bold text-xs px-2 py-0.5 rounded-md border shadow-2xs ${
                              (stock.compositeMomentumScore || 0) >= 85
                                ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                                : (stock.compositeMomentumScore || 0) >= 70
                                ? 'bg-sky-50 text-sky-900 border-sky-300'
                                : (stock.compositeMomentumScore || 0) >= 50
                                ? 'bg-slate-50 text-slate-700 border-slate-200'
                                : 'bg-amber-50 text-amber-900 border-amber-300'
                            }`}
                          >
                            {stock.compositeMomentumScore?.toFixed(1) ?? '—'}
                          </span>
                          <div
                            className="w-16 h-2 bg-slate-100 rounded-full border border-slate-300/90 overflow-hidden shadow-2xs mt-1.5"
                            title={`Composite Score: ${stock.compositeMomentumScore?.toFixed(1) ?? 0} / 100 (${((100 - (stock.compositeMomentumScore || 0))).toFixed(1)} pts away from 100)`}
                          >
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                (stock.compositeMomentumScore || 0) >= 85
                                  ? 'bg-emerald-500'
                                  : (stock.compositeMomentumScore || 0) >= 70
                                  ? 'bg-sky-500'
                                  : (stock.compositeMomentumScore || 0) >= 50
                                  ? 'bg-indigo-500'
                                  : 'bg-amber-500'
                              }`}
                              style={{ width: `${Math.min(100, Math.max(0, stock.compositeMomentumScore || 0))}%` }}
                            />
                          </div>
                        </div>

                        {/* Interactive Tooltip on hover */}
                        <div className="hidden group-hover/score:block absolute right-0 bottom-full mb-1.5 w-64 p-3 bg-slate-900 text-white text-[11px] rounded-xl shadow-xl z-50 pointer-events-none text-left border border-slate-700 leading-relaxed animate-in fade-in">
                          <div className="font-bold text-emerald-400 border-b border-slate-800 pb-1 mb-1.5 flex justify-between">
                            <span>{stock.ticker} Momentum Score</span>
                            <span className="font-mono text-white">{stock.compositeMomentumScore} / 100</span>
                          </div>
                          <p className="text-slate-400 text-[10px] mb-1.5">
                            Percentile contributions across lookback horizons:
                          </p>
                          <div className="space-y-1 font-mono text-[10px]">
                            <div className="flex justify-between text-slate-300">
                              <span>1M (30% wt):</span>
                              <span className="font-semibold text-white">
                                {stock.percentile1M?.toFixed(1)}%ile → +{(0.3 * (stock.percentile1M || 0)).toFixed(1)} pts
                              </span>
                            </div>
                            <div className="flex justify-between text-slate-300">
                              <span>3M (35% wt):</span>
                              <span className="font-semibold text-white">
                                {stock.percentile3M?.toFixed(1)}%ile → +{(0.35 * (stock.percentile3M || 0)).toFixed(1)} pts
                              </span>
                            </div>
                            <div className="flex justify-between text-slate-300">
                              <span>1Y (35% wt):</span>
                              <span className="font-semibold text-white">
                                {stock.percentile1Y?.toFixed(1)}%ile → +{(0.35 * (stock.percentile1Y || 0)).toFixed(1)} pts
                              </span>
                            </div>
                          </div>
                          <div className="mt-2 pt-1.5 border-t border-slate-800 text-[9px] text-slate-400 font-mono">
                            Formula: 0.30×P₁ₘ + 0.35×P₃ₘ + 0.35×P₁ᵧ
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* 1M Momentum */}
                    <td className="py-3 px-3 text-right">
                      <div
                        className="flex flex-col items-end gap-0.5"
                        title={`1M Return: ${stock.return1M >= 0 ? '+' : ''}${stock.return1M.toFixed(1)}% | Rank #${stock.rank1M} of ${stocks.length} (${stock.percentile1M?.toFixed(1)}th percentile)`}
                      >
                        <span
                          className={`font-mono font-bold text-xs ${
                            stock.return1M >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {stock.return1M >= 0 ? '+' : ''}
                          {stock.return1M.toFixed(1)}%
                        </span>
                        {showRankBadges && stock.rank1M && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono inline-flex items-center gap-1 border shadow-2xs ${getRankBadgeClass(stock.rank1M)}`}>
                            <span>#{stock.rank1M}</span>
                            <span className="text-slate-300 font-normal">|</span>
                            <span>{formatPercentileLabel(stock.percentile1M)}</span>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 3M Momentum */}
                    <td className="py-3 px-3 text-right">
                      <div
                        className="flex flex-col items-end gap-0.5"
                        title={`3M Return: ${stock.return3M >= 0 ? '+' : ''}${stock.return3M.toFixed(1)}% | Rank #${stock.rank3M} of ${stocks.length} (${stock.percentile3M?.toFixed(1)}th percentile)`}
                      >
                        <span
                          className={`font-mono font-bold text-xs ${
                            stock.return3M >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {stock.return3M >= 0 ? '+' : ''}
                          {stock.return3M.toFixed(1)}%
                        </span>
                        {showRankBadges && stock.rank3M && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono inline-flex items-center gap-1 border shadow-2xs ${getRankBadgeClass(stock.rank3M)}`}>
                            <span>#{stock.rank3M}</span>
                            <span className="text-slate-300 font-normal">|</span>
                            <span>{formatPercentileLabel(stock.percentile3M)}</span>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 1Y Momentum */}
                    <td className="py-3 px-3 text-right">
                      <div
                        className="flex flex-col items-end gap-0.5"
                        title={`1Y Return: ${stock.return1Y >= 0 ? '+' : ''}${stock.return1Y.toFixed(1)}% | Rank #${stock.rank1Y} of ${stocks.length} (${stock.percentile1Y?.toFixed(1)}th percentile)`}
                      >
                        <span
                          className={`font-mono font-bold text-xs ${
                            stock.return1Y >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {stock.return1Y >= 0 ? '+' : ''}
                          {stock.return1Y.toFixed(1)}%
                        </span>
                        {showRankBadges && stock.rank1Y && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono inline-flex items-center gap-1 border shadow-2xs ${getRankBadgeClass(stock.rank1Y)}`}>
                            <span>#{stock.rank1Y}</span>
                            <span className="text-slate-300 font-normal">|</span>
                            <span>{formatPercentileLabel(stock.percentile1Y)}</span>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Quant Status & Rebalance Trigger */}
                    <td className="py-3 px-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        {stock.isOverlappingWinner ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs">
                            <Sparkles className="w-2.5 h-2.5 text-emerald-600" />
                            SUPER-TREND
                          </span>
                        ) : stock.rebalanceStatus === 'slipped_exit' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                            <AlertTriangle className="w-2.5 h-2.5 text-rose-600" />
                            EXIT TRIGGER
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                            Non-Overlap
                          </span>
                        )}

                        {/* Rebalance badge */}
                        {stock.rebalanceStatus === 'slipped_exit' && (
                          <span className="text-[9px] text-rose-600 font-semibold">
                            Slipped out of 1M/3M
                          </span>
                        )}
                        {stock.rebalanceStatus === 'new_entrant' && (
                          <span className="text-[9px] text-emerald-700 font-semibold">
                            + New Entrant
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Action Arrow */}
                    <td className="py-3 px-2 text-right">
                      <div className="p-1 rounded text-slate-400 group-hover:text-slate-900 group-hover:bg-slate-100 inline-block transition-colors">
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {stocks.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex items-center gap-3">
            <span>
              Showing <strong className="text-slate-900">{startIndex + 1}</strong> to{' '}
              <strong className="text-slate-900">{Math.min(startIndex + pageSize, stocks.length)}</strong> of{' '}
              <strong className="text-slate-900">{stocks.length}</strong> stocks
            </span>

            <div className="flex items-center gap-1.5 pl-3 border-l border-slate-200">
              <span className="text-slate-500">Per page:</span>
              <select
                id="select-page-size"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-white border border-slate-200 rounded px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={500}>All ({stocks.length})</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              id="btn-prev-page"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={validCurrentPage <= 1}
              className="px-2.5 py-1 rounded bg-white border border-slate-200 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>

            <span className="px-2 text-slate-500">
              Page <strong className="text-slate-900">{validCurrentPage}</strong> of{' '}
              <strong className="text-slate-900">{totalPages}</strong>
            </span>

            <button
              id="btn-next-page"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={validCurrentPage >= totalPages}
              className="px-2.5 py-1 rounded bg-white border border-slate-200 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
