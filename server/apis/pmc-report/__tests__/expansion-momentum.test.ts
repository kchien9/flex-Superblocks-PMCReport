/**
 * WHY THIS FILE EXISTS
 * ====================
 * Kevin's ask (2026-09-14): now that growth-trend slides (Adoption Trend included) render on
 * every Expansion deck, "The Case for Expanding" should lead with a 5th proof point about
 * adoption momentum - but ONLY when the trend is genuinely real, not asserted. Verifies
 * medianMomAdoptionTrend's gating (>=3 months, robust median-MoM, not a bare last-vs-previous
 * comparison) and renderExpansionCaseClose's use of it: the proof point appears first, the
 * title/subtitle renumber to five, and it's silent on flat/declining/sparse data - mirroring
 * Flask's identical port in generator/slides.py (render_expansion_case_close).
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/expansion-momentum.test.ts
 */
import assert from "node:assert/strict";

import { medianMomAdoptionTrend, renderExpansionCaseClose } from "../expansion-renderers.js";
import type { ExpansionCaseCloseInput } from "../expansion-renderers.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const BASE: ExpansionCaseCloseInput = {
  slideId: 46,
  pmcName: "Coast Property Management",
  enrolledUnits: 8_000,
  totalPortfolioUnits: 10_000,
  currentNar: 0.145,
  currentRent: 1_500_000,
  currentResidents: 8_000,
};

const rates = (vals: number[]) => vals.map((adoptionRate) => ({ adoptionRate }));

test("medianMomAdoptionTrend returns null below the 3-month floor", () => {
  assert.equal(medianMomAdoptionTrend(rates([0.10, 0.14])), null);
});

test("medianMomAdoptionTrend computes a robust median, not a last-vs-previous delta", () => {
  // One outlier month (a one-time spike) must not flip the reading - median of
  // [0.01, 0.01, 0.01, 0.01, 0.20] is 0.01, not the -0.19 or +0.19 a naive endpoint diff would give.
  const r = medianMomAdoptionTrend(rates([0.10, 0.11, 0.12, 0.13, 0.14, 0.34]));
  assert.ok(r);
  assert.ok(Math.abs(r!.medianMom - 0.01) < 1e-9, `expected median ~0.01, got ${r!.medianMom}`);
});

test("proof point appears first on a real rising trend", () => {
  const { html } = renderExpansionCaseClose({
    ...BASE,
    monthlyTotals: rates([0.10, 0.11, 0.12, 0.13, 0.14, 0.15]),
  });
  assert.match(html, /Five proof points\./);
  assert.match(html, /Adoption momentum/);
  assert.match(html, /trending up, month over month/);
  // "1" is the circle badge on the FIRST rendered finding - the momentum card must be it.
  const momentumIdx = html.indexOf("trending up, month over month");
  const badgeIdx = html.lastIndexOf(">1<", momentumIdx);
  assert.ok(badgeIdx > -1 && badgeIdx < momentumIdx, "momentum finding is not numbered first");
});

test("proof point absent on a flat trend", () => {
  const { html } = renderExpansionCaseClose({ ...BASE, monthlyTotals: rates([0.12, 0.12, 0.12, 0.12, 0.12, 0.12]) });
  assert.match(html, /Four proof points\./);
  assert.doesNotMatch(html, /Adoption momentum/);
});

test("proof point absent on a declining trend", () => {
  const { html } = renderExpansionCaseClose({ ...BASE, monthlyTotals: rates([0.18, 0.16, 0.14, 0.12, 0.10, 0.08]) });
  assert.match(html, /Four proof points\./);
  assert.doesNotMatch(html, /Adoption momentum/);
});

test("proof point absent when monthlyTotals is omitted (backward compatible)", () => {
  const { html } = renderExpansionCaseClose({ ...BASE });
  assert.match(html, /Four proof points\./);
  assert.doesNotMatch(html, /Adoption momentum/);
});

console.log(`\n${passed} passed`);
