import React, { useState } from 'react';
import { X, Copy, Check, Download, Terminal, Code2 } from 'lucide-react';
import { generateStreamlitScript } from '../utils/pythonCodeGenerator';

interface PythonStreamlitModalProps {
  isOpen: boolean;
  onClose: () => void;
  percentileThreshold: number;
  maxDistance52WHighPct: number;
  enforce52WHigh: boolean;
}

export const PythonStreamlitModal: React.FC<PythonStreamlitModalProps> = ({
  isOpen,
  onClose,
  percentileThreshold,
  maxDistance52WHighPct,
  enforce52WHigh,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const pythonScript = generateStreamlitScript({
    percentileThreshold,
    maxDistance52WHighPct,
    enforce52WHigh,
  });

  const copyScript = () => {
    navigator.clipboard.writeText(pythonScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadAppPy = () => {
    const blob = new Blob([pythonScript], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'app.py';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadRequirements = () => {
    const text = 'streamlit>=1.30.0\nyfinance>=0.2.35\npandas>=2.0.0\nnumpy>=1.24.0\n';
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'requirements.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-start justify-between bg-slate-50/50 rounded-t-2xl">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-100 text-blue-800">
                <Code2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                  Python &amp; Streamlit Strategy Script
                </h2>
                <p className="text-xs text-slate-500">
                  Ready-to-run script utilizing yfinance, pandas, and Streamlit as requested
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
        <div className="p-5 space-y-4">
          {/* Terminal Run Guide */}
          <div className="p-3.5 rounded-xl bg-slate-900 text-slate-200 font-mono text-xs space-y-2 border border-slate-800">
            <div className="flex items-center gap-2 text-slate-400 text-[11px]">
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>How to run locally on your machine:</span>
            </div>
            <div className="p-2 rounded bg-slate-950 border border-slate-800 text-emerald-400 select-all">
              pip install streamlit yfinance pandas numpy
            </div>
            <div className="p-2 rounded bg-slate-950 border border-slate-800 text-emerald-400 select-all">
              streamlit run app.py
            </div>
          </div>

          {/* Code Viewer */}
          <div className="relative rounded-xl border border-slate-200 bg-slate-950 text-slate-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900 text-xs">
              <span className="font-mono text-slate-400">app.py</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={copyScript}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied to Clipboard!' : 'Copy Code'}</span>
                </button>
              </div>
            </div>
            <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto max-h-96 leading-relaxed">
              {pythonScript}
            </pre>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/50 rounded-b-2xl">
          <div className="text-xs text-slate-500">
            Downloads official NSE India list, calculates 1M/3M/1Y returns, and finds the Sweet Spot.
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={downloadRequirements}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>requirements.txt</span>
            </button>

            <button
              onClick={downloadAppPy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download app.py</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
