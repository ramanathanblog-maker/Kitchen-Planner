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

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Sat 19 Jul" — for human-readable History lines (Audit 2026-07-18, UX #3).
// dateStr is a plain YYYY-MM-DD (no time component); parsed as UTC midnight so
// the weekday/day/month are never off-by-one relative to what the date string
// itself says, regardless of the server's local timezone.
function formatDateHuman(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${WEEKDAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

module.exports = { todayStr, addDays, formatDateHuman, IST_OFFSET_MS };
