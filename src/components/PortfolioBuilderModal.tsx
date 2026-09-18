import React, { useState } from 'react';
import {
  X,
  Briefcase,
  Download,
  Shield,
  ArrowRight,
  Check,
  TrendingUp,
  Sparkles,
  Sliders,
  Flame,
  Award,
  BarChart3,
  Percent,
} from 'lucide-react';
import { StockRecord, PortfolioAllocation, SectorTailwindInfo, PortfolioWeightStrategy } from '../types';
import { buildWeightedPortfolio } from '../utils/quantEngine';

interface PortfolioBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  winners: StockRecord[];
  sectorTailwinds?: SectorTailwindInfo[];
  onOpenBacktest?: (sl: number, target: number) => void;
}

export const PortfolioBuilderModal: React.FC<PortfolioBuilderModalProps> = ({
  isOpen,
  onClose,
  winners,
  sectorTailwinds = [],
  onOpenBacktest,
}) => {
  const [config, setConfig] = useState<PortfolioAllocation>({
    totalCapital: 1000000, // 10 Lakhs INR
    topNStocks: Math.min(10, Math.max(1, winners.length)),
    weightStrategy: 'multi_factor',
    maxPositionWeightPct: 20, // 20% single-stock maximum limit
    tailwindBoostPct: 25, // +25% boost for tailwind sectors
    stopLossPct: 8,
    targetGainPct: 25,
  });

  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const { positions, totalInvested, remainingCash, strategySummary } = buildWeightedPortfolio(
    winners,
    config,
    sectorTailwinds
  );

  const downloadCSV = () => {
    const headers = [
      'Rank,Ticker,Symbol,Company,Sector,Composite_Score,Conviction_Tier,Tailwind_Boost,Weight_Pct,Allocated_INR,Shares,Actual_Invested_INR,StopLoss_INR,Target_INR',
    ];
    const rows = positions.map(
      (p, idx) =>
        `${idx + 1},"${p.stock.ticker}","${p.stock.symbol}","${p.stock.name}","${p.stock.sector}",${p.stock.compositeMomentumScore || 0},"${p.convictionTier || 'Core'}","${p.hasTailwindBoost ? 'YES (+25%)' : 'NO'}",${p.weightPct},${p.allocatedAmount},${p.shares},${p.investedAmount},${p.stopLossPrice},${p.targetPrice}`
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `nifty500_weighted_portfolio_${config.weightStrategy}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyOrderBasket = () => {
    const text = positions
      .map(
        (p, idx) =>
          `#${idx + 1} ${p.stock.ticker}: ${p.shares} shares (~₹${p.investedAmount.toLocaleString('en-IN')}, ${p.weightPct}% weight${p.hasTailwindBoost ? ' • Tailwind Boosted' : ''})`
      )
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getStrategyLabel = (s?: PortfolioWeightStrategy) => {
    switch (s) {
      case 'atr_momentum_parity':
        return 'ATR-Adjusted Momentum (Score / ATR% Volatility Parity ★)';
      case 'atr_inverse_vol':
        return 'ATR Inverse Volatility (Pure Risk Parity)';
      case 'multi_factor':
        return 'Multi-Factor Conviction (Score × Rank Decay × Tailwind Boost)';
      case 'composite_score':
        return 'Composite Score Weighted (Score Proportional)';
      case 'rank_decay':
        return 'Rank-Decay Tiered (Exponential Lead Decile)';
      case 'tailwind_tilted':
        return 'Tailwind-Dominant (Overweight Tailwind Sectors)';
      case 'equal_weight':
      default:
        return 'Equal Weight (1/N Baseline)';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-5xl w-full max-h-[92vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-start justify-between bg-slate-50/50 rounded-t-2xl">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-xs">
                <Briefcase className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                    Quantitative Momentum Portfolio Allocator
                  </h2>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">
                    Step 5 Dynamic Sizing
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Size positions dynamically based on Composite Momentum Scores, Rank Conviction, and Institutional Sector Tailwinds.
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-5">
          {/* Sizing Strategy & Risk Configuration Bar */}
          <div className="bg-slate-50/80 p-4 rounded-xl border border-slate-200 space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-slate-900">
                  Portfolio Weighting & Capital Parameters
                </span>
              </div>
              <span className="text-[11px] text-indigo-700 font-medium font-mono">
                {getStrategyLabel(config.weightStrategy)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {/* Strategy Selector */}
              <div className="lg:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Weighting Strategy
                </label>
                <select
                  value={config.weightStrategy || 'atr_momentum_parity'}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      weightStrategy: e.target.value as PortfolioWeightStrategy,
                    })
                  }
                  className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white text-slate-900 shadow-2xs"
                >
                  <option value="atr_momentum_parity">
                    ★ ATR-Adjusted Momentum (Score / ATR% Volatility Parity)
                  </option>
                  <option value="multi_factor">
                    Multi-Factor Conviction (Score × Rank × Tailwind)
                  </option>
                  <option value="atr_inverse_vol">
                    ATR Inverse Volatility (Pure Risk Parity)
                  </option>
                  <option value="composite_score">
                    Composite Score Proportional (Score³)
                  </option>
                  <option value="rank_decay">
                    Rank-Decay Tiered (Top Heavy)
                  </option>
                  <option value="tailwind_tilted">
                    Tailwind-Dominant (Heavy Sector Overweight)
                  </option>
                  <option value="equal_weight">
                    Equal Weight (1/N Baseline)
                  </option>
                </select>
                <div className="text-[10px] text-slate-500 mt-1">
                  {config.weightStrategy === 'atr_momentum_parity' &&
                    '★ Sizes by Momentum Score divided by 14-day ATR%. Allocates higher capital to smooth compounders and scales down high-whipsaw stocks.'}
                  {config.weightStrategy === 'atr_inverse_vol' &&
                    'Equalizes portfolio risk contribution across high-beta and low-beta stocks using inverse ATR%.'}
                  {config.weightStrategy === 'multi_factor' &&
                    'Allocates higher capital to top scores & rewards confirmed Tailwind sectors with single-stock risk caps.'}
                  {config.weightStrategy === 'composite_score' &&
                    'Sizes positions strictly by composite score spread.'}
                  {config.weightStrategy === 'rank_decay' &&
                    'Decays capital allocation exponentially down the ranking ladder.'}
                  {config.weightStrategy === 'tailwind_tilted' &&
                    'Allocates up to 2x more capital to constituents in institutional tailwind sectors.'}
                  {config.weightStrategy === 'equal_weight' &&
                    'Simple naive 1/N allocation across all selected winners.'}
                </div>
              </div>

              {/* Total Capital */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Total Capital (₹)
                </label>
                <input
                  type="number"
                  min="50000"
                  step="50000"
                  value={config.totalCapital}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      totalCapital: Math.max(10000, Number(e.target.value)),
                    })
                  }
                  className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white"
                />
                <div className="text-[10px] text-slate-500 mt-1">
                  ₹{(config.totalCapital / 100000).toFixed(1)} Lakhs
                </div>
              </div>

              {/* Portfolio Size */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Holdings Count (Top N)
                </label>
                <select
                  value={config.topNStocks}
                  onChange={(e) => setConfig({ ...config, topNStocks: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white"
                >
                  {[5, 8, 10, 12, 15, 20].map((n) => (
                    <option key={n} value={n} disabled={n > winners.length}>
                      Top {n} Stocks ({n <= winners.length ? `${n} selected` : 'Not enough winners'})
                    </option>
                  ))}
                </select>
                <div className="text-[10px] text-slate-500 mt-1">
                  {winners.length} winners available
                </div>
              </div>

              {/* Single Stock Cap */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Max Position Cap
                </label>
                <select
                  value={config.maxPositionWeightPct || 20}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      maxPositionWeightPct: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white"
                >
                  <option value={15}>15% Max per Stock</option>
                  <option value={20}>20% Max per Stock</option>
                  <option value={25}>25% Max per Stock</option>
                  <option value={30}>30% Max per Stock</option>
                  <option value={100}>No Limit (Unconstrained)</option>
                </select>
                <div className="text-[10px] text-slate-500 mt-1">
                  Prevents idiosyncratic risk
                </div>
              </div>
            </div>
          </div>

          {/* Capital & Conviction Strategy Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-900 text-white flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-medium">Invested Outlay</span>
                <span className="text-[11px] text-emerald-400 font-mono font-bold">
                  {((totalInvested / config.totalCapital) * 100).toFixed(1)}% Deployed
                </span>
              </div>
              <div className="mt-2">
                <div className="text-xl font-mono font-bold text-white">
                  ₹{totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                  Cash Reserve: ₹{remainingCash.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-indigo-50/80 border border-indigo-200/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-indigo-900 font-semibold flex items-center gap-1">
                  <Award className="w-3.5 h-3.5 text-indigo-700" />
                  Alpha Weight Spread
                </span>
              </div>
              <div className="mt-2">
                <div className="text-lg font-mono font-bold text-indigo-950">
                  {strategySummary.topPositionWeight.toFixed(1)}% <span className="text-xs text-indigo-600 font-normal">top</span> / {strategySummary.lowestPositionWeight.toFixed(1)}% <span className="text-xs text-indigo-600 font-normal">lowest</span>
                </div>
                <div className="text-[10px] text-indigo-700 mt-0.5">
                  {(strategySummary.topPositionWeight / (strategySummary.lowestPositionWeight || 1)).toFixed(1)}x Conviction Multiple
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-purple-50/80 border border-purple-200/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-purple-900 font-semibold flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 text-purple-700" />
                  Tailwind Overweights
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-200/70 text-purple-800">
                  +{config.tailwindBoostPct || 25}% Boost
                </span>
              </div>
              <div className="mt-2">
                <div className="text-lg font-mono font-bold text-purple-950">
                  {strategySummary.tailwindBoostedCount} Stocks Boosted
                </div>
                <div className="text-[10px] text-purple-700 mt-0.5">
                  Operating in institutional leader sectors
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-50/80 border border-emerald-200/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-emerald-900 font-semibold flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5 text-emerald-700" />
                  Risk-Reward Target
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-200/70 text-emerald-800">
                  3.1:1 Ratio
                </span>
              </div>
              <div className="mt-2">
                <div className="text-lg font-mono font-bold text-emerald-950">
                  +{config.targetGainPct}% / -{config.stopLossPct}%
                </div>
                <div className="text-[10px] text-emerald-700 mt-0.5">
                  Trailing exit on rank drop or target
                </div>
              </div>
            </div>
          </div>

          {/* Allocation Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3"># Rank</th>
                    <th className="py-2.5 px-3">Stock Symbol</th>
                    <th className="py-2.5 px-3">Sector & Tailwind</th>
                    <th className="py-2.5 px-3 text-right">Composite Score</th>
                    <th className="py-2.5 px-3 text-center">Conviction Tier</th>
                    <th className="py-2.5 px-3 text-right" title="Last Completed Trading Session Close">Last Close (₹)</th>
                    <th className="py-2.5 px-3 text-right">Target Weight</th>
                    <th className="py-2.5 px-3 text-right">Shares</th>
                    <th className="py-2.5 px-3 text-right">Allocated Outlay</th>
                    <th className="py-2.5 px-3 text-right">Stop Loss (-{config.stopLossPct}%)</th>
                    <th className="py-2.5 px-3 text-right">Target (+{config.targetGainPct}%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {positions.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-slate-400">
                        No overlapping winners currently qualified. Relax filters to view candidates.
                      </td>
                    </tr>
                  ) : (
                    positions.map((pos, idx) => (
                      <tr key={pos.stock.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-slate-400 font-bold">{idx + 1}</td>
                        <td className="py-2.5 px-3">
                          <span className="font-bold text-slate-900">{pos.stock.ticker}</span>
                          <span className="text-[10px] text-slate-400 ml-1.5 font-mono">
                            {pos.stock.symbol}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-700 truncate max-w-[130px] font-medium">
                              {pos.stock.sector}
                            </span>
                            {pos.hasTailwindBoost && (
                              <span
                                className="text-[9px] font-bold text-purple-700 bg-purple-100 border border-purple-200 px-1.5 py-0.5 rounded shrink-0"
                                title="Institutional Sector Tailwind (+25% capital weight boost)"
                              >
                                Tailwind +25%
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                          {pos.stock.compositeMomentumScore || 85}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              pos.convictionTier === 'High Alpha'
                                ? 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                                : pos.convictionTier === 'Core Momentum'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}
                          >
                            {pos.convictionTier}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">
                          ₹{(pos.stock.lastClose || pos.stock.cmp).toFixed(1)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <span className="font-mono font-bold text-indigo-900 text-xs">
                              {pos.weightPct}%
                            </span>
                            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                              <div
                                className="h-full bg-indigo-600 rounded-full"
                                style={{ width: `${Math.min(100, (pos.weightPct / (strategySummary.topPositionWeight || 1)) * 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 bg-indigo-50/40">
                          {pos.shares}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                          ₹{pos.investedAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-rose-600 font-semibold">
                          ₹{pos.stopLossPrice}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-emerald-600 font-semibold">
                          ₹{pos.targetPrice}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/60 rounded-b-2xl">
          <div className="text-xs text-slate-500">
            <strong>Rebalancing Mandate:</strong> Rebalance dynamically on monthly cadence. Exit any stock slipping out of multi-timeframe leader ranks.
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={copyOrderBasket}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : null}
              <span>{copied ? 'Copied Basket!' : 'Copy Order Text'}</span>
            </button>

            <button
              onClick={downloadCSV}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Allocation CSV</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
