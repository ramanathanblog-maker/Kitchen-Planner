// Asia/Kolkata is a fixed UTC+5:30 offset year-round (no DST observed), so this
// arithmetic shift is exact — no Intl/timezone-database dependency needed. The
// household is IST; a plain UTC slice made the app believe it was still
// yesterday from 00:00-05:29 IST every day (Today showed yesterday's plan, the
// past-day lock unlocked yesterday for RP/PS, the kiosk rolled over 5.5h late).
// `now` is injectable so tests can pin a specific UTC instant.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function todayStr(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = { todayStr, addDays, IST_OFFSET_MS };
