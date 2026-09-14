import React from 'react';
import { X, RefreshCw, AlertTriangle, CheckCircle2, ArrowRight, ShieldAlert, Sparkles, TrendingUp } from 'lucide-react';
import { StockRecord } from '../types';

interface RebalanceSimulatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  processedStocks: StockRecord[];
  cutoffRank: number;
  onOpenBacktest?: () => void;
}

export const RebalanceSimulatorModal: React.FC<RebalanceSimulatorModalProps> = ({
  isOpen,
  onClose,
  processedStocks,
  cutoffRank,
  onOpenBacktest,
}) => {
  if (!isOpen) return null;

  // Segment stocks based on their rebalance status
  const exitTriggers = processedStocks.filter((s) => s.rebalanceStatus === 'slipped_exit');
  const newEntrants = processedStocks.filter((s) => s.rebalanceStatus === 'new_entrant' && s.isOverlappingWinner);
  const retainedHoldings = processedStocks.filter(
    (s) => (s.rebalanceStatus === 'retained' || s.isOverlappingWinner) && s.rebalanceStatus !== 'new_entrant'
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-start justify-between bg-slate-50/50 rounded-t-2xl">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-100 text-amber-800">
                <RefreshCw className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                  Monthly Rebalance &amp; Exit Watchdog
                </h2>
                <p className="text-xs text-slate-500">
                  Step 5.2: The &quot;Momentum Refresh&quot; — Protecting against sharp momentum reversals
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
        <div className="p-5 space-y-5 text-xs">
          {/* Rule Alert Banner */}
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-bold text-amber-900">
                The Golden Momentum Sell Rule
              </h4>
              <p className="text-amber-800 leading-relaxed">
                Momentum crashes happen fast when institutional inflows dry up. If a held stock slips out of the <strong className="font-semibold">Top 25% ranking in either the 1-month or 3-month horizon</strong>, exit immediately to protect gains.
              </p>
            </div>
          </div>

          {/* Section 1: Immediate Exit Triggers */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Immediate Sell Alerts ({exitTriggers.length} Slipped Stocks)</span>
              </h3>
              <span className="text-[10px] text-rose-600 bg-rose-50 px-2 py-0.5 rounded font-semibold border border-rose-200">
                Action: EXIT IMMEDIATELY
              </span>
            </div>

            {exitTriggers.length === 0 ? (
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 text-center">
                No active holdings have breached the sell threshold this period.
              </div>
            ) : (
              <div className="divide-y divide-rose-100 border border-rose-200 rounded-xl bg-rose-50/40 overflow-hidden">
                {exitTriggers.map((s) => (
                  <div key={s.id} className="p-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{s.ticker}</span>
                        <span className="text-[10px] text-slate-500 font-mono">{s.symbol}</span>
                        <span className="text-[10px] font-semibold text-rose-700 bg-rose-100 px-1.5 py-0.2 rounded">
                          Slipped Rank
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        1M Rank: #{s.rank1M} | 3M Rank: #{s.rank3M} (Threshold: #{cutoffRank})
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-slate-900">₹{s.cmp.toFixed(1)}</div>
                      <div className="text-[10px] text-rose-600 font-semibold">
                        Reversal detected
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: New Entrants (Fresh Breakouts) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <span>New Entrants to Super-Trend ({newEntrants.length} Stocks)</span>
              </h3>
              <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-semibold border border-emerald-200">
                Action: BUY CANDIDATE
              </span>
            </div>

            {newEntrants.length === 0 ? (
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 text-center">
                No newly promoted stocks this monthly cycle.
              </div>
            ) : (
              <div className="divide-y divide-emerald-100 border border-emerald-200 rounded-xl bg-emerald-50/40 overflow-hidden">
                {newEntrants.map((s) => (
                  <div key={s.id} className="p-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{s.ticker}</span>
                        <span className="text-[10px] text-slate-500 font-mono">{s.symbol}</span>
                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded">
                          Fresh Multi-Timeframe Winner
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        {s.sector} • 1M: +{s.return1M.toFixed(1)}% | 3M: +{s.return3M.toFixed(1)}%
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-slate-900">₹{s.cmp.toFixed(1)}</div>
                      <div className="text-[10px] text-emerald-700 font-semibold">
                        Within {Math.abs(s.pctFrom52WHigh || 0).toFixed(1)}% of 52W High
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 3: Retained Leaders */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-slate-600" />
              <span>Retained Multi-Timeframe Compounders ({retainedHoldings.length} Stocks)</span>
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {retainedHoldings.slice(0, 9).map((s) => (
                <div key={s.id} className="p-2.5 rounded-lg border border-slate-200 bg-white flex justify-between items-center">
                  <div>
                    <span className="font-bold text-slate-900">{s.ticker}</span>
                    <div className="text-[10px] text-slate-400 truncate max-w-[100px]">{s.sector}</div>
                  </div>
                  <span className="font-mono font-semibold text-emerald-600">
                    +{s.return3M.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50 rounded-b-2xl">
          {onOpenBacktest ? (
            <button
              onClick={() => {
                onClose();
                onOpenBacktest();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors"
            >
              <TrendingUp className="w-3.5 h-3.5 text-indigo-200" />
              <span>Simulate Cadence in 10Y Backtester →</span>
            </button>
          ) : <div />}

          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
          >
            Close Watchdog
          </button>
        </div>
      </div>
    </div>
  );
};
