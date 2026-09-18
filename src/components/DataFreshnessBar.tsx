import React from 'react';
import { Clock, Database, RefreshCw, ShieldCheck, AlertCircle, CalendarClock } from 'lucide-react';
import { DataFetchInfo } from '../types';
import { getSyncScheduleDetails } from '../utils/syncScheduleUtils';

interface DataFreshnessBarProps {
  dataFetchInfo: DataFetchInfo;
  isComputing?: boolean;
  onRefreshLive?: () => void;
  activeConstituentsCount?: number;
}

export const DataFreshnessBar: React.FC<DataFreshnessBarProps> = ({
  dataFetchInfo,
  isComputing = false,
  onRefreshLive,
  activeConstituentsCount = 500,
}) => {
  const syncDetails = getSyncScheduleDetails(
    dataFetchInfo.dbTradeDate || '2026-09-15',
    dataFetchInfo.fetchedAt
  );

  return (
    <div
      id="data-freshness-bar"
      className="w-full bg-slate-900 border border-slate-700/80 rounded-xl p-4 sm:p-5 shadow-lg text-slate-100 mb-6 transition-all"
    >
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        {/* Left Section: Timestamp Callout & Source */}
        <div className="flex items-start gap-3.5 flex-1">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shrink-0 mt-0.5">
            <CalendarClock className="w-5 h-5" />
          </div>

          <div className="space-y-1.5 flex-1">
            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                NSE Bhavcopy Database Status
              </span>

              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-700/60">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                Market Session in DB: {syncDetails.dbTradeDateFormatted}
              </span>

              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-950/50 text-amber-300 border border-amber-800/50">
                <Clock className="w-3 h-3 text-amber-400" />
                Daily Sync: 6:30 PM IST
              </span>

              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                <Database className="w-3 h-3 text-cyan-400" />
                {activeConstituentsCount} Constituents Active
              </span>
            </div>

            {/* Primary Headline Message */}
            <p className="text-sm sm:text-base font-semibold text-slate-100 leading-snug">
              {syncDetails.headlineMessage}
            </p>

            {/* Detailed Explanation / 6:30 PM Schedule Note */}
            <div className="text-xs text-slate-300 bg-slate-800/70 border border-slate-700/60 rounded-lg p-2.5 mt-2 space-y-1">
              <p className="flex items-start gap-1.5 text-slate-300">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-amber-300 font-medium">Daily Sync Schedule:</strong> {syncDetails.detailedScheduleNote}
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-400 text-[11px] pt-1 border-t border-slate-700/50">
                <span>
                  Source: <span className="text-slate-200 font-medium">{dataFetchInfo.source}</span>
                </span>
                <span>•</span>
                <span>
                  Verified Database Trade Date: <span className="text-emerald-300 font-mono font-medium">{syncDetails.dbTradeDate}</span>
                </span>
                <span>•</span>
                <span>
                  Last Ingestion Check: <span className="text-slate-200 font-mono">{syncDetails.syncTimestampFormatted}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Section: Action / Recompute Control */}
        {onRefreshLive && (
          <div className="flex items-center gap-2 self-start lg:self-center shrink-0 mt-2 lg:mt-0">
            <button
              id="recompute-data-btn"
              onClick={onRefreshLive}
              disabled={isComputing}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs sm:text-sm font-semibold transition shadow-sm border border-emerald-500/30 active:scale-95 cursor-pointer disabled:cursor-not-allowed"
              title="Recalculate momentum factors from the latest database"
            >
              <RefreshCw className={`w-4 h-4 ${isComputing ? 'animate-spin text-emerald-300' : ''}`} />
              <span>{isComputing ? 'Computing Latest DB...' : 'Recompute on Latest DB'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

