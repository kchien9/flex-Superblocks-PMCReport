/**
 * Render-level tests for the multi-quarter "Q<N> <YYYY> adds" buttons on Adoption Trend and
 * Residents/Units & Rent - mirrors Flask tests/test_quarter_toggle.py + the
 * previous_calendar_quarters table test (Flask 333f372). No test runner in this repo - run with:
 *   npx tsx server/apis/pmc-report/__tests__/quarter-toggle.test.ts
 */
import assert from "node:assert/strict";

import {
  buildQuarterAddsSeries,
  displayEntityNames,
  previousCalendarQuarter,
  previousCalendarQuarters,
  renderAdoptionTrend,
  renderResidentsUnitsCombo,
} from "../slide-renderers.js";
import type { MonthlyTotal, QuarterAddsBlock, QuarterAddsRow, QuarterAddsSeries } from "../slide-renderers.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

/** The slide-scoped JSON a renderer embeds as `window.<var>[<sid>]=<json>;` / `window.<var>=<json>;`. */
function payload(js: string, prefix: string): unknown {
  const idx = js.indexOf(prefix);
  assert.ok(idx >= 0, `payload prefix not found: ${prefix}`);
  const start = idx + prefix.length;
  let depth = 0;
  for (let i = start; i < js.length; i++) {
    if (js[i] === "{") depth++;
    else if (js[i] === "}") { depth--; if (depth === 0) return JSON.parse(js.slice(start, i + 1)); }
  }
  throw new Error("unterminated payload");
}

test("previousCalendarQuarters: last n completed quarters, most recent first", () => {
  assert.deepEqual(previousCalendarQuarters("2026-09-01").map((q) => q.label), ["Q3 2026", "Q2 2026", "Q1 2026"]);
  assert.deepEqual(previousCalendarQuarters("2026-01-01").map((q) => q.label), ["Q4 2025", "Q3 2025", "Q2 2025"]);
  assert.deepEqual(previousCalendarQuarters("2026-08-01", 2).map((q) => q.label), ["Q2 2026", "Q1 2026"]);
  assert.deepEqual(previousCalendarQuarters("2026-09-01", 0), []);
  // Element 0 IS previousCalendarQuarter (checkin depends on that helper staying unchanged).
  assert.deepEqual(previousCalendarQuarters("2026-09-01")[0], previousCalendarQuarter("2026-09-01"));
  const [, q2] = previousCalendarQuarters("2026-09-01");
  assert.equal(q2.start, "2026-04-01");
  assert.equal(q2.end, "2026-06-01");
  assert.equal(q2.monthsLabel, "Apr–Jun 2026");
});

// ── Fixture: two properties rolled out Nov 2025, chart axis Nov–Dec 2025 ─────────────────────
const ALPHA = "PMC Alpha (an Asset Living Company)";
const BETA = "PMC Beta";
const row = (pmc: string, name: string, month: string, units: number, bills: number, rent: number): QuarterAddsRow & { PMC_NAME: string } =>
  ({ PMC_NAME: pmc, PROPERTY_NAME: name, BP_MONTH: month, ROLLOUT_MONTH: "2025-11-01", PROPERTY_UNIT_COUNT: units, BILLS_PAID: bills, RENT_PAID: rent });
const rows = [
  row(ALPHA, "Alpha", "2025-11-01", 100, 5, 5000), row(ALPHA, "Alpha", "2025-12-01", 100, 8, 8000),
  row(BETA, "Beta", "2025-11-01", 200, 10, 12000), row(BETA, "Beta", "2025-12-01", 200, 14, 16000),
];
const alphaRows = rows.filter((r) => r.PMC_NAME === ALPHA);
const betaRows = rows.filter((r) => r.PMC_NAME === BETA);
const monthlyTotals: MonthlyTotal[] = ["2025-11-01", "2025-12-01"].map((m) => {
  const rs = rows.filter((r) => r.BP_MONTH === m);
  const units = rs.reduce((s, r) => s + r.PROPERTY_UNIT_COUNT, 0);
  const billsPaid = rs.reduce((s, r) => s + r.BILLS_PAID, 0);
  return { month: m, units, billsPaid, rentPaid: rs.reduce((s, r) => s + r.RENT_PAID, 0), newSignups: 0, adoptionRate: billsPaid / units, propertyCount: rs.length };
});
const toMonthly = (rs: typeof rows) => ["2025-11-01", "2025-12-01"].map((m) => {
  const r = rs.filter((x) => x.BP_MONTH === m);
  const units = r.reduce((s, x) => s + x.PROPERTY_UNIT_COUNT, 0);
  const billsPaid = r.reduce((s, x) => s + x.BILLS_PAID, 0);
  return { month: m, units, billsPaid, rentPaid: r.reduce((s, x) => s + x.RENT_PAID, 0), adoptionRate: billsPaid / units };
});
const rucEntities = [{ pmcName: ALPHA, monthly: toMonthly(alphaRows) }, { pmcName: BETA, monthly: toMonthly(betaRows) }];
const adtEntities = rucEntities.map((e) => ({ pmcName: e.pmcName, monthly: e.monthly.map((m) => ({ month: m.month, adoptionRate: m.adoptionRate })) }));

const q4 = previousCalendarQuarter("2025-12-01"); // Q4 2025
const q3 = previousCalendarQuarter("2025-09-01"); // Q3 2025
const c4 = buildQuarterAddsSeries(rows, q4) as QuarterAddsSeries;
const c4Alpha = buildQuarterAddsSeries(alphaRows, q4) as QuarterAddsSeries;
const c4Beta = buildQuarterAddsSeries(betaRows, q4) as QuarterAddsSeries;
assert.ok(c4 && c4Alpha && c4Beta);
// Q3 2025 is fabricated from the same rows so the renderers have a second, older cohort (only Alpha).
const c3: QuarterAddsSeries = { propertyCount: 1, unitCount: 100, monthly: c4Alpha.monthly };
const quarters: QuarterAddsBlock[] = [
  { quarter: q4, combined: c4, entities: [{ pmcName: ALPHA, series: c4Alpha }, { pmcName: BETA, series: c4Beta }] },
  { quarter: q3, combined: c3, entities: [{ pmcName: ALPHA, series: c3 }] },
];
const [alphaShort, betaShort] = displayEntityNames([ALPHA, BETA]);

test("Residents/Units: two quarter buttons most recent first, with per-entity headers", () => {
  const { html, js } = renderResidentsUnitsCombo({ slideId: 54, monthlyTotals, entityMonthlyData: rucEntities, quarters });
  const btns = [...html.matchAll(/<button class="spark-ctrl-btn ctl-btn" id="rucQBtn54-(\d)" onclick="flexToggleRucQuarter\(54,(\d),this\)">([^<]+)<\/button>/g)]
    .map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(btns, [["0", "0", "Q4 2025 adds"], ["1", "1", "Q3 2025 adds"]]);
  const all = html + js;
  assert.ok(all.includes("window.flexToggleRucQuarter=function(slideId,qi,btn)"));
  assert.ok(all.includes("window.flexRucQuarterTitle=function(q,view)"));
  // the entity switcher re-titles the slide while a quarter is on
  assert.ok(all.includes("t.textContent=window.flexRucQuarterTitle(qq,idx)"));
  assert.ok(!all.includes("ruQtrBtn"));

  const p = payload(all, "window.ruQuarterData[54]=") as { quarters: { label: string; header: string; entityHeaders: (string | null)[]; entities: Record<string, unknown>; combined: { residents: unknown[] } }[]; quarter?: unknown };
  assert.equal(p.quarter, undefined); // single-quarter object is gone
  assert.deepEqual(p.quarters.map((q) => q.label), ["Q4 2025", "Q3 2025"]);
  const [pq4, pq3] = p.quarters;
  assert.equal(pq4.header, "Properties added in Q4 2025 — 2 properties, 300 units");
  assert.ok(!pq4.header.includes("(BP months"));
  // per-entity headers use the display-shortened name (same list the switcher buttons print)
  assert.deepEqual(pq4.entityHeaders, [
    `${alphaShort} · properties added in Q4 2025 — 1 property, 100 units`,
    `${betaShort} · properties added in Q4 2025 — 1 property, 200 units`,
  ]);
  assert.deepEqual(pq3.entityHeaders, [`${alphaShort} · properties added in Q3 2025 — 1 property, 100 units`, null]);
  assert.equal(pq3.entities["2"], undefined); // Beta (view index 2) hidden while Q3 is selected
  assert.ok(pq3.entities["1"]);
  assert.equal(pq4.combined.residents.length, monthlyTotals.length);
});

test("Residents/Units: single-PMC deck gets the quarter buttons too", () => {
  const { html, js } = renderResidentsUnitsCombo({ slideId: 54, monthlyTotals, quarters });
  assert.ok(html.includes('id="rucQBtn54-0"') && html.includes('id="rucQBtn54-1"'));
  assert.ok(html.indexOf('id="rucQBtn54-0"') < html.indexOf('id="rucQBtn54-1"'));
  const p = payload(html + js, "window.ruQuarterData[54]=") as { quarters: { entityHeaders: unknown[] }[] };
  assert.equal(p.quarters.length, 2);
  assert.deepEqual(p.quarters[0].entityHeaders, []);
});

test("Adoption Trend: two quarter buttons most recent first (combined + single-PMC decks)", () => {
  for (const extra of [{ entityMonthlyData: adtEntities }, {}]) {
    const { html, js } = renderAdoptionTrend({ slideId: 6, monthly: monthlyTotals, quarters, ...extra });
    const btns = [...html.matchAll(/<button class="spark-ctrl-btn ctl-btn" id="adtQBtn6-(\d)" onclick="flexToggleAdoptionQuarter\(6,(\d),this\)">([^<]+)<\/button>/g)]
      .map((m) => [m[1], m[2], m[3]]);
    assert.deepEqual(btns, [["0", "0", "Q4 2025 adds"], ["1", "1", "Q3 2025 adds"]]);
    assert.ok(js.includes("window.flexToggleAdoptionQuarter=function(slideId,qi,btn)"));
    assert.ok(!(html + js).includes("atQtrBtn"));
    const p = payload(js, "window.atQuarterData[6]=") as { quarters: Record<string, unknown>[]; peerLabelQ: string };
    assert.deepEqual(p.quarters.map((q) => q.label), ["Q4 2025", "Q3 2025"]);
    for (const q of p.quarters) assert.deepEqual(Object.keys(q).sort(), ["combined", "entities", "header", "label", "peer"]);
    assert.equal(p.peerLabelQ, "Peer Median · same stage");
    assert.equal(p.quarters[0].header, "Properties added in Q4 2025 — 2 properties, 300 units");
  }
  // combined deck: Beta (entity 1) has no adds in Q3 -> absent from that quarter's entity map
  const { js } = renderAdoptionTrend({ slideId: 6, monthly: monthlyTotals, entityMonthlyData: adtEntities, quarters });
  const p = payload(js, "window.atQuarterData[6]=") as { quarters: { entities: Record<string, unknown> }[] };
  assert.deepEqual(Object.keys(p.quarters[0].entities).sort(), ["0", "1"]);
  assert.deepEqual(Object.keys(p.quarters[1].entities), ["0"]);
});

test("quarters: [] / undefined render identically and carry no quarter machinery", () => {
  for (const extra of [{}, { entityMonthlyData: rucEntities }]) {
    const base = renderResidentsUnitsCombo({ slideId: 54, monthlyTotals, ...extra });
    assert.deepEqual(renderResidentsUnitsCombo({ slideId: 54, monthlyTotals, quarters: [], ...extra }), base);
    assert.deepEqual(renderResidentsUnitsCombo({ slideId: 54, monthlyTotals, quarters: null, ...extra }), base);
    assert.ok(!base.html.includes("rucQBtn") && !(base.html + base.js).includes("flexToggleRucQuarter"));
  }
  for (const extra of [{}, { entityMonthlyData: adtEntities }]) {
    const base = renderAdoptionTrend({ slideId: 6, monthly: monthlyTotals, ...extra });
    assert.deepEqual(renderAdoptionTrend({ slideId: 6, monthly: monthlyTotals, quarters: [], ...extra }), base);
    assert.deepEqual(renderAdoptionTrend({ slideId: 6, monthly: monthlyTotals, quarters: null, ...extra }), base);
    assert.ok(!base.html.includes("adtQBtn") && !base.js.includes("flexToggleAdoptionQuarter"));
  }
});

console.log(`\n${passed} quarter-toggle tests passed`);
