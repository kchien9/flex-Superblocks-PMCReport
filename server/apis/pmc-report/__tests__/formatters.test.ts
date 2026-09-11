/**
 * Pins the ONE canonical currency/percent formatting behaviour (formatters.ts) against Flask's
 * _fmt_currency / _fmt_pct_num / _fmt_pct100 / _fmt_pp (generator/slides.py:20-74).
 *
 * Why this exists: the repo had three copies of fmtCurrency and two of fmtPct, and they had
 * drifted, so the same number printed differently on different slides of one deck. Each case
 * below that names a module is an actual divergence one of those copies produced. If a future
 * change reintroduces a local copy, these cases are what catch it.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/formatters.test.ts
 */
import assert from "node:assert/strict";

import { fmtCurrency, fmtPct, fmtPct100, fmtPctNum, fmtPp } from "../formatters.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL: ${name}`);
    throw e;
  }
}

// ── fmtCurrency: the tiers ──────────────────────────────────────────────────

test("fmtCurrency: sub-1K prints whole dollars with grouping", () => {
  assert.equal(fmtCurrency(0), "$0");
  assert.equal(fmtCurrency(938), "$938");
  assert.equal(fmtCurrency(999), "$999");
});

test("fmtCurrency: K tier rounds to whole thousands", () => {
  assert.equal(fmtCurrency(1_000), "$1K");
  assert.equal(fmtCurrency(412_400), "$412K");
  assert.equal(fmtCurrency(5_785.86), "$6K"); // AJH's real DQ headline
});

test("fmtCurrency: M tier keeps up to two decimals, minimum one", () => {
  assert.equal(fmtCurrency(1_000_000), "$1.0M");
  assert.equal(fmtCurrency(1_230_000), "$1.23M");
  assert.equal(fmtCurrency(1_234_567), "$1.23M");
  assert.equal(fmtCurrency(3_000_000), "$3.0M");
  assert.equal(fmtCurrency(48_160_932.39), "$48.16M"); // RPM Living, Sep-2026
});

test("fmtCurrency: B tier, trimmed to a minimum of one decimal", () => {
  assert.equal(fmtCurrency(1_000_000_000), "$1.0B");
  assert.equal(fmtCurrency(1_730_000_000), "$1.73B");
  assert.equal(fmtCurrency(2_210_500_000), "$2.21B"); // the 8-entity combined lifetime rent
});

// ── The two 1000-rollover guards: each was missing from a different copy ─────

test("999,600 rolls the K tier into $1.0M, never '$1000K'", () => {
  // slide-renderers.ts's copy printed "$1000K" here - no guard on the K tier.
  assert.equal(fmtCurrency(999_600), "$1.0M");
  assert.equal(fmtCurrency(999_999), "$1.0M");
});

test("999,999,000 rolls the M tier into $1.0B, never '$1000.0M'", () => {
  // get-pmc-monthly-report.ts's copy printed "$1000.0M" here; Flask gives "$1.0B".
  assert.equal(fmtCurrency(999_999_000), "$1.0B");
  assert.equal(fmtCurrency(999_995_000), "$1.0B");
  // Just below the rounding boundary still reads as M.
  assert.equal(fmtCurrency(999_000_000), "$999.0M");
});

test("regression: the B tier is trimmed, so 1e9 is not '$1.00B'", () => {
  // get-pmc-monthly-report.ts's copy used a bare .toFixed(2) on the B tier.
  assert.notEqual(fmtCurrency(1_000_000_000), "$1.00B");
});

// ── Percentages: never a bare trailing ".0" ─────────────────────────────────

test("fmtPctNum drops an all-zero decimal part and nothing else", () => {
  assert.equal(fmtPctNum(100), "100");
  assert.equal(fmtPctNum(89.7), "89.7");
  assert.equal(fmtPctNum(1.8), "1.8");
  assert.equal(fmtPctNum(0), "0");
  // "removing .0", not "trimming zeros": 1.50 at two places keeps both.
  assert.equal(fmtPctNum(1.5, 2), "1.50");
  assert.equal(fmtPctNum(1.0, 2), "1");
});

test("fmtPct100 / fmtPct / fmtPp print no bare .0", () => {
  assert.equal(fmtPct100(100), "100%");
  assert.equal(fmtPct100(89.7), "89.7%");
  assert.equal(fmtPct(0.897), "89.7%");
  assert.equal(fmtPct(1), "100%");
  assert.equal(fmtPp(3), "3pp");
  assert.equal(fmtPp(-0.3), "-0.3pp");
  assert.equal(fmtPp(-2), "-2pp");
});

test("fmtPct100 / fmtPp signed form", () => {
  assert.equal(fmtPct100(2, 1, true), "+2%");
  assert.equal(fmtPct100(-2, 1, true), "-2%");
  assert.equal(fmtPp(3, 1, true), "+3pp");
});

test("the exec delta pills' old output is gone", () => {
  // The pills built "+2.0%" / "+3.0pp" from an inline .toFixed(1).
  assert.notEqual(`+${fmtPct100(2)}`, "+2.0%");
  assert.notEqual(`+${fmtPp(3)}`, "+3.0pp");
  assert.equal(`+${fmtPct100(2)}`, "+2%");
  assert.equal(`+${fmtPp(3)}`, "+3pp");
});

test("the pill's rounded-to-zero detector still fires on the new strings", () => {
  // renderExecSummary's pill() swaps in a grey "No change" when the formatted delta would
  // display as zero. Its regex has to keep matching what these helpers now emit.
  const roundsToZero = /^0(\.0+)?(pp|%|)$/;
  assert.ok(roundsToZero.test(fmtPct100(0)));
  assert.ok(roundsToZero.test(fmtPp(0)));
  assert.ok(roundsToZero.test(fmtPctNum(0)));
  assert.ok(!roundsToZero.test(fmtPct100(0.1)));
});

console.log(`formatters: ${passed} tests passed`);
