import React from 'react';
import { Layers } from 'lucide-react';
import { NSEIndexKey } from '../types';
import { NSE_INDEX_OPTIONS } from '../data/nifty500Data';

interface IndexSelectorBarProps {
  selectedIndex: NSEIndexKey;
  onSelectIndex: (indexKey: NSEIndexKey) => void;
  stockCount: number;
  winnerCount: number;
}

export const IndexSelectorBar: React.FC<IndexSelectorBarProps> = ({
  selectedIndex,
  onSelectIndex,
  stockCount,
  winnerCount,
}) => {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs px-5 py-3.5 transition-all">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3.5">
        {/* Left: Section Label & Icon */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-2xs">
            <Layers className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
              Benchmark Index Universe
            </div>
            <div className="text-xs font-semibold text-slate-800 flex items-center gap-2">
              <span>{stockCount} Verified Constituents</span>
              <span className="text-slate-300">•</span>
              <span className="text-emerald-700 font-bold">{winnerCount} Qualified Leaders</span>
            </div>
          </div>
        </div>

        {/* Right: Unified Segmented Control for the 5 Indices */}
        <div className="flex items-center p-1 bg-slate-100/90 rounded-xl border border-slate-200/80 overflow-x-auto">
          {NSE_INDEX_OPTIONS.map((opt) => {
            const isActive = opt.key === selectedIndex;
            return (
              <button
                key={opt.key}
                id={`btn-index-${opt.key}`}
                onClick={() => onSelectIndex(opt.key)}
                className={`relative px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center ${
                  isActive
                    ? 'bg-white text-slate-950 shadow-xs font-bold border border-slate-200/90'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

