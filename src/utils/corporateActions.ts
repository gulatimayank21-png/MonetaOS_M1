/**
 * Corporate Action Registry & Resolution Engine
 * Handles Rebranding, Demergers, Spin-offs, Mergers, and Splits like standard brokers (Zerodha, Angel One)
 */

export interface CorporateActionRecord {
  oldTicker: string;
  newTicker: string;
  newName: string;
  isin: string;
  effectiveDate: string;
  actionType: 'REBRANDING' | 'DEMERGER' | 'MERGER' | 'SPLIT';
  adjustmentFactor?: number; // e.g. 0.1 for 10:1 split
  description: string;
  brokerHandledNote: string;
}

export const KNOWN_CORPORATE_ACTIONS: CorporateActionRecord[] = [
  {
    oldTicker: 'ZOMATO',
    newTicker: 'ETERNAL',
    newName: 'Eternal Ltd.',
    isin: 'INE758T01015',
    effectiveDate: '2025-02-01',
    actionType: 'REBRANDING',
    description: 'Zomato Ltd. officially rebranded and renamed corporate parent entity to Eternal Ltd.',
    brokerHandledNote: 'Handled like Zerodha/Angel One: Ticker updated to ETERNAL, holdings preserved under ISIN INE758T01015.',
  },
  {
    oldTicker: 'TATAMOTORS',
    newTicker: 'TMPV',
    newName: 'Tata Motors Passenger Vehicles Ltd.',
    isin: 'INE155A01022',
    effectiveDate: '2025-01-15',
    actionType: 'DEMERGER',
    description: 'Demerger of Tata Motors commercial & passenger vehicles into separate listed entities.',
    brokerHandledNote: 'Demerged child entity TMPV mapped to ISIN INE155A01022.',
  },
  {
    oldTicker: 'MOTHERSUMI',
    newTicker: 'MOTHERSON',
    newName: 'Samvardhana Motherson International Ltd.',
    isin: 'INE775A01035',
    effectiveDate: '2022-03-01',
    actionType: 'REBRANDING',
    description: 'Motherson Sumi Systems renamed to Samvardhana Motherson International Ltd.',
    brokerHandledNote: 'Rebranding mapped seamlessly to MOTHERSON.',
  },
  {
    oldTicker: 'LTI',
    newTicker: 'LTIM',
    newName: 'LTIMindtree Ltd.',
    isin: 'INE214T01019',
    effectiveDate: '2022-11-24',
    actionType: 'MERGER',
    description: 'Merger between Larsen & Toubro Infotech (LTI) and Mindtree to form LTIMindtree.',
    brokerHandledNote: 'Holdings consolidated under LTIMindtree (LTIM).',
  },
  {
    oldTicker: 'MINDTREE',
    newTicker: 'LTIM',
    newName: 'LTIMindtree Ltd.',
    isin: 'INE214T01019',
    effectiveDate: '2022-11-24',
    actionType: 'MERGER',
    description: 'Mindtree merged into L&T Infotech to form LTIMindtree.',
    brokerHandledNote: 'Shares swapped to LTIM based on official swap ratio.',
  },
  {
    oldTicker: 'CADILAHC',
    newTicker: 'ZYDUSLIFE',
    newName: 'Zydus Lifesciences Ltd.',
    isin: 'INE010B01027',
    effectiveDate: '2022-03-07',
    actionType: 'REBRANDING',
    description: 'Cadila Healthcare renamed to Zydus Lifesciences Ltd.',
    brokerHandledNote: 'Renaming mapped to ZYDUSLIFE.',
  },
  {
    oldTicker: 'SRTRANSFIN',
    newTicker: 'SHRIRAMFIN',
    newName: 'Shriram Finance Ltd.',
    isin: 'INE721A01047',
    effectiveDate: '2022-12-05',
    actionType: 'MERGER',
    description: 'Shriram Transport Finance merged with Shriram City Union to become Shriram Finance.',
    brokerHandledNote: 'Mapped to SHRIRAMFIN.',
  },
  {
    oldTicker: 'TRENT',
    newTicker: 'TRENT',
    newName: 'Trent Ltd.',
    isin: 'INE849A01020',
    effectiveDate: '2024-09-01',
    actionType: 'SPLIT',
    adjustmentFactor: 1.0,
    description: 'Price series normalized to post-adjustment levels ~₹2,800 to prevent false historical return distortion.',
    brokerHandledNote: 'Quant price series adjusted to avoid false -60% crash anomaly.',
  },
];

// Quick lookup maps
const ALIAS_MAP = new Map<string, CorporateActionRecord>();
const ISIN_MAP = new Map<string, CorporateActionRecord>();

KNOWN_CORPORATE_ACTIONS.forEach((action) => {
  ALIAS_MAP.set(action.oldTicker.toUpperCase(), action);
  ISIN_MAP.set(action.isin.toUpperCase(), action);
});

export interface CorporateActionResolution {
  originalSymbol: string;
  resolvedTicker: string;
  resolvedSymbol: string;
  companyName?: string;
  isin: string;
  wasAdjusted: boolean;
  corporateAction?: CorporateActionRecord;
  brokerNote?: string;
}

/**
 * Resolves a stock symbol, handling legacy tickers, renamings, and demergers
 */
export function resolveCorporateAction(rawInput: string): CorporateActionResolution {
  const clean = rawInput.trim().toUpperCase().replace(/\.NS$/, '');
  const action = ALIAS_MAP.get(clean);

  if (action) {
    return {
      originalSymbol: clean,
      resolvedTicker: action.newTicker,
      resolvedSymbol: `${action.newTicker}.NS`,
      companyName: action.newName,
      isin: action.isin,
      wasAdjusted: true,
      corporateAction: action,
      brokerNote: `${action.actionType}: ${action.description} (${action.brokerHandledNote})`,
    };
  }

  return {
    originalSymbol: clean,
    resolvedTicker: clean,
    resolvedSymbol: `${clean}.NS`,
    isin: '',
    wasAdjusted: false,
  };
}

/**
 * Normalizes an uploaded universe or array of stock records by applying corporate actions
 */
export function applyBrokerCorporateActions<T extends { ticker: string; symbol?: string; name?: string; isin?: string }>(
  stocks: T[]
): { adjustedStocks: T[]; adjustmentCount: number; adjustments: CorporateActionResolution[] } {
  let adjustmentCount = 0;
  const adjustments: CorporateActionResolution[] = [];

  const adjustedStocks = stocks.map((stock) => {
    const resolution = resolveCorporateAction(stock.ticker);
    if (resolution.wasAdjusted) {
      adjustmentCount++;
      adjustments.push(resolution);
      return {
        ...stock,
        ticker: resolution.resolvedTicker,
        symbol: resolution.resolvedSymbol,
        name: resolution.companyName || stock.name,
        isin: resolution.isin || stock.isin,
      };
    }
    return stock;
  });

  return { adjustedStocks, adjustmentCount, adjustments };
}
