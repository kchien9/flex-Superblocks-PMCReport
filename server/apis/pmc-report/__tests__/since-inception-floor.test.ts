/**
 * WHY THIS FILE EXISTS
 * ====================
 * Since Inception could render PRE-PARTNERSHIP years as real bars.
 *
 * The yearly query is deliberately unbounded ("true full history"), which is right for a
 * partner's own history but wrong whenever a transferred property carries billing rows under
 * this PMC's name from BEFORE the partnership - a transferred property's rollout_month is
 * inherited from its prior, unrelated owner. Clark computed `firstYear` from `partnerSince`
 * but fed it only to the subtitle, so the headline said "joined Flex in 2024" over bars going
 * back to 2019, and those 2019-2023 rows were also summed into the "$X guaranteed … since they
 * joined Flex" totals right next to it. Confirmed real on Bridge PM (Kevin's catch); Flask
 * fixed it by flooring yearly_df and re-gating to empty (generator/slides.py:7717-7719).
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/since-inception-floor.test.ts
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

/** Bridge-PM shape: billing from 2019 under a prior owner, partnership starts mid-2024. */
const year = (y: number, rent: number): YearlyData => ({
  year: y, totalRent: rent, billsPaid: rent / 1000, monthsActive: 12,
  ytdRent: rent / 2, ytdBills: rent / 2000, ytdMonthsActive: 6,
});
const YEARLY: YearlyData[] = [
  year(2019, 1_000_000), year(2020, 2_000_000), year(2021, 3_000_000),
  year(2022, 4_000_000), year(2023, 5_000_000), year(2024, 6_000_000), year(2025, 7_000_000),
];
const monthlyTotals: MonthlyTotal[] = ["2025-10-01", "2025-11-01", "2025-12-01"].map((m) => ({
  month: m, units: 1_000, billsPaid: 120, rentPaid: 150_000, newSignups: 10,
  adoptionRate: 0.12, propertyCount: 4,
}));
const base = {
  slideId: 3, pmcName: "Bridge PM", reportingMonth: "2025-12-01", yearlyData: YEARLY, monthlyTotals,
} satisfies SinceInceptionInput;

/** The year labels Chart.js is actually handed. */
function chartYears(html: string, js: string): string[] {
  const m = (html + js).match(/labels:\s*(\[[^\]]*\])/);
  assert.ok(m, "chart labels not found");
  return (JSON.parse(m[1]) as string[]).filter((s) => s !== "");
}

test("with no partnerSince, every billed year still renders (unchanged behaviour)", () => {
  const { html, js } = renderSinceInception({ ...base, partnerSince: null });
  assert.deepEqual(chartYears(html, js), ["2019", "2020", "2021", "2022", "2023", "2024", "2025"]);
  assert.ok(html.includes("joined Flex in 2019"));
});

test("pre-partnership years are floored out of the chart, not just the headline", () => {
  const { html, js } = renderSinceInception({ ...base, partnerSince: "2024-07-29" });
  assert.deepEqual(chartYears(html, js), ["2024", "2025"], "pre-2024 bars survived the floor");
  assert.ok(html.includes("joined Flex in 2024"));
  for (const y of ["2019", "2020", "2021", "2022", "2023"]) {
    assert.ok(!html.includes(`>${y}<`), `${y} still appears in the slide markup`);
  }
});

test("the subtitle totals are the post-floor totals, so they match the headline", () => {
  const { html } = renderSinceInception({ ...base, partnerSince: "2024-07-29" });
  // 2024 + 2025 = $13.0M, NOT the full-history $28.0M.
  assert.ok(html.includes("$13.0M guaranteed"), `subtitle totals not floored: ${html.slice(0, 400)}`);
  assert.ok(!html.includes("$28.0M"));
  // bills: (6_000_000 + 7_000_000) / 1000 = 13,000
  assert.ok(html.includes("13,000 bills paid"));
});

test("a partnerSince later than every billed year re-gates the slide to empty", () => {
  // Flask's `if yearly_df.empty: return "", ""`. An empty chart under a confident headline is
  // worse than no slide; the deck's .filter(Boolean) drops it.
  const r = renderSinceInception({ ...base, partnerSince: "2030-01-01" });
  assert.equal(r.html, "");
  assert.equal(r.js, "");
});

test("partnerSince inside the earliest year keeps that whole year", () => {
  // The floor is by YEAR, as Flask's is (`yearly_df["year"] >= first_year`).
  const { html, js } = renderSinceInception({ ...base, partnerSince: "2019-12-31" });
  assert.deepEqual(chartYears(html, js)[0], "2019");
});

test("per-entity stacked segments are floored too, and the palette index is preserved", () => {
  const entityYearlyData = [
    // Entity 0 has ONLY pre-partnership history (the transferred-in prior owner's rows).
    { pmcName: "Prior Owner", totalRentByYear: { 2019: 1_000_000, 2020: 2_000_000 }, ytdRentByYear: { 2019: 500_000 } },
    { pmcName: "Bridge PM", totalRentByYear: { 2024: 6_000_000, 2025: 7_000_000 }, ytdRentByYear: { 2025: 3_500_000 } },
    { pmcName: "Bridge PM Student", totalRentByYear: { 2024: 100_000, 2025: 200_000 }, ytdRentByYear: { 2025: 100_000 } },
  ];
  const { html, js } = renderSinceInception({ ...base, partnerSince: "2024-07-29", entityYearlyData });
  const all = html + js;
  // Still stacked: two entities have post-floor data.
  assert.ok(all.includes("stack: 'rent'"));
  // No pre-partnership entity money survived into any dataset.
  assert.ok(!all.includes("1000000") && !all.includes("2000000"), "pre-partnership entity rent leaked into the chart");
  // Entity 0 kept its slot (a zero-height segment) so entity 1/2 keep their ENTITY_PALETTE
  // colors - the repo's "same entity, same color on every slide" rule.
  const labels = [...all.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(labels.slice(0, 3), ["Prior Owner", "Bridge PM", "Bridge PM Student"]);
});

test("if the floor leaves only one entity with data, the slide stops stacking", () => {
  const entityYearlyData = [
    { pmcName: "Prior Owner", totalRentByYear: { 2019: 1_000_000 }, ytdRentByYear: {} },
    { pmcName: "Bridge PM", totalRentByYear: { 2024: 6_000_000, 2025: 7_000_000 }, ytdRentByYear: { 2025: 3_500_000 } },
  ];
  const { html, js } = renderSinceInception({ ...base, partnerSince: "2024-07-29", entityYearlyData });
  assert.ok(!(html + js).includes("stack: 'rent'"), "stacked a single real entity");
  assert.ok((html + js).includes("label: 'Rent paid / year'"), "did not fall back to the combined bar");
});

console.log(`\nsince-inception-floor: ${passed} tests passed`);
