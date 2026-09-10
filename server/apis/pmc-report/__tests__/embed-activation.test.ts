/**
 * Render-level tests for the prospect embed-activation slide's Platinum comparator - mirrors
 * the render_embed_activation tests in Flask tests/test_slides_prospect.py (Flask e138728).
 * No test runner in this repo - run with:
 *   npx tsx server/apis/pmc-report/__tests__/embed-activation.test.ts
 */
import assert from "node:assert/strict";

import { renderEmbedActivation } from "../slides-prospect.js";
import type { Benchmarks, EmbedData, ProspectInfo } from "../slides-prospect.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function embed(unitCount = 2000, chargedUsers = 68, msp = "yardi"): EmbedData {
  return { pmc_name: "X", unit_count: unitCount, property_count: 12, charged_users: chargedUsers, bills_paid: 150, msp, bp_month: "" };
}

function prospect(units = 1000): ProspectInfo {
  return { name: "X", units, state: "TX", pms: "Yardi", segment: "SMB", opp_stage: "", affordable: false, asset_subtypes: [], avg_rent: null, footprint: "single" };
}

function bench(overrides: Partial<Benchmarks>): Benchmarks {
  return {
    median_nar: 0.10, avg_nar: 0.10, p25_nar: 0.05, p75_nar: 0.15, p75_signups: 0,
    median_avg_rent: 1500, avg_avg_rent: 1500, median_monthly_rent: 0, avg_monthly_rent: 0,
    pool_size: 10, footprint: "single", match_level: "similar size", match_mode: "portfolio",
    established_only: false, pms: "Yardi", affordable: false, prospect_units: 1000,
    prospect_segment: "SMB", prospect_region: "", _peer_pmc_names: [],
    ...overrides,
  };
}

test("uses the Platinum comparator when present (+22 for 1,000 units @ 9.0%, 68 charged)", () => {
  const { html } = renderEmbedActivation(2, embed(), prospect(1000), bench({
    median_nar: 0.056, platinum_median_nar: 0.09, platinum_peer_count: 5, platinum_scope: "comparable",
  }));
  assert.ok(html.includes("With integration + marketing (Platinum) - peer median"));
  assert.ok(html.includes("+22")); // floor(1000 * 0.09) = 90 - 68
  assert.ok(html.includes("similar PMCs' opted-in properties"));
  assert.ok(html.includes("9.0% adoption"));
  assert.ok(html.includes("fully integrated, marketed program"));
  assert.ok(!html.includes("With full integration - peer median"));
});

test("network scope labels the pool 'Platinum properties across Flex'", () => {
  const { html } = renderEmbedActivation(2, embed(), prospect(1000), bench({
    median_nar: 0.056, platinum_median_nar: 0.09, platinum_scope: "network",
  }));
  assert.ok(html.includes("Platinum properties across Flex"));
  assert.ok(!html.includes("opted-in properties"));
});

test("without platinum keys the old comparator renders byte-for-byte", () => {
  const { html } = renderEmbedActivation(2, embed(), prospect(1000), bench({ median_nar: 0.10 }));
  assert.ok(html.includes("With full integration - peer median"));
  assert.ok(!html.includes("Platinum"));
  assert.ok(html.includes("10.0% adoption"));
  assert.ok(html.includes("based on similar Yardi PMCs on Flex"));
  assert.ok(html.includes("+32")); // floor(1000 * 0.10) = 100 - 68
  assert.ok(html.includes("fully integrated program."));
  assert.ok(!html.includes("marketed program"));
  assert.ok(html.includes("of embed portfolio")); // real unit_count present
});

test("never prints +0 - upside <= 0 renders 'Already ahead of the median.'", () => {
  // embed rate 68/2000 = 3.4%; projected floor(1000 * 0.056) = 56 < 68 charged
  const { html } = renderEmbedActivation(2, embed(), prospect(1000), bench({ median_nar: 0.056 }));
  assert.ok(!html.includes("+0"));
  assert.ok(html.includes("Already ahead of the median."));
  assert.ok(html.includes("5.6% is the peer baseline, not the ceiling"));
  assert.ok(!html.includes("additional residents who could split rent"));
});

test("missing embed unit_count (AppFolio) labels the rate over total units", () => {
  const { html } = renderEmbedActivation(2, embed(0, 68, "appfolio"), prospect(1000), bench({ median_nar: 0.10 }));
  assert.ok(html.includes("of 1,000 total units"));
  assert.ok(html.includes("6.8% of your total units"));
  assert.ok(!html.includes("of embed portfolio"));
  assert.ok(!html.includes("of portfolio &middot;"));
});

test("left panel says 'or any marketing to residents'", () => {
  const { html } = renderEmbedActivation(2, embed(), prospect(1000), bench({ median_nar: 0.10 }));
  assert.ok(html.includes("without a formal integration or any marketing to residents."));
});

console.log(`\n${passed} passed`);
