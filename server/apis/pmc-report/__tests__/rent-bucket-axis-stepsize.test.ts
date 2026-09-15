/**
 * WHY THIS FILE EXISTS
 * ====================
 * The Rent Bucket slide's $ axis (y2) set only min/max, no stepSize - Chart.js's own "nice
 * number" auto step algorithm doesn't know rentChartMax is always a multiple of 25,000, so on
 * a range like 0-625,000 it picked a clean 100,000 step (0/100K/.../600K) and then
 * force-included the exact configured max (625,000) as an extra, oddly-close 7th tick on top
 * of the real 600K one - Kevin's catch, live screenshot, Coast Property Management: "$625K"
 * sitting right on top of "$600K".
 *
 * Fix: an explicit stepSize of max/5. rentChartMax is always k*25_000, so max/5 is always
 * k*5_000 - an exact integer that divides max with zero remainder in exactly 5 steps, so the
 * forced max-tick always coincides with a regular-interval tick instead of sitting beside one.
 * Applied both to the initial server-rendered chart AND the client-side period-toggle rescale
 * (the toggle is what actually reaches All-Time mode - the bug Kevin saw).
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/rent-bucket-axis-stepsize.test.ts
 */
import assert from "node:assert/strict";

import { renderHighRentAdoption } from "../slide-renderers.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// Realistic spread of resident rents (last month) so the dynamic bucketer produces several
// real buckets with a nonzero, non-trivial rentChartMax.
const RESIDENT_RENTS = [
  800, 900, 950, 1100, 1150, 1200, 1300, 1350, 1400, 1450,
  1600, 1650, 1700, 1750, 1800, 1900, 2000, 2100, 2300, 2500, 2800, 3200,
];
const propertySnapshot = [
  { propertyName: "A", units: 100, billsPaid: 30, rentPaid: 45_000, adoptionRate: 0.3 },
  { propertyName: "B", units: 150, billsPaid: 50, rentPaid: 90_000, adoptionRate: 0.33 },
  { propertyName: "C", units: 80, billsPaid: 20, rentPaid: 36_000, adoptionRate: 0.25 },
];

test("initial render sets an explicit stepSize that evenly divides the max (no stray tick)", () => {
  const { js } = renderHighRentAdoption({
    slideId: 12, pmcName: "Coast Property Management", propertySnapshot,
    residentRents: RESIDENT_RENTS,
  });
  // Two independent, narrow matches rather than one brace-spanning regex - the y2 block has
  // nested {} of its own (font, grid, the callback function body) that a greedy/non-greedy
  // [^}]* can't safely straddle. stepSize is emitted as the literal unevaluated expression
  // "<max> / 5" (template interpolation only substitutes rentChartMax, not the "/ 5" after
  // it), so match that shape directly rather than a bare number.
  const maxMatch = js.match(/max:\s*(\d+),\s*position:\s*'right'/);
  assert.ok(maxMatch, "y2 axis max (position: 'right') not found in generated JS");
  const max = Number(maxMatch![1]);
  assert.ok(max > 0, "rentChartMax should be a real positive number for this fixture");
  assert.ok(max % 5 === 0, "rentChartMax (always k*25_000) should always be divisible by 5");
  assert.match(js, new RegExp(`stepSize:\\s*${max}\\s*/\\s*5,\\s*callback:\\s*function\\(v\\)\\s*\\{\\s*return fmtRent`));
});

test("the client-side period-toggle rescale also sets a matching stepSize, not just max", () => {
  const { js } = renderHighRentAdoption({
    slideId: 12, pmcName: "Coast Property Management", propertySnapshot,
    residentRents: RESIDENT_RENTS,
    alltimeResidentRents: RESIDENT_RENTS.map((r) => ({ amountPaid: r, totalPaid: r * 12 })),
  });
  assert.match(js, /chart\.options\.scales\.y2\.max\s*=\s*y2Max;/);
  assert.match(js, /chart\.options\.scales\.y2\.ticks\.stepSize\s*=\s*y2Max\s*\/\s*5;/);
});

console.log(`\n${passed} passed`);
