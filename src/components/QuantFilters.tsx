import React from 'react';
import { Search, SlidersHorizontal, ArrowUpDown, HelpCircle } from 'lucide-react';
import { FilterSettings, SectorTailwindInfo } from '../types';

interface QuantFiltersProps {
  filters: FilterSettings;
  onChangeFilters: (updated: Partial<FilterSettings>) => void;
  sectorTailwinds: SectorTailwindInfo[];
  availableSectors: string[];
}

export const QuantFilters: React.FC<QuantFiltersProps> = ({
  filters,
  onChangeFilters,
  sectorTailwinds,
  availableSectors,
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3.5">
      {/* Row 1: Search, Sector, Category, Sort */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Search */}
        <div className="relative">
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Search Stock / Ticker
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              id="input-search-stock"
              type="text"
              value={filters.searchQuery}
              onChange={(e) => onChangeFilters({ searchQuery: e.target.value })}
              placeholder="e.g. TRENT, BEL, COCHINSHIP"
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 bg-slate-50/50"
            />
          </div>
        </div>

        {/* Sector Filter with Tailwinds Badges */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Sector / Industry
            </label>
            {sectorTailwinds.some((s) => s.isTailwind) && (
              <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 px-1.5 py-0.2 rounded">
                ⚡ Tailwinds Active
              </span>
            )}
          </div>
          <select
            id="select-sector"
            value={filters.selectedSector}
            onChange={(e) => onChangeFilters({ selectedSector: e.target.value })}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50/50 text-slate-800 font-medium"
          >
            <option value="ALL">All Sectors ({availableSectors.length})</option>
            {availableSectors.map((sector) => {
              const tailwind = sectorTailwinds.find((st) => st.sector === sector);
              return (
                <option key={sector} value={sector}>
                  {sector} {tailwind ? `(🔥 ${tailwind.overlappingCount} in Top Overlap)` : ''}
                </option>
              );
            })}
          </select>
        </div>

        {/* Market Cap Category */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Market Cap
          </label>
          <select
            id="select-category"
            value={filters.selectedCategory}
            onChange={(e) => onChangeFilters({ selectedCategory: e.target.value })}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50/50 text-slate-800 font-medium"
          >
            <option value="ALL">All Market Caps (Large + Mid + Small)</option>
            <option value="Large Cap">Large Cap Only</option>
            <option value="Mid Cap">Mid Cap Only</option>
            <option value="Small Cap">Small Cap Only</option>
          </select>
        </div>

        {/* Sort By */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Sort Universe
            </label>
            <div className="relative group/sortInfo cursor-help">
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-800">
                <HelpCircle className="w-3 h-3 text-slate-400" />
                <span>Score Formula</span>
              </span>
              <div className="hidden group-hover/sortInfo:block absolute right-0 top-full mt-1 w-64 p-2.5 bg-slate-900 text-white text-[10px] rounded-lg shadow-xl z-50 normal-case font-normal border border-slate-700 leading-relaxed animate-in fade-in">
                <span className="font-bold text-emerald-400 block mb-0.5">Composite Score (0–100)</span>
                Blends percentiles: <code className="text-emerald-300 font-mono">0.30×1M + 0.35×3M + 0.35×1Y</code>. Evaluates both breakout velocity and structural long-term trend strength.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <select
              id="select-sort-by"
              value={filters.sortBy}
              onChange={(e) => onChangeFilters({ sortBy: e.target.value as FilterSettings['sortBy'] })}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50/50 text-slate-800 font-medium"
            >
              <option value="composite">Composite Momentum Score</option>
              <option value="return1M">1-Month Return (1M)</option>
              <option value="return3M">3-Month Return (3M)</option>
              <option value="return1Y">1-Year Return (1Y)</option>
              <option value="pct52WHigh">Nearest 52W High</option>
            </select>
            <button
              id="btn-toggle-sort-order"
              onClick={() => onChangeFilters({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' })}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
              title={`Sorting ${filters.sortOrder === 'asc' ? 'Ascending' : 'Descending'}`}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Row 2: Strategy Core Knobs (Super-Trend Cutoff & 52-Week High Rule) */}
      <div className="pt-3 border-t border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        {/* Step 5.1 Super-Trend Cutoff */}
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-semibold text-slate-700 flex items-center gap-1">
            <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-600" />
            <span>Super-Trend Filter:</span>
          </span>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
            {[10, 20, 25, 33].map((pct) => (
              <button
                key={pct}
                id={`btn-cutoff-${pct}`}
                onClick={() => onChangeFilters({ percentileThreshold: pct, mode: 'percentile' })}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                  filters.mode === 'percentile' && filters.percentileThreshold === pct
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Top {pct}% {pct === 10 ? '★ (Default)' : ''}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-slate-400">
            (Required in 1M, 3M, &amp; 1Y simultaneously)
          </span>
        </div>

        {/* Step 5.3 52-Week High Rule */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              id="chk-enforce-52w"
              type="checkbox"
              checked={filters.enforce52WHigh}
              onChange={(e) => onChangeFilters({ enforce52WHigh: e.target.checked })}
              className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
            />
            <span className="text-xs font-semibold text-slate-700">
              52-Week High Rule:
            </span>
          </label>

          <div className={`flex items-center gap-2 ${!filters.enforce52WHigh ? 'opacity-40 pointer-events-none' : ''}`}>
            <span className="text-xs text-slate-600 font-medium">Within:</span>
            <input
              id="range-52w-distance"
              type="range"
              min="2"
              max="15"
              step="1"
              value={filters.maxDistance52WHighPct}
              onChange={(e) => onChangeFilters({ maxDistance52WHighPct: Number(e.target.value) })}
              className="w-20 accent-slate-900 cursor-pointer"
            />
            <span className="text-xs font-bold font-mono text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
              ≤ {filters.maxDistance52WHighPct}%
            </span>
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              of 52W High
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
