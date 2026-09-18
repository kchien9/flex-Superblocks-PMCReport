/**
 * WHY THIS FILE EXISTS
 * ====================
 * Kevin's catch, live screenshot: "Sparrow Management, 5 comparable PMCs" ramp curve showed
 * Month 24's top-quartile adoption rate (20.0%) LOWER than Month 12's (20.7%). Real data, not
 * a bug in the query - each row of the ramp-curve pull is a cross-sectional slice (whichever
 * properties have reached that many months since THEIR OWN rollout, not one cohort tracked
 * over time), and property count shrinks with tenure by construction, so a small peer match
 * can leave Month 24 resting on just one or two properties. Not a real regression, a much
 * smaller and different sample than Month 12's - but nothing on the slide would have told a
 * rep that (the deck's own "N comparable properties" caption is computed from the BEST
 * month's count, not the one actually backing the number on screen).
 *
 * Fix: a data-sufficiency floor, not a methodology change. truncateRampToReliableWindow cuts
 * the curve to the latest labeled milestone (3/6/12/24) that still has enough real properties
 * behind it, and drops the whole curve if even Month 12 doesn't clear the floor - a 3- or
 * 6-month-only curve barely tells the "adoption took off" story this slide exists for.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/ramp-curve-reliability.test.ts
 */
import assert from "node:assert/strict";

import { truncateRampToReliableWindow, MIN_MILESTONE_PROPERTIES } from "../slides-prospect.js";
import type { RampRow } from "../slides-prospect.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function row(mo: number, propertyCount: number, medianNar = 0.15): RampRow {
  return {
    months_since_rollout: mo, median_nar: medianNar, avg_nar: medianNar,
    p25_nar: medianNar * 0.5, p75_nar: medianNar * 1.5, p90_nar: medianNar * 2,
    property_count: propertyCount,
  };
}

test("truncates to 12 months when 24 is a thin sample", () => {
  // Sparrow Management's real shape: plenty of properties through Month 12, only 1 left by
  // Month 24 - the exact case that printed a misleading dip.
  const rows = [row(0, 12), row(3, 12, 0.106), row(6, 10, 0.146), row(12, 8, 0.207), row(24, 1, 0.10)];
  const out = truncateRampToReliableWindow(rows);
  assert.deepEqual(out.map(r => r.months_since_rollout), [0, 3, 6, 12]);
});

test("keeps the full curve when 24 months is still a real sample", () => {
  const rows = [row(0, 40), row(3, 38), row(6, 35), row(12, 30), row(24, 12)];
  const out = truncateRampToReliableWindow(rows);
  assert.deepEqual(out.map(r => r.months_since_rollout), [0, 3, 6, 12, 24]);
});

test("drops the whole curve when even 12 months is too thin", () => {
  // Kevin's call: a 3- or 6-month-only curve isn't worth showing at all.
  const rows = [row(0, 12), row(3, 8), row(6, 5), row(12, 2)];
  const out = truncateRampToReliableWindow(rows);
  assert.equal(out.length, 0);
});

test("exactly at the floor counts as reliable, not below it", () => {
  const rows = [row(0, 10), row(3, 10), row(6, 10), row(12, MIN_MILESTONE_PROPERTIES)];
  const out = truncateRampToReliableWindow(rows);
  assert.deepEqual(out.map(r => r.months_since_rollout), [0, 3, 6, 12]);
});

test("a missing Month 12 row is treated as zero properties - drops the whole curve", () => {
  const rows = [row(0, 5), row(3, 4), row(6, 2)];
  const out = truncateRampToReliableWindow(rows);
  assert.equal(out.length, 0);
});

test("empty input returns empty without erroring", () => {
  assert.deepEqual(truncateRampToReliableWindow([]), []);
});

console.log(`\n${passed} passed`);
