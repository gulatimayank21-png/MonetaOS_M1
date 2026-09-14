import React, { useState, useEffect } from 'react';
import { X, Copy, Check, CheckCircle2, XCircle, TrendingUp, ShieldAlert, Target, Calculator, RefreshCw, Radio, ShieldCheck, FileCheck, HelpCircle } from 'lucide-react';
import { StockRecord, SectorTailwindInfo, CrossSourceQuoteComparison } from '../types';
import { resolveCorporateAction } from '../utils/corporateActions';
import { verifyQuoteCrossSource } from '../utils/crossSourceVerification';

interface StockDetailModalProps {
  stock: StockRecord | null;
  onClose: () => void;
  sectorTailwinds: SectorTailwindInfo[];
  cutoffRank: number;
  maxDistance52WHigh: number;
  onUpdateStock?: (updatedStock: Partial<StockRecord> & { ticker: string }) => void;
}

export const StockDetailModal: React.FC<StockDetailModalProps> = ({
  stock,
  onClose,
  sectorTailwinds,
  cutoffRank,
  maxDistance52WHigh,
  onUpdateStock,
}) => {
  const [copied, setCopied] = useState(false);
  const [allocatedCapital, setAllocatedCapital] = useState<number>(100000);
  const [isLoadingLive, setIsLoadingLive] = useState(false);
  const [liveSuccessMsg, setLiveSuccessMsg] = useState<string | null>(null);
  const [liveErrorMsg, setLiveErrorMsg] = useState<string | null>(null);

  // Cross-source audit state
  const [isAuditing, setIsAuditing] = useState(false);
  const [crossAuditResult, setCrossAuditResult] = useState<CrossSourceQuoteComparison | null>(null);

  if (!stock) return null;

  const corpActionRes = resolveCorporateAction(stock.ticker);
  const tailwind = sectorTailwinds.find((st) => st.sector === stock.sector);
  const dist52W = stock.pctFrom52WHigh || 0;
  const isWithin52W = Math.abs(dist52W) <= maxDistance52WHigh;

  const pass1M = (stock.rank1M || 999) <= cutoffRank;
  const pass3M = (stock.rank3M || 999) <= cutoffRank;
  const pass1Y = (stock.rank1Y || 999) <= cutoffRank;

  // Single position sizing calculation based on lastClose or CMP
  const basePrice = stock.lastClose || stock.cmp;
  const shares = Math.max(1, Math.floor(allocatedCapital / basePrice));
  const investedAmount = shares * basePrice;
  const stopLossPrice = Number((basePrice * 0.92).toFixed(1)); // -8%
  const targetPrice = Number((basePrice * 1.25).toFixed(1)); // +25%

  const copySymbol = () => {
    navigator.clipboard.writeText(stock.symbol);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRunCrossAudit = async () => {
    setIsAuditing(true);
    try {
      const res = await verifyQuoteCrossSource(stock);
      setCrossAuditResult(res);
    } catch (err: any) {
      console.error('Audit failed:', err);
    } finally {
      setIsAuditing(false);
    }
  };

  const handleFetchLiveQuote = async () => {
    setIsLoadingLive(true);
    setLiveSuccessMsg(null);
    setLiveErrorMsg(null);

    try {
      const res = await fetch(`/api/live-quote/${stock.ticker}`);
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const json = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.error || 'Failed to fetch live quote');
      }

      const d = json.data;
      const changePct = Number((((d.cmp - d.lastClose) / d.lastClose) * 100).toFixed(1));

      if (onUpdateStock) {
        onUpdateStock({
          ticker: stock.ticker,
          lastClose: d.lastClose,
          cmp: d.cmp,
          cmpChangePct: changePct,
          high52w: d.high52w,
          low52w: d.low52w,
          return1M: d.return1M,
          return3M: d.return3M,
          return1Y: d.return1Y,
        });
      }

      setLiveSuccessMsg(`Live quote synced! CMP: ₹${d.cmp.toLocaleString('en-IN')} (Last Close: ₹${d.lastClose.toLocaleString('en-IN')})`);
      setTimeout(() => setLiveSuccessMsg(null), 4000);
    } catch (err: any) {
      setLiveErrorMsg(`Live sync error: ${err.message}`);
      setTimeout(() => setLiveErrorMsg(null), 4000);
    } finally {
      setIsLoadingLive(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-start justify-between bg-slate-50/50 rounded-t-2xl">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold text-slate-900 tracking-tight font-mono">
                {stock.ticker}
              </h2>
              <button
                onClick={copySymbol}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 font-mono transition-colors"
                title="Copy symbol for Python yfinance / Broker"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                <span>{stock.symbol}</span>
              </button>
              {(corpActionRes.isin || stock.isin) && (
                <span className="text-[11px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200" title="International Securities Identification Number">
                  ISIN: {corpActionRes.isin || stock.isin}
                </span>
              )}
              {stock.isOverlappingWinner && (
                <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-300">
                  ★ Super-Trend Winner
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600 mt-1">
              {stock.name} • {stock.sector} • <span className="font-medium">{stock.category}</span>
            </p>
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
          {/* Real-time Market Sync Banner */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-slate-900 text-white border border-slate-800">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <div>
                <span className="text-xs font-semibold text-white block">
                  Live Market Data Feed Available
                </span>
                <span className="text-[10px] text-slate-400">
                  Connects to Yahoo Finance ({stock.ticker}.NS) for real-time CMP &amp; 52W metrics
                </span>
              </div>
            </div>

            <button
              onClick={handleFetchLiveQuote}
              disabled={isLoadingLive}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLive ? 'animate-spin' : ''}`} />
              <span>{isLoadingLive ? 'Fetching NSE...' : 'Fetch Live NSE Quote'}</span>
            </button>
          </div>

          {liveSuccessMsg && (
            <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-medium flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{liveSuccessMsg}</span>
            </div>
          )}

          {liveErrorMsg && (
            <div className="p-2.5 rounded-lg bg-rose-50 text-rose-800 border border-rose-200 text-xs font-medium flex items-center gap-2 animate-in fade-in">
              <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{liveErrorMsg}</span>
            </div>
          )}

          {/* Broker-Grade Corporate Action Card (Zerodha / Angel One standard) */}
          {(corpActionRes.wasAdjusted || stock.corporateActionNote) && (
            <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-200/90 text-amber-950 flex items-start gap-3 animate-in fade-in">
              <FileCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">
                    Corporate Action Handled (Broker Standard)
                  </span>
                  <span className="text-[11px] text-amber-800">
                    ISIN: <strong>{corpActionRes.isin || stock.isin}</strong>
                  </span>
                </div>
                <p className="text-[11px] text-amber-900 leading-relaxed">
                  {corpActionRes.brokerNote || stock.corporateActionNote || 'Price and constituent series normalized to reflect post-corporate action trading range.'}
                </p>
              </div>
            </div>
          )}

          {/* Cross-Source Price Audit Section */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <div>
                  <span className="text-xs font-bold text-slate-800 block">
                    Dual-Layer Quote Audit
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    Last Close (≤ 0.20%) &bull; Live CMP (≤ 1.25%)
                  </span>
                </div>
              </div>
              <button
                onClick={handleRunCrossAudit}
                disabled={isAuditing}
                className="text-[11px] font-semibold px-2.5 py-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 transition-colors disabled:opacity-50"
              >
                {isAuditing ? 'Auditing Feeds...' : 'Audit Cross-Source'}
              </button>
            </div>

            {crossAuditResult && (
              <div className="pt-2 border-t border-slate-200/80 space-y-2 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="bg-white p-2 rounded border border-slate-200">
                    <span className="text-[10px] text-slate-400 block">Last Close</span>
                    <span className="font-mono font-bold text-slate-800">₹{crossAuditResult.appLastClose}</span>
                  </div>
                  <div className="bg-white p-2 rounded border border-slate-200">
                    <span className="text-[10px] text-slate-400 block">Close Diff (≤0.2%)</span>
                    <span className={`font-mono font-bold ${crossAuditResult.isCloseConsistent ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {crossAuditResult.closeDiscrepancyPct}% {crossAuditResult.isCloseConsistent ? '✓' : '⚠'}
                    </span>
                  </div>
                  <div className="bg-white p-2 rounded border border-slate-200">
                    <span className="text-[10px] text-slate-400 block">Live CMP</span>
                    <span className="font-mono font-bold text-slate-800">₹{crossAuditResult.appCmp}</span>
                  </div>
                  <div className="bg-white p-2 rounded border border-slate-200">
                    <span className="text-[10px] text-slate-400 block">CMP Diff (≤1.25%)</span>
                    <span className={`font-mono font-bold ${crossAuditResult.isCmpConsistent ? 'text-blue-600' : 'text-rose-600'}`}>
                      {crossAuditResult.cmpDiscrepancyPct}% {crossAuditResult.isCmpConsistent ? '✓' : '⚠'}
                    </span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-600 bg-white p-2 rounded border border-slate-200 italic">
                  {crossAuditResult.note}
                </p>
              </div>
            )}
          </div>

          {/* Price & 52-Week High Range */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Last Session Close */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Last Session Close
              </span>
              <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                ₹{(stock.lastClose || stock.cmp).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5 font-medium">
                Quant Calculation Anchor
              </div>
            </div>

            {/* CMP 15-min delayed */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                CMP (15m Delayed)
              </span>
              <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                ₹{stock.cmp.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </div>
              <div className="text-[10px] mt-0.5 flex items-center gap-1 font-mono font-semibold">
                <span className={(stock.cmpChangePct || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                  {(stock.cmpChangePct || 0) >= 0 ? '+' : ''}
                  {(stock.cmpChangePct || 0).toFixed(1)}%
                </span>
                <span className="text-slate-400 font-normal">vs Last Close</span>
              </div>
            </div>

            {/* 52W High */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                52W High &amp; Proximity
              </span>
              <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                ₹{stock.high52w.toLocaleString('en-IN')}
              </div>
              <div
                className={`text-[10px] font-semibold font-mono mt-0.5 ${
                  isWithin52W ? 'text-emerald-700' : 'text-slate-600'
                }`}
              >
                {dist52W >= 0 ? 'At 52W High' : `${dist52W.toFixed(1)}% from High`}
              </div>
            </div>

            {/* Composite Momentum Score with Calculation Tooltip */}
            <div className="p-3.5 rounded-xl bg-indigo-50/50 border border-indigo-200/80 relative group/modalScore cursor-help">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-indigo-900 uppercase tracking-wider block">
                  Composite Score
                </span>
                <HelpCircle className="w-3.5 h-3.5 text-indigo-500 group-hover/modalScore:text-indigo-700 transition-colors" />
              </div>
              <div className="text-xl font-bold font-mono text-indigo-950 mt-1">
                {stock.compositeMomentumScore} <span className="text-xs font-normal text-indigo-700">/ 100</span>
              </div>
              <div className="text-[10px] text-indigo-800 font-medium mt-0.5">
                30% 1M + 35% 3M + 35% 1Y
              </div>

              {/* Tooltip on Hover */}
              <div className="hidden group-hover/modalScore:block absolute right-0 top-full mt-1.5 w-72 p-3 bg-slate-900 text-white text-[11px] rounded-xl shadow-xl z-50 text-left normal-case font-normal border border-slate-700 leading-relaxed animate-in fade-in">
                <span className="font-bold text-emerald-400 block mb-1">How This Score Is Calculated</span>
                <p className="text-slate-300 text-[11px] mb-1.5">
                  Blended multi-timeframe percentile score weighted across the active universe:
                </p>
                <div className="space-y-1 font-mono text-[10px] bg-slate-800 p-2 rounded-lg border border-slate-700 text-slate-200">
                  <div className="flex justify-between">
                    <span className="text-slate-400">1M Percentile (30% wt):</span>
                    <span>{stock.percentile1M?.toFixed(1)}%ile → +{(0.3 * (stock.percentile1M || 0)).toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">3M Percentile (35% wt):</span>
                    <span>{stock.percentile3M?.toFixed(1)}%ile → +{(0.35 * (stock.percentile3M || 0)).toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">1Y Percentile (35% wt):</span>
                    <span>{stock.percentile1Y?.toFixed(1)}%ile → +{(0.35 * (stock.percentile1Y || 0)).toFixed(1)}</span>
                  </div>
                  <div className="pt-1 border-t border-slate-700 font-bold text-emerald-300 flex justify-between">
                    <span>Total Score:</span>
                    <span>{stock.compositeMomentumScore} / 100</span>
                  </div>
                </div>
                <p className="text-slate-400 text-[9px] mt-1.5 font-mono">
                  Formula: (0.30 × P₁ₘ) + (0.35 × P₃ₘ) + (0.35 × P₁ᵧ)
                </p>
              </div>
            </div>
          </div>

          {/* Strategy Qualification Checklist */}
          <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Target className="w-4 h-4 text-emerald-600" />
              <span>Super-Trend Strategy Rule Verification</span>
            </h4>

            <div className="space-y-2.5">
              {/* 1M Check */}
              <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-white border border-slate-200/80">
                <div className="flex items-center gap-2">
                  {pass1M ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-800">1-Month Return in Top Tier:</span>
                    <span className="ml-1 text-slate-600">
                      Rank #{stock.rank1M} (Top {stock.percentile1M?.toFixed(0)}%)
                    </span>
                  </div>
                </div>
                <span
                  className={`font-mono font-bold ${
                    stock.return1M >= 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  +{stock.return1M.toFixed(1)}%
                </span>
              </div>

              {/* 3M Check */}
              <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-white border border-slate-200/80">
                <div className="flex items-center gap-2">
                  {pass3M ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-800">3-Month Return in Top Tier:</span>
                    <span className="ml-1 text-slate-600">
                      Rank #{stock.rank3M} (Top {stock.percentile3M?.toFixed(0)}%)
                    </span>
                  </div>
                </div>
                <span
                  className={`font-mono font-bold ${
                    stock.return3M >= 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  +{stock.return3M.toFixed(1)}%
                </span>
              </div>

              {/* 1Y Check */}
              <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-white border border-slate-200/80">
                <div className="flex items-center gap-2">
                  {pass1Y ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-800">1-Year Return in Top Tier:</span>
                    <span className="ml-1 text-slate-600">
                      Rank #{stock.rank1Y} (Top {stock.percentile1Y?.toFixed(0)}%)
                    </span>
                  </div>
                </div>
                <span
                  className={`font-mono font-bold ${
                    stock.return1Y >= 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  +{stock.return1Y.toFixed(1)}%
                </span>
              </div>

              {/* 52W High Rule */}
              <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-white border border-slate-200/80">
                <div className="flex items-center gap-2">
                  {isWithin52W ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-800">52-Week High Rule:</span>
                    <span className="ml-1 text-slate-600">
                      Must trade within {maxDistance52WHigh}% of 52W High
                    </span>
                  </div>
                </div>
                <span
                  className={`font-mono font-bold ${
                    isWithin52W ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {dist52W.toFixed(1)}%
                </span>
              </div>

              {/* Sector Tailwind Check */}
              <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-white border border-slate-200/80">
                <div className="flex items-center gap-2">
                  {tailwind?.isTailwind ? (
                    <CheckCircle2 className="w-4 h-4 text-purple-600 shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-slate-300 shrink-0 flex items-center justify-center text-[9px] text-slate-400">
                      -
                    </div>
                  )}
                  <div>
                    <span className="font-semibold text-slate-800">Sector Tailwinds Indicator:</span>
                    <span className="ml-1 text-slate-600">
                      {stock.sector} ({tailwind ? `${tailwind.overlappingCount} in Overlap` : '0 in Overlap'})
                    </span>
                  </div>
                </div>
                <span className="text-xs font-semibold text-purple-700">
                  {tailwind?.isTailwind ? 'Tailwind Active' : 'Neutral'}
                </span>
              </div>
            </div>
          </div>

          {/* Position Sizer & Risk Management */}
          <div className="rounded-xl border border-slate-200 p-4 bg-slate-900 text-white">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-emerald-400">
                <Calculator className="w-4 h-4" />
                <span>Single Position Sizing &amp; Exit Targets</span>
              </h4>
              <span className="text-[11px] text-slate-400">Equal Weighting Helper</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">
                  Allocated Capital for {stock.ticker} (₹)
                </label>
                <input
                  type="number"
                  min="5000"
                  step="5000"
                  value={allocatedCapital}
                  onChange={(e) => setAllocatedCapital(Math.max(1000, Number(e.target.value)))}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1.5 bg-slate-800/80 p-3 rounded-lg border border-slate-700">
                <div className="flex justify-between">
                  <span className="text-slate-400">Quantity to Buy:</span>
                  <span className="font-mono font-bold text-white text-sm">{shares} shares</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Actual Outlay:</span>
                  <span className="font-mono text-slate-200">
                    ₹{investedAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="flex justify-between text-rose-400">
                  <span>Stop-Loss (-8%):</span>
                  <span className="font-mono font-bold">₹{stopLossPrice}</span>
                </div>
                <div className="flex justify-between text-emerald-400">
                  <span>Target (+25%):</span>
                  <span className="font-mono font-bold">₹{targetPrice}</span>
                </div>
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-slate-800 text-[11px] text-slate-400 leading-relaxed">
              <strong>Quant Rebalance Rule:</strong> Even if stop-loss is untouched, exit immediately if this stock slips out of the Top 25% on either the 1M or 3M horizon during the next monthly refresh.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex justify-end bg-slate-50/50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
};
