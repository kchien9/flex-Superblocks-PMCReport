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
 *    pixel position - garbage until a real resize happens. A bare resize() (2026-09-15's first
 *    attempt) fixed the absence but regressed to something worse on the combined/stacked view -
 *    overlapping garbled labels and a stray oversized ghost box, a real live-screenshot catch.
 *    centerDots is the only hand-rolled canvas plugin in this file (every other resize() site
 *    only has the standard chartjs-plugin-datalabels, which animates cleanly on its own) - it
 *    re-reads scale/bar pixel positions fresh on every afterDatasetsDraw call, so if resize()
 *    kicks off Chart.js's default animated transition, this plugin repaints mid-interpolation.
 *    Fixed with resize() (still needed - it's the only call that corrects the canvas's actual
 *    pixel dimensions) immediately followed by update('none') (forces a final, fully
 *    non-animated redraw against those now-correct dimensions, so nothing is ever left
 *    mid-transition for this plugin to draw over).
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/since-inception-bills-legend.test.ts
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

test("the chart forces a resize + non-animated redraw after creation, so the bills-paid dots don't need a toggle click to appear or repaint garbled", () => {
  const { js } = renderSinceInception({
    slideId: 3, pmcName: "Coast Property Management", reportingMonth: "2025-12-01",
    yearlyData: YEARLY, monthlyTotals,
  } satisfies SinceInceptionInput);
  assert.match(js, /requestAnimationFrame\(\(\) => \{/);
  assert.match(js, /const c = window\['siChart3'\];/);
  assert.match(js, /c\.resize\(\);/);
  // update('none') must run too, not just resize() alone - the whole point of this second call
  // is to force a final, non-animated redraw so centerDots never draws mid-transition.
  assert.match(js, /c\.update\('none'\);/);
  // A faithful headless-browser repro (real Chart.js 4.4.0 + chartjs-plugin-datalabels, single
  // and 8-entity combined cases) proved this resize/update logic itself renders correctly - so
  // if Kevin is still seeing the bug live, whatever throws or goes missing needs to actually
  // surface instead of vanishing silently. showSlide()'s try/catch only wraps the synchronous
  // initSlideN() call, not this async requestAnimationFrame callback.
  assert.match(js, /if \(!c\) \{ console\.error\('slide 3 SI resize: chart missing'\); return; \}/);
  assert.match(js, /\} catch \(e\) \{\s*console\.error\('slide 3 SI resize failed:', e\);/);
});

test("the same fix reaches the combined/stacked view - the exact shape the live glitch showed up on", () => {
  // Asset Living's real shape: several entities stacked into one bar per year.
  const entityYearlyData: SinceInceptionEntityYearly[] = [
    { pmcName: "Asset Living", totalRentByYear: { 2024: 200_000_000, 2025: 300_000_000 }, ytdRentByYear: { 2024: 100_000_000, 2025: 150_000_000 } },
    { pmcName: "Echelon Property Group", totalRentByYear: { 2024: 20_000_000, 2025: 30_000_000 }, ytdRentByYear: { 2024: 10_000_000, 2025: 15_000_000 } },
    { pmcName: "FPI", totalRentByYear: { 2024: 50_000_000, 2025: 70_000_000 }, ytdRentByYear: { 2024: 25_000_000, 2025: 35_000_000 } },
  ];
  const { js } = renderSinceInception({
    slideId: 9, pmcName: "Asset Living", reportingMonth: "2025-12-01",
    yearlyData: YEARLY, monthlyTotals, entityYearlyData,
  } satisfies SinceInceptionInput);
  assert.match(js, /const c = window\['siChart9'\];/);
  assert.match(js, /c\.resize\(\);/);
  assert.match(js, /c\.update\('none'\);/);
});

console.log(`\n${passed} passed`);
