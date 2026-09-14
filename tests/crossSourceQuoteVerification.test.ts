import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  verifyQuoteCrossSource,
  cherryPickRandomStocksForAudit,
  EOD_CLOSE_TOLERANCE_PCT,
  INTRADAY_CMP_TOLERANCE_PCT,
} from '../src/utils/crossSourceVerification';
import { INITIAL_NIFTY500_STOCKS } from '../src/data/nifty500Data';
import { StockRecord } from '../src/types';

describe('Cross-Source CMP & Settled Last Close Verification (Strict Dual Tolerance)', () => {
  it('1. Randomly cherry-picks 6 stocks and enforces strict <= 0.20% Last Close and <= 1.25% CMP tolerances', async () => {
    // Random sample across Nifty 500
    const audits = await cherryPickRandomStocksForAudit(INITIAL_NIFTY500_STOCKS as StockRecord[], 6, 99);
    assert.strictEqual(audits.length, 6, 'Must cherry-pick 6 stocks');

    audits.forEach((audit) => {
      // Basic sanity
      assert.ok(audit.appLastClose > 0, `${audit.ticker}: Last Close must be positive`);
      assert.ok(audit.appCmp > 0, `${audit.ticker}: CMP must be positive`);

      // STRICT EOD BENCHMARK: Last Completed Session Close must not deviate by more than 0.20%
      assert.ok(
        audit.closeDiscrepancyPct <= EOD_CLOSE_TOLERANCE_PCT,
        `${audit.ticker}: Settled Last Close discrepancy (${audit.closeDiscrepancyPct}%) exceeds strict EOD threshold (<= ${EOD_CLOSE_TOLERANCE_PCT}%)`
      );
      assert.strictEqual(
        audit.isCloseConsistent,
        true,
        `${audit.ticker}: Last Close must be marked consistent`
      );

      // OPEN MARKET HOURS TOLERANCE: Live CMP must not deviate by more than 1.25%
      assert.ok(
        audit.cmpDiscrepancyPct <= INTRADAY_CMP_TOLERANCE_PCT,
        `${audit.ticker}: Intraday CMP discrepancy (${audit.cmpDiscrepancyPct}%) exceeds market hours threshold (<= ${INTRADAY_CMP_TOLERANCE_PCT}%)`
      );
      assert.strictEqual(
        audit.isCmpConsistent,
        true,
        `${audit.ticker}: CMP must be marked consistent`
      );

      // Overall consistency flag
      assert.strictEqual(
        audit.isConsistent,
        true,
        `${audit.ticker}: Must pass both EOD and live market checks`
      );
    });
  });

  it('2. Specifically audits TRENT: Enforces <= 0.20% Last Close near ~₹2,818 and <= 1.25% CMP', async () => {
    const trent = (INITIAL_NIFTY500_STOCKS as StockRecord[]).find((s) => s.ticker === 'TRENT');
    assert.ok(trent, 'Trent must be in the universe');

    // Check App price range
    assert.ok(
      trent.lastClose > 2000 && trent.lastClose < 3500,
      `Trent Last Close must be ~₹2,818, not obsolete ₹7,450 (got ${trent.lastClose})`
    );

    // Cross-source verify with precise secondary close (e.g. 0.08% diff on ₹2,802.4 -> within <= 0.20%)
    const audit = await verifyQuoteCrossSource(trent, {
      secondaryCloseOverride: Number((trent.lastClose * 1.0008).toFixed(2)), // ~0.08% discrepancy
      secondaryCmpOverride: Number((trent.cmp * 1.006).toFixed(2)), // ~0.60% CMP discrepancy during market hours
    });

    assert.strictEqual(audit.isCloseConsistent, true, 'Trent Last Close must pass <= 0.20%');
    assert.ok(
      audit.closeDiscrepancyPct <= 0.20,
      `Trent Last Close discrepancy (${audit.closeDiscrepancyPct}%) must be <= 0.20%`
    );

    assert.strictEqual(audit.isCmpConsistent, true, 'Trent CMP must pass <= 1.25%');
    assert.ok(
      audit.cmpDiscrepancyPct <= 1.25,
      `Trent CMP discrepancy (${audit.cmpDiscrepancyPct}%) must be <= 1.25%`
    );

    assert.strictEqual(audit.isConsistent, true);
    assert.ok(!audit.note?.includes('CRITICAL ANOMALY'), 'Trent must not have anomaly flag');
  });

  it('3. Specifically audits ETERNAL (Zomato): Enforces <= 0.20% Last Close and <= 1.25% CMP', async () => {
    const eternal = (INITIAL_NIFTY500_STOCKS as StockRecord[]).find((s) => s.ticker === 'ETERNAL');
    assert.ok(eternal, 'Eternal Ltd. (formerly Zomato) must be present');

    const audit = await verifyQuoteCrossSource(eternal, {
      secondaryCloseOverride: Number((eternal.lastClose * 1.0005).toFixed(2)), // 0.05% diff
      secondaryCmpOverride: Number((eternal.cmp * 1.004).toFixed(2)), // 0.4% diff
    });

    assert.strictEqual(audit.isCloseConsistent, true);
    assert.strictEqual(audit.isCmpConsistent, true);
    assert.strictEqual(audit.isConsistent, true);
  });

  it('4. Specifically audits TMPV (Tata Motors Demerged entity)', async () => {
    const tmpv = (INITIAL_NIFTY500_STOCKS as StockRecord[]).find((s) => s.ticker === 'TMPV');
    assert.ok(tmpv, 'TMPV (Tata Motors Passenger Vehicles) must be present');

    const audit = await verifyQuoteCrossSource(tmpv);
    assert.strictEqual(audit.isCloseConsistent, true);
    assert.strictEqual(audit.isCmpConsistent, true);
    assert.strictEqual(audit.isConsistent, true);
  });

  it('5. Anomalous Divergence Detection: Catches Last Close divergence (> 0.20%) and CMP divergence (> 1.25%)', async () => {
    const sample = (INITIAL_NIFTY500_STOCKS as StockRecord[])[0];

    // Case A: Last Close diverges by 0.50% (which exceeds 0.20%, even though it is within 1.25%)
    const eodDivergenceAudit = await verifyQuoteCrossSource(sample, {
      secondaryCloseOverride: Number((sample.lastClose * 1.005).toFixed(2)), // 0.5% divergence
      secondaryCmpOverride: sample.cmp, // exact match on CMP
    });

    assert.strictEqual(
      eodDivergenceAudit.isCloseConsistent,
      false,
      'Last Close divergence of 0.50% must be flagged because threshold is strict <= 0.20%'
    );
    assert.strictEqual(eodDivergenceAudit.isCmpConsistent, true);
    assert.strictEqual(
      eodDivergenceAudit.isConsistent,
      false,
      'Overall verification must FAIL when Last Close diverges'
    );
    assert.ok(
      eodDivergenceAudit.note?.includes('CRITICAL EOD DIVERGENCE'),
      'Audit note must call out CRITICAL EOD DIVERGENCE'
    );

    // Case B: Intraday CMP diverges by 1.80% (which exceeds 1.25% market hours threshold)
    const cmpDivergenceAudit = await verifyQuoteCrossSource(sample, {
      secondaryCloseOverride: sample.lastClose, // exact match on close
      secondaryCmpOverride: Number((sample.cmp * 1.018).toFixed(2)), // 1.8% divergence
    });

    assert.strictEqual(cmpDivergenceAudit.isCloseConsistent, true);
    assert.strictEqual(
      cmpDivergenceAudit.isCmpConsistent,
      false,
      'CMP divergence of 1.80% must be flagged because market hours threshold is <= 1.25%'
    );
    assert.strictEqual(
      cmpDivergenceAudit.isConsistent,
      false,
      'Overall verification must FAIL when CMP diverges beyond 1.25%'
    );
    assert.ok(
      cmpDivergenceAudit.note?.includes('CMP DIVERGENCE'),
      'Audit note must call out CMP DIVERGENCE'
    );
  });
});
