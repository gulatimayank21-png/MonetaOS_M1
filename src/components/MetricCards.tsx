import React from 'react';
import { Layers, Award, Crosshair, Wind } from 'lucide-react';
import { SectorTailwindInfo } from '../types';

interface MetricCardsProps {
  totalUniverse: number;
  winnerCount: number;
  within52WCount?: number;
  within52WHighCount?: number;
  dominantSectorInfo: SectorTailwindInfo | null;
  cutoffPct: number;
  avgWinner1YReturn: number;
}

export const MetricCards: React.FC<MetricCardsProps> = ({
  totalUniverse,
  winnerCount,
  within52WCount,
  within52WHighCount,
  dominantSectorInfo,
  cutoffPct,
  avgWinner1YReturn,
}) => {
  const safe52WCount = Number(within52WCount ?? within52WHighCount ?? 0);
  const winnerRate = totalUniverse > 0 ? ((winnerCount / totalUniverse) * 100).toFixed(1) : '0';
  const near52WRate = totalUniverse > 0 && !isNaN(safe52WCount) ? ((safe52WCount / totalUniverse) * 100).toFixed(1) : '0';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
      {/* 1. Universe Size: Light Neutral Slate Pastel */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            NSE Stock Universe
          </span>
          <div className="p-1.5 rounded-lg bg-slate-100 text-slate-600">
            <Layers className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono text-slate-900">{totalUniverse}</span>
          <span className="text-xs text-slate-500 font-medium">Verified Constituents</span>
        </div>
        <div className="mt-2.5 pt-2 border-t border-slate-100 text-[11px] text-slate-500 flex justify-between">
          <span>Active Lookback</span>
          <span className="font-semibold text-slate-700">1M, 3M, 1Y Horizons</span>
        </div>
      </div>

      {/* 2. Super-Trend Winners: Soft Mint / Emerald Pastel */}
      <div className="bg-emerald-50/40 rounded-2xl p-4 border border-emerald-200/90 shadow-xs flex flex-col justify-between hover:border-emerald-300 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-emerald-900 uppercase tracking-wider">
            Super-Trend Winners
          </span>
          <div className="p-1.5 rounded-lg bg-emerald-100/80 text-emerald-700">
            <Award className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono text-emerald-800">{winnerCount}</span>
          <span className="text-xs font-semibold text-emerald-800 bg-emerald-100/70 border border-emerald-200/60 px-2 py-0.5 rounded-full">
            {winnerRate}% of Universe
          </span>
        </div>
        <div className="mt-2.5 pt-2 border-t border-emerald-200/60 text-[11px] text-emerald-900/80 flex justify-between">
          <span>Quartile Filter</span>
          <span className="font-semibold text-emerald-950">Top {cutoffPct}% in 1M ∩ 3M ∩ 1Y</span>
        </div>
      </div>

      {/* 3. 52-Week High Guardrail Rule: Amber Accent */}
      <div className="bg-amber-50/40 rounded-2xl p-4 border border-amber-200/90 shadow-xs flex flex-col justify-between hover:border-amber-300 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">
            52W High Rule (≤5%)
          </span>
          <div className="p-1.5 rounded-lg bg-amber-100/80 text-amber-700">
            <Crosshair className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono text-amber-950">{safe52WCount}</span>
          <span className="text-xs text-amber-800 bg-amber-100/70 border border-amber-200/60 px-2 py-0.5 rounded-full font-semibold">
            {near52WRate}% Pass
          </span>
        </div>
        <div className="mt-2.5 pt-2 border-t border-amber-200/60 text-[11px] text-amber-900/80 flex justify-between">
          <span>Guardrail Status</span>
          <span className="font-semibold text-amber-950">Near All-Time Highs</span>
        </div>
      </div>

      {/* 4. Sector Tailwinds Leader: Indigo Accent */}
      <div className="bg-indigo-50/40 rounded-2xl p-4 border border-indigo-200/90 shadow-xs flex flex-col justify-between hover:border-indigo-300 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider">
            Sector Tailwinds Alpha
          </span>
          <div className="p-1.5 rounded-lg bg-indigo-100/80 text-indigo-700">
            <Wind className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2">
          <div className="text-sm font-bold text-indigo-950 truncate">
            {dominantSectorInfo ? dominantSectorInfo.sector : 'Broad Breadth'}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] font-semibold text-indigo-800 bg-indigo-100/70 border border-indigo-200/60 px-2 py-0.5 rounded-full">
              {dominantSectorInfo
                ? dominantSectorInfo.overlappingCount > 0
                  ? `${dominantSectorInfo.overlappingCount} in Top ${cutoffPct}% (${dominantSectorInfo.percentageOfOverlapping}% of Winners)`
                  : `${dominantSectorInfo.baselineWinnerCount || 0} Macro Universe Leaders`
                : 'Diversified'}
            </span>
          </div>
        </div>
        <div className="mt-2.5 pt-2 border-t border-indigo-200/60 text-[11px] text-indigo-900/80 flex justify-between">
          <span>Winner Avg 1Y Return</span>
          <span className="font-semibold text-emerald-700 font-mono">+{avgWinner1YReturn}%</span>
        </div>
      </div>
    </div>
  );
};
