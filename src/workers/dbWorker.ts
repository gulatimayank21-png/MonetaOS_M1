/**
 * Web Worker for Background SQLite WASM & Stream Download Operations
 *
 * Runs off the main thread to ensure smooth UI 60fps rendering during large
 * database downloads (100MB+), IndexedDB caching, and heavy analytical SQL queries.
 */

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import JSZip from 'jszip';
import {
  getDatabaseBuffer,
  saveDatabaseBuffer,
  hasValidDatabase,
  clearDatabase,
  setStoredDbVersion,
} from '../utils/indexedDbStorage';
import {
  executeRealDataBacktest,
  buildMarketMatrix,
  InMemMarketMatrix,
} from '../utils/realDataBacktestEngine';
import { BacktestConfig, BacktestSummary } from '../types';
import {
  APP_DB_VERSION,
  DB_DOWNLOAD_URL,
  STORAGE_VERSION_KEY,
  DB_FILENAME,
} from '../constants/database';

export const DEFAULT_DB_URL = DB_DOWNLOAD_URL;
export const DB_VERSION_TAG = APP_DB_VERSION;

// --- Message Protocol Types ---

export type WorkerRequestType =
  | 'CHECK_CACHE'
  | 'WARMUP_DB'
  | 'GET_DB_STATUS'
  | 'EXECUTE_QUERY'
  | 'RUN_BACKTEST';

export interface CheckCacheRequest {
  id: string;
  type: 'CHECK_CACHE';
}

export interface WarmupDbRequest {
  id: string;
  type: 'WARMUP_DB';
  forceDownload?: boolean;
  downloadUrl?: string;
  version?: string;
  apiOrigin?: string;
}

export interface GetDbStatusRequest {
  id: string;
  type: 'GET_DB_STATUS';
}

export interface ExecuteQueryRequest {
  id: string;
  type: 'EXECUTE_QUERY';
  sql: string;
  params?: any[];
}

export interface RunBacktestRequest {
  id: string;
  type: 'RUN_BACKTEST';
  config: BacktestConfig;
}

export type WorkerRequest =
  | CheckCacheRequest
  | WarmupDbRequest
  | GetDbStatusRequest
  | ExecuteQueryRequest
  | RunBacktestRequest;

export type WorkerResponseType =
  | 'PROGRESS'
  | 'STATUS_RESULT'
  | 'QUERY_RESULT'
  | 'CHECK_CACHE_RESULT'
  | 'WARMUP_COMPLETE'
  | 'BACKTEST_COMPLETE'
  | 'ERROR';

export interface ProgressResponse {
  id: string;
  type: 'PROGRESS';
  phase: 'checking' | 'downloading' | 'saving' | 'initializing' | 'ready';
  loadedBytes: number;
  totalBytes: number;
  percent: number;
  message: string;
}

export interface DbStatusData {
  totalCandles: number;
  uniqueSymbols: number;
  minDate: string;
  maxDate: string;
  tableName: string;
  sizeBytes: number;
  tables: string[];
}

export interface StatusResultResponse {
  id: string;
  type: 'STATUS_RESULT';
  data: DbStatusData;
}

export interface QueryResultResponse {
  id: string;
  type: 'QUERY_RESULT';
  results: Array<{
    columns: string[];
    values: any[][];
  }>;
}

export interface CheckCacheResponse {
  id: string;
  type: 'CHECK_CACHE_RESULT';
  hasCache: boolean;
  version?: string;
}

export interface WarmupCompleteResponse {
  id: string;
  type: 'WARMUP_COMPLETE';
  fromCache: boolean;
  sizeBytes: number;
  status: DbStatusData;
}

export interface BacktestCompleteResponse {
  id: string;
  type: 'BACKTEST_COMPLETE';
  summary: BacktestSummary;
  executionTimeMs: number;
}

export interface ErrorResponse {
  id: string;
  type: 'ERROR';
  error: string;
  code?: string;
}

export type WorkerResponse =
  | ProgressResponse
  | StatusResultResponse
  | QueryResultResponse
  | CheckCacheResponse
  | WarmupCompleteResponse
  | BacktestCompleteResponse
  | ErrorResponse;

// --- Worker State ---

let SQLModule: SqlJsStatic | null = null;
let dbInstance: Database | null = null;
let rawBuffer: ArrayBuffer | null = null;
let cachedStatus: DbStatusData | null = null;
let cachedMarketMatrix: InMemMarketMatrix | null = null;

/**
 * Initializes the sql.js WebAssembly engine with multi-CDN fallback
 */
async function getSQL(): Promise<SqlJsStatic> {
  if (SQLModule) return SQLModule;

  const cdnList = [
    'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.14.2/',
    'https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/',
    'https://unpkg.com/sql.js@1.14.2/dist/',
    'https://sql.js.org/dist/',
  ];

  for (const cdn of cdnList) {
    try {
      SQLModule = await initSqlJs({
        locateFile: (file: string) => `${cdn}${file}`,
      });
      if (SQLModule) return SQLModule;
    } catch (err) {
      console.warn(`WASM CDN ${cdn} failed, attempting next mirror...`, err);
    }
  }

  // Fallback default init
  SQLModule = await initSqlJs();
  return SQLModule;
}

/**
 * Helper to uncompress a ZIP archive containing nifty500_historical.db
 */
async function uncompressIfZip(
  buffer: ArrayBuffer,
  onProgress?: (msg: string) => void
): Promise<ArrayBuffer> {
  const u8 = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 16));
  // Check ZIP magic numbers PK\x03\x04 (0x50, 0x4B, 0x03, 0x04)
  const isZip = u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04;

  if (!isZip) {
    return buffer;
  }

  if (onProgress) {
    onProgress('Decompressing SQLite database from ZIP archive in worker...');
  }

  const zip = await JSZip.loadAsync(buffer);
  const fileNames = Object.keys(zip.files);
  const targetName =
    fileNames.find((name) => /\.(db|sqlite|sqlite3)$/i.test(name) && !zip.files[name].dir) ||
    fileNames.find((name) => !zip.files[name].dir) ||
    fileNames[0];

  if (!targetName || !zip.files[targetName]) {
    throw new Error('No valid SQLite .db file found inside the release ZIP archive.');
  }

  const extracted = await zip.files[targetName].async('arraybuffer');
  return extracted;
}

/**
 * Discovers table structure and computes summary metrics
 */
function inspectDatabase(db: Database, sizeBytes: number): DbStatusData {
  const tableRes = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
  );
  const tables: string[] = tableRes[0]?.values
    ? tableRes[0].values.map((v) => String(v[0]))
    : [];

  let targetTable =
    tables.find((t) => t.toLowerCase() === 'daily_ohlcv') ||
    tables.find((t) => t.toLowerCase() === 'stock_daily_ohlcv') ||
    tables.find((t) =>
      /ohlc|daily|price|stock|eod|bhav|market|history|candles|nifty/i.test(t)
    ) || (tables.length > 0 ? tables[0] : 'daily_ohlcv');

  let totalCandles = 0;
  let uniqueSymbols = 0;
  let minDate = 'N/A';
  let maxDate = 'N/A';

  if (tables.length > 0) {
    try {
      const countRes = db.exec(`SELECT COUNT(*) FROM "${targetTable}";`);
      if (countRes[0]?.values?.[0]?.[0] !== undefined) {
        totalCandles = Number(countRes[0].values[0][0]);
      }

      const colRes = db.exec(`PRAGMA table_info("${targetTable}");`);
      const cols: string[] = colRes[0]?.values
        ? colRes[0].values.map((c) => String(c[1]).toLowerCase())
        : [];

      const symCol = cols.find((c) => /symbol|ticker|stock|name/i.test(c));
      if (symCol) {
        const countSymRes = db.exec(
          `SELECT COUNT(DISTINCT "${symCol}") FROM "${targetTable}";`
        );
        if (countSymRes[0]?.values?.[0]?.[0] !== undefined) {
          uniqueSymbols = Number(countSymRes[0].values[0][0]);
        }
      }

      const dateCol = cols.find((c) => /date|timestamp|time|datetime/i.test(c));
      if (dateCol) {
        const minMaxRes = db.exec(
          `SELECT MIN("${dateCol}"), MAX("${dateCol}") FROM "${targetTable}";`
        );
        if (minMaxRes[0]?.values?.[0]) {
          minDate = String(minMaxRes[0].values[0][0] || 'N/A');
          maxDate = String(minMaxRes[0].values[0][1] || 'N/A');
        }
      }
    } catch (e) {
      console.warn('Error querying metadata from table:', e);
    }
  }

  return {
    totalCandles,
    uniqueSymbols,
    minDate,
    maxDate,
    tableName: targetTable,
    sizeBytes,
    tables,
  };
}

/**
 * Downloads database binary with streaming progress calculation
 * Tier 1: Direct remote fetch
 * Tier 2: Cloud-Run safe Chunked Proxy fetch (bypasses browser CORS & Cloud Run 32MB payload ceiling)
 */
async function downloadDatabaseStream(
  url: string,
  requestId: string,
  apiOrigin?: string
): Promise<ArrayBuffer> {
  const tryFetch = async (targetUrl: string): Promise<Response> => {
    return await fetch(targetUrl, {
      headers: {
        Accept: 'application/octet-stream, */*',
      },
    });
  };

  let response: Response | null = null;
  let fetchErrorDetails: string = '';

  // Tier 1: Direct remote fetch (bypasses server if browser allows CORS)
  try {
    const directRes = await tryFetch(url);
    if (directRes.ok) {
      response = directRes;
    } else {
      fetchErrorDetails = `Direct download HTTP ${directRes.status}: ${directRes.statusText}`;
    }
  } catch (directErr: any) {
    fetchErrorDetails = directErr?.message || 'CORS or network error';
    console.warn('Direct GitHub fetch failed (likely CORS or network), falling back to chunked server proxy...', directErr);
  }

  // If Tier 1 succeeded and has body
  if (response && response.ok) {
    const contentLengthHeader = response.headers.get('content-length');
    const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
    let loadedBytes = 0;

    if (!response.body) {
      const arrayBuf = await response.arrayBuffer();
      self.postMessage({
        id: requestId,
        type: 'PROGRESS',
        phase: 'downloading',
        loadedBytes: arrayBuf.byteLength,
        totalBytes: arrayBuf.byteLength,
        percent: 100,
        message: `Downloaded ${(arrayBuf.byteLength / (1024 * 1024)).toFixed(1)} MB`,
      } as ProgressResponse);
      return arrayBuf;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        chunks.push(value);
        loadedBytes += value.byteLength;

        const percent =
          totalBytes > 0
            ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100))
            : 0;

        self.postMessage({
          id: requestId,
          type: 'PROGRESS',
          phase: 'downloading',
          loadedBytes,
          totalBytes: totalBytes || loadedBytes,
          percent,
          message: `Streaming database: ${(loadedBytes / (1024 * 1024)).toFixed(1)} MB${
            totalBytes > 0
              ? ` / ${(totalBytes / (1024 * 1024)).toFixed(1)} MB (${percent}%)`
              : ''
          }`,
        } as ProgressResponse);
      }
    }

    const concatenated = new Uint8Array(loadedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      concatenated.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return concatenated.buffer;
  }

  // Tier 2: Cloud-Run Safe Chunked Proxy Download
  // Splits 130MB database into 8MB chunks so each request is well below Cloud Run's 32MB payload ceiling
  const baseUrl =
    apiOrigin ||
    (typeof self !== 'undefined' &&
    self.location &&
    self.location.origin &&
    self.location.origin !== 'null' &&
    !self.location.origin.startsWith('blob:')
      ? self.location.origin
      : '');

  self.postMessage({
    id: requestId,
    type: 'PROGRESS',
    phase: 'downloading',
    loadedBytes: 0,
    totalBytes: 136245248,
    percent: 5,
    message: 'Initiating safe chunked download via server proxy...',
  } as ProgressResponse);

  // 1. Get database size & chunk metadata
  let totalBytes = 136245248;
  let chunkSize = 8 * 1024 * 1024;
  let totalChunks = 17;

  try {
    const infoRes = await fetch(
      `${baseUrl}/api/database/release-db-info?url=${encodeURIComponent(url)}`
    );
    if (infoRes.ok) {
      const infoData = await infoRes.json();
      if (infoData.totalBytes && infoData.totalBytes > 0) {
        totalBytes = infoData.totalBytes;
        chunkSize = infoData.chunkSize || chunkSize;
        totalChunks = infoData.totalChunks || Math.ceil(totalBytes / chunkSize);
      }
    }
  } catch (infoErr) {
    console.warn('Failed to query release info, using standard 8MB chunk calculations:', infoErr);
  }

  const finalBuffer = new Uint8Array(totalBytes);
  let totalDownloaded = 0;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const chunkUrl = `${baseUrl}/api/database/proxy-release-chunk?url=${encodeURIComponent(
      url
    )}&chunkIndex=${chunkIndex}&chunkSize=${chunkSize}&totalBytes=${totalBytes}`;

    let chunkRes: Response | null = null;
    let retries = 3;

    while (retries > 0 && (!chunkRes || !chunkRes.ok)) {
      try {
        chunkRes = await fetch(chunkUrl);
        if (!chunkRes.ok) {
          retries--;
          if (retries > 0) {
            await new Promise((r) => setTimeout(r, 800));
          }
        }
      } catch (e) {
        retries--;
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    }

    if (!chunkRes || !chunkRes.ok) {
      throw new Error(
        `Failed to download chunk ${chunkIndex + 1}/${totalChunks} (HTTP ${
          chunkRes?.status || 'network error'
        })`
      );
    }

    const chunkArrayBuffer = await chunkRes.arrayBuffer();
    const chunkBytes = new Uint8Array(chunkArrayBuffer);
    const writeOffset = chunkIndex * chunkSize;

    finalBuffer.set(chunkBytes, writeOffset);
    totalDownloaded += chunkBytes.byteLength;

    const percent = Math.min(100, Math.round((totalDownloaded / totalBytes) * 100));

    self.postMessage({
      id: requestId,
      type: 'PROGRESS',
      phase: 'downloading',
      loadedBytes: totalDownloaded,
      totalBytes,
      percent,
      message: `Downloaded ${(totalDownloaded / (1024 * 1024)).toFixed(1)} MB / ${(
        totalBytes /
        (1024 * 1024)
      ).toFixed(1)} MB (Chunk ${chunkIndex + 1}/${totalChunks})`,
    } as ProgressResponse);
  }

  return finalBuffer.buffer;
}

/**
 * Main Worker Message Event Listener
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (!request || !request.type) return;

  const { id, type } = request;

  try {
    switch (type) {
      case 'CHECK_CACHE': {
        const cached = await getDatabaseBuffer();
        const hasCache = !!(cached && cached.buffer && cached.buffer.byteLength > 1024 * 1024);
        const version = cached?.version;
        const isTargetVersion = version === APP_DB_VERSION;

        self.postMessage({
          id,
          type: 'CHECK_CACHE_RESULT',
          hasCache,
          version,
          isTargetVersion,
        } as CheckCacheResponse & { isTargetVersion?: boolean });
        break;
      }

      case 'WARMUP_DB': {
        const warmupReq = request as WarmupDbRequest;
        const forceDownload = !!warmupReq.forceDownload;
        const downloadUrl = warmupReq.downloadUrl || DEFAULT_DB_URL;
        const targetVersion = warmupReq.version || DB_VERSION_TAG;

        let buffer: ArrayBuffer | null = null;
        let fromCache = false;

        // Step 1: Pre-Run Handshake & Cache Validation
        if (!forceDownload) {
          self.postMessage({
            id,
            type: 'PROGRESS',
            phase: 'checking',
            loadedBytes: 0,
            totalBytes: 0,
            percent: 5,
            message: 'Checking local IndexedDB cache version...',
          } as ProgressResponse);

          const cached = await getDatabaseBuffer();
          if (
            cached &&
            cached.buffer &&
            cached.buffer.byteLength > 1024 * 1024 &&
            cached.version === targetVersion
          ) {
            buffer = cached.buffer;
            fromCache = true;
          } else if (cached && cached.version && cached.version !== targetVersion) {
            // Outdated version detected: purge outdated database
            self.postMessage({
              id,
              type: 'PROGRESS',
              phase: 'checking',
              loadedBytes: 0,
              totalBytes: 0,
              percent: 8,
              message: `Outdated database (${cached.version}) detected. Purging storage for ${targetVersion}...`,
            } as ProgressResponse);

            try {
              await clearDatabase();
            } catch (purgeErr) {
              console.warn('Purge error:', purgeErr);
            }
          }
        }

        // Step 2: Auto-Purge & Pull Routine
        if (!buffer) {
          self.postMessage({
            id,
            type: 'PROGRESS',
            phase: 'downloading',
            loadedBytes: 0,
            totalBytes: 0,
            percent: 10,
            message: `New database version detected. Downloading release ${targetVersion}...`,
          } as ProgressResponse);

          // Stream-fetch real SQLite binary / zip from remote / proxy
          const downloadedRaw = await downloadDatabaseStream(downloadUrl, id, warmupReq.apiOrigin);

          // Handle decompression if the downloaded file is a .zip archive (nifty500_historical.db extraction)
          self.postMessage({
            id,
            type: 'PROGRESS',
            phase: 'saving',
            loadedBytes: downloadedRaw.byteLength,
            totalBytes: downloadedRaw.byteLength,
            percent: 80,
            message: `Decompressing ${DB_FILENAME} from release archive...`,
          } as ProgressResponse);

          buffer = await uncompressIfZip(downloadedRaw, (msg) => {
            self.postMessage({
              id,
              type: 'PROGRESS',
              phase: 'saving',
              loadedBytes: downloadedRaw.byteLength,
              totalBytes: downloadedRaw.byteLength,
              percent: 82,
              message: msg,
            } as ProgressResponse);
          });

          self.postMessage({
            id,
            type: 'PROGRESS',
            phase: 'saving',
            loadedBytes: buffer.byteLength,
            totalBytes: buffer.byteLength,
            percent: 85,
            message: `Saving ${DB_FILENAME} (${targetVersion}) to local IndexedDB storage...`,
          } as ProgressResponse);

          // Store extracted .db binary into local browser storage and verify
          try {
            await saveDatabaseBuffer(buffer, targetVersion);
            // Verify write was successful
            const verifyRecord = await getDatabaseBuffer();
            if (verifyRecord && verifyRecord.buffer && verifyRecord.version === targetVersion) {
              setStoredDbVersion(targetVersion);
            }
          } catch (storageErr) {
            console.warn('Could not persist to IndexedDB (in-memory execution active):', storageErr);
          }
        }

        // Step 3: Initialize sql.js WASM engine
        self.postMessage({
          id,
          type: 'PROGRESS',
          phase: 'initializing',
          loadedBytes: buffer.byteLength,
          totalBytes: buffer.byteLength,
          percent: 92,
          message: 'Initializing SQLite WASM engine in Web Worker...',
        } as ProgressResponse);

        const SQL = await getSQL();
        if (dbInstance) {
          try {
            dbInstance.close();
          } catch (_) {}
        }

        rawBuffer = buffer;
        const u8View = new Uint8Array(buffer);
        dbInstance = new SQL.Database(u8View);

        // Invalidate cached market matrix when new DB is loaded
        cachedMarketMatrix = null;

        // Step 4: Inspect and cache database status
        const status = inspectDatabase(dbInstance, buffer.byteLength);
        cachedStatus = status;

        self.postMessage({
          id,
          type: 'PROGRESS',
          phase: 'ready',
          loadedBytes: buffer.byteLength,
          totalBytes: buffer.byteLength,
          percent: 100,
          message: `Database ${targetVersion} loaded successfully (${status.totalCandles.toLocaleString()} candles across ${status.uniqueSymbols} symbols).`,
        } as ProgressResponse);

        self.postMessage({
          id,
          type: 'WARMUP_COMPLETE',
          fromCache,
          sizeBytes: buffer.byteLength,
          status,
        } as WarmupCompleteResponse);

        break;
      }

      case 'GET_DB_STATUS': {
        if (!dbInstance) {
          const cached = await getDatabaseBuffer();
          if (cached && cached.buffer) {
            const SQL = await getSQL();
            rawBuffer = cached.buffer;
            dbInstance = new SQL.Database(new Uint8Array(cached.buffer));
            cachedStatus = inspectDatabase(dbInstance, cached.buffer.byteLength);
          }
        }

        if (!dbInstance || !cachedStatus) {
          throw new Error('Historical database is not loaded. Please warmup or download the database.');
        }

        self.postMessage({
          id,
          type: 'STATUS_RESULT',
          data: cachedStatus,
        } as StatusResultResponse);
        break;
      }

      case 'EXECUTE_QUERY': {
        const queryReq = request as ExecuteQueryRequest;
        if (!dbInstance) {
          const cached = await getDatabaseBuffer();
          if (cached && cached.buffer) {
            const SQL = await getSQL();
            rawBuffer = cached.buffer;
            dbInstance = new SQL.Database(new Uint8Array(cached.buffer));
          } else {
            throw new Error('Historical database is not loaded. Please warmup or download the database first.');
          }
        }

        const results = dbInstance.exec(queryReq.sql, queryReq.params);
        self.postMessage({
          id,
          type: 'QUERY_RESULT',
          results,
        } as QueryResultResponse);
        break;
      }

      case 'RUN_BACKTEST': {
        const backtestReq = request as RunBacktestRequest;
        const startTime = performance.now();

        // 1. Ensure SQLite DB is initialized
        if (!dbInstance) {
          self.postMessage({
            id,
            type: 'PROGRESS',
            phase: 'checking',
            loadedBytes: 0,
            totalBytes: 0,
            percent: 5,
            message: 'Checking local 10-Year SQLite Database in IndexedDB...',
          } as ProgressResponse);

          const cached = await getDatabaseBuffer();
          if (cached && cached.buffer) {
            const SQL = await getSQL();
            rawBuffer = cached.buffer;
            dbInstance = new SQL.Database(new Uint8Array(cached.buffer));
          } else {
            throw new Error('Historical SQLite database is not yet downloaded. Please sync the database first.');
          }
        }

        // 2. Build or use cached continuous market matrix
        if (!cachedMarketMatrix) {
          self.postMessage({
            id,
            type: 'PROGRESS',
            phase: 'initializing',
            loadedBytes: 0,
            totalBytes: 0,
            percent: 25,
            message: 'Querying daily OHLCV rows from SQLite database...',
          } as ProgressResponse);

          // Check available tables in the SQLite database
          const masterTablesRes = dbInstance.exec("SELECT name FROM sqlite_master WHERE type='table';");
          const tableNames = masterTablesRes[0]?.values ? masterTablesRes[0].values.map((v) => String(v[0]).toLowerCase()) : [];

          // Determine candle table: daily_ohlcv (v2.0.0) or stock_daily_ohlcv (legacy)
          const candleTable = tableNames.includes('daily_ohlcv')
            ? 'daily_ohlcv'
            : tableNames.includes('stock_daily_ohlcv')
            ? 'stock_daily_ohlcv'
            : tableNames.find((t) => /ohlc|candle|daily|price/i.test(t)) || 'daily_ohlcv';

          // Check column names for date column (trade_date vs date)
          const colRes = dbInstance.exec(`PRAGMA table_info("${candleTable}");`);
          const cols = colRes[0]?.values ? colRes[0].values.map((c) => String(c[1]).toLowerCase()) : [];
          const dateCol = cols.includes('trade_date') ? 'trade_date' : cols.includes('date') ? 'date' : 'date';

          const sql = `SELECT symbol, ${dateCol} as trade_date, open, high, low, close, volume FROM "${candleTable}" ORDER BY ${dateCol}, symbol;`;
          const queryRes = dbInstance.exec(sql);

          if (!queryRes || queryRes.length === 0 || !queryRes[0].values) {
            throw new Error(`No historical records found in ${candleTable} table.`);
          }

          // Query index_universe_history for Point-in-Time Zero-Lookahead Reconstitution (v2.0.0)
          let indexHistoryRows: any[] = [];
          if (tableNames.includes('index_universe_history')) {
            try {
              const reconRes = dbInstance.exec('SELECT symbol, effective_from, effective_to FROM index_universe_history;');
              if (reconRes && reconRes[0]?.values) {
                indexHistoryRows = reconRes[0].values;
              }
            } catch (err) {
              console.warn('Could not query index_universe_history:', err);
            }
          }

          // Query symbol_lineage for Corporate Mergers / Rebrands (v2.0.0)
          let lineageRows: any[] = [];
          if (tableNames.includes('symbol_lineage')) {
            try {
              const lineageRes = dbInstance.exec('SELECT old_symbol, new_symbol, effective_date FROM symbol_lineage;');
              if (lineageRes && lineageRes[0]?.values) {
                lineageRows = lineageRes[0].values;
              }
            } catch (err) {
              console.warn('Could not query symbol_lineage:', err);
            }
          }

          self.postMessage({
            id,
            type: 'PROGRESS',
            phase: 'initializing',
            loadedBytes: 0,
            totalBytes: 0,
            percent: 50,
            message: `Indexing ${queryRes[0].values.length.toLocaleString()} candles with ${
              indexHistoryRows.length > 0 ? `${indexHistoryRows.length} reconstitution periods & ` : ''
            }point-in-time universe filters...`,
          } as ProgressResponse);

          cachedMarketMatrix = buildMarketMatrix(queryRes[0].values, indexHistoryRows, lineageRows);
        }

        // 3. Execute Authentic Real-Data Quant Simulation
        self.postMessage({
          id,
          type: 'PROGRESS',
          phase: 'initializing',
          loadedBytes: 0,
          totalBytes: 0,
          percent: 70,
          message: 'Running multi-timeframe factor ranking & day-by-day portfolio simulator...',
        } as ProgressResponse);

        const summary = executeRealDataBacktest(
          cachedMarketMatrix,
          backtestReq.config,
          (pct, phase) => {
            self.postMessage({
              id,
              type: 'PROGRESS',
              phase: 'initializing',
              loadedBytes: 0,
              totalBytes: 0,
              percent: 70 + Math.round(pct * 0.28),
              message: phase,
            } as ProgressResponse);
          }
        );

        const executionTimeMs = Math.round(performance.now() - startTime);

        self.postMessage({
          id,
          type: 'PROGRESS',
          phase: 'ready',
          loadedBytes: 0,
          totalBytes: 0,
          percent: 100,
          message: `100% Real-Data Simulation completed in ${executionTimeMs} ms (${summary.totalTrades} real trades executed)!`,
        } as ProgressResponse);

        self.postMessage({
          id,
          type: 'BACKTEST_COMPLETE',
          summary,
          executionTimeMs,
        } as BacktestCompleteResponse);
        break;
      }

      default: {
        throw new Error(`Unsupported worker message type: ${(request as any).type}`);
      }
    }
  } catch (error: any) {
    console.error(`[Worker Error on ${type}]:`, error);
    self.postMessage({
      id,
      type: 'ERROR',
      error: error?.message || String(error) || 'Unknown worker operation error',
      code: error?.name || 'WORKER_ERROR',
    } as ErrorResponse);
  }
};
