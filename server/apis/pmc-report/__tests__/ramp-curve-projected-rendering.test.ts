/**
 * WHY THIS FILE EXISTS
 * ====================
 * Rendering-level companion to ramp-curve-reliability.test.ts: fillUnreliableRampMilestones
 * computes the right projected VALUE; this file checks renderRampBenchmark actually shows it
 * distinctly (dashed dot, "projected" label, stat-card note) rather than blending it in as if
 * it were observed data - the whole point of projecting instead of hiding or flat-lining is
 * that a rep (or a sharp prospect) can tell which number is which.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/ramp-curve-projected-rendering.test.ts
 */
import assert from "node:assert/strict";

import { fillUnreliableRampMilestones, renderRampBenchmark } from "../slides-prospect.js";
import type { RampRow, Benchmarks, ProspectInfo } from "../slides-prospect.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const BENCHMARKS: Benchmarks = {
  pms: "Yardi", pool_size: 5, median_nar: 0.16, avg_nar: 0.17, p25_nar: 0.08, p75_nar: 0.207,
  p75_signups: 10, median_avg_rent: 1500, avg_avg_rent: 1500, median_monthly_rent: 1500,
  avg_monthly_rent: 1500, footprint: "regional", match_level: "state", match_mode: "peer",
  established_only: false, affordable: false, is_sfr: false,
  prospect_units: 300, prospect_segment: "SMB", prospect_region: "South", _peer_pmc_names: [],
};
const PROSPECT: ProspectInfo = {
  name: "Sparrow Management", units: 300, state: "TX", pms: "Yardi", segment: "SMB",
  opp_stage: "", affordable: false, asset_subtypes: [], avg_rent: 1500, footprint: "regional",
};

function row(mo: number, propertyCount: number, p75Nar: number): RampRow {
  return { months_since_rollout: mo, median_nar: 0.1, avg_nar: 0.11, p25_nar: 0.05, p75_nar: p75Nar, p90_nar: 0.3, property_count: propertyCount };
}

test("a projected milestone renders dashed and labeled, not blended in", () => {
  // Sparrow's real shape: reliable through Month 12, thin (1 property) and noisy at Month 24.
  const rows = [row(0, 12, 0), row(3, 12, 0.106), row(6, 10, 0.146), row(12, 8, 0.207), row(24, 1, 0.10)];
  const filled = fillUnreliableRampMilestones(rows);
  const { html } = renderRampBenchmark(6, filled, BENCHMARKS, PROSPECT);
  assert.match(html, /stroke-dasharray="2,2"/);
  assert.match(html, />projected<\/text>/);
  assert.match(html, /Projected from your own earlier-month trend/);
  // The projected number should reflect the network-growth estimate (~26%), not the noisy
  // raw 10% that was actually in the thin Month-24 sample.
  assert.match(html, /~26\.0%/);
});

test("a fully reliable curve never shows the projected treatment", () => {
  const rows = [row(0, 40, 0.15), row(3, 38, 0.16), row(6, 35, 0.18), row(12, 30, 0.20), row(24, 12, 0.25)];
  const filled = fillUnreliableRampMilestones(rows);
  const { html } = renderRampBenchmark(6, filled, BENCHMARKS, PROSPECT);
  assert.doesNotMatch(html, /stroke-dasharray="2,2"/);
  assert.doesNotMatch(html, /Projected from your own earlier-month trend/);
});

console.log(`\n${passed} passed`);
