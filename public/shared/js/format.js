// Number, credit and duration formatting shared by the games.

const SUFFIXES = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'k'],
];

/** 1234 -> "1,234"; with `compact`, 12345 -> "12.3k". */
export function formatNumber(value, { compact = false, decimals = 0 } = {}) {
  if (!Number.isFinite(value)) return '–';
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  if (compact && abs >= 10_000) {
    for (const [size, suffix] of SUFFIXES) {
      if (abs >= size) {
        const scaled = abs / size;
        const digits = scaled >= 100 ? 0 : 1;
        return `${sign}${trimZeros(scaled.toFixed(digits))}${suffix}`;
      }
    }
  }
  return sign + abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function trimZeros(text) {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** 1240 -> "1,240 cr". */
export function formatCredits(value, options) {
  return `${formatNumber(Math.round(value), options)} cr`;
}

/** Signed credits: 300 -> "+300 cr", -80 -> "−80 cr". */
export function formatCreditsDelta(value, options) {
  const rounded = Math.round(value);
  const text = formatCredits(Math.abs(rounded), options);
  if (rounded > 0) return `+${text}`;
  if (rounded < 0) return `−${text}`;
  return text;
}

/**
 * A short, human duration for countdowns: "45 s", "8 min", "1 h 05".
 * Minutes round up so a timer never shows "0 min" while still running.
 */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

/** A local clock time, "14:05". */
export function formatClock(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
