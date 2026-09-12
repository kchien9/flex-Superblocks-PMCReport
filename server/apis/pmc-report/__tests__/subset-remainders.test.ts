/**
 * Kevin's rule: "anything presented as a slice of something needs to add up."
 *
 * Two slides show a deliberate subset under a title that doesn't say so:
 *   - "Properties worth celebrating" renders the top 12 of a usually-larger pool
 *   - Cohort Overview renders the 6 most recent cohorts above a portfolio-wide totals bar
 * Both now state their remainder, and the cohort one states its MAGNITUDE (units, properties,
 * paying residents) rather than a bare count. Mirrors Flask's _more_note (slides.py:6665) and
 * overflow_note (slides.py:3222).
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/subset-remainders.test.ts
 */
import assert from "node:assert/strict";

import { renderCohortAnalysis } from "../get-pmc-monthly-report.js";
import type { CohortRow } from "../get-pmc-monthly-report.js";
import { renderPropertiesWorthCelebrating } from "../slide-renderers.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────
// Every row clears buildEstablishedPool's gates (7+ months live, 10+ units, avg rent in band).
const prop = (i: number, bills: number) => ({
  propertyName: `P${i}`, units: 100, billsPaid: bills, newSignups: 5,
  adoptionRate: bills / 100, monthsLive: 12, avgRent: 1200, rentPaid: bills * 1200,
  propertyState: "CA",
});

const cohort = (m: string, props: number, units: number, residents: number): CohortRow => ({
  rolloutMonth: m, propertyCount: props, totalUnits: units, currentResidents: residents,
  currentRent: residents * 1000, cumulativeRent: residents * 12000,
  cohortNar: units > 0 ? residents / units : 0,
});

// ── Properties worth celebrating ────────────────────────────────────────────────────────────
test("the top-12 celebrate table states how many more beat the average", () => {
  // 16 properties at 50% + 8 at 0% => portfolio avg 33.3%, so 16 qualify and 12 render.
  const snapshot = [
    ...Array.from({ length: 16 }, (_, i) => prop(i, 50)),
    ...Array.from({ length: 8 }, (_, i) => prop(100 + i, 0)),
  ];
  const html = renderPropertiesWorthCelebrating({ slideId: 30, propertySnapshot: snapshot, targetNar: 0.2 }).html;
  assert.ok(html.includes("+ 4 more not shown"), "remainder line missing or wrong");
  // Exactly 12 rows render, so 12 + 4 == the 16 that qualified.
  assert.equal((html.match(/<tr style="border-bottom:1px solid #f0f0f4;">/g) ?? []).length, 12);
});

test("a celebrate table that shows its whole pool prints no remainder", () => {
  // 4 at 50% + 8 at 0% => only 4 qualify, all 4 render.
  const snapshot = [
    ...Array.from({ length: 4 }, (_, i) => prop(i, 50)),
    ...Array.from({ length: 8 }, (_, i) => prop(100 + i, 0)),
  ];
  const html = renderPropertiesWorthCelebrating({ slideId: 30, propertySnapshot: snapshot, targetNar: 0.2 }).html;
  assert.ok(!html.includes("more not shown"));
  assert.equal((html.match(/<tr style="border-bottom:1px solid #f0f0f4;">/g) ?? []).length, 4);
});

// ── Cohort Overview ─────────────────────────────────────────────────────────────────────────
const COHORTS: CohortRow[] = [
  cohort("2024-01-01", 10, 1000, 100), cohort("2024-02-01", 20, 2000, 200),
  cohort("2024-03-01", 30, 3000, 300), cohort("2024-04-01", 5, 500, 50),
  cohort("2024-05-01", 1, 100, 10), cohort("2024-06-01", 2, 200, 20),
  cohort("2024-07-01", 3, 300, 30), cohort("2024-08-01", 4, 400, 40),
  cohort("2024-09-01", 6, 600, 60), cohort("2024-10-01", 7, 700, 70),
];

test("the cohort remainder carries units, properties and paying residents - not just a count", () => {
  const html = renderCohortAnalysis({ cohorts: COHORTS, reportingMonth: "2026-08-01", cohortMonthly: new Map(), slideId: 7 });
  // Shown = the 6 most recent (May-Oct): 100+200+300+400+600+700 = 2,300 units, 230 paying.
  // All 10 cohorts: 8,800 units, 880 paying. Hidden 4 (Jan-Apr): 65 props, 6,500 units, 650 paying.
  assert.ok(html.includes("The 6 cohorts above are 2,300 of 8,800 units"), "shown-vs-all units wrong");
  assert.ok(html.includes("(26.1% of the portfolio)"), "share wrong");
  assert.ok(html.includes("230 of 880 paying residents"), "shown-vs-all residents wrong");
  assert.ok(html.includes("the other 4 cohorts (65 properties, 6,500 units, 650 paying)"), "hidden magnitudes wrong");
  assert.ok(html.includes("Totals below cover every cohort."));
  // The old count-only copy is gone.
  assert.ok(!html.includes("Showing the 6 most recent cohorts"));
});

test("shown + hidden == every cohort, on all three measures", () => {
  const html = renderCohortAnalysis({ cohorts: COHORTS, reportingMonth: "2026-08-01", cohortMonthly: new Map(), slideId: 7 });
  const n = (s: string) => Number(s.replace(/,/g, ""));
  const m = /The (\d+) cohorts? above are ([\d,]+) of ([\d,]+) units \([\d.]+% of the portfolio\) and ([\d,]+) of ([\d,]+) paying residents &middot; the other (\d+) cohorts? \(([\d,]+) properties, ([\d,]+) units, ([\d,]+) paying\)/.exec(html);
  assert.ok(m, "remainder sentence did not parse");
  const [shownN, shownU, allU, shownR, allR, hiddenN, hiddenP, hiddenU, hiddenR] = m.slice(1).map(n);
  assert.equal(shownN + hiddenN, COHORTS.length, "cohort counts must partition");
  assert.equal(shownU + hiddenU, allU, "units must partition");
  assert.equal(shownR + hiddenR, allR, "paying residents must partition");
  assert.equal(hiddenP, COHORTS.slice(0, 4).reduce((s, c) => s + c.propertyCount, 0));
  assert.equal(allU, COHORTS.reduce((s, c) => s + c.totalUnits, 0));
});

test("six or fewer cohorts prints no remainder at all", () => {
  const html = renderCohortAnalysis({ cohorts: COHORTS.slice(0, 6), reportingMonth: "2026-08-01", cohortMonthly: new Map(), slideId: 7 });
  assert.ok(!html.includes("cohorts above are"));
  assert.ok(!html.includes("Totals below cover every cohort."));
});

test("presenting mode shows every cohort, so there is nothing to state", () => {
  const html = renderCohortAnalysis({ cohorts: COHORTS, reportingMonth: "2026-08-01", cohortMonthly: new Map(), slideId: 7, presentingMode: true });
  assert.ok(!html.includes("cohorts above are"));
});

console.log(`\nsubset-remainders: ${passed} tests passed`);
