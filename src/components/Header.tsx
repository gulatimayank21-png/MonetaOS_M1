import React, { useState, useRef, useEffect } from 'react';
import {
  TrendingUp,
  Briefcase,
  SlidersHorizontal,
  Code2,
  Upload,
  ChevronDown,
  Sparkles,
  RefreshCw,
  ShieldCheck,
  Globe,
  AlertCircle,
  Database,
} from 'lucide-react';
import { NSEIndexKey, NightlySyncStatus } from '../types';

interface HeaderProps {
  selectedIndex?: NSEIndexKey;
  stockCount?: number;
  onOpenPortfolio: () => void;
  onOpenRebalance: () => void;
  onOpenBacktest: () => void;
  onOpenPythonCode: () => void;
  onOpenUpload: () => void;
  onOpenAuditModal: () => void;
  onOpenDatabaseUpload?: () => void;
  onForceSyncExchange?: () => void;
  isSyncingLive?: boolean;
  winnerCount: number;
}

const DEFAULT_SYNC_STATUS: NightlySyncStatus = {
  lastSuccessfulSync: '2026-09-12T08:04:57.811Z',
  lastActualNSESync: '2026-09-12T08:04:57.811Z',
  lastAttempt: '2026-09-12T08:04:57.811Z',
  status: 'success',
  syncMode: 'live_nse_direct',
  errorMessage: null,
  scheduledCron: 'Daily at 00:00 IST (Official NSE Archive EOD Batch)',
  source: 'Official National Stock Exchange of India (archives.nseindia.com)',
  updatedIndices: ['nifty500', 'nifty50', 'niftynext50', 'niftymidcap150', 'niftysmallcap250'],
  stockCounts: {
    nifty500: 500,
    nifty50: 50,
    niftynext50: 50,
    niftymidcap150: 150,
    niftysmallcap250: 250,
  },
};

export const Header: React.FC<HeaderProps> = ({
  onOpenPortfolio,
  onOpenRebalance,
  onOpenBacktest,
  onOpenPythonCode,
  onOpenUpload,
  onOpenAuditModal,
  onOpenDatabaseUpload,
  onForceSyncExchange,
  isSyncingLive,
  winnerCount,
}) => {
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<NightlySyncStatus>(DEFAULT_SYNC_STATUS);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  // Poll sync status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/universe/sync-status', {
          headers: { Accept: 'application/json' },
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const json = await res.json();
          if (json.success && json.status) {
            setSyncStatus(json.status);
          }
        }
      } catch (err) {
        console.warn('Could not refresh sync status:', err);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [isSyncingLive]);

  // Close tools dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setIsToolsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatShortTime = (isoString?: string) => {
    if (!isoString) return 'Just now';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Just now';
    }
  };

  const isFailed = syncStatus?.status === 'failed';

  return (
    <header className="border-b border-slate-200/90 bg-white/95 backdrop-blur-md sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6">
        {/* Brand & Prominent Identity */}
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white flex items-center justify-center shadow-lg ring-1 ring-slate-700/60 shrink-0 relative group">
            <TrendingUp className="w-7 h-7 sm:w-8 sm:h-8 text-emerald-400 transition-transform group-hover:scale-110" />
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 ring-2 ring-white"></span>
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl sm:text-4xl font-black tracking-tight text-slate-950 font-sans">
                MONETA
              </span>
              <span className="px-2.5 py-0.5 rounded-lg bg-slate-950 text-emerald-400 text-sm sm:text-base font-black tracking-wider font-mono shadow-xs border border-slate-800">
                OS
              </span>
            </div>
          </div>
        </div>

        {/* Top-Right Stack: Top row has Portfolio & Tools, Bottom row has condensed Sync Telemetry */}
        <div className="flex flex-col items-start sm:items-end gap-2.5 shrink-0">
          {/* Top Row: Portfolio & Tools Buttons */}
          <div className="flex items-center gap-2.5">
            {/* Equal-Weight Portfolio Button */}
            <button
              id="btn-open-portfolio"
              onClick={onOpenPortfolio}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950 shadow-xs transition-colors cursor-pointer"
            >
              <Briefcase className="w-4 h-4 text-emerald-400" />
              <span>Portfolio</span>
              <span className="ml-0.5 px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 text-[11px] font-mono font-bold">
                {winnerCount}
              </span>
            </button>

            {/* Strategy Tools Dropdown (Includes Backtest, Rebalance, CMP Audit, Python Code, Universe CSV) */}
            <div className="relative" ref={toolsMenuRef}>
              <button
                id="btn-tools-menu"
                onClick={() => setIsToolsOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 shadow-xs transition-colors cursor-pointer"
                title="Strategy utilities, cross-source audits, and quantitative tools"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-600" />
                <span>Tools</span>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isToolsOpen ? 'rotate-180' : ''}`} />
              </button>

              {isToolsOpen && (
                <div className="absolute right-0 mt-1.5 w-60 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Quant & Strategy Tools
                  </div>

                  <button
                    id="btn-open-backtest"
                    onClick={() => {
                      setIsToolsOpen(false);
                      onOpenBacktest();
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-900 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <TrendingUp className="w-4 h-4 text-indigo-600 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-900">10-Year Backtest</div>
                      <div className="text-[10px] text-slate-500">Historical performance & metrics</div>
                    </div>
                  </button>

                  <button
                    id="btn-rebalance-check"
                    onClick={() => {
                      setIsToolsOpen(false);
                      onOpenRebalance();
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-amber-50 hover:text-amber-900 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <SlidersHorizontal className="w-4 h-4 text-amber-600 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-900">Rebalance Simulator</div>
                      <div className="text-[10px] text-slate-500">Monthly rules & turnover checks</div>
                    </div>
                  </button>

                  <button
                    id="btn-open-audit-modal"
                    onClick={() => {
                      setIsToolsOpen(false);
                      onOpenAuditModal();
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-emerald-50 hover:text-emerald-950 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-900">Cross-Source CMP Audit</div>
                      <div className="text-[10px] text-slate-500">Cross-verify prices vs secondary feeds</div>
                    </div>
                  </button>

                  <div className="my-1 border-t border-slate-100" />
                  <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Developer & Data
                  </div>

                  <button
                    id="btn-upload-db"
                    onClick={() => {
                      setIsToolsOpen(false);
                      if (onOpenDatabaseUpload) onOpenDatabaseUpload();
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-emerald-50 hover:text-emerald-950 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <Database className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                        <span>10-Year DB (.db / .zip)</span>
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-emerald-100 text-emerald-800 font-bold">
                          Angel One
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500">Stream 40MB+ DB directly to server</div>
                    </div>
                  </button>

                  <button
                    id="btn-python-export"
                    onClick={() => {
                      setIsToolsOpen(false);
                      onOpenPythonCode();
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-900 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <Code2 className="w-4 h-4 text-blue-600 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-900">Python / Streamlit Code</div>
                      <div className="text-[10px] text-slate-500">Export quant algorithm scripts</div>
                    </div>
                  </button>

                  <button
                    id="btn-upload-csv"
                    onClick={() => {
                      setIsToolsOpen(false);
                      onOpenUpload();
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-slate-500 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-900">Custom Universe CSV</div>
                      <div className="text-[10px] text-slate-500">Upload official NSE index list</div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Row: Condensed Sync Information & Icon-Only Sync Button */}
          <div className="flex items-center gap-2 bg-slate-50/90 hover:bg-slate-100/80 px-2.5 py-1 rounded-lg border border-slate-200/80 text-xs transition-colors">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 relative shrink-0">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isFailed ? 'bg-amber-400' : 'bg-emerald-400'} opacity-75`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${isFailed ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
              </span>

              <div className="flex items-center gap-1.5 text-slate-600 text-[11px]">
                <Globe className="w-3 h-3 text-slate-400 shrink-0" />
                <span className="text-slate-500">Auto-Refreshed:</span>
                <span className="font-mono text-slate-800 font-semibold">
                  {formatShortTime(syncStatus?.lastSuccessfulSync)}
                </span>
              </div>
            </div>

            <div className="h-3.5 w-[1px] bg-slate-200" />

            {/* Icon-Only Force Sync Button */}
            {onForceSyncExchange && (
              <button
                id="btn-force-sync-exchange"
                onClick={onForceSyncExchange}
                disabled={isSyncingLive}
                className="p-1 rounded-md bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-2xs transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center"
                title="Force sync prices with Exchange"
                aria-label="Force sync prices with Exchange"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingLive ? 'animate-spin text-white' : 'text-white'}`} />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};


