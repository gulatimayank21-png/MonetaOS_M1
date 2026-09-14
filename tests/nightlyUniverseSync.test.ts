import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { executeNightlySync, readSyncStatus, writeSyncStatus } from '../src/utils/nightlyUniverseSync';
import { NightlySyncStatus } from '../src/types';

describe('Nightly Automated Universe Refresh & Failure Fallback Auditing', () => {
  const initialKnownGoodDate = '2026-09-10T18:30:00.000Z'; // Known verified EOD

  beforeEach(() => {
    // Reset to known baseline state before each test
    const baseline: NightlySyncStatus = {
      lastSuccessfulSync: initialKnownGoodDate,
      lastAttempt: initialKnownGoodDate,
      status: 'success',
      errorMessage: null,
      scheduledCron: 'Daily at 00:00 IST',
      source: 'Official NSE India Archives',
      updatedIndices: ['nifty500', 'nifty50', 'niftynext50', 'niftymidcap150', 'niftysmallcap250'],
      stockCounts: {
        nifty500: 500,
        nifty50: 50,
        niftynext50: 50,
        niftymidcap150: 150,
        niftysmallcap250: 250,
      },
    };
    writeSyncStatus(baseline);
  });

  it('1. Successfully executes nightly refresh and updates lastSuccessfulSync', async () => {
    const result = await executeNightlySync({ forceFail: false });
    assert.strictEqual(result.hasFailure, false);
    assert.strictEqual(result.status.status, 'success');
    assert.strictEqual(result.status.errorMessage, null);
    assert.notStrictEqual(result.status.lastSuccessfulSync, initialKnownGoodDate);
    assert.ok(new Date(result.status.lastSuccessfulSync).getTime() > new Date(initialKnownGoodDate).getTime());
  });

  it('2. Preserves lastSuccessfulSync and reports the exact last updated date when nightly update fails', async () => {
    const failureReason = 'NSE Archives HTTP 503 Server Under Maintenance';
    const result = await executeNightlySync({ forceFail: true, failureReason });

    assert.strictEqual(result.hasFailure, true);
    assert.strictEqual(result.status.status, 'failed');
    assert.strictEqual(result.status.errorMessage, failureReason);

    // CRITICAL: The app MUST preserve and call out the date when it was last updated!
    assert.strictEqual(
      result.status.lastSuccessfulSync,
      initialKnownGoodDate,
      'When nightly sync fails, the last verified successful date MUST NOT be wiped or overwritten'
    );

    // The failure message must specifically call out the last successful date
    assert.ok(
      result.message.includes(initialKnownGoodDate),
      `Failure notification must cite the last successful update timestamp (${initialKnownGoodDate})`
    );
  });

  it('3. Read and write state persistence persists status across server restarts', () => {
    const customTimestamp = '2026-09-09T18:00:00.000Z';
    writeSyncStatus({
      lastSuccessfulSync: customTimestamp,
      lastAttempt: new Date().toISOString(),
      status: 'failed',
      errorMessage: 'Simulated network drop',
      scheduledCron: 'Daily at 00:00 IST',
      source: 'Official NSE India Archives',
      updatedIndices: ['nifty500'],
      stockCounts: { nifty500: 500, nifty50: 50, niftynext50: 50, niftymidcap150: 150, niftysmallcap250: 250 },
    });

    const loaded = readSyncStatus();
    assert.strictEqual(loaded.status, 'failed');
    assert.strictEqual(loaded.lastSuccessfulSync, customTimestamp);
    assert.strictEqual(loaded.errorMessage, 'Simulated network drop');
  });

  it('4. Recovers gracefully to success on subsequent successful retry', async () => {
    // First fail
    await executeNightlySync({ forceFail: true, failureReason: 'Temporary network glitch' });
    const failedStatus = readSyncStatus();
    assert.strictEqual(failedStatus.status, 'failed');

    // Then retry successfully
    const retryResult = await executeNightlySync({ forceFail: false });
    assert.strictEqual(retryResult.hasFailure, false);
    assert.strictEqual(retryResult.status.status, 'success');
    assert.strictEqual(retryResult.status.errorMessage, null);
  });
});
