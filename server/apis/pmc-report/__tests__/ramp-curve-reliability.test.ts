/**
 * WHY THIS FILE EXISTS
 * ====================
 * Kevin's catch, live screenshot: "Sparrow Management, 5 comparable PMCs" ramp curve showed
 * Month 24's top-quartile adoption rate (20.0%) LOWER than Month 12's (20.7%). Real data, not
 * a bug in the query - each row of the ramp-curve pull is a cross-sectional slice (whichever
 * properties have reached that many months since THEIR OWN rollout), and property count
 * shrinks with tenure by construction, so a small peer match can leave Month 24 resting on
 * just one or two properties.
 *
 * First fix (truncate the curve at the last reliable milestone) worked but cost real coverage
 * - a small peer match, exactly the kind most likely to be thin at 24 months, would routinely
 * lose the whole 12-24 range. Kevin's catch again: a flat line (freeze at the last reliable
 * value) is also wrong - it implies adoption plateaus, which the real network data says is
 * false too.
 *
 * This version keeps every labeled milestone and PROJECTS whichever one doesn't clear
 * MIN_MILESTONE_PROPERTIES, scaling the last reliable earlier milestone by the network's own
 * real, independently-verified growth ratio (median/avg/p75/p90 all rise at every month 0-24
 * network-wide, with zero exceptions, across tens of thousands of properties) - and marks it
 * `projected: true` so the caller can render it distinctly, same idea as this deck's existing
 * "Projected" ghost-bar convention elsewhere.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/ramp-curve-reliability.test.ts
 */
import assert from "node:assert/strict";

import { fillUnreliableRampMilestones, projectRampMilestone, MIN_MILESTONE_PROPERTIES } from "../slides-prospect.js";
import type { RampRow } from "../slides-prospect.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function row(
  mo: number, propertyCount: number,
  medianNar = 0.15, avgNar = 0.16, p25Nar = 0.05, p75Nar = 0.22, p90Nar = 0.30,
): RampRow {
  return {
    months_since_rollout: mo, median_nar: medianNar, avg_nar: avgNar,
    p25_nar: p25Nar, p75_nar: p75Nar, p90_nar: p90Nar, property_count: propertyCount,
  };
}

test("projects month 24 from month 12 when 24 is a thin sample", () => {
  // Sparrow Management's real shape: plenty of properties through Month 12, only 1 left by
  // Month 24 - the exact case that printed a misleading dip.
  const rows = [
    row(0, 12), row(3, 12, undefined, undefined, undefined, 0.106),
    row(6, 10, undefined, undefined, undefined, 0.146), row(12, 8, undefined, undefined, undefined, 0.207),
    row(24, 1, undefined, undefined, undefined, 0.10), // thin, noisy raw value - should get overwritten
  ];
  const out = fillUnreliableRampMilestones(rows);
  assert.equal(out.length, 5); // nothing dropped - same milestones as before
  const row24 = out.find(r => r.months_since_rollout === 24)!;
  assert.equal(row24.projected, true);
  // Network's own real growth ratio for p75 (Month 12 -> Month 24), applied to the peer
  // group's own reliable Month-12 value (0.207) - not the noisy raw 0.10.
  assert.ok(Math.abs(row24.p75_nar - 0.207 * (0.125486 / 0.100000)) < 1e-9);
  assert.ok(row24.p75_nar > 0.207); // keeps climbing - never flat, never a dip
  const row12 = out.find(r => r.months_since_rollout === 12)!;
  assert.equal(row12.projected, false);
  assert.equal(row12.p75_nar, 0.207);
});

test("keeps every milestone real when 24 months is still a genuine sample", () => {
  const rows = [row(0, 40), row(3, 38), row(6, 35), row(12, 30), row(24, 12)];
  const out = fillUnreliableRampMilestones(rows);
  assert.equal(out.filter(r => r.projected).length, 0);
  assert.equal(out.length, 5);
});

test("drops the whole curve when even 12 months is too thin", () => {
  // Kevin's call, unchanged from the first fix: no reliable peer-specific anchor by Month 12
  // means there's no real signal left to project FROM either.
  const rows = [row(0, 12), row(3, 8), row(6, 5), row(12, 2)];
  const out = fillUnreliableRampMilestones(rows);
  assert.equal(out.length, 0);
});

test("exactly at the floor counts as reliable, not projected", () => {
  const rows = [row(0, 10), row(3, 10), row(6, 10), row(12, MIN_MILESTONE_PROPERTIES)];
  const out = fillUnreliableRampMilestones(rows);
  assert.notEqual(out.length, 0);
  assert.equal(out.find(r => r.months_since_rollout === 12)!.projected, false);
});

test("empty input returns empty without erroring", () => {
  assert.deepEqual(fillUnreliableRampMilestones([]), []);
});

test("projectRampMilestone scales by the real network ratio, and always keeps climbing", () => {
  const expected = 0.20 * (0.074561 / 0.053191);
  assert.ok(Math.abs(projectRampMilestone(0.20, 12, 24, "median_nar") - expected) < 1e-9);
  // Every series' network ratio from 12->24 is > 1 (real, verified: adoption keeps rising),
  // so a projection is never lower than its anchor - the actual thing this fix exists to
  // guarantee.
  for (const col of ["median_nar", "avg_nar", "p75_nar", "p90_nar"] as const) {
    assert.ok(projectRampMilestone(0.20, 12, 24, col) > 0.20);
  }
});

test("projectRampMilestone falls back to the anchor when the network baseline is zero", () => {
  // p25_nar is genuinely 0.0 network-wide through month 6 - dividing by that baseline would
  // crash or produce nonsense, so a zero baseline just returns the anchor's own value.
  assert.equal(projectRampMilestone(0.05, 3, 6, "p25_nar"), 0.05);
});

console.log(`\n${passed} passed`);
