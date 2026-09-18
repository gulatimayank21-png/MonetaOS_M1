/**
 * EOD Delta Synchronization Service for MonetaOS SQLite Database
 *
 * Automatically pulls new market candles from GitHub Pages into the client-side SQLite database.
 * Executes non-blockingly right after database initialization.
 * Audits tracked universe constituents and alerts the user if any stocks are missing from Bhavcopy.
 */

import type { Database } from 'sql.js';

export const DELTA_SYNC_ENDPOINT =
  'https://gulatimayank21-png.github.io/MonetaOS_M1/latest_deltas.json';

export interface DeltaPayloadItem {
  symbol: string;
  trade_date: string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
}

export interface MacroDeltaPayloadItem {
  index_name: string;
  trade_date: string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
}

export interface DeltaPayload {
  updated_at?: string;
  target_date?: string;
  covered_dates?: string[];
  record_count?: number;
  macro_count?: number;
  data: DeltaPayloadItem[];
  macro_data?: MacroDeltaPayloadItem[];
}

export interface MissingStocksAudit {
  tradeDate: string;
  missingCount: number;
  expectedCount: number;
  receivedCount: number;
  missingSymbols: string[];
}

export interface DeltaSyncResult {
  syncedCount: number;
  macroSyncedCount?: number;
  maxDate: string;
  maxMacroDate?: string;
  previousMaxDate: string;
  message: string;
  timestamp: number;
  coveredDates?: string[];
  status: 'synced' | 'up_to_date' | 'failed' | 'skipped';
  error?: string;
  hasMissingStocks?: boolean;
  missingAudits?: MissingStocksAudit[];
  missingWarningMessage?: string;
}

/**
 * Synchronizes new EOD candles into the active SQLite database instance.
 *
 * @param db Active sql.js Database instance
 * @param options Optional configuration and progress callbacks
 */
export async function syncLatestDeltas(
  db: Database,
  options?: {
    endpointUrl?: string;
    apiOrigin?: string;
    onProgress?: (message: string) => void;
  }
): Promise<DeltaSyncResult> {
  const onProgress = options?.onProgress || (() => {});
  const endpoint = options?.endpointUrl || DELTA_SYNC_ENDPOINT;

  try {
    // 1. Discover target table and date column
    const masterTablesRes = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
    );
    const tables = masterTablesRes[0]?.values
      ? masterTablesRes[0].values.map((v) => String(v[0]))
      : [];

    const candleTable =
      tables.find((t) => t.toLowerCase() === 'daily_ohlcv') ||
      tables.find((t) => t.toLowerCase() === 'stock_daily_ohlcv') ||
      tables.find((t) => /ohlc|candle|daily|price|history/i.test(t)) ||
      'daily_ohlcv';

    let dateCol = 'trade_date';
    try {
      const colRes = db.exec(`PRAGMA table_info("${candleTable}");`);
      const cols = colRes[0]?.values
        ? colRes[0].values.map((c) => String(c[1]).toLowerCase())
        : [];
      if (cols.includes('trade_date')) {
        dateCol = 'trade_date';
      } else if (cols.includes('date')) {
        dateCol = 'date';
      }
    } catch (_) {}

    // Ensure macro_daily table and indexes exist
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS macro_daily (
            trade_date TEXT NOT NULL,
            index_name TEXT NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL NOT NULL,
            volume INTEGER,
            PRIMARY KEY (trade_date, index_name)
        );
        CREATE INDEX IF NOT EXISTS idx_macro_date ON macro_daily(trade_date);
        CREATE INDEX IF NOT EXISTS idx_macro_name_date ON macro_daily(index_name, trade_date);
      `);
    } catch (tblErr) {
      console.warn('[EOD Delta Sync] Table init check for macro_daily warning:', tblErr);
    }

    // Step 1: Check Local Baseline Dates (Stocks & Macro)
    let maxLocalDate = '2015-01-01';
    try {
      const maxDateRes = db.exec(`SELECT MAX("${dateCol}") AS max_date FROM "${candleTable}";`);
      if (maxDateRes[0]?.values?.[0]?.[0]) {
        maxLocalDate = String(maxDateRes[0].values[0][0]);
      }
    } catch (err) {
      console.warn('[EOD Delta Sync] Could not query max stock date, defaulting to 2015-01-01:', err);
    }

    let maxLocalMacroDate = '2015-01-01';
    try {
      const maxMacroRes = db.exec(`SELECT MAX(trade_date) AS max_date FROM macro_daily;`);
      if (maxMacroRes[0]?.values?.[0]?.[0]) {
        maxLocalMacroDate = String(maxMacroRes[0].values[0][0]);
      }
    } catch (_) {}

    onProgress(`Checking for new market & macro candles beyond ${maxLocalDate}...`);

    // Step 2: Fetch Remote Payload (with cache-busting timestamp)
    const timestamp = Date.now();
    const urlWithTimestamp = `${endpoint}?t=${timestamp}`;

    let payload: DeltaPayload | null = null;

    // Tier 1: Direct Fetch
    try {
      const res = await fetch(urlWithTimestamp, {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        payload = await res.json();
      }
    } catch (directErr: any) {
      console.warn('[EOD Delta Sync] Direct GitHub Pages fetch failed, attempting server proxy...', directErr.message);
    }

    // Tier 2: Server Proxy Fallback (if direct fetch had CORS / network issues)
    if (!payload) {
      try {
        const baseUrl =
          options?.apiOrigin ||
          (typeof self !== 'undefined' &&
          self.location &&
          self.location.origin &&
          self.location.origin !== 'null' &&
          !self.location.origin.startsWith('blob:')
            ? self.location.origin
            : '');

        const proxyUrl = `${baseUrl}/api/database/proxy-delta?url=${encodeURIComponent(
          urlWithTimestamp
        )}`;
        const proxyRes = await fetch(proxyUrl, {
          headers: { Accept: 'application/json' },
        });
        if (proxyRes.ok) {
          payload = await proxyRes.json();
        }
      } catch (proxyErr: any) {
        console.warn('[EOD Delta Sync] Proxy fetch also unavailable:', proxyErr.message);
      }
    }

    // If payload could not be fetched (offline / network error), fail gracefully and non-blockingly
    if (!payload || !Array.isArray(payload.data)) {
      console.warn('[EOD Delta Sync] Remote delta payload unavailable or invalid. Retaining local baseline.');
      return {
        syncedCount: 0,
        maxDate: maxLocalDate,
        previousMaxDate: maxLocalDate,
        message: `Offline mode: database retained through ${maxLocalDate}`,
        timestamp: Date.now(),
        status: 'skipped',
      };
    }

    // Step 3: Universe Filtering (Option A) & Constituent Audit
    // Query tracked symbols from stock_market_lifespan if present, else fallback to distinct symbols in candle table
    let activeTodaySet = new Set<string>();
    const expectedSymbolsList: string[] = [];
    const hasLifespanTable = tables.some(
      (t) => t.toLowerCase() === 'stock_market_lifespan'
    );

    if (hasLifespanTable) {
      try {
        const lifespanRes = db.exec(
          "SELECT symbol FROM stock_market_lifespan WHERE market_status = 'ACTIVE_TODAY';"
        );
        if (lifespanRes[0]?.values) {
          lifespanRes[0].values.forEach((val) => {
            if (val[0]) {
              const rawSym = String(val[0]).trim().toUpperCase();
              const cleanSym = rawSym.replace(/\.NS$/i, '');
              expectedSymbolsList.push(cleanSym);
              activeTodaySet.add(rawSym);
              activeTodaySet.add(cleanSym);
            }
          });
        }
      } catch (e) {
        console.warn('[EOD Delta Sync] Error querying stock_market_lifespan:', e);
      }
    }

    // Fallback: If stock_market_lifespan table is missing or returned 0 rows, use distinct symbols from candle table
    if (activeTodaySet.size === 0) {
      try {
        const symRes = db.exec(`SELECT DISTINCT symbol FROM "${candleTable}";`);
        if (symRes[0]?.values) {
          symRes[0].values.forEach((val) => {
            if (val[0]) {
              const rawSym = String(val[0]).trim().toUpperCase();
              const cleanSym = rawSym.replace(/\.NS$/i, '');
              expectedSymbolsList.push(cleanSym);
              activeTodaySet.add(rawSym);
              activeTodaySet.add(cleanSym);
            }
          });
        }
      } catch (e) {
        console.warn('[EOD Delta Sync] Error querying distinct symbols:', e);
      }
    }

    // Step 3B: Constituent Audit (Set Difference per new trading date)
    // Group payload items newer than maxLocalDate by trade_date
    const payloadByDate = new Map<string, DeltaPayloadItem[]>();
    for (const item of payload.data) {
      const tradeDate = item.trade_date;
      if (tradeDate && tradeDate > maxLocalDate) {
        if (!payloadByDate.has(tradeDate)) {
          payloadByDate.set(tradeDate, []);
        }
        payloadByDate.get(tradeDate)!.push(item);
      }
    }

    const missingAudits: MissingStocksAudit[] = [];
    const uniqueExpectedSymbols = Array.from(new Set(expectedSymbolsList)).sort();

    if (uniqueExpectedSymbols.length > 0 && payloadByDate.size > 0) {
      for (const [tradeDate, itemsForDate] of payloadByDate.entries()) {
        const receivedSymbolsSet = new Set<string>();
        for (const it of itemsForDate) {
          if (it.symbol) {
            const sym = it.symbol.trim().toUpperCase();
            receivedSymbolsSet.add(sym);
            receivedSymbolsSet.add(sym.replace(/\.NS$/i, ''));
          }
        }

        // missingSymbols = expectedSymbols - receivedSymbolsForDate
        const missingSymbols = uniqueExpectedSymbols.filter(
          (sym) => !receivedSymbolsSet.has(sym) && !receivedSymbolsSet.has(`${sym}.NS`)
        );

        if (missingSymbols.length > 0) {
          missingAudits.push({
            tradeDate,
            missingCount: missingSymbols.length,
            expectedCount: uniqueExpectedSymbols.length,
            receivedCount: receivedSymbolsSet.size,
            missingSymbols,
          });

          // Log complete list to console.warn for copy-pasting and troubleshooting
          console.warn(
            `[EOD Delta Sync Warning] ⚠️ Missing ${missingSymbols.length} tracked stocks in Bhavcopy for trade date ${tradeDate} (Expected: ${uniqueExpectedSymbols.length}, Received: ${receivedSymbolsSet.size}):`,
            missingSymbols
          );
        }
      }
    }

    // Filter remote data for records with trade_date > maxLocalDate and matching active symbol
    const matchingRecords = payload.data.filter((item) => {
      const tradeDate = item.trade_date;
      if (!tradeDate || tradeDate <= maxLocalDate) return false;

      const sym = (item.symbol || '').trim().toUpperCase();
      const symClean = sym.replace(/\.NS$/i, '');

      // If active set is populated, enforce membership
      if (activeTodaySet.size > 0) {
        return activeTodaySet.has(sym) || activeTodaySet.has(symClean);
      }
      return true;
    });

    // Filter macro_data records with trade_date > maxLocalMacroDate (or beyond maxLocalDate)
    const matchingMacroRecords = (payload.macro_data || []).filter((item) => {
      const tradeDate = item.trade_date;
      if (!tradeDate) return false;
      return tradeDate > maxLocalMacroDate || tradeDate > maxLocalDate;
    });

    if (matchingRecords.length === 0 && matchingMacroRecords.length === 0) {
      const msg = `Database is up to date through ${maxLocalDate}. No new market or macro deltas found.`;
      console.log(`[EOD Delta Sync] ${msg}`);
      return {
        syncedCount: 0,
        macroSyncedCount: 0,
        maxDate: maxLocalDate,
        maxMacroDate: maxLocalMacroDate,
        previousMaxDate: maxLocalDate,
        message: msg,
        timestamp: Date.now(),
        coveredDates: payload.covered_dates || (payload.target_date ? [payload.target_date] : []),
        status: 'up_to_date',
      };
    }

    onProgress(
      `Upserting ${matchingRecords.length} stock candles and ${matchingMacroRecords.length} macro records into SQLite...`
    );

    // Step 4: Batch Atomic UPSERT (Fault-tolerant: continues inserting valid candles)
    db.exec('BEGIN TRANSACTION;');

    let upsertSucceeded = false;

    // Primary attempt: standard SQLite ON CONFLICT(symbol, dateCol) DO UPDATE
    if (matchingRecords.length > 0) {
      try {
        const upsertSql = `
          INSERT INTO "${candleTable}" (symbol, ${dateCol}, open, high, low, close, volume)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(symbol, ${dateCol}) DO UPDATE SET
            open = excluded.open,
            high = excluded.high,
            low = excluded.low,
            close = excluded.close,
            volume = excluded.volume;
        `;
        const stmt = db.prepare(upsertSql);

        for (const row of matchingRecords) {
          stmt.run([
            row.symbol,
            row.trade_date,
            Number(row.open),
            Number(row.high),
            Number(row.low),
            Number(row.close),
            Number(row.volume || 0),
          ]);
        }
        stmt.free();
        upsertSucceeded = true;
      } catch (conflictErr) {
        console.warn('[EOD Delta Sync] ON CONFLICT failed, trying INSERT OR REPLACE fallback:', conflictErr);
      }

      // Fallback attempt: INSERT OR REPLACE
      if (!upsertSucceeded) {
        const replaceSql = `
          INSERT OR REPLACE INTO "${candleTable}" (symbol, ${dateCol}, open, high, low, close, volume)
          VALUES (?, ?, ?, ?, ?, ?, ?);
        `;
        const stmt = db.prepare(replaceSql);
        for (const row of matchingRecords) {
          stmt.run([
            row.symbol,
            row.trade_date,
            Number(row.open),
            Number(row.high),
            Number(row.low),
            Number(row.close),
            Number(row.volume || 0),
          ]);
        }
        stmt.free();
      }
    }

    // Upsert macro records into macro_daily table
    let macroUpsertCount = 0;
    if (matchingMacroRecords.length > 0) {
      try {
        const macroSql = `
          INSERT OR REPLACE INTO macro_daily (trade_date, index_name, open, high, low, close, volume)
          VALUES (?, ?, ?, ?, ?, ?, ?);
        `;
        const macroStmt = db.prepare(macroSql);
        for (const mRow of matchingMacroRecords) {
          macroStmt.run([
            mRow.trade_date,
            (mRow.index_name || '').trim().toUpperCase(),
            Number(mRow.open || mRow.close),
            Number(mRow.high || mRow.close),
            Number(mRow.low || mRow.close),
            Number(mRow.close),
            Number(mRow.volume || 0),
          ]);
          macroUpsertCount++;
        }
        macroStmt.free();
      } catch (macroErr) {
        console.warn('[EOD Delta Sync] Failed inserting macro records into macro_daily:', macroErr);
      }
    }

    db.exec('COMMIT;');

    // Step 5: Query new max dates after commit
    let newMaxDate = maxLocalDate;
    try {
      const newMaxRes = db.exec(`SELECT MAX("${dateCol}") AS max_date FROM "${candleTable}";`);
      if (newMaxRes[0]?.values?.[0]?.[0]) {
        newMaxDate = String(newMaxRes[0].values[0][0]);
      }
    } catch (_) {}

    let newMaxMacroDate = maxLocalMacroDate;
    try {
      const newMaxMacroRes = db.exec(`SELECT MAX(trade_date) AS max_date FROM macro_daily;`);
      if (newMaxMacroRes[0]?.values?.[0]?.[0]) {
        newMaxMacroDate = String(newMaxMacroRes[0].values[0][0]);
      }
    } catch (_) {}

    const hasMissingStocks = missingAudits.length > 0;
    let missingWarningMessage: string | undefined;

    if (hasMissingStocks) {
      const totalMissing = missingAudits.reduce((acc, curr) => acc + curr.missingCount, 0);
      const datesStr = missingAudits.map((a) => a.tradeDate).join(', ');
      const sampleTickers = missingAudits[0].missingSymbols.slice(0, 3).join(', ');
      const moreCount = missingAudits[0].missingSymbols.length > 3 ? ` +${missingAudits[0].missingSymbols.length - 3} more` : '';
      missingWarningMessage = `⚠️ Data Sync Warning: ${totalMissing} stocks had missing candle data for ${datesStr} (e.g. ${sampleTickers}${moreCount})`;
    }

    const macroNote = macroUpsertCount > 0 ? ` + ${macroUpsertCount} macro records` : '';
    const successMessage = hasMissingStocks
      ? `Synced ${matchingRecords.length} candles${macroNote} through ${newMaxDate} (${missingAudits.length} dates had missing constituents)`
      : `✅ Database synced: ${matchingRecords.length} stock candles${macroNote} added through ${newMaxDate}.`;

    console.log(`[EOD Delta Sync] ${successMessage}`);

    return {
      syncedCount: matchingRecords.length,
      macroSyncedCount: macroUpsertCount,
      maxDate: newMaxDate,
      maxMacroDate: newMaxMacroDate,
      previousMaxDate: maxLocalDate,
      message: successMessage,
      timestamp: Date.now(),
      coveredDates: payload.covered_dates || (payload.target_date ? [payload.target_date] : []),
      status: 'synced',
      hasMissingStocks,
      missingAudits,
      missingWarningMessage,
    };
  } catch (err: any) {
    console.error('[EOD Delta Sync Error]:', err);
    try {
      db.exec('ROLLBACK;');
    } catch (_) {}
    return {
      syncedCount: 0,
      maxDate: '2015-01-01',
      previousMaxDate: '2015-01-01',
      message: `Delta sync encountered error: ${err.message || err}`,
      timestamp: Date.now(),
      status: 'failed',
      error: err.message || String(err),
    };
  }
}
