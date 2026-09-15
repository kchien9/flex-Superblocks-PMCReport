/**
 * WHY THIS FILE EXISTS
 * ====================
 * renderDelinquency's contiguous zero-fill anchors at dqLatestMonth - the latest month actually
 * PRESENT in the (1-month-lagged) DQ_PROPERTY pull, not the report's own latest completed month.
 * For a PMC whose tenure is exactly windowMonths long, walking back windowMonths-1 slots from
 * that lagged anchor can land ONE MONTH BEFORE the partnership started.
 *
 * Live-verified on Coast Property Management (PMC 654): first BP month 2026-06, DQ_PROPERTY has
 * real rows for Jun/Jul/Aug only ($1,414/1 resident, $9,015.66/5, $7,450.69/4 - summing to
 * exactly the $18K/10 residents both decks' headlines already showed), no Sep row yet (DQ lag),
 * and NO May row (they weren't a partner in May at all). dqTenureMonths computed Jun-Sep = 4,
 * so windowMonths=4, and the un-floored loop anchored at Aug (the latest real DQ row) and walked
 * back 3 more months to May - fabricating a $0 May bar for a month before the partnership
 * existed, under a "Trailing 4 Months" title. Kevin caught this from a live screenshot and asked
 * "why is the $0 correct? what am I missing" - it wasn't; this is the fix.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/delinquency-tenure-floor.test.ts
 */
import assert from "node:assert/strict";

import { renderDelinquency } from "../slide-renderers.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// The real Coast Property Management shape.
const COAST_MONTHS = [
  { month: "2026-06-01", totalRentShielded: 1414.00, residentsShielded: 1 },
  { month: "2026-07-01", totalRentShielded: 9015.66, residentsShielded: 5 },
  { month: "2026-08-01", totalRentShielded: 7450.69, residentsShielded: 4 },
];

test("without a tenure floor, the loop fabricates a pre-partnership May bar (documents the bug)", () => {
  const { html, js } = renderDelinquency({ slideId: 13, months: COAST_MONTHS, windowMonths: 4 });
  // This is the OLD, buggy shape - kept as a named assertion (not a snapshot) so a future
  // change to the un-floored path is a deliberate, visible decision, not a silent drift. Chart
  // month labels live in the Chart.js `js` string, not `html`.
  assert.match(js, /May 2026/);
  assert.match(html, /Trailing 4 Months/);
});

test("with the real tenure floor, May never renders and the title shrinks to match", () => {
  const { html, js } = renderDelinquency({
    slideId: 13,
    months: COAST_MONTHS,
    windowMonths: 4,
    tenureStartMonth: "2026-06-01",
  });
  assert.doesNotMatch(js, /May 2026/, "fabricated a bar for a month before the partnership existed");
  assert.match(js, /Jun 2026/);
  assert.match(js, /Jul 2026/);
  assert.match(js, /Aug 2026/);
  // 3 real months rendered -> the label must say 3, not the raw windowMonths=4 input.
  assert.match(html, /Trailing 3 Months/);
  assert.doesNotMatch(html, /Trailing 4 Months/);
});

test("the headline dollar/resident totals are unchanged by the floor (no real row was ever in May anyway)", () => {
  const floored = renderDelinquency({
    slideId: 13, months: COAST_MONTHS, windowMonths: 4, tenureStartMonth: "2026-06-01",
  }).html;
  const unfloored = renderDelinquency({ slideId: 13, months: COAST_MONTHS, windowMonths: 4 }).html;
  const headlineRe = /Flex guaranteed (\$[\d,.]+K?) across ([\d,]+) resident payments/;
  const [, floAmt, floRes] = headlineRe.exec(floored) ?? [];
  const [, unfAmt, unfRes] = headlineRe.exec(unfloored) ?? [];
  assert.equal(floAmt, unfAmt);
  assert.equal(floRes, unfRes);
  assert.equal(floAmt, "$18K");
  assert.equal(floRes, "10");
});

test("a PMC with real DQ data starting exactly at tenure start floors to a no-op (nothing to clip)", () => {
  const months = [
    { month: "2025-01-01", totalRentShielded: 2_000, residentsShielded: 2 },
    { month: "2025-02-01", totalRentShielded: 3_000, residentsShielded: 3 },
    { month: "2025-03-01", totalRentShielded: 4_000, residentsShielded: 4 },
  ];
  const { html, js } = renderDelinquency({
    slideId: 13, months, windowMonths: 3, tenureStartMonth: "2025-01-01",
  });
  assert.match(html, /Trailing 3 Months/);
  assert.match(js, /Jan 2025/);
});

console.log(`\n${passed} passed`);
