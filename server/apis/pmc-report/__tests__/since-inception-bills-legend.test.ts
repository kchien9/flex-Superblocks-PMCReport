/**
 * WHY THIS FILE EXISTS
 * ====================
 * Two related bugs Kevin caught on a live Since Inception render, no screenshot needed to spot
 * either one from the description alone:
 *
 * 1. "These labels are conflicting" - the eyebrow ("RENT PAID & BILLS PAID, YTD THROUGH SEP")
 *    and the x-axis note ("Every bar shows Jan-Sep of that year only") both correctly announce
 *    YTD mode, but the top-right legend dot still said "Bills paid / year" unconditionally - a
 *    static string the toggle never touched. Three labels on screen at once, one of them
 *    contradicting the other two. Split into a full/ytd pair (si-bills-legend-full-<id> /
 *    si-bills-legend-ytd-<id>), same show/hide pattern as the eyebrow and x-axis note.
 *
 * 2. "The paying users [dots] only show in the YTD toggle" - every slide starts hidden
 *    (display:none) until made active, so this chart was created against a 0-sized canvas.
 *    centerDots' afterDatasetsDraw plugin reads chart.getDatasetMeta(0).data[i] for each dot's
 *    pixel position - garbage until a real resize happens. Clicking ANY toggle calls
 *    chart.update() after the slide is actually visible, which "fixed" the dots by accident;
 *    the real bug was that the FIRST paint (Full Year, the default) never got that same
 *    resize. Two other charts in this file (Flex Is For Everyone, Residents/Units) already
 *    carry a requestAnimationFrame(() => chart.resize()) call after creation for exactly this
 *    reason - Since Inception was just missing it.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/since-inception-bills-legend.test.ts
 */
import assert from "node:assert/strict";

import { renderSinceInception } from "../slide-renderers.js";
import type { MonthlyTotal, SinceInceptionInput, YearlyData } from "../slide-renderers.js";

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

test("the Bills Paid legend has a Full/YTD pair, hidden by default the same way the eyebrow does", () => {
  const { html } = renderSinceInception({
    slideId: 3, pmcName: "Coast Property Management", reportingMonth: "2025-12-01",
    yearlyData: YEARLY, monthlyTotals,
  } satisfies SinceInceptionInput);
  assert.match(html, /<span id="si-bills-legend-full-3">Bills paid \/ year<\/span>/);
  assert.match(html, /<span id="si-bills-legend-ytd-3" style="display:none;">Bills paid, YTD<\/span>/);
  // Exactly one of each - no leftover unconditional copy sitting alongside the new pair.
  assert.equal((html.match(/Bills paid \/ year/g) ?? []).length, 1);
  assert.equal((html.match(/Bills paid, YTD/g) ?? []).length, 1);
});

test("toggling to YTD swaps the Bills Paid legend, matching the eyebrow and x-axis note", () => {
  const { js } = renderSinceInception({
    slideId: 3, pmcName: "Coast Property Management", reportingMonth: "2025-12-01",
    yearlyData: YEARLY, monthlyTotals,
  } satisfies SinceInceptionInput);
  assert.match(js, /blFull\.style\.display\s*=\s*showYtd\s*\?\s*'none'\s*:\s*'inline'/);
  assert.match(js, /blYtd\.style\.display\s*=\s*showYtd\s*\?\s*'inline'\s*:\s*'none'/);
  assert.match(js, /si-bills-legend-full-'\s*\+\s*sid/);
  assert.match(js, /si-bills-legend-ytd-'\s*\+\s*sid/);
});

test("the chart forces a resize after creation, so the bills-paid dots don't need a toggle click to appear", () => {
  const { js } = renderSinceInception({
    slideId: 3, pmcName: "Coast Property Management", reportingMonth: "2025-12-01",
    yearlyData: YEARLY, monthlyTotals,
  } satisfies SinceInceptionInput);
  assert.match(js, /requestAnimationFrame\(\(\) => \{ window\['siChart3'\]\.resize\(\); \}\);/);
});

console.log(`\n${passed} passed`);
