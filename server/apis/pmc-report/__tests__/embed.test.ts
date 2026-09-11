/**
 * Embed → DI deck - the pure half of Flask's tests/test_embed.py (everything that doesn't need a
 * live Snowflake cursor): the projection range, the picker junk filter, the market gate, the
 * cohort's curve_full_through / thin-tail mask, summarizeEmbedMonthly, the upload merge, the gate
 * strings, and the renderMarketMap subjectEmbed kwarg.
 * No test runner in this repo - run with:
 *   npx tsx server/apis/pmc-report/__tests__/embed.test.ts
 */
import assert from "node:assert/strict";

import {
  EMBED_GATES, EMBED_MIN_MONTHS, MARKET_MIN_PROPERTIES,
  applyPropertyUpload, cleanUnits, curveFullThrough, embedMarkets, embedProjectionRange,
  embedStatesFromDim, embedUploadRows, isRealPmcName, latestEmbedBpMonth, summarizeEmbedMonthly,
} from "../embed.js";
import type { EmbedMonthlyRow, EmbedProperty, GraduationCurve, GraduationCurvePoint } from "../embed.js";
import { renderEmbedProjection, renderEmbedGraduation, renderEmbedVisibility, thinMask } from "../slides-embed.js";
import type { EmbedCtx } from "../slides-embed.js";
import { renderMarketMap } from "../market-map-slides.js";
import type { Market, MarketSummary } from "../market-map-data.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function prop(
  id: string, name: string, address: string, city: string, state: string, zip: string, units: number | null,
): EmbedProperty {
  return { property_public_id: id, property_name: name, address, city, state, zip, unit_count: units, biller_id: 1 };
}

/** Flask tests/test_embed.py `_curve_rows`: bills/units by rel_month - -6..-1 at 2.6%, 0..3
 * ramping, 4..12 at 7.2%. With thinAfter=k, points past +k carry only thinProps properties. */
function curveRows(nProps = 400, units = 20000, thinAfter: number | null = null, thinProps = 0): GraduationCurvePoint[] {
  const out: GraduationCurvePoint[] = [];
  for (let rel = -6; rel <= 12; rel++) {
    const rate = rel < 0 ? 0.026 : rel < 4 ? 0.05 : 0.072;
    const props = thinAfter !== null && rel > thinAfter ? thinProps : nProps;
    const u = Math.round((units * props) / nProps);
    const bills = Math.round(u * rate);
    out.push({ rel_month: rel, properties: props, units: u, bills_paid: bills, adoption: u > 0 ? bills / u : 0 });
  }
  return out;
}

function cohortOf(curve: GraduationCurvePoint[], properties: number, scope: "same_msp" | "all" = "all"): GraduationCurve {
  return {
    curve, before_rate: 0.026, after_rate: 0.072, properties, units: 240000, pmcs: 25,
    curve_full_through: curveFullThrough(curve, properties), scope, msp: scope === "same_msp" ? "appfolio" : null,
  };
}

function ctxOf(overrides: Partial<EmbedCtx> = {}): EmbedCtx {
  const base: EmbedCtx = {
    pmc_name: "Harmoniq Residential", msp: "appfolio", msp_label: "AppFolio",
    reporting_month: "2026-09-01", property_count: 46,
    paying: 68, bills_paid: 68, rent_paid: 266000, flex_customers: 199,
    total_units: 1162, units_known: false, adoption: 68 / 1162,
    monthly: [{ bp_month: "2026-09-01", charged_users: 199, bills_paid: 68, rent_paid: 266000, properties: 40 }],
    floor_rate: 0.0658, floor_label: "similar PMCs' opted-in properties",
    ceiling_rate: 0.072, cohort: null, repeat: { embed: 0.791, di: 0.853, embed_n: 1000, di_n: 1000 },
    niro: { niro_units: 958, niro_rate: 0.007, niro_properties: 3 },
    avg_rent: 1500, avg_rent_source: "input",
    range: embedProjectionRange(68, 1162, 0.0658, 0.072, 1500),
    properties: [prop("a", "Alvista", "1 St", "Bowie", "MD", "20715", null)],
    property_paying: { a: 68 }, property_rent: { a: 266000 }, lookback_months: 12,
  };
  return { ...base, ...overrides };
}

// ── embedProjectionRange (Flask test_embed_projection_range_*) ─────────────────

test("projection range: floor and ceiling math", () => {
  const r = embedProjectionRange(68, 1162, 0.0658, 0.072, 1500);
  assert.equal(r.today, 68);
  assert.equal(r.floor_residents, 76);
  assert.equal(r.ceiling_residents, 84);
  assert.equal(r.floor_already_here, false);
  assert.equal(r.range_lo, 76);
  assert.equal(r.range_hi, 84);
  assert.equal(r.floor_gain, 8);
  assert.equal(r.ceiling_gain, 16);
  assert.equal(r.rent_lo, 12000);
  assert.equal(r.rent_hi, 24000);
});

test("projection range: floor at or below today starts the range at today", () => {
  const r = embedProjectionRange(100, 1000, 0.05, 0.072, 1000);
  assert.equal(r.floor_already_here, true);
  assert.equal(r.floor_residents, 50);
  assert.equal(r.ceiling_residents, 72);
  assert.equal(r.range_lo, 100);
  assert.equal(r.floor_gain, 0);
  assert.equal(r.range_hi, 100); // ceiling 72 < today -> hi = today
  assert.equal(r.ceiling_gain, 0);
  assert.equal(r.rent_lo, 0);
  assert.equal(r.rent_hi, 0);
});

test("projection range: without a ceiling uses the floor only", () => {
  const r = embedProjectionRange(10, 1000, 0.05, null, 1000);
  assert.equal(r.ceiling_residents, null);
  assert.equal(r.range_lo, 50);
  assert.equal(r.range_hi, 50);
  assert.equal(r.floor_gain, 40);
  assert.equal(r.ceiling_gain, 40);
});

// ── isRealPmcName (Flask test_is_real_pmc_name table) ─────────────────────────

test("isRealPmcName: the Flask table", () => {
  const cases: [unknown, boolean][] = [
    ["Harmoniq Residential", true],
    ["PPC Residential", true],
    ["*Coldwell Banker Realty", true], // leading decoration stripped, real name behind it
    ['"', false], ["-", false], ["*", false], ["  ", false], ["AB", false], [null, false],
    ["123", false], // 3 chars but no letters
    ["PRACTICE SITE 42", false], ["Flex Embed", false], ["Flex Generic Properties OON", false],
  ];
  for (const [name, real] of cases) {
    assert.equal(isRealPmcName(name), real, `isRealPmcName(${JSON.stringify(name)})`);
  }
});

test("cleanUnits: the dim's 1 placeholder and NULL both read as unknown", () => {
  assert.equal(cleanUnits(348), 348);
  assert.equal(cleanUnits(1), null);
  assert.equal(cleanUnits(0), null);
  assert.equal(cleanUnits(null), null);
  assert.equal(cleanUnits("120"), 120);
});

// ── summarizeEmbedMonthly (Flask test_summarize_embed_monthly_*) ──────────────

test("summarizeEmbedMonthly sums per month and counts paying properties", () => {
  const rows: EmbedMonthlyRow[] = [
    { bp_month: "2026-09-01", property_public_id: "p1", charged_users: 4, bills_paid: 7, rent_paid: 100 },
    { bp_month: "2026-09-01", property_public_id: "p2", charged_users: 0, bills_paid: 0, rent_paid: 0 },
    { bp_month: "2026-08-01", property_public_id: "p1", charged_users: 3, bills_paid: 5, rent_paid: 50 },
  ];
  const out = summarizeEmbedMonthly(rows);
  assert.deepEqual(out.map((r) => r.bp_month), ["2026-08-01", "2026-09-01"]);
  assert.deepEqual(out.map((r) => r.charged_users), [3, 4]);
  assert.deepEqual(out.map((r) => r.bills_paid), [5, 7]);
  assert.deepEqual(out.map((r) => r.rent_paid), [50, 100]);
  assert.deepEqual(out.map((r) => r.properties), [1, 1]);
  assert.deepEqual(summarizeEmbedMonthly([]), []);
});

test("the 3-month gate counts months with bills, not rows", () => {
  const oneMonth: EmbedMonthlyRow[] = [
    { bp_month: "2026-09-01", property_public_id: "p1", charged_users: 4, bills_paid: 7, rent_paid: 100 },
    { bp_month: "2026-08-01", property_public_id: "p1", charged_users: 2, bills_paid: 0, rent_paid: 0 },
    { bp_month: "2026-07-01", property_public_id: "p1", charged_users: 1, bills_paid: 0, rent_paid: 0 },
  ];
  assert.equal(summarizeEmbedMonthly(oneMonth).filter((m) => m.bills_paid > 0).length < EMBED_MIN_MONTHS, true);
});

// ── curveFullThrough + the slide-72 thin-tail mask ────────────────────────────

test("curveFullThrough marks the last rel_month backed by half the cohort (tail kept)", () => {
  const curve = curveRows(400, 20000, 8, 120);
  assert.equal(curveFullThrough(curve, 400), 8);
  assert.deepEqual(curve.map((p) => p.rel_month), Array.from({ length: 19 }, (_, i) => i - 6));
  assert.deepEqual(curve.slice(-4).map((p) => p.properties), [120, 120, 120, 120]);
  // exactly half still counts as "full"
  assert.equal(curveFullThrough(curveRows(400, 20000, 10, 200), 400), 12);
});

test("thin mask flags BOTH tails from the properties column, not a fixed offset", () => {
  // thin on the way in (-6..-4 at 100 of 400) and on the way out (past +8)
  const curve = curveRows(400, 20000, 8, 120);
  for (const rel of [-6, -5, -4]) {
    const i = curve.findIndex((p) => p.rel_month === rel);
    curve[i] = { ...curve[i], properties: 100 };
  }
  const mask = thinMask(curve, 400);
  assert.deepEqual(mask.slice(0, 3), [true, true, true]);
  assert.deepEqual(mask.slice(-4), [true, true, true, true]);
  assert.equal(mask[curve.findIndex((p) => p.rel_month === 0)], false);
  // no thin points -> no mask, and the renderer drops the footnote
  assert.equal(thinMask(curveRows(400), 400).some(Boolean), false);
});

test("slide 72 renders the dashed-tail footnote only when a tail is thin", () => {
  const thinCtx = ctxOf({ cohort: cohortOf(curveRows(400, 20000, 8, 120), 400) });
  const { html: thinHtml, js } = renderEmbedGraduation(3, thinCtx);
  assert.ok(thinHtml.includes("Dashed segments: fewer switchers have been on embed/DI this long."));
  assert.ok(thinHtml.includes("2.6% → 7.2%"));
  assert.ok(thinHtml.includes("DI go-live"), "the month-0 marker is drawn in the chart JS");
  assert.ok(js.includes("const thin = ["));
  const fullCtx = ctxOf({ cohort: cohortOf(curveRows(400), 400) });
  assert.ok(!renderEmbedGraduation(3, fullCtx).html.includes("Dashed segments"));
  // same-MSP vs all-MSP legend / sub-line
  assert.ok(renderEmbedGraduation(3, ctxOf({ cohort: cohortOf(curveRows(400), 400, "same_msp") })).html
    .includes("AppFolio embed properties only"));
  assert.ok(fullCtx.cohort && renderEmbedGraduation(3, fullCtx).html
    .includes("All PMS embeds (AppFolio cohort under 300 properties)"));
  assert.ok(renderEmbedGraduation(3, fullCtx).html.includes("on a PMS embed like yours"));
  // no cohort -> the slide self-gates
  assert.deepEqual(renderEmbedGraduation(3, ctxOf({ cohort: null })), { html: "", js: "" });
});

// ── slide 73 copy ─────────────────────────────────────────────────────────────

test("slide 73 prints the range, the continuity line and the NIRO line", () => {
  const { html } = renderEmbedProjection(4, ctxOf({ cohort: cohortOf(curveRows(400), 400) }));
  assert.ok(html.includes("+8 to +16 more residents paying through Flex"));
  assert.ok(html.includes("Residents stick: 85% of residents paying through a direct integration also paid the month before, vs 79% on embed."));
  assert.ok(html.includes("You already have 958 units in network without an integration — at 0.7%."));
  assert.ok(html.includes("With DI — what switchers reached"));
  assert.ok(!html.includes("Graduation cohort unavailable"));
});

test("slide 73 never prints +0 - it uses the 'Already ahead' variant, and footnotes a missing cohort", () => {
  const ctx = ctxOf({
    paying: 100, total_units: 1000, adoption: 0.1, floor_rate: 0.05, ceiling_rate: null, cohort: null,
    range: embedProjectionRange(100, 1000, 0.05, null, 1000),
  });
  const { html } = renderEmbedProjection(4, ctx);
  assert.ok(!html.includes("+0"));
  assert.ok(html.includes("Already ahead of the peer median."));
  assert.ok(html.includes("With DI — peer median (already here)"));
  assert.ok(!html.includes("With DI — what switchers reached"));
  assert.ok(html.includes("Graduation cohort unavailable this run — the range shows the peer floor only."));
});

test("slide 75 dashes what embed can't show, and prints real per-property units when known", () => {
  const placeholder = renderEmbedVisibility(6, ctxOf()).html;
  assert.ok(placeholder.includes("unit counts: not available"));
  assert.ok(placeholder.includes(">—<"));
  const real = renderEmbedVisibility(6, ctxOf({
    units_known: true,
    properties: [prop("a", "Alvista", "1 St", "Bowie", "MD", "20715", 340)],
  })).html;
  assert.ok(real.includes("unit counts: from your AppFolio embed list"));
  assert.ok(real.includes("20%")); // 68 paying / 340 units (_fmt_pct drops a trailing .0)
});

// ── embedStatesFromDim / applyPropertyUpload / embedUploadRows / embedMarkets ──

test("embedStatesFromDim uses units when real, property count when placeholders", () => {
  const real = embedStatesFromDim([
    prop("a", "A", "1 St", "Austin", "TX", "78701", 300),
    prop("b", "B", "2 St", "Reno", "NV", "89501", 10),
  ]);
  assert.equal(real.basis, "units");
  assert.deepEqual(real.included, ["TX"]);
  assert.equal(real.excluded[0].state, "NV");
  const placeholders = embedStatesFromDim([
    prop("a", "A", "1 St", "Austin", "TX", "78701", null),
    prop("b", "B", "2 St", "Reno", "NV", "89501", null),
  ]);
  assert.equal(placeholders.basis, "properties");
  assert.deepEqual(placeholders.included, ["NV", "TX"]);
});

test("applyPropertyUpload overrides address/city/state/zip/units by property name", () => {
  const dim = [
    prop("a", "Alvista Bowie", "", "", "WI", "", null),
    prop("b", "Bear Creek", "9 Old Rd", "Madison", "WI", "53703", null),
  ];
  const out = applyPropertyUpload(dim, [
    { "Property Name": "alvista bowie", Address: "123 Main St", City: "Bowie", State: "MD", Zip: "20715", "# of Units": "348" },
    { "Property Name": "Not Ours", Address: "1 Nowhere", Units: "50" },
  ]);
  const a = out.find((p) => p.property_public_id === "a")!;
  assert.deepEqual([a.address, a.city, a.state, a.zip, a.unit_count], ["123 Main St", "Bowie", "MD", "20715", 348]);
  const b = out.find((p) => p.property_public_id === "b")!;
  assert.equal(b.address, "9 Old Rd");
  assert.equal(b.unit_count, null);
  assert.equal(out.length, 2);
  assert.equal(applyPropertyUpload(dim, []), dim, "no upload -> the dim rows untouched");
});

test("embedUploadRows build one combined address, units 0 for placeholders, zip/state kept", () => {
  const rows = embedUploadRows([
    prop("a", "Alvista", "123 Main St", "Bowie", "MD", "20715", 348),
    prop("b", "Bear", "", "Reno", "NV", "", null),
  ]);
  assert.deepEqual(rows, [
    { "property_name": "Alvista", address: "123 Main St, Bowie, MD 20715", units: 348, csvZip: "20715", csvState: "MD", property_public_id: "a" },
    { "property_name": "Bear", address: "Reno, NV", units: 0, csvZip: "", csvState: "NV", property_public_id: "b" },
  ]);
});

test("embedMarkets keeps DMAs with 2+ of their properties, ranked by units then count", () => {
  const withMarket = [
    { property_name: "A", units: 100, dma: "DALLAS-FT. WORTH" },
    { property_name: "B", units: 50, dma: "DALLAS-FT. WORTH" },
    { property_name: "C", units: 0, dma: "AUSTIN" },
    { property_name: "D", units: 0, dma: "AUSTIN" },
    { property_name: "E", units: 0, dma: "AUSTIN" },
    { property_name: "F", units: 900, dma: "HOUSTON" }, // only 1 property -> out
    { property_name: "G", units: 0, dma: "Unknown" },
    { property_name: "H", units: 0, dma: "Unknown" },
  ];
  const out = embedMarkets(withMarket);
  assert.deepEqual(out.map((m) => m.label), ["DALLAS-FT. WORTH", "AUSTIN"]);
  assert.deepEqual(out[0], { label: "DALLAS-FT. WORTH", sub_markets: ["DALLAS-FT. WORTH"], rows_per_sub_market: 6, prospect_units: 150 });
  assert.deepEqual(embedMarkets(withMarket.slice(5)), [], "self-gates when no DMA has 2+");
  assert.equal(MARKET_MIN_PROPERTIES, 2);
});

// ── renderMarketMap subjectEmbed (slide 74) ───────────────────────────────────

const MARKET: Market = { label: "MILWAUKEE", sub_markets: ["MILWAUKEE"], rows_per_sub_market: 6, prospect_units: 0 };
const SUMMARY: Record<string, MarketSummary> = {
  MILWAUKEE: {
    total_properties: 40, total_pmcs: 12, total_units: 8000, total_active_users: 600, avg_adoption: 0.075,
    rent_paid_month: 900000, total_rent_paid_all_time: 9000000, new_properties_this_year: 4,
    new_pmcs_this_year: 2, new_properties_rent_paid: 100000,
  },
};
const NO_OON = { matched_count: 0, residents: 0, ytd_rent: 0 };

test("renderMarketMap is byte-identical without subjectEmbed", () => {
  const withoutArg = renderMarketMap(1, MARKET, SUMMARY, [], [], 0, null, NO_OON);
  const withNull = renderMarketMap(1, MARKET, SUMMARY, [], [], 0, null, NO_OON, null);
  assert.equal(withoutArg.html, withNull.html);
  assert.ok(withoutArg.html.includes("FLEX IS ALREADY IN YOUR MARKET"));
  assert.ok(!withoutArg.html.includes("Your embed today in this market"));
});

test("renderMarketMap subjectEmbed adds the competitor eyebrow and their embed bullet", () => {
  const { html } = renderMarketMap(1, MARKET, SUMMARY, [], [], 0, null, NO_OON, {
    paying: 41, properties: 12, units: null, msp_label: "AppFolio",
  });
  assert.ok(html.includes("Competitors on a direct integration in MILWAUKEE"));
  assert.ok(!html.includes("FLEX IS ALREADY IN YOUR MARKET"));
  assert.ok(html.includes("Your embed today in this market"));
  assert.ok(html.includes("41 residents paying"));
  assert.ok(html.includes("across 12 properties &middot; unit counts not available via AppFolio embed"));
});

test("renderMarketMap subjectEmbed with units prints their rate in the market", () => {
  const { html } = renderMarketMap(1, MARKET, SUMMARY, [], [], 0, null, NO_OON, {
    paying: 41, properties: 1, units: 500, msp_label: "Yardi",
  });
  assert.ok(html.includes("8.2% of your 500 units here &middot; across 1 property"));
});

// ── gates ────────────────────────────────────────────────────────────────────

test("gate strings are the spec's, verbatim", () => {
  assert.equal(EMBED_GATES.noName, "The Embed deck needs a PMC name.");
  assert.equal(EMBED_GATES.onePmc, "The Embed deck is one PMC per deck - remove the additional PMCs / property IDs and try again.");
  assert.equal(EMBED_GATES.unknownPmc("Nobody LLC"), "No embed activity found for: Nobody LLC");
  assert.equal(
    EMBED_GATES.tooEarly("AQP Property Management, Inc."),
    "AQP Property Management, Inc. has under 3 months of embed activity — too early for a trend; try again next month.",
  );
  assert.equal(
    EMBED_GATES.noTotalUnits("Harmoniq Residential", "AppFolio"),
    "Enter Harmoniq Residential's total units — AppFolio embed doesn't report unit counts.",
  );
});

test("latestEmbedBpMonth is bpSafeCutoff minus one month", () => {
  assert.equal(latestEmbedBpMonth(new Date(2026, 8, 11)), "2026-09-01"); // Sep 11 -> cutoff Oct 1
  assert.equal(latestEmbedBpMonth(new Date(2026, 8, 3)), "2026-08-01"); // Sep 3 -> cutoff Sep 1
  assert.equal(latestEmbedBpMonth(new Date(2026, 0, 3)), "2025-12-01"); // year boundary
});

console.log(`\n${passed} passed`);
