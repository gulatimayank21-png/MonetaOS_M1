import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles, ShieldCheck, Flame, Compass, Target } from 'lucide-react';

export const SummaryComparisonGuide: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="bg-white text-slate-900 rounded-2xl shadow-xs border border-slate-200/90 p-4 transition-all">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-100 shrink-0">
            <Sparkles className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              The Overlapping Momentum Thesis
              <span className="text-[11px] font-semibold text-indigo-800 bg-indigo-50 border border-indigo-200/70 px-2 py-0.5 rounded-full">
                Quant Alpha Strategy
              </span>
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Why multi-timeframe overlap filters out false breakouts and tired momentum
            </p>
          </div>
        </div>

        <button
          id="btn-toggle-guide"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors shadow-2xs"
        >
          <span>{isOpen ? 'Hide Rules' : 'Strategy Rules & Matrix'}</span>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
        </button>
      </div>

      {isOpen && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
          {/* Summary Matrix Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50/80">
                <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  <th className="py-2.5 px-3">Timeframe</th>
                  <th className="py-2.5 px-3">Quant Phenomenon</th>
                  <th className="py-2.5 px-3">What It Tells You</th>
                  <th className="py-2.5 px-3 text-right">Lookback Trading Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 bg-white">
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-emerald-700 flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-emerald-600" /> 1 Year (1Y)
                  </td>
                  <td className="py-2.5 px-3 font-medium text-slate-900">Structural Macro Trend</td>
                  <td className="py-2.5 px-3 text-slate-600">
                    Shows which companies are systematically winning the &quot;macro&quot; game over business cycles.
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-500">~252 Days</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-indigo-700 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" /> 3 Months (3M)
                  </td>
                  <td className="py-2.5 px-3 font-medium text-slate-900">Institutional Accumulation</td>
                  <td className="py-2.5 px-3 text-slate-600">
                    Shows where mutual funds and institutional smart money are aggressively accumulating.
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-500">~63 Days</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-amber-700 flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-amber-600" /> 1 Month (1M)
                  </td>
                  <td className="py-2.5 px-3 font-medium text-slate-900">Retail &amp; Speculative Demand</td>
                  <td className="py-2.5 px-3 text-slate-600">
                    Shows immediate supply-demand imbalance and explosive breakout heat.
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-500">~21 Days</td>
                </tr>
                <tr className="bg-emerald-50/50 font-semibold border-t border-emerald-200/60">
                  <td className="py-2.5 px-3 text-emerald-900 flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-emerald-700" /> 1M ∩ 3M ∩ 1Y Overlap
                  </td>
                  <td className="py-2.5 px-3 text-emerald-950">The Sweet Spot (Persistent Alpha)</td>
                  <td className="py-2.5 px-3 text-emerald-800">
                    Eliminates &quot;flash-in-the-pan&quot; (short 1M pump) and &quot;tired&quot; stocks (1Y gainers reversing). Highest probability of outperformance.
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-emerald-900 font-bold">Top 25% Overlap</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 3 Core Rules */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            <div className="p-3.5 rounded-xl bg-emerald-50/40 border border-emerald-200/80">
              <div className="text-xs font-bold text-emerald-900 mb-1 flex items-center gap-1">
                1. Selection Rule (&quot;Super-Trend&quot;)
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Rank in the <strong className="text-slate-900">Top 25%</strong> of all three horizons simultaneously. Ensures macro uptrend, institutional backing, and immediate breakout momentum.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-amber-50/40 border border-amber-200/80">
              <div className="text-xs font-bold text-amber-900 mb-1 flex items-center gap-1">
                2. Monthly Rebalance &amp; Exit Trigger
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Rebalance monthly. <strong className="text-slate-900">Exit Rule:</strong> If a stock falls out of Top 25% in the 3M or 1M ranking, exit immediately to evade momentum crashes.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-indigo-50/40 border border-indigo-200/80">
              <div className="text-xs font-bold text-indigo-900 mb-1 flex items-center gap-1">
                3. The 52-Week High Rule
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Momentum is strongest when trading near highs with minimal overhead supply. Price must be <strong className="text-slate-900">within 5%</strong> of its 52-week high.
              </p>
            </div>
          </div>

          {/* Pricing Standard Clarity Banner */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-[11px] text-slate-600">
            <span>
              <strong className="text-slate-900">Quant Pricing Standard:</strong> All timeframe returns (1M, 3M, 1Y), percentile rankings, and 52-Week High proximity are calculated against the <strong className="text-slate-900">Last Completed Trading Session Close (EOD)</strong> to prevent intraday tick noise from triggering false signals. The separate <strong className="text-slate-900">CMP (15m Delay)</strong> column provides indicative intraday price discovery.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
