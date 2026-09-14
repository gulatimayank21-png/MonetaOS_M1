import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runQuantMomentumBacktest } from '../src/utils/backtestEngine';
import { BacktestConfig } from '../src/types';

describe('10-Year Quantitative Momentum Backtester (Moneta OS)', () => {
  const baseConfig: BacktestConfig = {
    initialCapital: 1000000,
    portfolioSize: 10,
    stopLossPct: 8,
    targetGainPct: 25,
    trailingRule: 'none',
    rebalanceCadence: 'first_day_monthly',
    enforce52WHigh: true,
    maxDistance52WHighPct: 5,
    startYear: 2015,
    endYear: 2024,
  };

  it('1. Successfully executes 10-year backtest and generates full equity curve and yearly data', () => {
    const result = runQuantMomentumBacktest(baseConfig);

    assert.strictEqual(result.initialCapital, 1000000);
    assert.ok(result.finalStrategyCapital > result.initialCapital, 'Strategy should deliver positive growth');
    assert.strictEqual(result.yearlyPerformance.length, 10, 'Should cover exactly 10 years (2015-2024)');
    assert.ok(result.equityCurve.length >= 120, 'Should contain monthly equity curve points');
    assert.ok(result.strategyCagr > 0, 'CAGR should be positive');
  });

  it('2. Mathematically demonstrates how Stop Loss protects against catastrophic drawdowns', () => {
    // Strategy with Stop Loss = 8%
    const withSL = runQuantMomentumBacktest({ ...baseConfig, stopLossPct: 8 });

    // Strategy with No Stop Loss = 0%
    const withoutSL = runQuantMomentumBacktest({ ...baseConfig, stopLossPct: 0 });

    // When there is no stop loss, drawdown is significantly worse during momentum reversals
    assert.ok(
      Math.abs(withoutSL.strategyMaxDrawdown) > Math.abs(withSL.strategyMaxDrawdown),
      `Without SL drawdown (${withoutSL.strategyMaxDrawdown}%) must be worse than with SL (${withSL.strategyMaxDrawdown}%)`
    );
  });

  it('3. Evaluates Target Gain trade-offs: Capped +25% vs Letting Winners Run (0%)', () => {
    const cappedTarget = runQuantMomentumBacktest({ ...baseConfig, targetGainPct: 25 });
    const runWinners = runQuantMomentumBacktest({ ...baseConfig, targetGainPct: 0 });

    // Letting winners run allows multi-baggers to compound, yielding higher total return over 10 years
    assert.ok(
      runWinners.finalStrategyCapital > cappedTarget.finalStrategyCapital,
      'Letting winners run captures multi-bagger momentum runs exceeding 25%'
    );
  });

  it('4. Evaluates Rebalance Cadence: First Wednesday vs Daily Continuous vs Monthly', () => {
    const monthlyResult = runQuantMomentumBacktest({ ...baseConfig, rebalanceCadence: 'first_day_monthly' });
    const firstWedResult = runQuantMomentumBacktest({ ...baseConfig, rebalanceCadence: 'first_wednesday_monthly' });
    const dailyResult = runQuantMomentumBacktest({ ...baseConfig, rebalanceCadence: 'daily_continuous' });

    assert.ok(firstWedResult.strategyCagr >= monthlyResult.strategyCagr, 'First Wednesday avoids Monday gaps');
    assert.ok(dailyResult.strategyCagr > 0, 'Daily continuous rebalance executes cleanly');
  });

  it('5. Evaluates Trailing Stop rules: Preserves open profits', () => {
    const staticSL = runQuantMomentumBacktest({ ...baseConfig, trailingRule: 'none' });
    const trailingSL = runQuantMomentumBacktest({ ...baseConfig, trailingRule: 'trail_from_high' });

    assert.ok(trailingSL.sharpeRatio >= staticSL.sharpeRatio, 'Trailing stop locks profits and enhances Sharpe');
  });

  it('6. Validates trade logs and exit reasons consistency', () => {
    const result = runQuantMomentumBacktest(baseConfig);
    assert.ok(result.sampleTrades.length > 0, 'Should produce representative trades');

    const validExitReasons = [
      'Stop Loss Triggered',
      'Target Gain Achieved',
      'Rank Dropped Below Cutoff',
      'Trailing Stop Breached',
      'Still Active',
    ];

    result.sampleTrades.forEach((trade) => {
      assert.ok(validExitReasons.includes(trade.exitReason), `Unknown exit reason: ${trade.exitReason}`);
      assert.ok(trade.holdingDays > 0, 'Holding days must be positive');
      assert.ok(trade.entryPrice > 0, 'Entry price must be positive');
      assert.ok(trade.exitPrice > 0, 'Exit price must be positive');
    });
  });
});
