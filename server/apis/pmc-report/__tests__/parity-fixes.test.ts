/**
 * Clark-vs-Flask parity regressions found by comparing live AJH Management decks side by side
 * (2026-09-11). No test runner in this repo - run with:
 *   npx tsx server/apis/pmc-report/__tests__/parity-fixes.test.ts
 *
 * Covers:
 *   1. resolveSubjectPortfolioUnits - the Salesforce total-company-units row-selection rule
 *      (AJH Management's duplicate account row must not inflate the portfolio ceiling).
 *   2. monthFull - the Exec Summary subtitle's bare full-month label (Flask _month_full).
 *   3. The Delinquency slide's agreed gating rule, pinned against AJH's real DQ rows:
 *      window = min(TENURE, 12) calendar months back from the latest DQ month, floor = at
 *      least 3 of those months with total_rent_shielded > 0, else no slide at all. Identical
 *      in Flask (render_delinquency) and Clark (delinquencyWindowMonths + renderDelinquency).
 */
import assert from "node:assert/strict";

import { resolveSubjectPortfolioUnits } from "../peer-matching.js";
import type { SubjectPortfolioRow } from "../peer-matching.js";
import { delinquencyWindowMonths, monthFull, renderDelinquency } from "../slide-renderers.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// ─── 1. Salesforce total-company-units selection rule ───────────────────────

test("single account row returns its total", () => {
  const rows: SubjectPortfolioRow[] = [{ PMC_ID: 478, TOTAL_COMPANY_UNITS: 11000, FLEX_UNITS: 1232 }];
  assert.equal(resolveSubjectPortfolioUnits(rows), 11000);
});

test("AJH Management duplicate account row picks 11,000, never 11,070 or 70", () => {
  // Live shape (2026-09-11): the 11,000-unit Partner account carries ACCOUNT_FLEX_UNITS = 1232;
  // the 70-unit deleted Deep SMB duplicate carries 0. Summing gave 11,070.
  const rows: SubjectPortfolioRow[] = [
    { PMC_ID: 478, TOTAL_COMPANY_UNITS: 70, FLEX_UNITS: 0 },
    { PMC_ID: 478, TOTAL_COMPANY_UNITS: 11000, FLEX_UNITS: 1232 },
  ];
  assert.equal(resolveSubjectPortfolioUnits(rows), 11000);
  assert.notEqual(resolveSubjectPortfolioUnits(rows), 11070);
  assert.notEqual(resolveSubjectPortfolioUnits(rows), 70);
});

test("row order does not change the winner", () => {
  const a: SubjectPortfolioRow[] = [
    { PMC_ID: 478, TOTAL_COMPANY_UNITS: 11000, FLEX_UNITS: 1232 },
    { PMC_ID: 478, TOTAL_COMPANY_UNITS: 70, FLEX_UNITS: 0 },
  ];
  assert.equal(resolveSubjectPortfolioUnits(a), 11000);
});

test("exact duplicate rows for one PMC collapse to one value", () => {
  // FLEX.SALES.DIM_CRM_ACCOUNT_HISTORY returns AJH's 11,000-unit row TWICE with
  // IS_CURRENT = TRUE (live-verified) - summing would report 22,000.
  const rows: SubjectPortfolioRow[] = [
    { PMC_ID: 478, TOTAL_COMPANY_UNITS: 11000, FLEX_UNITS: 1232 },
    { PMC_ID: 478, TOTAL_COMPANY_UNITS: 11000, FLEX_UNITS: 1232 },
  ];
  assert.equal(resolveSubjectPortfolioUnits(rows), 11000);
});

test("combined entities still sum across distinct PMC_IDs", () => {
  const rows: SubjectPortfolioRow[] = [
    { PMC_ID: 478, TOTAL_COMPANY_UNITS: 11000, FLEX_UNITS: 1232 },
    { PMC_ID: 478, TOTAL_COMPANY_UNITS: 70, FLEX_UNITS: 0 },
    { PMC_ID: 901, TOTAL_COMPANY_UNITS: 4300, FLEX_UNITS: 2992 },
  ];
  assert.equal(resolveSubjectPortfolioUnits(rows), 15300);
});

test("larger total wins when neither duplicate has Flex units", () => {
  const rows: SubjectPortfolioRow[] = [
    { PMC_ID: 12, TOTAL_COMPANY_UNITS: 600, FLEX_UNITS: 0 },
    { PMC_ID: 12, TOTAL_COMPANY_UNITS: 900, FLEX_UNITS: null },
  ];
  assert.equal(resolveSubjectPortfolioUnits(rows), 900);
});

test("a row with Flex units beats a larger row without them", () => {
  // Flask's list_expansion_candidates requires ACCOUNT_FLEX_UNITS > 0, so a stale
  // zero-Flex account row never supplies the ceiling even when its total is bigger.
  const rows: SubjectPortfolioRow[] = [
    { PMC_ID: 12, TOTAL_COMPANY_UNITS: 99000, FLEX_UNITS: 0 },
    { PMC_ID: 12, TOTAL_COMPANY_UNITS: 11000, FLEX_UNITS: 1232 },
  ];
  assert.equal(resolveSubjectPortfolioUnits(rows), 11000);
});

test("no usable rows returns 0 so callers fall back to enrolled units", () => {
  assert.equal(resolveSubjectPortfolioUnits([]), 0);
  assert.equal(resolveSubjectPortfolioUnits([{ PMC_ID: 478, TOTAL_COMPANY_UNITS: null, FLEX_UNITS: 1232 }]), 0);
  assert.equal(resolveSubjectPortfolioUnits([{ PMC_ID: 478, TOTAL_COMPANY_UNITS: 0, FLEX_UNITS: 0 }]), 0);
});

// ─── 2. Exec Summary subtitle month format (Flask _month_full) ──────────────

test("monthFull prints the full month name and year", () => {
  assert.equal(monthFull("2026-09-01"), "September 2026");
  assert.equal(monthFull("2026-06-01"), "June 2026");
  assert.equal(monthFull("2026-01-01"), "January 2026");
  assert.equal(monthFull("2026-12-01"), "December 2026");
});

test("monthFull is not the abbreviated label", () => {
  assert.notEqual(monthFull("2026-09-01"), "Sep 2026");
});

test("monthFull degrades safely on missing/odd input", () => {
  assert.equal(monthFull(""), "—");
  assert.equal(monthFull("2026-13-01"), "2026-13-01");
});

// ─── 3. Delinquency slide self-gate, pinned against AJH's real rows ─────────

// AJH Management (PMC_ID 478), PRODUCTION.EXTERNAL_REPORTING.DQ_PROPERTY, the 13-month pull
// Clark makes as of 2026-09-11 (cutoff 2026-10-01). Three rows, all non-zero.
const AJH_DQ = [
  { month: "2025-10-01", totalRentShielded: 1652.95, residentsShielded: 1 },
  { month: "2025-11-01", totalRentShielded: 2876.90, residentsShielded: 2 },
  { month: "2026-07-01", totalRentShielded: 1256.01, residentsShielded: 1 },
];

// --- 3a. The window length rule itself (tenure, not row count) ---

test("window length is tenure-capped at 12, NOT the DQ row count", () => {
  // AJH: 58 months on Flex, 3 DQ rows. The old rule returned 3; the agreed rule returns 12.
  assert.equal(delinquencyWindowMonths(58, AJH_DQ.length), 12);
  assert.notEqual(delinquencyWindowMonths(58, AJH_DQ.length), AJH_DQ.length);
});

test("a partner younger than 12 months gets its real tenure as the window", () => {
  assert.equal(delinquencyWindowMonths(8, 2), 8);
  assert.equal(delinquencyWindowMonths(1, 1), 1);
  assert.equal(delinquencyWindowMonths(12, 4), 12);
  assert.equal(delinquencyWindowMonths(120, 12), 12);
});

test("unknown tenure falls back to the DQ row count, same as Flask's len(df) fallback", () => {
  assert.equal(delinquencyWindowMonths(0, 5), 5);
  assert.equal(delinquencyWindowMonths(0, 0), 0);
});

// --- 3b. The window + floor, end to end through the renderer ---

test("AJH: the tenure window (12) keeps all three rows and the slide RENDERS", () => {
  // 58 months since launch -> windowMonths 12 -> window starts 2025-08-01, so 2025-10, 2025-11
  // and 2026-07 are all in scope -> 3 non-zero months -> at the floor -> renders. This is the
  // live behaviour confirmed in both repos on 2026-09-11 ($6K / 4 payments in each).
  const r = renderDelinquency({
    slideId: 26,
    months: AJH_DQ,
    windowMonths: delinquencyWindowMonths(58, AJH_DQ.length),
  });
  assert.notEqual(r.html, "");
  assert.match(r.html, /Trailing 12 Months/);
  // 1652.95 + 2876.90 + 1256.01 = 5785.86 -> "$6K"; 1 + 2 + 1 = 4 resident payments.
  assert.match(r.html, /\$6K/);
  assert.match(r.html, /across 4 resident payments/);
});

test("AJH regression: the old row-count window (3) hid the slide", () => {
  // windowMonths = Math.min(dqMonths.length, 12) = 3 -> the date window starts at 2026-05-01,
  // which keeps only the 2026-07 row -> 1 non-zero month -> below the floor -> no slide. Pinned
  // so nobody reintroduces the row-count derivation.
  const r = renderDelinquency({ slideId: 26, months: AJH_DQ, windowMonths: Math.min(AJH_DQ.length, 12) });
  assert.equal(r.html, "");
  assert.equal(r.js, "");
});

test("the 3-non-zero-month floor hides a sparse PMC even at a full 12-month window", () => {
  // Adara Communities' live shape (2 non-zero months) - confirmed skipping in Flask too.
  const twoMonths = AJH_DQ.slice(0, 2);
  assert.equal(renderDelinquency({ slideId: 26, months: twoMonths, windowMonths: 12 }).html, "");
  assert.equal(renderDelinquency({ slideId: 26, months: [], windowMonths: 12 }).html, "");
});

test("non-zero months OUTSIDE the window do not count toward the floor", () => {
  // 3 non-zero months, but a 3-month tenure -> window is 2026-03..2026-05, which contains only
  // one of them -> no slide. The floor counts in-window months, never the whole frame.
  const spread = [
    { month: "2025-06-01", totalRentShielded: 9000, residentsShielded: 9 },
    { month: "2025-08-01", totalRentShielded: 8000, residentsShielded: 8 },
    { month: "2026-05-01", totalRentShielded: 1000, residentsShielded: 1 },
  ];
  assert.equal(delinquencyWindowMonths(3, spread.length), 3);
  assert.equal(renderDelinquency({ slideId: 26, months: spread, windowMonths: 3 }).html, "");
  // Same rows at a 12-month tenure window: only 2026-05 is still in scope (2025-06/08 are
  // outside 2025-06..2026-05? 2025-06 is the boundary month, so 3 are in scope) -> renders.
  assert.notEqual(renderDelinquency({ slideId: 26, months: spread, windowMonths: 12 }).html, "");
});

test("the headline sum excludes out-of-window months, matching its own label", () => {
  // 13 months of history, 12-month window: the oldest month's $500K must not reach the
  // headline. Flask's equivalent test asserts the same "$11K / 11 resident payments" string.
  const rows = [
    { month: "2025-07-01", totalRentShielded: 500000, residentsShielded: 500 },
    ...[9, 10, 11, 12].map((m) => ({
      month: `2025-${String(m).padStart(2, "0")}-01`, totalRentShielded: 1000, residentsShielded: 1,
    })),
    ...[1, 2, 3, 4, 5, 6, 7].map((m) => ({
      month: `2026-0${m}-01`, totalRentShielded: 1000, residentsShielded: 1,
    })),
  ];
  const r = renderDelinquency({ slideId: 26, months: rows, windowMonths: 12 });
  assert.match(r.html, /Trailing 12 Months/);
  assert.match(r.html, /\$11K across 11 resident payments in the last 12 months/);
});

console.log(`\n${passed} tests passed`);
