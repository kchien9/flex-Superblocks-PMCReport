/**
 * WHY THIS FILE EXISTS
 * ====================
 * Clark renumbers every slide's internal ids to its final document position AFTER
 * `.filter(Boolean)` has dropped the empty slides (`renumberSlideHtml`). That pass rewrites
 * `id="slide-N"`, `#slide-N`, `id="chartN"`, `chartN'`, `initSlideN` and `slide-N` — and it
 * CANNOT rewrite a bare `N` sitting in an `onclick` argument list, because a bare number in JS
 * source is indistinguishable from any other number.
 *
 * So this shipped: render a slide at id 4, renumber it to 5, and the DOM says `slide-5` /
 * `chart5` while the button still reads `flexToggleRucQuarter(4, …)`. Every handler that did
 * `Chart.getChart('chart' + slideId)` then got `undefined` → `if(!chart)return`, i.e. a
 * silently dead entity switcher / quarter-adds button, and `getElementById('slide-' + slideId)`
 * reached the NEIGHBOURING slide and overwrote its title. Triggered by any QBR deck with a
 * "start"-anchored imported slide, and by any Expansion deck where a slide self-gates to empty
 * (slideNum++ is unconditional while pushSlide only appends non-empty html).
 *
 * The fix is DOM derivation, not a longer list of regexes: the handler walks up from the
 * clicked button to its `.slide` ancestor, whose id the renumbering pass keeps correct by
 * construction. So the invariant this file pins is not "the onclick argument equals the id" —
 * the argument is deliberately left alone, and still keys the payloads / sibling ids that the
 * renumbering pass never touches. It is the stronger property those handlers actually need:
 *
 *   the slide a handler RESOLVES is the slide its button lives in, after renumbering.
 *
 * That is checked by actually executing the emitted helper JS against a minimal DOM stub, not
 * by pattern-matching it. Plus a structural sweep asserting no handler anywhere has gone back
 * to `'chart'+slideId` / `'slide-'+slideId`.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/renumber-safety.test.ts
 */
import assert from "node:assert/strict";

import { renumberSlideHtml } from "../get-pmc-monthly-report.js";
import {
  buildQuarterAddsSeries,
  previousCalendarQuarter,
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

// ── Fixture: 2 combined entities + one quarter cohort, so every control renders ──────────────
const ALPHA = "PMC Alpha";
const BETA = "PMC Beta";
const MONTHS = ["2025-11-01", "2025-12-01"];
const row = (pmc: string, name: string, month: string, units: number, bills: number, rent: number): QuarterAddsRow & { PMC_NAME: string } =>
  ({ PMC_NAME: pmc, PROPERTY_NAME: name, BP_MONTH: month, ROLLOUT_MONTH: "2025-11-01", PROPERTY_UNIT_COUNT: units, BILLS_PAID: bills, RENT_PAID: rent });
const rows = [
  row(ALPHA, "Alpha", "2025-11-01", 100, 5, 5000), row(ALPHA, "Alpha", "2025-12-01", 100, 8, 8000),
  row(BETA, "Beta", "2025-11-01", 200, 10, 12000), row(BETA, "Beta", "2025-12-01", 200, 14, 16000),
];
const perMonth = (rs: typeof rows) => MONTHS.map((m) => {
  const r = rs.filter((x) => x.BP_MONTH === m);
  const units = r.reduce((s, x) => s + x.PROPERTY_UNIT_COUNT, 0);
  const billsPaid = r.reduce((s, x) => s + x.BILLS_PAID, 0);
  return { month: m, units, billsPaid, rentPaid: r.reduce((s, x) => s + x.RENT_PAID, 0), adoptionRate: billsPaid / units };
});
const monthlyTotals: MonthlyTotal[] = perMonth(rows).map((m) => ({ ...m, newSignups: 0, propertyCount: 2 }));
const rucEntities = [
  { pmcName: ALPHA, monthly: perMonth(rows.filter((r) => r.PMC_NAME === ALPHA)) },
  { pmcName: BETA, monthly: perMonth(rows.filter((r) => r.PMC_NAME === BETA)) },
];
const adtEntities = rucEntities.map((e) => ({
  pmcName: e.pmcName,
  monthly: e.monthly.map((m) => ({ month: m.month, adoptionRate: m.adoptionRate })),
}));
const q4 = previousCalendarQuarter("2025-12-01");
const combined = buildQuarterAddsSeries(rows, q4) as QuarterAddsSeries;
const quarters: QuarterAddsBlock[] = [{
  quarter: q4,
  combined,
  entities: rucEntities.map((e) => ({
    pmcName: e.pmcName,
    series: buildQuarterAddsSeries(rows.filter((r) => r.PMC_NAME === e.pmcName), q4) as QuarterAddsSeries,
  })),
}];

/** The slide is rendered at 4 and lands at document position 5 — a one-slide shift is enough. */
const OLD_ID = "4";
const NEW_ID = "5";

/**
 * Runs the emitted slide JS with a `window`/`document` stub and returns the stub window, so
 * `flexSlideOf` / `flexSlideNum` can be called for real. Only the top level executes; the
 * handler bodies (which need Chart.js and a real DOM) are just defined.
 */
function runSlideJs(js: string): Record<string, (el: unknown, sid: unknown) => unknown> {
  const win: Record<string, unknown> = {};
  const doc = { getElementById: () => null, querySelector: () => null };
  new Function("window", "document", "Chart", js)(win, doc, undefined);
  return win as Record<string, (el: unknown, sid: unknown) => unknown>;
}

/** A clicked button inside the RENUMBERED slide element, as the browser would hand it over. */
function buttonInSlide(slideDomId: string) {
  const slide = { id: slideDomId, querySelector: () => null };
  return { closest: (sel: string) => (sel === ".slide" ? slide : null) };
}

// ── 1. The renumbering really does move the DOM out from under the onclick argument ─────────

test("renumbering rewrites the slide root and canvas ids but NOT the onclick argument", () => {
  const { html } = renderResidentsUnitsCombo({ slideId: 4, monthlyTotals, entityMonthlyData: rucEntities, quarters });
  assert.ok(html.includes('id="slide-4"') && html.includes('id="chart4"'));
  assert.ok(html.includes("flexToggleRucQuarter(4,0,this)"));

  const out = renumberSlideHtml(html, OLD_ID, NEW_ID);
  // Renumbered:
  assert.ok(out.includes('id="slide-5"'), "slide root id not renumbered");
  assert.ok(out.includes('id="chart5"'), "canvas id not renumbered");
  assert.ok(!out.includes('id="slide-4"') && !out.includes('id="chart4"'));
  // NOT renumbered - and unfixable by regex, which is the whole reason for DOM derivation:
  assert.ok(out.includes("flexToggleRucQuarter(4,0,this)"), "onclick arg unexpectedly rewritten");
  assert.ok(out.includes("flexSwitchResUnitsView(4,0,this)"), "onclick arg unexpectedly rewritten");
});

// ── 2. The handler resolves the slide it is IN, not the one its argument names ───────────────

test("flexSlideNum resolves the renumbered canvas for a Residents/Units button", () => {
  const { html, js } = renderResidentsUnitsCombo({ slideId: 4, monthlyTotals, entityMonthlyData: rucEntities, quarters });
  const out = renumberSlideHtml(html + "\n<script>" + js + "</script>", OLD_ID, NEW_ID);
  const win = runSlideJs(js);

  // The button's own onclick still passes 4; the DOM now says slide-5.
  const btn = buttonInSlide("slide-5");
  assert.equal(win.flexSlideNum(btn, 4), "5");
  // …which is exactly the canvas the renumbered html carries.
  assert.ok(out.includes(`id="chart${win.flexSlideNum(btn, 4)}"`));
  // and the slide element the title swap writes into is the one holding the button
  assert.equal((win.flexSlideOf(btn, 4) as { id: string }).id, "slide-5");
});

test("flexSlideNum resolves the renumbered canvas for an Adoption Trend button", () => {
  const { html, js } = renderAdoptionTrend({ slideId: 4, monthly: monthlyTotals, entityMonthlyData: adtEntities, quarters });
  const out = renumberSlideHtml(html, OLD_ID, NEW_ID);
  const win = runSlideJs(js);
  const btn = buttonInSlide("slide-5");
  assert.equal(win.flexSlideNum(btn, 4), "5");
  assert.ok(out.includes(`id="chart${win.flexSlideNum(btn, 4)}"`));
  // Both the entity toggles and Show all now hand `this` over so this can work at all.
  assert.ok(html.includes("flexToggleAdoptionEntity(4,0,this)"));
  assert.ok(html.includes("flexToggleAllAdoptionEntities(4,this)"));
});

test("with no element to walk up from, the passed id is still honoured (Platinum PDF prep)", () => {
  // The Platinum PDF-prep hook calls its toggle with btn = null. That deck has a fixed slide
  // order and never renumbers, so falling back to the passed id is exact there.
  const { js } = renderResidentsUnitsCombo({ slideId: 4, monthlyTotals, entityMonthlyData: rucEntities, quarters });
  const win = runSlideJs(js);
  assert.equal(win.flexSlideNum(null, 4), 4);
  assert.equal(win.flexSlideNum(undefined, 7), 7);
});

test("a button in an un-renumbered slide resolves its own number unchanged", () => {
  const { js } = renderAdoptionTrend({ slideId: 6, monthly: monthlyTotals, entityMonthlyData: adtEntities, quarters });
  const win = runSlideJs(js);
  assert.equal(win.flexSlideNum(buttonInSlide("slide-6"), 6), "6");
});

// ── 3. Structural sweep: nothing may go back to trusting the passed id ───────────────────────

test("no emitted handler looks up a renumbered id from its passed slideId", () => {
  const emitted = [
    renderResidentsUnitsCombo({ slideId: 4, monthlyTotals, entityMonthlyData: rucEntities, quarters }),
    renderResidentsUnitsCombo({ slideId: 4, monthlyTotals, quarters }),
    renderResidentsUnitsCombo({ slideId: 4, monthlyTotals, entityMonthlyData: rucEntities }),
    renderAdoptionTrend({ slideId: 4, monthly: monthlyTotals, entityMonthlyData: adtEntities, quarters }),
    renderAdoptionTrend({ slideId: 4, monthly: monthlyTotals, quarters }),
    renderAdoptionTrend({ slideId: 4, monthly: monthlyTotals, entityMonthlyData: adtEntities }),
  ].map((r) => r.html + "\n" + r.js).join("\n");

  // These two are the exact shapes that broke. Both must be routed through the DOM helpers.
  assert.ok(!emitted.includes("getChart('chart'+slideId"), "a handler is back to Chart.getChart('chart'+slideId)");
  assert.ok(!emitted.includes("getElementById('slide-'+slideId"), "a handler is back to getElementById('slide-'+slideId)");
});

// ── 4. Fix 7: the per-slide quarter guards are no longer baked into a shared singleton ───────

test("the shared entity-toggle functions carry the quarter guards unconditionally", () => {
  // flexSyncAdoptionEntities / flexToggleAllAdoptionEntities are defined inside
  // `if(!window.flexToggleAdoptionEntity)`, so anything interpolated into them is fixed by
  // whichever slide rendered FIRST. A no-cohort slide must emit the same body as a cohort one.
  const noCohort = renderAdoptionTrend({ slideId: 4, monthly: monthlyTotals, entityMonthlyData: adtEntities }).js;
  const withCohort = renderAdoptionTrend({ slideId: 4, monthly: monthlyTotals, entityMonthlyData: adtEntities, quarters }).js;
  for (const js of [noCohort, withCohort]) {
    assert.ok(js.includes("if(ds[j].atQtrHidden)continue;"), "sync pass lost its atQtrHidden guard");
    assert.ok(js.includes("ds[j].atEntity!=null&&!ds[j].atQtrHidden"), "Show all lost its atQtrHidden guard");
  }
  const guardBody = (js: string) => {
    const i = js.indexOf("window.flexToggleAllAdoptionEntities=function");
    assert.ok(i >= 0);
    return js.slice(i, js.indexOf("};", i));
  };
  assert.equal(guardBody(noCohort), guardBody(withCohort));
});

console.log(`\nrenumber-safety: ${passed} tests passed`);
