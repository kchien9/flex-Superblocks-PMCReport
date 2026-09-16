/**
 * WHY THIS FILE EXISTS
 * ====================
 * Kevin's catch, live screenshot: Paths Management Services' "Flex Is for Everyone" slide
 * showed 68% of active Flex users piled into a single open-ended "$1,250+" bucket. Checked
 * directly against Snowflake before touching any code - the number itself is real, not a
 * query bug. But it exposed a real gap in the bucketing algorithm: the terminal "+" bucket is
 * supposed to catch a small tail past P95 ("equal-dollar-width bins spanning P5-P95" - see
 * renderHighRentAdoption's own comment), not the bulk of the population. That assumption
 * breaks when a PMC's real median sits close to (or above) the P95-derived top edge: Paths'
 * residents topped out under $1,900 (median $1,287), so a real "$1,250-$1,500 / $1,500+"
 * split was sitting right there and never got cut - 107 of 175 residents (61%) are actually
 * in a tight $1,250-$1,500 band, only 12 (7%) are genuinely above that.
 *
 * Fix: extend BREAKS past the P95 edge with more same-width buckets, toward the real observed
 * max, until the open bucket's share drops to something a single "+" catch-all should mean -
 * capped at 3 extra buckets. Ported from Flask's render_high_rent_adoption, same commit -
 * applied to BOTH the server-side initial render AND flexRentBreaks (the client-side twin
 * that recomputes breaks independently on every Last-Month/All-Time toggle).
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/rent-bucket-terminal-extension.test.ts
 */
import assert from "node:assert/strict";

import { renderHighRentAdoption } from "../slide-renderers.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const propertySnapshot = [
  { propertyName: "Alpha Towers", units: 100, billsPaid: 30, rentPaid: 40_000, adoptionRate: 0.3 },
  { propertyName: "Beta Court", units: 80, billsPaid: 15, rentPaid: 20_000, adoptionRate: 0.25 },
];

// Same shape as Paths Management Services' real data: 68% >= $1,250, P95 landing right at the
// original bucket edge, real max only one $250-wide bucket beyond it.
function pathsShapedResidentRents(): number[] {
  const below = [600, ...Array.from({ length: 27 }, (_, i) => 700 + i * 20)]; // 28 values, all < 1250
  const bulk = Array(58).fill(1300);
  const midTail = Array(5).fill(1500);
  const topTail = Array(5).fill(1700);
  return [...below, ...bulk, ...midTail, ...topTail]; // n = 96
}

test("the terminal bucket extends past P95 when it would otherwise swallow the bulk", () => {
  const { js } = renderHighRentAdoption({
    slideId: 39, pmcName: "Paths Management Services", propertySnapshot,
    residentRents: pathsShapedResidentRents(),
  });
  // Regex avoids matching on the literal en-dash character directly - a real, separate
  // source-encoding footgun on this environment, not the thing under test here.
  assert.match(js, /\$1,250.\$1,500/);
  assert.match(js, /\$1,500\+/);
  // The old single catch-all that swallowed 68% is gone.
  assert.doesNotMatch(js, /\$1,250\+/);
});

test("the terminal bucket stays as-is when the tail is already a small minority", () => {
  const rents = [
    ...Array(20).fill(600), ...Array(20).fill(900), ...Array(20).fill(1200),
    ...Array(20).fill(1500), ...Array(15).fill(1800), ...Array(5).fill(2200),
  ];
  const { js } = renderHighRentAdoption({
    slideId: 39, pmcName: "Coast Property Management", propertySnapshot, residentRents: rents,
  });
  const breaksFound = [...js.matchAll(/\$([\d,]+).\$([\d,]+)/g)].length
    + [...js.matchAll(/\$([\d,]+)\+/g)].length;
  assert.ok(breaksFound <= 6, `expected at most 6 bucket edges, got ${breaksFound}`);
});

test("the client-side toggle (flexRentBreaks) carries the identical extension logic", () => {
  // flexRentBreaks recomputes breaks independently on every All-Time/Last Month toggle - a
  // JS duplicate of the server-side algorithm, not a reuse of its output. Missing this half
  // would mean the initial render looks fixed but toggling periods reverts to the old bug.
  const { js } = renderHighRentAdoption({
    slideId: 39, pmcName: "Paths Management Services", propertySnapshot,
    residentRents: pathsShapedResidentRents(),
  });
  assert.match(js, /function flexRentBreaks\(rents\)/);
  assert.match(js, /var maxRent = sorted\[sorted\.length - 1\];/);
  assert.match(js, /if \(nextBreak >= maxRent\) break;/);
  assert.match(js, /deduped\.push\(nextBreak\);/);
});

console.log(`\n${passed} passed`);
