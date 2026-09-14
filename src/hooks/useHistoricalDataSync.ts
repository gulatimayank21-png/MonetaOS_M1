/**
 * React Hook for Historical SQLite WASM Synchronization & Querying
 *
 * Manages the background Web Worker lifecycle, automatic IndexedDB cache detection,
 * stream download progress tracking, and query execution.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  WorkerRequest,
  WorkerResponse,
  ProgressResponse,
  StatusResultResponse,
  QueryResultResponse,
  CheckCacheResponse,
  WarmupCompleteResponse,
  BacktestCompleteResponse,
  ErrorResponse,
  DbStatusData,
} from '../workers/dbWorker';
import { BacktestConfig, BacktestSummary } from '../types';
import {
  APP_DB_VERSION,
  DB_DOWNLOAD_URL,
  STORAGE_VERSION_KEY,
  DB_FILENAME,
} from '../constants/database';

export type SyncStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

export interface UseHistoricalDataSyncReturn {
  status: SyncStatus;
  progress: number;
  progressMessage: string;
  error: string | null;
  dbStats: DbStatusData | null;
  hasCachedData: boolean;
  startWarmup: (forceDownload?: boolean) => void;
  runQuery: <T = any>(sql: string, params?: any[]) => Promise<T[]>;
  runRealBacktest: (config: BacktestConfig) => Promise<{ summary: BacktestSummary; executionTimeMs: number }>;
  checkCache: () => void;
}

export function useHistoricalDataSync(): UseHistoricalDataSyncReturn {
  const [status, setStatus] = useState<SyncStatus>('checking');
  const [progress, setProgress] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>('Initializing SQLite engine...');
  const [error, setError] = useState<string | null>(null);
  const [dbStats, setDbStats] = useState<DbStatusData | null>(null);
  const [hasCachedData, setHasCachedData] = useState<boolean>(false);

  const workerRef = useRef<Worker | null>(null);
  const pendingRequestsRef = useRef<
    Map<
      string,
      {
        resolve: (value: any) => void;
        reject: (reason?: any) => void;
      }
    >
  >(new Map());

  // Generate unique request IDs
  const getNextId = useCallback(() => {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }, []);

  // Post a message and optionally wait for a correlation response
  const sendWorkerMessage = useCallback(
    (message: WorkerRequest): Promise<any> => {
      if (!workerRef.current) {
        return Promise.reject(new Error('Web Worker is not active'));
      }

      return new Promise((resolve, reject) => {
        pendingRequestsRef.current.set(message.id, { resolve, reject });
        workerRef.current?.postMessage(message);
      });
    },
    []
  );

  // Initialize Worker & setup event dispatching
  useEffect(() => {
    let worker: Worker;

    try {
      worker = new Worker(new URL('../workers/dbWorker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;
    } catch (err: any) {
      console.error('Failed to instantiate SQLite Web Worker:', err);
      setStatus('error');
      setError('Web Worker initialization failed. Check browser compatibility.');
      return;
    }

    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (!response || !response.id) return;

      const { id, type } = response;
      const pending = pendingRequestsRef.current.get(id);

      switch (type) {
        case 'PROGRESS': {
          const prog = response as ProgressResponse;
          setProgress(prog.percent);
          setProgressMessage(prog.message);

          if (prog.phase === 'downloading') {
            setStatus('downloading');
          } else if (prog.phase === 'checking') {
            setStatus('checking');
          } else if (prog.phase === 'ready') {
            setStatus('ready');
          }
          break;
        }

        case 'CHECK_CACHE_RESULT': {
          const res = response as CheckCacheResponse & { isTargetVersion?: boolean };
          const storedVersion =
            typeof localStorage !== 'undefined'
              ? localStorage.getItem(STORAGE_VERSION_KEY)
              : null;
          const isVersionMatch =
            res.hasCache &&
            res.version === APP_DB_VERSION &&
            storedVersion === APP_DB_VERSION;

          setHasCachedData(isVersionMatch);

          if (isVersionMatch) {
            setProgressMessage(`Database ${APP_DB_VERSION} found in cache. Loading...`);
            // Automatically warm up from verified local IndexedDB cache
            const warmupId = getNextId();
            worker.postMessage({
              id: warmupId,
              type: 'WARMUP_DB',
              forceDownload: false,
              version: APP_DB_VERSION,
              apiOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
            } as WorkerRequest);
          } else {
            // Missing or outdated version -> trigger auto-purge and pull routine
            setStatus('downloading');
            setProgress(5);
            setProgressMessage(
              `New database version detected. Downloading release ${APP_DB_VERSION}...`
            );
            const warmupId = getNextId();
            worker.postMessage({
              id: warmupId,
              type: 'WARMUP_DB',
              forceDownload: true,
              version: APP_DB_VERSION,
              downloadUrl: DB_DOWNLOAD_URL,
              apiOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
            } as WorkerRequest);
          }

          if (pending) {
            pending.resolve(res);
            pendingRequestsRef.current.delete(id);
          }
          break;
        }

        case 'WARMUP_COMPLETE': {
          const res = response as WarmupCompleteResponse;
          setDbStats(res.status);
          setStatus('ready');
          setProgress(100);
          setProgressMessage(
            `Database ${APP_DB_VERSION} loaded successfully (${res.status.totalCandles.toLocaleString()} rows, ${res.status.uniqueSymbols} symbols)`
          );
          setError(null);
          setHasCachedData(true);

          // Update localStorage version tag after verified write
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem(STORAGE_VERSION_KEY, APP_DB_VERSION);
            }
          } catch (_) {}

          if (pending) {
            pending.resolve(res);
            pendingRequestsRef.current.delete(id);
          }
          break;
        }

        case 'STATUS_RESULT': {
          const res = response as StatusResultResponse;
          setDbStats(res.data);
          if (pending) {
            pending.resolve(res.data);
            pendingRequestsRef.current.delete(id);
          }
          break;
        }

        case 'QUERY_RESULT': {
          const res = response as QueryResultResponse;
          // Transform sql.js { columns, values } into standard array of objects
          const rows: any[] = [];
          if (res.results && res.results.length > 0) {
            const firstResult = res.results[0];
            const cols = firstResult.columns;
            for (const valRow of firstResult.values) {
              const obj: Record<string, any> = {};
              cols.forEach((col, idx) => {
                obj[col] = valRow[idx];
              });
              rows.push(obj);
            }
          }

          if (pending) {
            pending.resolve(rows);
            pendingRequestsRef.current.delete(id);
          }
          break;
        }

        case 'BACKTEST_COMPLETE': {
          const res = response as BacktestCompleteResponse;
          if (pending) {
            pending.resolve({
              summary: res.summary,
              executionTimeMs: res.executionTimeMs,
            });
            pendingRequestsRef.current.delete(id);
          }
          break;
        }

        case 'ERROR': {
          const res = response as ErrorResponse;
          console.error('[Worker Error Encountered]:', res.error);
          setError(res.error);
          setStatus('error');
          setProgressMessage(`Error: ${res.error}`);

          if (pending) {
            pending.reject(new Error(res.error));
            pendingRequestsRef.current.delete(id);
          }
          break;
        }

        default:
          break;
      }
    };

    const handleError = (errEvent: ErrorEvent) => {
      console.error('[Worker Global Error]:', errEvent);
      setError(errEvent.message || 'Worker encountered an unexpected error.');
      setStatus('error');
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);

    // Initial cache check
    const checkId = getNextId();
    worker.postMessage({
      id: checkId,
      type: 'CHECK_CACHE',
    } as WorkerRequest);

    return () => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      worker.terminate();
      workerRef.current = null;
      pendingRequestsRef.current.clear();
    };
  }, [getNextId]);

  // Trigger manual warmup or force download
  const startWarmup = useCallback(
    (forceDownload = false) => {
      if (!workerRef.current) return;
      setStatus(forceDownload ? 'downloading' : 'checking');
      setError(null);
      setProgress(0);
      setProgressMessage(
        forceDownload
          ? `New database version detected. Downloading release ${APP_DB_VERSION}...`
          : `Warming up SQLite engine (${APP_DB_VERSION})...`
      );

      const warmupId = getNextId();
      workerRef.current.postMessage({
        id: warmupId,
        type: 'WARMUP_DB',
        forceDownload,
        version: APP_DB_VERSION,
        downloadUrl: DB_DOWNLOAD_URL,
        apiOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
      } as WorkerRequest);
    },
    [getNextId]
  );

  // Manual cache check trigger
  const checkCache = useCallback(() => {
    if (!workerRef.current) return;
    const checkId = getNextId();
    workerRef.current.postMessage({
      id: checkId,
      type: 'CHECK_CACHE',
    } as WorkerRequest);
  }, [getNextId]);

  // Execute typed SQL query against the WASM database
  const runQuery = useCallback(
    async <T = any>(sql: string, params?: any[]): Promise<T[]> => {
      const id = getNextId();
      return sendWorkerMessage({
        id,
        type: 'EXECUTE_QUERY',
        sql,
        params,
      });
    },
    [getNextId, sendWorkerMessage]
  );

  // Execute authentic Real-Data Quantitative Simulation over 10-year OHLCV in the worker
  const runRealBacktest = useCallback(
    async (config: BacktestConfig): Promise<{ summary: BacktestSummary; executionTimeMs: number }> => {
      const id = getNextId();
      return sendWorkerMessage({
        id,
        type: 'RUN_BACKTEST',
        config,
      });
    },
    [getNextId, sendWorkerMessage]
  );

  return {
    status,
    progress,
    progressMessage,
    error,
    dbStats,
    hasCachedData,
    startWarmup,
    runQuery,
    runRealBacktest,
    checkCache,
  };
}
