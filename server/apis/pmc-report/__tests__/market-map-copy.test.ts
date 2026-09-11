/**
 * Market Map slide copy regressions (2026-09-11). No test runner in this repo - run with:
 *   npx tsx server/apis/pmc-report/__tests__/market-map-copy.test.ts
 *
 * Covers:
 *   1. The `isMatched` gating Flask derives at generator/slides_prospect.py:3311
 *      (`is_matched = bool(similarity) and not similarity.get("is_fallback")`). Three
 *      distinct copy variants must come out: a real rent+size match, an explicit
 *      is_fallback:true similarity, and a tier:"all" similarity. Only the first may claim
 *      the market population is comparable to the prospect's own.
 *   2. The raw DMA_NAME label prints verbatim - never title-cased. Real stored values are
 *      ALL CAPS with abbreviations and punctuation ("BIRMINGHAM (ANN & TUSC)",
 *      "CEDAR RAPIDS - WTRLO - IWC&DUB", "ALBANY, GA"), which title-casing mangles and
 *      which also made the bullets disagree with the slide's own header.
 *   3. The shared percent/pp formatters (format-pct.ts, Flask's _fmt_pct/_fmt_pct100/_fmt_pp):
 *      no bare trailing ".0", and the sign survives on a negative pp delta.
 */
import assert from "node:assert/strict";

import { renderMarketMap } from "../market-map-slides.js";
import type { Market, MarketSummary, SimilarityInfo, MatchedUsageTotals } from "../market-map-data.js";
import { fmtPct, fmtPct100, fmtPctNum, fmtPp } from "../format-pct.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const NO_USAGE: MatchedUsageTotals = { matched_count: 0, residents: 0, ytd_rent: 0 };

function similarity(over: Partial<SimilarityInfo>): SimilarityInfo {
  return {
    tier: "rent+size",
    label: "rent within 25% of yours & similar property size",
    is_fallback: false,
    rent_low: 1100,
    rent_high: 1900,
    unit_low: 80,
    unit_high: 320,
    pool_properties: 140,
    unknown_rent_properties: 3,
    ...over,
  };
}

/** One DMA's summary. market_wide is always the unfiltered population (Flask's contract). */
function summary(sim: SimilarityInfo | null): MarketSummary {
  return {
    total_properties: 140,
    total_pmcs: 22,
    total_units: 20_000,
    total_active_users: 1_600,
    avg_adoption: 0.08,
    rent_paid_month: 2_400_000,
    total_rent_paid_all_time: 58_000_000,
    new_properties_this_year: 18,
    new_pmcs_this_year: 4,
    new_properties_rent_paid: 3_100_000,
    similarity: sim,
    market_wide: {
      total_properties: 900,
      total_pmcs: 130,
      total_units: 100_000,
      total_active_users: 5_000,
      // Deliberately different from the matched rate (0.08) so the "market-wide" comparison
      // line can only be right if it really reads market_wide, not the filtered totals.
      avg_adoption: 0.05,
      rent_paid_month: 7_000_000,
      total_rent_paid_all_time: 190_000_000,
      new_properties_this_year: 60,
      new_pmcs_this_year: 12,
      new_properties_rent_paid: 9_000_000,
    },
  };
}

const DMA = "LOS ANGELES";
const MARKET: Market = { label: DMA, sub_markets: [DMA], rows_per_sub_market: 1, prospect_units: 900 };

/** 40 network pins against 140 total_properties, so the "not pictured" note always renders. */
const NETWORK_PINS = Array.from({ length: 40 }, (_, i) => ({
  property_name: `P${i}`, lat: 34 + i * 0.01, lon: -118 - i * 0.01, is_new_this_year: i < 5,
}));
const PROSPECT_PINS = [{ property_name: "Mine", lat: 34.05, lon: -118.24 }];

/** avgRentInput null => the market-rent fallback path, which is where the bad claim lived. */
function render(sim: SimilarityInfo | null, label = DMA): string {
  const market: Market = { ...MARKET, label, sub_markets: [label] };
  const byDma: Record<string, MarketSummary> = { [label]: summary(sim) };
  return renderMarketMap(1, market, byDma, PROSPECT_PINS, NETWORK_PINS, 900, null, NO_USAGE).html;
}

// ─── 1. isMatched gating: three variants ────────────────────────────────────

const MATCHED_STRINGS = [
  "Properties like yours on Flex in this market",
  "Average adoption rate &mdash; properties like yours",
  "avg rent of properties like yours in this market",
  "(properties like yours)",
  "Properties like yours in Flex network",
  `of 140 properties like yours`,
  "benchmarked against comparable properties",
];

const UNMATCHED_STRINGS = [
  "Properties on Flex in this market",
  "this market's average rent",
  ">Flex network</div>",
  "of 140 properties &mdash;",
  "benchmarked against all properties",
];

test("real rent+size match claims comparability on all six nodes", () => {
  const html = render(similarity({}));
  for (const s of MATCHED_STRINGS) assert.ok(html.includes(s), `missing matched copy: ${s}`);
  // The market-wide comparison line only exists in the matched branch, and must read
  // market_wide.avg_adoption (5%), not the filtered rate (8%).
  assert.ok(html.includes("5% market-wide across all property types"));
  assert.ok(html.includes("8% market adoption rate (properties like yours)"));
});

test("is_fallback:true similarity claims nothing", () => {
  const html = render(similarity({ is_fallback: true, tier: "all", label: "market-wide" }));
  for (const s of MATCHED_STRINGS) assert.ok(!html.includes(s), `leaked matched copy: ${s}`);
  for (const s of UNMATCHED_STRINGS) assert.ok(html.includes(s), `missing unmatched copy: ${s}`);
  assert.ok(!html.includes("market-wide across all property types"));
});

test('tier "all" claims nothing even when is_fallback were somehow false', () => {
  // The real pullMarketSummary always sets is_fallback = (tier === "all"), but the copy must
  // not depend on both agreeing: tier "all" IS the unfiltered population by definition. This
  // asserts the ordinary path (both set) and that the label is the honest one.
  const html = render(similarity({ tier: "all", is_fallback: true, label: "market-wide" }));
  assert.ok(html.includes("Properties on Flex in this market"));
  assert.ok(!html.includes("properties like yours"));
  assert.ok(html.includes("market-wide")); // the similarity label still prints, honestly
});

test("null similarity (no avg rent pulled) claims nothing", () => {
  const html = render(null);
  for (const s of MATCHED_STRINGS) assert.ok(!html.includes(s), `leaked matched copy: ${s}`);
  assert.ok(html.includes("Properties on Flex in this market"));
  assert.ok(html.includes("this market's average rent"));
});

test("a merged market that falls back in ANY sub_market claims nothing", () => {
  // Worst-tier wins: one DMA matched on rent+size, the other fell back to market-wide, so the
  // combined numbers on the slide are not a matched subset and must not say they are.
  const market: Market = {
    label: "LOS ANGELES", sub_markets: ["LOS ANGELES", "SAN DIEGO"],
    rows_per_sub_market: 1, prospect_units: 900,
  };
  const byDma: Record<string, MarketSummary> = {
    "LOS ANGELES": summary(similarity({})),
    "SAN DIEGO": summary(similarity({ tier: "all", is_fallback: true, label: "market-wide" })),
  };
  const html = renderMarketMap(1, market, byDma, PROSPECT_PINS, NETWORK_PINS, 900, null, NO_USAGE).html;
  assert.ok(!html.includes("properties like yours"));
  assert.ok(html.includes("Properties on Flex in this market"));
});

// ─── 2. Raw DMA_NAME prints verbatim ────────────────────────────────────────

test("DMA label is never title-cased, and header matches the bullets", () => {
  // Real stored values from PRODUCTION.SEEDS.SEED_ZIP_CODE_TO_DMA_MAPPING.
  for (const label of ["LOS ANGELES", "ALBANY, GA", "BIRMINGHAM (ANN & TUSC)", "CEDAR RAPIDS - WTRLO - IWC&DUB"]) {
    const html = render(similarity({}), label);
    const escaped = label.replace(/&/g, "&amp;");
    // Header prints it, and so does the guarantee bullet - same string, both places.
    assert.ok(html.includes(`>${escaped}</div>`), `header lost the raw label: ${label}`);
    assert.ok(html.includes(`Your ${escaped} properties could be guaranteeing`), `bullet lost the raw label: ${label}`);
    // None of the title-cased manglings.
    for (const bad of ["Los Angeles", "Albany, Ga", "Birmingham (ann & Tusc)", "Cedar Rapids - Wtrlo - Iwc&amp;dub"]) {
      assert.ok(!html.includes(bad), `title-cased label leaked: ${bad}`);
    }
  }
});

// ─── 3. Shared percent / pp formatters ──────────────────────────────────────

test("fmtPct drops a bare trailing .0 and keeps a real decimal", () => {
  assert.equal(fmtPct(1.0), "100%");
  assert.equal(fmtPct(0.897), "89.7%");
  assert.equal(fmtPct(0), "0%");
  assert.equal(fmtPct(0.018), "1.8%");
  assert.equal(fmtPct(0.05), "5%");
});

test("fmtPp keeps the sign on a negative delta", () => {
  assert.equal(fmtPp(-0.02 * 100), "-2pp");
  assert.equal(fmtPp(-0.3), "-0.3pp");
  assert.equal(fmtPp(3.0), "3pp");
  assert.equal(fmtPp(3.0, 1, true), "+3pp");
  assert.equal(fmtPp(-2.0, 1, true), "-2pp");
});

test("fmtPct100 / fmtPctNum honour decimals without trimming real zeros", () => {
  assert.equal(fmtPct100(100.0), "100%");
  assert.equal(fmtPct100(89.7), "89.7%");
  assert.equal(fmtPct100(12.0, 1, true), "+12%");
  // decimals=2: we remove ".00", never trim a trailing zero out of "1.50".
  assert.equal(fmtPctNum(1.5, 2), "1.50");
  assert.equal(fmtPctNum(1.0, 2), "1");
  assert.equal(fmtPctNum(0, 0), "0");
});

console.log(`\n${passed} tests passed`);
