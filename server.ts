import express from 'express';
import path from 'path';
import { Readable } from 'stream';
import { createServer as createViteServer } from 'vite';
import { readSyncStatus, executeNightlySync } from './src/utils/nightlyUniverseSync';
import { cherryPickRandomStocksForAudit, verifyQuoteCrossSource } from './src/utils/crossSourceVerification';
import { getDatabaseMetadata, saveUploadedDatabaseStream, handleUploadedChunk } from './src/utils/historicalDbService';

const app = express();
const PORT = 3000;

// API: Chunked upload of historical 10-year database (.db, .sqlite, or .zip)
// Splits large 40MB+ files into 4MB chunks to bypass Cloud Run / proxy 32MB payload ceiling
app.post(
  '/api/database/upload-chunk',
  express.raw({ limit: '15mb', type: () => true }),
  async (req, res) => {
    try {
      const uploadId = (req.headers['x-upload-id'] as string) || 'default_upload';
      const chunkIndex = parseInt((req.headers['x-chunk-index'] as string) || '0', 10);
      const totalChunks = parseInt((req.headers['x-total-chunks'] as string) || '1', 10);
      const filename = (req.headers['x-filename'] as string) || 'historical.db';
      const chunkBuffer = req.body as Buffer;

      if (!chunkBuffer || !Buffer.isBuffer(chunkBuffer) || chunkBuffer.length === 0) {
        return res.status(400).json({ success: false, error: 'Empty chunk data received' });
      }

      console.log(
        `[Chunk Upload] Received chunk ${chunkIndex + 1}/${totalChunks} for ${filename} (${(chunkBuffer.length / (1024 * 1024)).toFixed(2)} MB)`
      );

      const result = await handleUploadedChunk(uploadId, chunkIndex, totalChunks, chunkBuffer, filename);
      res.json({
        success: true,
        complete: result.complete,
        chunkIndex: result.chunkIndex,
        totalChunks: result.totalChunks,
        database: result.metadata,
      });
    } catch (err: any) {
      console.error('[Chunk Upload Error]:', err);
      res.status(500).json({ success: false, error: err.message || 'Failed to process chunk' });
    }
  }
);

// API: Get metadata & total size for the GitHub release historical database
app.get('/api/database/release-db-info', async (req, res) => {
  const targetUrl =
    (req.query.url as string) ||
    'https://github.com/gulatimayank21-png/MonetaOS/releases/download/v2.0.0/nifty500_historical_v2.db.zip';
  try {
    const headRes = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MonetaOS/1.0',
        Range: 'bytes=0-0',
      },
      redirect: 'follow',
    });

    const contentRange = headRes.headers.get('content-range');
    let totalBytes = 55000000; // Compressed zip size fallback
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      if (match && match[1]) {
        totalBytes = parseInt(match[1], 10);
      }
    } else {
      const cl = headRes.headers.get('content-length');
      if (cl && parseInt(cl, 10) > 1) {
        totalBytes = parseInt(cl, 10);
      }
    }

    const chunkSize = 8 * 1024 * 1024; // 8 MB chunks (well below Cloud Run 32MB ceiling)
    const totalChunks = Math.ceil(totalBytes / chunkSize);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      success: true,
      totalBytes,
      chunkSize,
      totalChunks,
      url: targetUrl,
      version: 'v2.0.0',
    });
  } catch (err: any) {
    console.warn('[Release Info Error]:', err.message);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      success: true,
      totalBytes: 55000000,
      chunkSize: 8 * 1024 * 1024,
      totalChunks: 7,
      url: targetUrl,
      version: 'v2.0.0',
    });
  }
});

// API: Download single 8MB chunk from GitHub Release (bypasses Cloud Run 32MB payload ceiling & CORS)
app.get('/api/database/proxy-release-chunk', async (req, res) => {
  const targetUrl =
    (req.query.url as string) ||
    'https://github.com/gulatimayank21-png/MonetaOS/releases/download/v2.0.0/nifty500_historical_v2.db.zip';
  const chunkIndex = parseInt((req.query.chunkIndex as string) || '0', 10);
  const chunkSize = parseInt((req.query.chunkSize as string) || String(8 * 1024 * 1024), 10);
  const totalBytes = parseInt((req.query.totalBytes as string) || '55000000', 10);

  const start = chunkIndex * chunkSize;
  const end = Math.min(totalBytes - 1, start + chunkSize - 1);

  if (start >= totalBytes) {
    return res.status(416).json({ error: 'Requested range not satisfiable' });
  }

  try {
    const remoteRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MonetaOS/1.0',
        Range: `bytes=${start}-${end}`,
        Accept: 'application/octet-stream, */*',
      },
      redirect: 'follow',
    });

    if (!remoteRes.ok && remoteRes.status !== 206) {
      return res.status(remoteRes.status).json({
        error: `GitHub server responded with status ${remoteRes.status}: ${remoteRes.statusText}`,
      });
    }

    const arrayBuf = await remoteRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalBytes}`);
    res.setHeader('X-Chunk-Index', chunkIndex);
    res.setHeader('X-Total-Chunks', Math.ceil(totalBytes / chunkSize));
    res.send(buffer);
  } catch (err: any) {
    console.error(`[Proxy Chunk ${chunkIndex} Error]:`, err.message);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(502).json({ error: err.message || `Failed to download chunk ${chunkIndex}` });
  }
});

// API: Direct stream upload of historical 10-year database (.db, .sqlite, or .zip up to 300MB+)
// Placed BEFORE express.json body parser to allow direct unbuffered piping of 40MB+ streams
app.get('/api/database/proxy-release-db', async (req, res) => {
  const targetUrl =
    (req.query.url as string) ||
    'https://github.com/gulatimayank21-png/MonetaOS/releases/download/v2.0.0/nifty500_historical_v2.db.zip';
  try {
    const rangeHeader = (req.headers['range'] as string) || (req.query.range as string) || undefined;
    const remoteRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MonetaOS/1.0',
        Accept: 'application/octet-stream, */*',
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      },
      redirect: 'follow',
    });

    if (!remoteRes.ok && remoteRes.status !== 206) {
      return res.status(remoteRes.status).json({
        error: `Remote GitHub release server returned ${remoteRes.status}: ${remoteRes.statusText}`,
      });
    }

    const contentLength = remoteRes.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    const contentRange = remoteRes.headers.get('content-range');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="nifty500_historical.db"');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (remoteRes.body) {
      try {
        const nodeReadable = Readable.fromWeb(remoteRes.body as any);
        nodeReadable.pipe(res);
      } catch (streamErr) {
        // Fallback for older stream representations
        const buffer = await remoteRes.arrayBuffer();
        res.send(Buffer.from(buffer));
      }
    } else {
      const buffer = await remoteRes.arrayBuffer();
      res.send(Buffer.from(buffer));
    }
  } catch (err: any) {
    console.warn('[Proxy Download Error]:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: err.message || 'Failed to proxy database download' });
    }
  }
});

// API: Proxy EOD Delta JSON from GitHub Pages (bypasses browser CORS / sandbox constraints)
app.get('/api/database/proxy-delta', async (req, res) => {
  const targetUrl =
    (req.query.url as string) ||
    'https://gulatimayank21-png.github.io/MonetaOS_M1/latest_deltas.json';
  try {
    const remoteRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MonetaOS/1.0',
        Accept: 'application/json',
      },
    });

    if (!remoteRes.ok) {
      return res.status(remoteRes.status).json({
        error: `Remote delta server returned ${remoteRes.status}: ${remoteRes.statusText}`,
      });
    }

    const data = await remoteRes.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
  } catch (err: any) {
    console.warn('[Proxy Delta Error]:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: err.message || 'Failed to proxy delta feed' });
    }
  }
});

app.post('/api/database/upload-historical-db', async (req, res) => {
  try {
    const filename = (req.headers['x-filename'] as string) || 'historical_market.db';
    console.log(`[Database Streaming Upload] Receiving ${filename}...`);

    const meta = await saveUploadedDatabaseStream(req, filename);
    console.log(
      `[Database Upload] Successfully mounted ${filename}! Found ${meta.uniqueSymbols} symbols, ${meta.totalRows} rows.`
    );

    res.json({
      success: true,
      message: `Successfully loaded database (${meta.totalRows.toLocaleString()} rows, ${meta.uniqueSymbols} symbols)`,
      database: meta,
    });
  } catch (err: any) {
    console.error('[Database Upload Error]:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to process database file' });
  }
});

app.use(express.json({ limit: '10mb' }));

// In-memory cache for live stock quotes (TTL: 5 minutes)
interface CachedQuote {
  timestamp: number;
  data: {
    symbol: string;
    cmp: number;
    lastClose: number;
    high52w: number;
    low52w: number;
    return1M: number;
    return3M: number;
    return1Y: number;
    currency: string;
    regularMarketTime: number;
  };
}

const quoteCache = new Map<string, CachedQuote>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Corporate Action & Rebranding Ticker Aliases
const SYMBOL_ALIASES: Record<string, string> = {
  ZOMATO: 'ETERNAL.NS',
  'ZOMATO.NS': 'ETERNAL.NS',
  TATAMOTORS: 'TMPV.NS',
  'TATAMOTORS.NS': 'TMPV.NS',
  LTI: 'LTIM.NS',
  'LTI.NS': 'LTIM.NS',
  MINDTREE: 'LTIM.NS',
  'MINDTREE.NS': 'LTIM.NS',
  MOTHERSUMI: 'MOTHERSON.NS',
  'MOTHERSUMI.NS': 'MOTHERSON.NS',
};

async function fetchRealStockQuote(symbol: string) {
  const upper = symbol.toUpperCase();
  const resolved = SYMBOL_ALIASES[upper] || (upper.endsWith('.NS') ? upper : `${upper}.NS`);
  const cleanSymbol = resolved;

  const cached = quoteCache.get(cleanSymbol);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${cleanSymbol}?range=1y&interval=1d`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance responded with status ${response.status}`);
  }

  const json = await response.json();
  const result = json.chart?.result?.[0];
  if (!result) {
    throw new Error(`No chart data returned for ${cleanSymbol}`);
  }

  const meta = result.meta;
  const quote = result.indicators?.quote?.[0];
  const closes: number[] = (quote?.close || []).filter((c: any) => typeof c === 'number' && !isNaN(c));

  if (closes.length === 0) {
    throw new Error(`No valid closing price history for ${cleanSymbol}`);
  }

  const lastClose = Number((closes[closes.length - 1]).toFixed(2));
  const liveCmp = Number((meta.regularMarketPrice || lastClose).toFixed(2));
  const high52w = Number((meta.fiftyTwoWeekHigh || Math.max(...closes)).toFixed(2));
  const low52w = Number((meta.fiftyTwoWeekLow || Math.min(...closes)).toFixed(2));

  // Compute returns: 1M (~21 trading days), 3M (~63 trading days), 1Y (~252 trading days)
  const idx1M = Math.max(0, closes.length - 22);
  const idx3M = Math.max(0, closes.length - 64);
  const idx1Y = 0;

  const close1M = closes[idx1M] || lastClose;
  const close3M = closes[idx3M] || lastClose;
  const close1Y = closes[idx1Y] || lastClose;

  const return1M = Number((((lastClose / close1M) - 1) * 100).toFixed(1));
  const return3M = Number((((lastClose / close3M) - 1) * 100).toFixed(1));
  const return1Y = Number((((lastClose / close1Y) - 1) * 100).toFixed(1));

  const quoteData = {
    symbol: cleanSymbol,
    cmp: liveCmp,
    lastClose,
    high52w,
    low52w,
    return1M,
    return3M,
    return1Y,
    currency: meta.currency || 'INR',
    regularMarketTime: meta.regularMarketTime || Math.floor(Date.now() / 1000),
  };

  quoteCache.set(cleanSymbol, {
    timestamp: Date.now(),
    data: quoteData,
  });

  return quoteData;
}

// API: Single stock real live quote
app.get('/api/live-quote/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const data = await fetchRealStockQuote(symbol);
    res.json({ success: true, data });
  } catch (error: any) {
    console.error(`Error fetching live quote for ${req.params.symbol}:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Official NSE India Archive Index URLs
const NSE_INDEX_URLS: Record<string, string> = {
  nifty500: 'https://archives.nseindia.com/content/indices/ind_nifty500list.csv',
  nifty50: 'https://archives.nseindia.com/content/indices/ind_nifty50list.csv',
  niftynext50: 'https://archives.nseindia.com/content/indices/ind_niftynext50list.csv',
  niftymidcap150: 'https://archives.nseindia.com/content/indices/ind_niftymidcap150list.csv',
  niftysmallcap250: 'https://archives.nseindia.com/content/indices/ind_niftysmallcap250list.csv',
};

// API: Pull live constituents directly from official NSE India archives
app.get('/api/nse/fetch-index/:indexKey', async (req, res) => {
  try {
    const indexKey = req.params.indexKey.toLowerCase();
    const url = NSE_INDEX_URLS[indexKey];
    if (!url) {
      return res.status(400).json({
        success: false,
        error: `Unknown index: ${indexKey}. Available: ${Object.keys(NSE_INDEX_URLS).join(', ')}`,
      });
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/csv,text/plain,*/*',
      },
    });

    if (!response.ok) {
      throw new Error(`NSE archive responded with status ${response.status}`);
    }

    const text = await response.text();
    const lines = text.trim().split('\n');
    const header = lines[0].split(',');
    
    // Find index columns
    const symIdx = header.findIndex((h) => /symbol/i.test(h));
    const nameIdx = header.findIndex((h) => /company\s*name/i.test(h));
    const indIdx = header.findIndex((h) => /industry/i.test(h));
    const isinIdx = header.findIndex((h) => /isin/i.test(h));

    const constituents: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(',');
      const rawSymbol = cols[symIdx !== -1 ? symIdx : 2]?.trim();
      if (!rawSymbol || rawSymbol.startsWith('DUMMY')) continue;

      let symbol = rawSymbol.toUpperCase();
      let name = cols[nameIdx !== -1 ? nameIdx : 0]?.trim() || `${symbol} Ltd.`;
      const sector = cols[indIdx !== -1 ? indIdx : 1]?.trim() || 'Diversified';
      const isin = isinIdx !== -1 ? cols[isinIdx]?.trim() : '';

      // Alias resolution
      if (symbol === 'ZOMATO') {
        symbol = 'ETERNAL';
        name = 'Eternal Ltd.';
      } else if (symbol === 'TATAMOTORS') {
        symbol = 'TMPV';
        name = 'Tata Motors Passenger Vehicles Ltd.';
      }

      let category = 'Small Cap';
      if (indexKey === 'nifty50' || indexKey === 'niftynext50') {
        category = 'Large Cap';
      } else if (indexKey === 'niftymidcap150') {
        category = 'Mid Cap';
      }

      constituents.push({
        id: symbol.toLowerCase(),
        symbol: `${symbol}.NS`,
        ticker: symbol,
        name,
        sector,
        category,
        isin,
      });
    }

    res.json({
      success: true,
      indexKey,
      count: constituents.length,
      constituents,
    });
  } catch (error: any) {
    console.error('Error fetching NSE index CSV:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Batch live quotes (supports up to 500 symbols)
app.post('/api/live-quotes-batch', async (req, res) => {
  try {
    const { symbols } = req.body;
    if (!Array.isArray(symbols)) {
      return res.status(400).json({ success: false, error: 'Symbols must be an array' });
    }

    // Process up to 500 symbols in concurrent chunks of 25
    const targetSymbols = symbols.slice(0, 500);
    const results: Record<string, any> = {};

    const chunkSize = 25;
    for (let i = 0; i < targetSymbols.length; i += chunkSize) {
      const chunk = targetSymbols.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (sym: string) => {
          try {
            const q = await fetchRealStockQuote(sym);
            results[sym.toUpperCase().replace(/\.NS$/, '')] = q;
          } catch {
            // Ignore individual symbol failures
          }
        })
      );
    }

    res.json({ success: true, count: Object.keys(results).length, quotes: results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Nightly universe refresh status
app.get('/api/universe/sync-status', (req, res) => {
  try {
    const status = readSyncStatus();
    res.json({ success: true, status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Trigger or test nightly sync (supports ?forceFail=true for failure testing)
app.post('/api/universe/trigger-nightly-sync', async (req, res) => {
  try {
    const { forceFail, failureReason } = req.body || {};
    const result = await executeNightlySync({
      forceFail: Boolean(forceFail),
      failureReason,
    });
    res.json({ success: !result.hasFailure, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Random cherry-pick CMP verification across independent sources
app.get('/api/audit/random-cherry-pick', async (req, res) => {
  try {
    const count = parseInt(req.query.count as string) || 5;
    const audits = await cherryPickRandomStocksForAudit(undefined, count, Date.now());
    res.json({ success: true, count: audits.length, audits });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Verify single stock CMP against secondary source
app.get('/api/audit/verify-stock/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const live = await fetchRealStockQuote(ticker);
    const audit = await verifyQuoteCrossSource({
      ticker,
      symbol: `${ticker}.NS`,
      cmp: live.cmp,
      lastClose: live.lastClose,
      high52w: live.high52w,
    });
    res.json({ success: true, audit });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get status of historical 10-year OHLCV database
app.get('/api/database/status', (req, res) => {
  try {
    const meta = getDatabaseMetadata();
    res.json({ success: true, database: meta });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Background Automated Nightly Universe Sync Scheduler
setInterval(async () => {
  try {
    console.log('[Nightly Scheduler] Checking automated universe refresh...');
    await executeNightlySync({ fetchLiveFromNSE: true });
  } catch (err) {
    console.error('[Nightly Scheduler] Error during scheduled sync:', err);
  }
}, 12 * 60 * 60 * 1000); // Check every 12 hours (and at midnight EOD)

// API: Healthcheck
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', cacheSize: quoteCache.size });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
