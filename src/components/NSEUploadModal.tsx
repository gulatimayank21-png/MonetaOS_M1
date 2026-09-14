import React, { useState, useRef } from 'react';
import { X, Upload, FileText, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { StockRecord } from '../types';

interface NSEUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyCustomStocks: (stocks: StockRecord[]) => void;
  onResetDefaults: () => void;
}

export const NSEUploadModal: React.FC<NSEUploadModalProps> = ({
  isOpen,
  onClose,
  onApplyCustomStocks,
  onResetDefaults,
}) => {
  const [pasteText, setPasteText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      parseCSV(content);
    };
    reader.readAsText(file);
  };

  const parseCSV = (content: string) => {
    try {
      setErrorMsg(null);
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        throw new Error('CSV file is empty or missing headers.');
      }

      const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
      const symbolIdx = headers.findIndex((h) => h.includes('symbol'));
      const companyIdx = headers.findIndex((h) => h.includes('company') || h.includes('name'));
      const industryIdx = headers.findIndex((h) => h.includes('industry') || h.includes('sector'));

      if (symbolIdx === -1) {
        throw new Error('Could not locate "Symbol" column in CSV header.');
      }

      const parsed: StockRecord[] = [];

      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        if (row.length <= symbolIdx) continue;

        const rawSymbol = row[symbolIdx].toUpperCase();
        if (!rawSymbol) continue;

        let ticker = rawSymbol.replace(/\.NS$/i, '');
        let company = companyIdx !== -1 && row[companyIdx] ? row[companyIdx] : `${ticker} Ltd.`;
        const sector = industryIdx !== -1 && row[industryIdx] ? row[industryIdx] : 'Diversified';

        // Auto-resolve known corporate actions & rebranded entities
        if (ticker === 'ZOMATO') {
          ticker = 'ETERNAL';
          company = 'Eternal Limited (formerly Zomato)';
        } else if (ticker === 'TATAMOTORS') {
          ticker = 'TMPV';
          company = 'Tata Motors Passenger Vehicles Limited';
        } else if (ticker === 'LTI' || ticker === 'MINDTREE') {
          ticker = 'LTIM';
          company = 'LTIMindtree Limited';
        } else if (ticker === 'MOTHERSUMI') {
          ticker = 'MOTHERSON';
          company = 'Samvardhana Motherson International Limited';
        }

        // Generate consistent pseudo-realistic values if not present
        const seed = rawSymbol.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const lastClose = Math.round(100 + (seed % 4500));
        const deltaPct = Number((((seed % 20) - 10) * 0.1).toFixed(1));
        const cmp = Number((lastClose * (1 + deltaPct / 100)).toFixed(1));
        const high52w = Math.round(lastClose * (1 + (seed % 25) / 100));
        const low52w = Math.round(lastClose * 0.55);

        // Simulated realistic returns based on symbol characteristics
        const ret1M = Number((((seed % 35) - 8)).toFixed(1));
        const ret3M = Number((((seed % 60) - 5)).toFixed(1));
        const ret1Y = Number((((seed % 180) - 10)).toFixed(1));

        parsed.push({
          id: ticker.toLowerCase(),
          symbol: `${ticker}.NS`,
          ticker,
          name: company,
          sector,
          category: lastClose > 2500 ? 'Large Cap' : lastClose > 800 ? 'Mid Cap' : 'Small Cap',
          lastClose,
          cmp,
          cmpChangePct: deltaPct,
          high52w,
          low52w,
          return1M: ret1M,
          return3M: ret3M,
          return1Y: ret1Y,
        });
      }

      if (parsed.length === 0) {
        throw new Error('No valid stock symbols extracted.');
      }

      onApplyCustomStocks(parsed);
      setSuccessMsg(`Successfully imported ${parsed.length} symbols from CSV!`);
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to parse CSV.');
    }
  };

  const handlePasteSubmit = () => {
    if (!pasteText.trim()) return;
    const lines = ['Company Name,Industry,Symbol'];
    const rawTokens = pasteText.split(/[\n,; \t]+/).filter((t) => t.trim().length > 0);
    rawTokens.forEach((tok) => {
      const clean = tok.trim().toUpperCase().replace(/\.NS$/i, '');
      if (clean) lines.push(`"${clean} India","General","${clean}"`);
    });
    parseCSV(lines.join('\n'));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-start justify-between bg-slate-50/50 rounded-t-2xl">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-slate-100 text-slate-800">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                  Import Nifty 500 Universe
                </h2>
                <p className="text-xs text-slate-500">
                  Load official NSE CSV (<span className="font-mono">ind_nifty500list.csv</span>) or custom symbols
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
        <div className="p-5 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Drag & drop / file upload */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="p-6 border-2 border-dashed border-slate-200 rounded-xl hover:border-slate-400 hover:bg-slate-50/50 cursor-pointer flex flex-col items-center justify-center text-center transition-all"
          >
            <FileText className="w-8 h-8 text-slate-400 mb-2" />
            <span className="font-semibold text-slate-700">Click to upload official CSV</span>
            <span className="text-[11px] text-slate-400 mt-0.5">
              Downloaded from archives.nseindia.com/content/indices/ind_nifty500list.csv
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Or Paste text */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
              Or Paste Stock Symbols
            </label>
            <textarea
              rows={3}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="e.g. TRENT, BEL, COCHINSHIP, DIXON, MAZDOCK, SUZLON..."
              className="w-full p-2.5 rounded-lg border border-slate-200 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50/50"
            />
            <button
              onClick={handlePasteSubmit}
              className="w-full py-2 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800 transition-colors"
            >
              Parse &amp; Scan Custom Symbols
            </button>
          </div>

          {/* Reset to Curated Master List */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-slate-500">
            <span>Restore default Nifty 500 constituents:</span>
            <button
              onClick={() => {
                onResetDefaults();
                setSuccessMsg('Restored full curated Nifty 500 constituents!');
                setTimeout(() => onClose(), 800);
              }}
              className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900 font-semibold underline text-xs"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Reset to Defaults</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
