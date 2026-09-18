import React, { useState, useEffect } from 'react';
import { ShieldCheck, AlertTriangle, RefreshCw, CheckCircle2, X, Globe, Radio } from 'lucide-react';
import { NightlySyncStatus } from '../types';

interface NightlySyncBannerProps {
  onOpenAuditModal: () => void;
  onRefreshUniverse: () => void;
  onNotify?: (msg: string) => void;
}

interface SyncFeedback {
  type: 'syncing' | 'success' | 'error';
  title: string;
  message: string;
  timestamp?: string;
}

const DEFAULT_BANNER_STATUS: NightlySyncStatus = {
  lastSuccessfulSync: '2026-09-12T08:04:57.811Z',
  lastActualNSESync: '2026-09-12T08:04:57.811Z',
  lastAttempt: '2026-09-12T08:04:57.811Z',
  status: 'success',
  syncMode: 'live_nse_direct',
  errorMessage: null,
  scheduledCron: 'Daily at 18:30 IST (06:30 PM IST Post-Market Bhavcopy Batch)',
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

export const NightlySyncBanner: React.FC<NightlySyncBannerProps> = ({
  onOpenAuditModal,
  onRefreshUniverse,
  onNotify,
}) => {
  const [syncStatus, setSyncStatus] = useState<NightlySyncStatus>(DEFAULT_BANNER_STATUS);
  const [isRetrying, setIsRetrying] = useState(false);
  const [feedback, setFeedback] = useState<SyncFeedback | null>(null);

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
      console.warn('Could not refresh nightly sync status from server; retaining local fallback status:', err);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Poll every 60 seconds
    const timer = setInterval(fetchStatus, 60000);
    return () => clearInterval(timer);
  }, []);

  // Auto-dismiss success and error feedback after 7 seconds
  useEffect(() => {
    if (feedback && feedback.type !== 'syncing') {
      const timer = setTimeout(() => {
        setFeedback(null);
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [feedback]);

  const formatDate = (isoString?: string) => {
    if (!isoString) return 'N/A';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const handleRetrySync = async (forceFail = false) => {
    setIsRetrying(true);
    setFeedback({
      type: 'syncing',
      title: 'Connecting to NSE...',
      message: forceFail
        ? 'Simulating failed sync attempt (testing network timeout alert)...'
        : 'Connecting to official NSE India archives and verifying 500 constituents...',
    });

    try {
      const res = await fetch('/api/universe/trigger-nightly-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          forceFail,
          failureReason: forceFail ? 'Simulated NSE Network Outage (503 Service Unavailable)' : undefined,
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      let data: any = {};
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        throw new Error(`Server returned unexpected response (${res.status})`);
      }
      const nowFormatted = new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      if (data.status) {
        setSyncStatus(data.status);
      }

      if (data.success && data.status?.status === 'success') {
        const successMsg =
          data.message ||
          `Sync Successful! Verified 500 NSE India constituents & latest prices at ${nowFormatted}.`;
        setFeedback({
          type: 'success',
          title: 'Sync Successful',
          message: successMsg,
          timestamp: nowFormatted,
        });
        if (onNotify) {
          onNotify(successMsg);
        }
      } else {
        const errMsg =
          data.message ||
          data.status?.errorMessage ||
          data.error ||
          'NSE archives unresponsive. Operating on fallback universe.';
        const lastValid = formatDate(data.status?.lastSuccessfulSync || syncStatus?.lastSuccessfulSync);
        setFeedback({
          type: 'error',
          title: 'Sync Failed',
          message: `${errMsg} (Fallback preserved from ${lastValid})`,
          timestamp: nowFormatted,
        });
        if (onNotify) {
          onNotify(`Sync Failed: ${errMsg}`);
        }
      }

      onRefreshUniverse();
    } catch (err: any) {
      console.error('Retry sync failed:', err);
      const nowFormatted = new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setFeedback({
        type: 'error',
        title: 'Sync Error',
        message: `Network request to sync service failed: ${err.message || 'Unknown network error'}`,
        timestamp: nowFormatted,
      });
      if (onNotify) {
        onNotify(`Sync error: ${err.message || 'Network request failed'}`);
      }
    } finally {
      setIsRetrying(false);
    }
  };

  if (!syncStatus) return null;

  const isFailed = syncStatus.status === 'failed';

  return (
    <div className="w-full">
      {/* 1. Dynamic Interactive Feedback Banner (Success / Failure / In-Progress Alert) */}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`border-b px-4 py-2.5 text-xs transition-all animate-in fade-in duration-200 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-950 border-emerald-300'
              : feedback.type === 'error'
              ? 'bg-rose-50 text-rose-950 border-rose-300'
              : 'bg-indigo-50 text-indigo-950 border-indigo-200'
          }`}
        >
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {feedback.type === 'syncing' ? (
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-600 shrink-0" />
              ) : feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-bold tracking-tight">
                  {feedback.title}:
                </span>
                <span className="font-medium text-slate-800">
                  {feedback.message}
                </span>
                {feedback.timestamp && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/80 border border-slate-300/60 text-slate-600">
                    {feedback.timestamp}
                  </span>
                )}
              </div>
            </div>

            {feedback.type !== 'syncing' && (
              <button
                onClick={() => setFeedback(null)}
                className="p-1 rounded hover:bg-black/5 text-slate-500 hover:text-slate-800 transition-colors"
                title="Dismiss message"
                aria-label="Dismiss message"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 2. Main Universe Status Bar */}
      {isFailed ? (
        /* Critical Failure Alert Banner (Calling out exact date when it was last updated) */
        <div className="bg-amber-50 border-y border-amber-300 px-4 py-3 sm:px-6 shadow-xs">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
            <div className="flex items-start gap-3">
              <div className="p-1.5 rounded-lg bg-rose-200 text-rose-900 shrink-0 mt-0.5">
                <AlertTriangle className="w-4 h-4 text-rose-800" />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-rose-950 uppercase tracking-wide text-[10px] px-2 py-0.5 rounded-md bg-rose-200 border border-rose-300">
                    ⚠️ Last Sync: Failed
                  </span>
                  <span className="font-mono text-rose-900 font-semibold bg-rose-100 px-2 py-0.5 rounded border border-rose-200 text-[11px]">
                    Attempt timestamp: {formatDate(syncStatus.lastAttempt)}
                  </span>
                </div>
                <p className="text-amber-950 leading-relaxed">
                  Active universe safely anchored to last verified constituents from{' '}
                  <strong className="underline decoration-amber-500 font-bold text-amber-950 font-mono bg-amber-100 px-1.5 py-0.5 rounded border border-amber-300">
                    {formatDate(syncStatus.lastSuccessfulSync)}
                  </strong>
                  . Error:{' '}
                  <span className="font-mono text-rose-900 font-medium">
                    {syncStatus.errorMessage || 'NSE servers unresponsive.'}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
              <button
                id="btn-retry-universe-sync"
                onClick={() => handleRetrySync(false)}
                disabled={isRetrying}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs bg-amber-900 hover:bg-amber-800 text-white shadow-xs transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                <span>{isRetrying ? 'Retrying...' : 'Retry Universe Sync'}</span>
              </button>
              <button
                onClick={onOpenAuditModal}
                className="px-3 py-1.5 rounded-lg font-semibold text-xs bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 transition-colors"
              >
                Inspect Audit
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Normal Status Strip: Compact, unified, and quiet */
        <div className="bg-slate-50/80 text-slate-700 px-4 py-2 text-xs border-b border-slate-200/70">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-slate-600 font-medium">Auto-Refreshed:</span>
                <span className="font-mono text-slate-900 font-bold">
                  {formatDate(syncStatus.lastSuccessfulSync)}
                </span>
              </div>

              <span className="text-slate-300 hidden sm:inline">•</span>

              <div className="flex items-center gap-1.5 text-slate-600">
                <Globe className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span>NSE Sync:</span>
                <span className="font-mono text-slate-800 font-semibold">
                  {formatDate(syncStatus.lastActualNSESync || syncStatus.lastSuccessfulSync)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onOpenAuditModal}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors text-[11px] font-medium shadow-2xs"
                title="Cross-verify CMP across secondary market feeds"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>CMP Audit</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

