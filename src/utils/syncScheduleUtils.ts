/**
 * Utilities for NSE Daily 6:30 PM IST Bhavcopy Schedule & Database Session Verification
 */

export interface SyncScheduleDetails {
  currentIstTime: string;
  isBeforeDailySync: boolean; // True if before 6:30 PM IST today
  dbTradeDate: string; // e.g. "2026-09-15"
  dbTradeDateFormatted: string; // e.g. "Tuesday, 15 Sep 2026"
  headlineMessage: string;
  detailedScheduleNote: string;
  syncTimestampFormatted: string;
}

/**
 * Returns current IST time components
 */
export function getISTTimeInfo(now = new Date()) {
  const istFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = istFormatter.formatToParts(now);
  const findVal = (type: string) => parts.find((p) => p.type === type)?.value || '00';

  const year = parseInt(findVal('year'), 10);
  const month = parseInt(findVal('month'), 10);
  const day = parseInt(findVal('day'), 10);
  const hour = parseInt(findVal('hour'), 10);
  const minute = parseInt(findVal('minute'), 10);

  // Daily sync takes place at 18:30 IST (6:30 PM)
  const isBeforeDailySync = hour < 18 || (hour === 18 && minute < 30);
  const todayYMD = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return {
    year,
    month,
    day,
    hour,
    minute,
    isBeforeDailySync,
    todayYMD,
  };
}

/**
 * Formats a YYYY-MM-DD or ISO date string into a friendly Indian Standard Time string
 */
export function formatTradeDateFriendly(dateStr?: string): string {
  if (!dateStr || dateStr === 'N/A') return '15 Sep 2026';
  try {
    // If format is YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(dateObj);
    }

    const dateObj = new Date(dateStr);
    if (isNaN(dateObj.getTime())) return dateStr;
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(dateObj);
  } catch {
    return dateStr;
  }
}

/**
 * Computes complete sync schedule and verification explanation for UI
 */
export function getSyncScheduleDetails(
  dbMaxDate = '2026-09-15',
  fetchedAtIso?: string
): SyncScheduleDetails {
  const istInfo = getISTTimeInfo();
  const formattedTradeDate = formatTradeDateFriendly(dbMaxDate);

  // Determine if database date matches today
  const isDbUpToDateWithToday = dbMaxDate === istInfo.todayYMD;

  let headlineMessage = '';
  let detailedScheduleNote = '';

  if (istInfo.isBeforeDailySync || !isDbUpToDateWithToday) {
    headlineMessage = `Calculations are based on the latest finalized market session in database: ${formattedTradeDate}`;
    detailedScheduleNote = `NSE Bhavcopy is synced daily at 6:30 PM IST after market close. Until the 6:30 PM sync runs, all momentum cards and rankings reflect yesterday's / last finalized trading session (${formattedTradeDate}).`;
  } else {
    headlineMessage = `Calculations updated with today's finalized market close data (${formattedTradeDate})`;
    detailedScheduleNote = `Daily 6:30 PM IST Bhavcopy sync complete. All momentum rankings and 52W metrics reflect today's finalized market close.`;
  }

  // Format the fetch/sync time
  let syncTimestampFormatted = `${formattedTradeDate}, 06:30 PM IST`;
  if (fetchedAtIso) {
    try {
      const d = new Date(fetchedAtIso);
      if (!isNaN(d.getTime())) {
        syncTimestampFormatted = new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }).format(d) + ' IST';
      }
    } catch {
      // fallback
    }
  }

  return {
    currentIstTime: `${String(istInfo.hour).padStart(2, '0')}:${String(istInfo.minute).padStart(2, '0')} IST`,
    isBeforeDailySync: istInfo.isBeforeDailySync,
    dbTradeDate: dbMaxDate,
    dbTradeDateFormatted: formattedTradeDate,
    headlineMessage,
    detailedScheduleNote,
    syncTimestampFormatted,
  };
}
