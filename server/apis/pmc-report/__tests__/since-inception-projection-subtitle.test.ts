/**
 * WHY THIS FILE EXISTS
 * ====================
 * Kevin's ask (2026-09-15): Since Inception's subtitle should say "...and where you're headed"
 * since the chart already renders a projected/ghost bar for an in-progress year. Gated on the
 * SAME hasProjection flag that already gates the ghost bar and its footnote - a fully completed
 * year has no projection bar at all, so claiming "where you're headed" with nothing on the
 * chart backing it up would be exactly the "copy claims content the slide doesn't have" bug
 * class this whole audit exists to catch.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/since-inception-projection-subtitle.test.ts
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

const year = (y: number, rent: number, monthsActive = 12): YearlyData => ({
  year: y, totalRent: rent, billsPaid: rent / 1000, monthsActive,
  ytdRent: rent / 2, ytdBills: rent / 2000, ytdMonthsActive: Math.min(monthsActive, 6),
});
const monthlyTotals: MonthlyTotal[] = ["2026-04-01", "2026-05-01", "2026-06-01"].map((m) => ({
  month: m, units: 1_000, billsPaid: 120, rentPaid: 150_000, newSignups: 10,
  adoptionRate: 0.12, propertyCount: 4,
}));

test("in-progress current year gets the projection clause", () => {
  const yearlyData = [year(2024, 4_000_000), year(2025, 6_000_000), year(2026, 3_000_000, 6)];
  const { html } = renderSinceInception({
    slideId: 3, pmcName: "Coast Property Management", reportingMonth: "2026-06-01",
    yearlyData, monthlyTotals,
  } satisfies SinceInceptionInput);
  assert.match(html, /joined Flex in 2024 - and where you.re headed\./);
});

test("a fully completed year gets no projection clause - nothing on the chart backs it up", () => {
  const yearlyData = [year(2024, 4_000_000), year(2025, 6_000_000), year(2026, 3_000_000, 12)];
  const { html } = renderSinceInception({
    slideId: 3, pmcName: "Coast Property Management", reportingMonth: "2026-06-01",
    yearlyData, monthlyTotals,
  } satisfies SinceInceptionInput);
  assert.match(html, /joined Flex in 2024\.<\/div>/);
  assert.doesNotMatch(html, /where you.re headed/);
});

test("a partner with no history in the current year at all gets no projection clause", () => {
  const yearlyData = [year(2023, 4_000_000), year(2024, 6_000_000)];
  const { html } = renderSinceInception({
    slideId: 3, pmcName: "Coast Property Management", reportingMonth: "2026-06-01",
    yearlyData, monthlyTotals,
  } satisfies SinceInceptionInput);
  assert.doesNotMatch(html, /where you.re headed/);
});

console.log(`\n${passed} passed`);
