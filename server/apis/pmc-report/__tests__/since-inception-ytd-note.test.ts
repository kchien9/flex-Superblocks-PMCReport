/**
 * WHY THIS FILE EXISTS
 * ====================
 * Since Inception's YTD toggle ("YTD through Sep") switches the chart to Jan-through-that-month
 * bars, but nothing on screen said so - Flask shows a small note under the chart
 * ("Every bar shows Jan-Sep of that year only") exactly when YTD is active, and Clark had no
 * equivalent element at all (Kevin's catch, live screenshot: Flask's Coast Property Management
 * deck showed the note, Clark's didn't). Added the same si-xaxis-note-<id> div (hidden by
 * default, shown only in YTD mode) to BOTH the stacked and non-stacked branches of
 * flexToggleSIView, mirroring Flask's si-xaxis-note-{slide_id} / xAxisNote wiring exactly
 * (generator/slides.py:8221,8397-8398).
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/since-inception-ytd-note.test.ts
 */
import assert from "node:assert/strict";

import { renderSinceInception } from "../slide-renderers.js";
import type { MonthlyTotal, SinceInceptionEntityYearly, SinceInceptionInput, YearlyData } from "../slide-renderers.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const year = (y: number, rent: number): YearlyData => ({
  year: y, totalRent: rent, billsPaid: rent / 1000, monthsActive: 12,
  ytdRent: rent / 2, ytdBills: rent / 2000, ytdMonthsActive: 6,
});
const YEARLY: YearlyData[] = [year(2024, 4_000_000), year(2025, 6_000_000)];
const monthlyTotals: MonthlyTotal[] = ["2025-10-01", "2025-11-01", "2025-12-01"].map((m) => ({
  month: m, units: 1_000, billsPaid: 120, rentPaid: 150_000, newSignups: 10,
  adoptionRate: 0.12, propertyCount: 4,
}));

function assertNoteWiring(html: string, js: string, slideId: number): void {
  // Present, hidden by default, and carries the real YTD month label (not a placeholder).
  const noteRe = new RegExp(
    `<div id="si-xaxis-note-${slideId}"[^>]*display:none[^>]*>Every bar shows Jan-\\w+ of that year only</div>`,
  );
  assert.match(html, noteRe, "xaxis note div missing, not hidden by default, or wrong copy");
  // The toggle function must reference the note element and flip it on for YTD, off for Full Year.
  assert.match(js, /si-xaxis-note-'\s*\+\s*sid/, "toggle JS never looks up the xaxis note element");
  assert.match(
    js,
    /xAxisNote\.style\.display\s*=\s*showYtd\s*\?\s*'block'\s*:\s*'none'/,
    "toggle JS doesn't show the note in YTD mode / hide it in Full Year mode",
  );
}

test("non-stacked (single-PMC) Since Inception wires the YTD x-axis note", () => {
  const { html, js } = renderSinceInception({
    slideId: 3, pmcName: "Coast Property Management", reportingMonth: "2025-12-01",
    yearlyData: YEARLY, monthlyTotals,
  } satisfies SinceInceptionInput);
  assertNoteWiring(html, js, 3);
});

test("stacked (combined) Since Inception also wires the YTD x-axis note", () => {
  const entityYearlyData: SinceInceptionEntityYearly[] = [
    { pmcName: "Coast Property Management", totalRentByYear: { 2024: 2_000_000, 2025: 3_000_000 }, ytdRentByYear: { 2024: 1_000_000, 2025: 1_500_000 } },
    { pmcName: "Coast Affiliate", totalRentByYear: { 2024: 2_000_000, 2025: 3_000_000 }, ytdRentByYear: { 2024: 1_000_000, 2025: 1_500_000 } },
  ];
  const { html, js } = renderSinceInception({
    slideId: 9, pmcName: "Coast Family", reportingMonth: "2025-12-01",
    yearlyData: YEARLY, monthlyTotals, entityYearlyData,
  } satisfies SinceInceptionInput);
  assertNoteWiring(html, js, 9);
});

console.log(`\n${passed} passed`);
