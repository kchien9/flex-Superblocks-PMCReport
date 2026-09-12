/**
 * The Expansion cover's third tile — "Total Portfolio", "1,232 of 11,000 units" (Flask
 * render_cover, generator/slides.py:310-311).
 *
 * Clark used to print no portfolio size on the Expansion cover at all: the tile was dropped
 * wholesale when the QBR "Reporting Period" label was removed from that deck, which took the one
 * number the whole Expansion pitch argues about with it. The value itself is NOT a caller input —
 * it is resolved from PRODUCTION.SALES.DIM_SALES_ACCOUNTS through resolveSubjectPortfolioUnits,
 * the shared helper that takes ONE row per PMC_ID (never a blind SUM across joined account rows)
 * and sums across distinct ids.
 *
 * Row fixtures are live DIM_SALES_ACCOUNTS rows (Snowflake, verified 2026-09-11).
 *
 * No test runner in this repo - run with:
 *   npx tsx server/apis/pmc-report/__tests__/expansion-cover.test.ts
 */
import assert from "node:assert/strict";

import { renderCover } from "../get-pmc-monthly-report.js";
import { resolveSubjectPortfolioUnits } from "../peer-matching.js";
import type { SubjectPortfolioRow } from "../peer-matching.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const BASE = {
  pmcName: "AJH Management",
  reportingMonth: "2026-09-01",
  partnerSince: "2021-04-01",
  propertyCount: 14,
  firstMonth: "2021-04-01",
};

/** AJH Management, PMC_ID 478 - one account row, 11,000 total / 1,232 Flex units. */
const AJH: SubjectPortfolioRow[] = [
  { PMC_ID: 478, TOTAL_COMPANY_UNITS: 11000, FLEX_UNITS: 1232 },
];

/** The eight Asset Living entities a combined deck would name, one account row each. */
const ASSET_LIVING: SubjectPortfolioRow[] = [
  { PMC_ID: 386, TOTAL_COMPANY_UNITS: 135699, FLEX_UNITS: 129887 },
  { PMC_ID: 272, TOTAL_COMPANY_UNITS: 133226, FLEX_UNITS: 129316 },
  { PMC_ID: 266, TOTAL_COMPANY_UNITS: 52467, FLEX_UNITS: 48262 },
  { PMC_ID: 519, TOTAL_COMPANY_UNITS: 38771, FLEX_UNITS: 37272 },
  { PMC_ID: 358, TOTAL_COMPANY_UNITS: 28809, FLEX_UNITS: 26029 },
  { PMC_ID: 379, TOTAL_COMPANY_UNITS: 26520, FLEX_UNITS: 20341 },
  { PMC_ID: 312, TOTAL_COMPANY_UNITS: 20856, FLEX_UNITS: 19815 },
  { PMC_ID: 1319, TOTAL_COMPANY_UNITS: 1649, FLEX_UNITS: 1370 },
  // Junk rows the same live query returns: no PMC_ID, zero units. Must contribute nothing.
  { PMC_ID: null, TOTAL_COMPANY_UNITS: 0, FLEX_UNITS: 0 },
  { PMC_ID: null, TOTAL_COMPANY_UNITS: 0, FLEX_UNITS: 0 },
];

test("AJH Management resolves to 11,000 and the cover prints '1,232 of 11,000 units'", () => {
  const total = resolveSubjectPortfolioUnits(AJH);
  assert.equal(total, 11000);
  const html = renderCover({ ...BASE, isExpansion: true, totalUnits: 1232, totalPortfolioUnits: total });
  assert.ok(html.includes("Total Portfolio"), "Expansion cover must label the tile 'Total Portfolio'");
  assert.ok(html.includes("1,232 of 11,000 units"), "Expansion cover must print enrolled-of-total");
  assert.ok(!html.includes("Reporting Period"), "Expansion cover must not keep the QBR label");
  assert.ok(html.includes("Portfolio Expansion Opportunity"));
});

test("Asset Living's eight entities resolve to 437,997 (sum across distinct PMC_IDs)", () => {
  // OPEN QUESTION with Kevin: whether a combined family deck SHOULD sum across legal entities at
  // all, or show only the entity being pitched. This asserts what the shared helper produces
  // today - it does not endorse the framing. Single-entity "Asset Living" alone is 135,699.
  assert.equal(resolveSubjectPortfolioUnits(ASSET_LIVING), 437997);
  assert.equal(resolveSubjectPortfolioUnits([ASSET_LIVING[0]]), 135699);
});

test("the tile self-gates: no resolved total means no third tile, not '0 units'", () => {
  const html = renderCover({ ...BASE, isExpansion: true, totalUnits: 1232, totalPortfolioUnits: 0 });
  assert.ok(!html.includes("Total Portfolio"));
  assert.ok(!html.includes("of 0 units"));
  assert.ok(!html.includes("Reporting Period"));
});

test("QBR's own third tile is untouched", () => {
  const html = renderCover({ ...BASE, isExpansion: false });
  assert.ok(html.includes("Reporting Period"));
  assert.ok(/– \w+ 2026 BP months/.test(html), "QBR keeps the firstMonth–reportingMonth range");
  assert.ok(!html.includes("Total Portfolio"));
  assert.ok(html.includes("Flex Performance Review"));
});

console.log(`\n${passed} tests passed`);
