import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, AlertTriangle, RefreshCw, ShieldCheck, Search } from 'lucide-react';
import { CrossSourceQuoteComparison, StockRecord } from '../types';
import {
  verifyQuoteCrossSource,
  cherryPickRandomStocksForAudit,
  EOD_CLOSE_TOLERANCE_PCT,
  INTRADAY_CMP_TOLERANCE_PCT,
} from '../utils/crossSourceVerification';

interface CrossSourceAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  universe: StockRecord[];
}

export const CrossSourceAuditModal: React.FC<CrossSourceAuditModalProps> = ({
  isOpen,
  onClose,
  universe,
}) => {
  const [audits, setAudits] = useState<CrossSourceQuoteComparison[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [customTicker, setCustomTicker] = useState('');
  const [customAudit, setCustomAudit] = useState<CrossSourceQuoteComparison | null>(null);

  const runRandomAudit = async () => {
    setIsLoading(true);
    try {
      const results = await cherryPickRandomStocksForAudit(universe, 5, Date.now());
      setAudits(results);
    } catch (err) {
      console.error('Audit failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      runRandomAudit();
      setCustomAudit(null);
      setCustomTicker('');
    }
  }, [isOpen]);

  const handleAuditCustomStock = async () => {
    const clean = customTicker.trim().toUpperCase();
    if (!clean) return;
    const found = universe.find((s) => s.ticker === clean || s.symbol.replace(/\.NS$/, '') === clean);
    if (found) {
      const res = await verifyQuoteCrossSource(found);
      setCustomAudit(res);
    } else {
      alert(`Stock ${clean} not found in current active universe`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Cross-Source Quote Verification &amp; Price Reconciliation
              </h2>
              <p className="text-xs text-slate-500">
                Dual-layer validation: Strict EOD Settlement (≤ 0.20%) &amp; Live Intraday CMP (≤ 1.25%)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {/* Dual Tolerance Policy Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* EOD Rule Card */}
            <div className="p-3.5 rounded-xl bg-emerald-50/80 border border-emerald-200 text-emerald-950 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-emerald-900 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  EOD Last Close Benchmark
                </span>
                <span className="font-mono font-bold text-[10px] bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded-full">
                  Tolerance: ≤ {EOD_CLOSE_TOLERANCE_PCT}%
                </span>
              </div>
              <p className="text-[11px] text-emerald-800 leading-relaxed">
                <strong>Quant Formula Foundation:</strong> All momentum calculations (1M, 3M, 1Y, and 52W high proximity) anchor to the settled session closing price. All sources must share exactly identical values (strict limit ≤ 0.20%).
              </p>
            </div>

            {/* Live CMP Rule Card */}
            <div className="p-3.5 rounded-xl bg-blue-50/80 border border-blue-200 text-blue-950 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-blue-900 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                  Live CMP Market Hours
                </span>
                <span className="font-mono font-bold text-[10px] bg-blue-200 text-blue-900 px-2 py-0.5 rounded-full">
                  Tolerance: ≤ {INTRADAY_CMP_TOLERANCE_PCT}%
                </span>
              </div>
              <p className="text-[11px] text-blue-800 leading-relaxed">
                <strong>Intraday Price Feed:</strong> Accounts for normal exchange tick latency, bid-ask spread variance, and 15-minute delayed stream intervals between primary and secondary market feeds.
              </p>
            </div>
          </div>

          {/* Random Cherry-Pick Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Random Cherry-Picked Stocks ({audits.length} Audited)
              </h3>
              <button
                onClick={runRandomAudit}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-slate-600 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Cherry Pick Another 5 Stocks</span>
              </button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
                    <th className="py-2.5 px-3">Ticker</th>
                    <th className="py-2.5 px-3 text-right">Settled Last Close (₹)</th>
                    <th className="py-2.5 px-3 text-right">Close Diff (≤0.2%)</th>
                    <th className="py-2.5 px-3 text-right">Live CMP (₹)</th>
                    <th className="py-2.5 px-3 text-right">CMP Diff (≤1.25%)</th>
                    <th className="py-2.5 px-3 text-center">Audit Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {audits.map((item) => (
                    <tr key={item.ticker} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-3 font-bold text-slate-900 font-sans">
                        {item.ticker}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-900 font-bold">
                        ₹{item.appLastClose.toLocaleString('en-IN', { minimumFractionDigits: 1 })}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span
                          className={`font-semibold ${
                            item.isCloseConsistent ? 'text-emerald-700' : 'text-rose-600 font-bold'
                          }`}
                        >
                          {item.closeDiscrepancyPct.toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-900 font-bold">
                        ₹{item.appCmp.toLocaleString('en-IN', { minimumFractionDigits: 1 })}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span
                          className={`font-semibold ${
                            item.isCmpConsistent ? 'text-blue-700' : 'text-rose-600 font-bold'
                          }`}
                        >
                          {item.cmpDiscrepancyPct.toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center font-sans">
                        {item.isConsistent ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            VERIFIED
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                            <AlertTriangle className="w-3 h-3 text-rose-600" />
                            DIVERGENT
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Audit Any Specific Stock */}
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Audit Any Specific Stock (e.g. TRENT, ETERNAL, TMPV, RELIANCE)
            </h3>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={customTicker}
                  onChange={(e) => setCustomTicker(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAuditCustomStock()}
                  placeholder="Enter NSE Ticker Symbol (e.g. TRENT)"
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50 font-mono uppercase"
                />
              </div>
              <button
                onClick={handleAuditCustomStock}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white transition-colors"
              >
                Run Dual Audit
              </button>
            </div>

            {customAudit && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 text-sm">{customAudit.ticker}</span>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      customAudit.isConsistent
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {customAudit.isConsistent ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                    )}
                    {customAudit.isConsistent ? 'ALL FEEDS VERIFIED' : 'DISCREPANCY FLAGGED'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <div className="text-[10px] text-slate-500 font-semibold">Settled Last Close</div>
                    <div className="text-xs font-bold font-mono text-slate-900">₹{customAudit.appLastClose}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Quant Anchor</div>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <div className="text-[10px] text-slate-500 font-semibold">Last Close Diff</div>
                    <div
                      className={`text-xs font-bold font-mono ${
                        customAudit.isCloseConsistent ? 'text-emerald-700' : 'text-rose-600'
                      }`}
                    >
                      {customAudit.closeDiscrepancyPct}%
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Limit: ≤ 0.20%</div>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <div className="text-[10px] text-slate-500 font-semibold">Live Market CMP</div>
                    <div className="text-xs font-bold font-mono text-slate-900">₹{customAudit.appCmp}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Market Hours</div>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <div className="text-[10px] text-slate-500 font-semibold">CMP Diff</div>
                    <div
                      className={`text-xs font-bold font-mono ${
                        customAudit.isCmpConsistent ? 'text-blue-700' : 'text-rose-600'
                      }`}
                    >
                      {customAudit.cmpDiscrepancyPct}%
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Limit: ≤ 1.25%</div>
                  </div>
                </div>

                <p className="text-[11px] text-slate-600 italic bg-white p-2.5 rounded-lg border border-slate-200">
                  {customAudit.note}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            Strict tolerance applied: EOD Settlement ≤ 0.20% | Market Hours CMP ≤ 1.25%.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
          >
            Close Audit
          </button>
        </div>
      </div>
    </div>
  );
};
