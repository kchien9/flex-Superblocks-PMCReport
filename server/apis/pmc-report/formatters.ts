/**
 * The deck's number formatters. ONE implementation each, shared by every renderer module.
 *
 * Why this file exists: currency and percentage formatting had been copy-pasted into
 * get-pmc-monthly-report.ts, slide-renderers.ts and expansion-renderers.ts, and the three
 * copies had drifted. Verified divergences on the same input:
 *
 *   1,234,567    slide-renderers "$1.2M"    vs get-pmc-monthly-report/expansion "$1.23M"
 *                (one decimal vs two-then-trimmed on the M tier)
 *   999,600      slide-renderers "$1000K"   - no 1000-rollover guard on the K tier
 *   999,999,000  get-pmc-monthly-report "$1000.0M" - no 1000-rollover guard on the M tier,
 *                where Flask gives "$1.0B"
 *   1,000,000,000 get-pmc-monthly-report "$1.00B" - no trim on the B tier, Flask "$1.0B"
 *
 * A deck that prints "$1000K" on one slide and "$1.0M" on the next for the same number is
 * the same class of self-contradiction as the True Repeat Rate bug. Flask solved it by
 * routing every printed number through one helper; this is the port of those helpers.
 *
 * Mirrors generator/slides.py:
 *   _fmt_currency  (slides.py:20-40)  -> fmtCurrency
 *   _fmt_pct_num   (slides.py:50-57)  -> fmtPctNum
 *   _fmt_pct100    (slides.py:60-63)  -> fmtPct100
 *   _fmt_pp        (slides.py:66-69)  -> fmtPp
 *   _fmt_pct       (slides.py:72-74)  -> fmtPct
 *
 * Note for the other renderer modules: import from here rather than defining your own.
 */

/** Flask's `f"{x:.2f}".rstrip("0")` + "keep at least one decimal" convention. */
function trimToOneDecimalMin(s: string): string {
  let t = s.replace(/0+$/, "");
  if (t.endsWith(".")) t += "0"; // "3." -> "3.0"
  return t;
}

/**
 * Currency, abbreviated: "$1.73B" / "$3.0M" / "$412K" / "$938".
 *
 * Both 1000-rollover guards are load-bearing and were missing from one copy each:
 *  - K tier: 999,600 rounds to 1000K, which must print "$1.0M", not "$1000K".
 *  - M tier: 999,999,000 formats as "1000.00" -> "1000.0", which must print "$1.0B",
 *    not "$1000.0M".
 */
export function fmtCurrency(v: number): string {
  if (v >= 1_000_000_000) return `$${trimToOneDecimalMin((v / 1_000_000_000).toFixed(2))}B`;
  if (v >= 1_000_000) {
    const s = trimToOneDecimalMin((v / 1_000_000).toFixed(2));
    if (s.startsWith("1000")) return "$1.0B"; // 999.995M+ rounds up past the M tier
    return `$${s}M`;
  }
  if (v >= 1_000) {
    const k = Math.round(v / 1_000);
    if (k >= 1000) return "$1.0M";
    return `$${k}K`;
  }
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

/**
 * The percent NUMBER, no "%" sign, with a bare trailing ".0" dropped. `v` is already in
 * percent units (89.7), not a 0-1 fraction. Kevin's rule: "if its a .0 remove it. only
 * include decimal if not .0" - so 100.0 -> "100", 89.7 -> "89.7", 1.8 -> "1.8".
 *
 * Only an ALL-zero decimal part is dropped, so "1.50" at decimals=2 keeps both places:
 * this removes ".0", it does not trim trailing zeros.
 */
export function fmtPctNum(v: number, decimals = 1): string {
  const s = v.toFixed(decimals);
  const zeroTail = "." + "0".repeat(decimals);
  return decimals > 0 && s.endsWith(zeroTail) ? s.slice(0, -(decimals + 1)) : s;
}

/** A percentage from percent units: 100.0 -> "100%", 89.7 -> "89.7%". */
export function fmtPct100(v: number, decimals = 1, signed = false): string {
  const s = fmtPctNum(v, decimals);
  return signed && v >= 0 ? `+${s}%` : `${s}%`;
}

/** A percentage-POINT delta: -0.3 -> "-0.3pp", -2.0 -> "-2pp", +3.0 -> "+3pp". */
export function fmtPp(v: number, decimals = 1, signed = false): string {
  const s = fmtPctNum(v, decimals);
  return signed && v >= 0 ? `+${s}pp` : `${s}pp`;
}

/** A percentage from a 0-1 fraction - the formatter every rate should reach for. */
export function fmtPct(v: number): string {
  return fmtPct100(v * 100);
}
