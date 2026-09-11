/**
 * Canonical percentage / percentage-point formatters — the Clark port of Flask's
 * `_fmt_pct_num` / `_fmt_pct100` / `_fmt_pp` / `_fmt_pct` (generator/slides.py:44-74).
 *
 * Kevin's rule, verbatim from Flask's own comment: "if its a .0 remove it. only include
 * decimal if not .0". So 100.0 -> "100%", 89.7 -> "89.7%", 1.8 -> "1.8%"; percentage-POINT
 * deltas follow the same rule (-0.3pp stays, -2.0pp -> "-2pp"). Every percentage the deck
 * PRINTS should go through these rather than an inline `(x*100).toFixed(1)}%` — that inline
 * spec is exactly what let one slide print "100.0%" while another printed "100%" for the
 * identical number.
 *
 * CSS geometry (width:/left: percentages) is deliberately NOT routed through here: it isn't
 * text a partner reads, and trimming ".0" there would be pointless churn.
 *
 * The sign always survives: `fmtPp(-2)` is "-2pp", never "2pp". Flask had a bug where an
 * `abs()` ate it; do not reintroduce one here. A caller that wants the typographic minus
 * (U+2212) wraps these — see speaker-notes.ts's `ppStr`, which mirrors Flask
 * speaker_notes.py `_pp` exactly.
 *
 * Lives in its own module (rather than being re-exported from slide-renderers.ts) because
 * slide-renderers' own `fmtPct` is file-private and several other files had already grown
 * private copies of the same rule. This is the one place the rule is written down.
 */

/**
 * The percent NUMBER, no "%" sign, with a bare trailing ".0" dropped. `v` is already in
 * percent units (89.7), not a 0-1 fraction. Only an all-zero decimal part is dropped, so
 * "1.50" at decimals=2 keeps both places — we're removing ".0", not trimming zeros.
 */
export function fmtPctNum(v: number, decimals = 1): string {
  const s = v.toFixed(decimals);
  if (decimals > 0 && s.endsWith("." + "0".repeat(decimals))) {
    return s.slice(0, -(decimals + 1));
  }
  return s;
}

/** A percentage from percent units: 100.0 -> "100%", 89.7 -> "89.7%". */
export function fmtPct100(v: number, decimals = 1, signed = false): string {
  const s = fmtPctNum(v, decimals);
  return signed && v >= 0 ? `+${s}%` : `${s}%`;
}

/** A percentage-point delta: -0.3 -> "-0.3pp", -2.0 -> "-2pp", +3.0 (signed) -> "+3pp". */
export function fmtPp(v: number, decimals = 1, signed = false): string {
  const s = fmtPctNum(v, decimals);
  return signed && v >= 0 ? `+${s}pp` : `${s}pp`;
}

/** A percentage from a 0-1 fraction — the formatter every rate should reach for. */
export function fmtPct(v: number): string {
  return fmtPct100(v * 100);
}
