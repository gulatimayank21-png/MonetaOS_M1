import React, { useState } from 'react';
import { X, Briefcase, Download, DollarSign, Shield, ArrowRight, Check, TrendingUp, Sparkles } from 'lucide-react';
import { StockRecord, PortfolioAllocation } from '../types';
import { buildEqualWeightPortfolio } from '../utils/quantEngine';

interface PortfolioBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  winners: StockRecord[];
  onOpenBacktest?: (sl: number, target: number) => void;
}

export const PortfolioBuilderModal: React.FC<PortfolioBuilderModalProps> = ({
  isOpen,
  onClose,
  winners,
  onOpenBacktest,
}) => {
  const [config, setConfig] = useState<PortfolioAllocation>({
    totalCapital: 1000000, // 10 Lakhs INR
    topNStocks: Math.min(10, Math.max(1, winners.length)),
    stopLossPct: 8,
    targetGainPct: 25,
  });

  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const { positions, totalInvested, remainingCash } = buildEqualWeightPortfolio(winners, config);

  const downloadCSV = () => {
    const headers = ['Symbol,Ticker,Company,CMP_INR,Weight_Pct,Allocated_INR,Shares,Actual_Invested_INR,StopLoss_INR,Target_INR'];
    const rows = positions.map(
      (p) =>
        `"${p.stock.symbol}","${p.stock.ticker}","${p.stock.name}",${p.stock.cmp},${p.weightPct},${p.allocatedAmount},${p.shares},${p.investedAmount},${p.stopLossPrice},${p.targetPrice}`
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `nifty500_momentum_portfolio_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyOrderBasket = () => {
    const text = positions.map((p) => `${p.stock.ticker}: ${p.shares} shares @ ~₹${p.stock.cmp}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-start justify-between bg-slate-50/50 rounded-t-2xl">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800">
                <Briefcase className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                  Equal-Weight Momentum Portfolio Allocator
                </h2>
                <p className="text-xs text-slate-500">
                  Step 5 Risk Management: Equal weighting across top overlapping momentum winners
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
          {/* Controls Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Total Capital (₹ INR)
              </label>
              <input
                type="number"
                min="50000"
                step="50000"
                value={config.totalCapital}
                onChange={(e) => setConfig({ ...config, totalCapital: Math.max(10000, Number(e.target.value)) })}
                className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
              />
              <div className="text-[10px] text-slate-400 mt-0.5">
                ₹{(config.totalCapital / 100000).toFixed(1)} Lakhs
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Portfolio Size (Top N)
              </label>
              <select
                value={config.topNStocks}
                onChange={(e) => setConfig({ ...config, topNStocks: Number(e.target.value) })}
                className="w-full px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
              >
                {[5, 8, 10, 12, 15, 20].map((n) => (
                  <option key={n} value={n} disabled={n > winners.length}>
                    Top {n} Stocks ({n <= winners.length ? `${(100 / n).toFixed(1)}% each` : 'Not enough winners'})
                  </option>
                ))}
              </select>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {winners.length} winners available
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Stop-Loss Exit Rule (%)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="3"
                  max="20"
                  value={config.stopLossPct}
                  onChange={(e) => setConfig({ ...config, stopLossPct: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-rose-600"
                />
                <span className="text-xs font-semibold text-slate-500">%</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Fixed safety stop</div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Target Objective (%)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="10"
                  max="100"
                  value={config.targetGainPct}
                  onChange={(e) => setConfig({ ...config, targetGainPct: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-emerald-600"
                />
                <span className="text-xs font-semibold text-slate-500">%</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Momentum runner</div>
            </div>
          </div>

          {/* 3:1 Risk-to-Reward Rationale & 10Y Backtest CTA */}
          <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <div className="text-xs">
                <span className="font-bold text-indigo-950">
                  3:1 Asymmetric Risk-Reward ({config.targetGainPct}% Gain / {config.stopLossPct}% Stop Loss = {(config.targetGainPct / (config.stopLossPct || 1)).toFixed(1)}:1 Ratio)
                </span>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Protects against momentum crashes while capturing explosive trend continuations. Requires only ~30% win-rate to generate persistent portfolio alpha.
                </p>
              </div>
            </div>
            {onOpenBacktest && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenBacktest(config.stopLossPct, config.targetGainPct);
                }}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs shrink-0 transition-colors"
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Simulate 10Y Backtest →</span>
              </button>
            )}
          </div>

          {/* Capital Allocation Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-slate-900 text-white flex justify-between items-center">
              <div>
                <span className="text-[11px] text-slate-400 font-medium">Invested Outlay</span>
                <div className="text-xl font-mono font-bold text-white">
                  ₹{totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {((totalInvested / config.totalCapital) * 100).toFixed(1)}%
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 flex justify-between items-center">
              <div>
                <span className="text-[11px] text-slate-500 font-medium">Uninvested Cash Buffer</span>
                <div className="text-xl font-mono font-bold text-slate-900">
                  ₹{remainingCash.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {((remainingCash / config.totalCapital) * 100).toFixed(1)}%
              </span>
            </div>

            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex justify-between items-center">
              <div>
                <span className="text-[11px] text-emerald-700 font-medium">Target per Stock</span>
                <div className="text-xl font-mono font-bold text-emerald-800">
                  ₹{(config.totalCapital / config.topNStocks).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
              </div>
              <span className="text-xs font-bold text-emerald-700 font-mono">
                {(100 / config.topNStocks).toFixed(1)}% each
              </span>
            </div>
          </div>

          {/* Allocation Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
                  <tr>
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Stock Symbol</th>
                    <th className="py-2.5 px-3">Sector</th>
                    <th className="py-2.5 px-3 text-right" title="Last Completed Trading Session Close">Last Close (₹)</th>
                    <th className="py-2.5 px-3 text-right" title="Current Market Price (15-min delayed)">Live CMP (₹)</th>
                    <th className="py-2.5 px-3 text-right">Weight</th>
                    <th className="py-2.5 px-3 text-right">Shares to Buy</th>
                    <th className="py-2.5 px-3 text-right">Actual Outlay (₹)</th>
                    <th className="py-2.5 px-3 text-right">Stop Loss (-{config.stopLossPct}%)</th>
                    <th className="py-2.5 px-3 text-right">Target (+{config.targetGainPct}%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {positions.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-slate-400">
                        No overlapping winners currently qualified. Relax filters to view candidates.
                      </td>
                    </tr>
                  ) : (
                    positions.map((pos, idx) => (
                      <tr key={pos.stock.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-mono text-slate-400">{idx + 1}</td>
                        <td className="py-2.5 px-3">
                          <span className="font-bold text-slate-900">{pos.stock.ticker}</span>
                          <span className="text-[10px] text-slate-400 ml-1.5 font-mono">
                            {pos.stock.symbol}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 truncate max-w-[140px]">
                          {pos.stock.sector}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                          ₹{(pos.stock.lastClose || pos.stock.cmp).toFixed(1)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">
                          ₹{pos.stock.cmp.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-medium text-emerald-700">
                          {pos.weightPct}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 bg-emerald-50/50">
                          {pos.shares}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-900">
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
        <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/50 rounded-b-2xl">
          <div className="text-xs text-slate-500">
            <strong>Rebalancing Mandate:</strong> Refresh once a month. Discard any stock that falls out of the Top 25% in 1M or 3M rankings.
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={copyOrderBasket}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : null}
              <span>{copied ? 'Copied Basket!' : 'Copy Order Text'}</span>
            </button>

            <button
              onClick={downloadCSV}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs transition-colors"
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
