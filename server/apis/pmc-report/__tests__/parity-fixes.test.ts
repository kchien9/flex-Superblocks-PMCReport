/**
 * Clark-vs-Flask parity regressions found by comparing live AJH Management decks side by side
 * (2026-09-11). No test runner in this repo - run with:
 *   npx tsx server/apis/pmc-report/__tests__/parity-fixes.test.ts
 *
 * Covers:
 *   1. resolveSubjectPortfolioUnits - the Salesforce total-company-units row-selection rule
 *      (AJH Management's duplicate account row must not inflate the portfolio ceiling).
 *   2. monthFull - the Exec Summary subtitle's bare full-month label (Flask _month_full).
 *   3. renderDelinquency's self-gate, pinned against AJH's real DQ rows - documents WHY the
 *      slide auto-hid in Clark while Flask rendered it. Behaviour under review; this test
 *      exists so a deliberate change to that threshold is a visible, intentional edit.
 */
import assert from "node:assert/strict";

import { resolveSubjectPortfolioUnits } from "../peer-matching.js";
import type { SubjectPortfolioRow } from "../peer-matching.js";
import { monthFull, renderDelinquency } from "../slide-renderers.js";

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

test("AJH: Clark's own windowMonths (row count) shrinks the window to 3 months and hides the slide", () => {
  // windowMonths = Math.min(dqMonths.length, 12) = 3 -> the date window starts at 2026-05-01,
  // which keeps only the 2026-07 row -> 1 non-zero month -> below the 3-month floor -> no slide.
  const r = renderDelinquency({ slideId: 26, months: AJH_DQ, windowMonths: Math.min(AJH_DQ.length, 12) });
  assert.equal(r.html, "");
  assert.equal(r.js, "");
});

test("AJH: at Flask's 12-month window all three rows are in scope and the slide renders", () => {
  // Flask's window is min(months_since_launch, 12) = 12 (AJH launched 2021-12), so its
  // df.tail(12) keeps all three rows and the slide renders.
  const r = renderDelinquency({ slideId: 26, months: AJH_DQ, windowMonths: 12 });
  assert.notEqual(r.html, "");
  assert.match(r.html, /Trailing 12 Months/);
  // 1652.95 + 2876.90 + 1256.01 = 5785.86 -> "$6K"; 1 + 2 + 1 = 4 resident payments.
  assert.match(r.html, /\$6K/);
  assert.match(r.html, /across 4 resident payments/);
});

test("the 3-non-zero-month floor is what hides a sparse PMC, independent of window length", () => {
  const twoMonths = AJH_DQ.slice(0, 2);
  assert.equal(renderDelinquency({ slideId: 26, months: twoMonths, windowMonths: 12 }).html, "");
  assert.equal(renderDelinquency({ slideId: 26, months: [], windowMonths: 12 }).html, "");
});

console.log(`\n${passed} tests passed`);
