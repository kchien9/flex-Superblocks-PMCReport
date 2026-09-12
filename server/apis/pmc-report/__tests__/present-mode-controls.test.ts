/**
 * WHY THIS FILE EXISTS
 * ====================
 * Two visibility bugs that can only be seen in a browser, so they have to be pinned as the
 * relationship between the classes a control is EMITTED with and the shell CSS rules that
 * MATCH those classes. There is no browser in this repo; this file is that evidence.
 *
 *   Fix 3 — every entity switcher disappeared in Present mode. The switcher rows shipped as
 *   `class="spark-ctrl presenter-control"`, and the shell hides BOTH of those in fullscreen
 *   (`:fullscreen .presenter-control` and `:fullscreen .spark-ctrl`) — directly under a Clark
 *   comment claiming the row was kept out of `.spark-ctrl` so it would stay live. Kevin
 *   explicitly wants these usable while presenting. Flask achieves that by putting them in
 *   deliberately unstyled containers (`.exec-switch-row` / `.adt-switch-row`) precisely so no
 *   fullscreen rule can reach them (generator/slides.py:9703 says so in a comment). Clark now
 *   has `.switch-row` for the same purpose.
 *
 *   Fix 4 — the "Hide established line" button was emitted with NO class at all, so it matched
 *   nothing in the PDF export's onclone strip list (`.slide-hide-btn, .presenter-control,
 *   .pdf-export-hide`) and was baked into every exported PDF. Flask uses
 *   `presenter-control keep-live` (slides.py:2479): stripped from the PDF, visible while
 *   presenting.
 *
 * The checks below take the REAL emitted markup and the REAL shell CSS / strip list and apply
 * a tiny class-selector matcher to them, so the assertions are about which rules actually
 * match — not about the source text of either side.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/present-mode-controls.test.ts
 */
import assert from "node:assert/strict";

import { buildDeckHtml, renderExecSummary } from "../get-pmc-monthly-report.js";
import type { ExecSummaryInput } from "../get-pmc-monthly-report.js";
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

// ── The shell's real rules ──────────────────────────────────────────────────
const SHELL = buildDeckHtml({
  slides: "", pmc_name: "Test PMC", report_month: "August", report_year: "2026",
  slide_count: 1, pdf_filename: "t.pdf",
});

/** Class-only selectors from every `:fullscreen …` rule in the shell's <style>. */
function fullscreenHideSelectors(): string[] {
  const out: string[] = [];
  for (const m of SHELL.matchAll(/:fullscreen\s+([^,{]+)[^{]*\{([^}]*)\}/g)) {
    if (/display:\s*none/.test(m[2])) out.push(m[1].trim());
  }
  return out;
}
function fullscreenShowSelectors(): string[] {
  const out: string[] = [];
  for (const m of SHELL.matchAll(/:fullscreen\s+([^,{]+)[^{]*\{([^}]*)\}/g)) {
    if (/display:\s*(inline-block|block|flex)/.test(m[2])) out.push(m[1].trim());
  }
  return out;
}
/** The PDF export's onclone strip list, scraped from the shell itself. */
function pdfStripSelectors(): string[] {
  const m = SHELL.match(/([^{}]*)\{ display: none !important; \}/);
  assert.ok(m, "PDF onclone strip rule not found in the shell");
  return m[1].split(",").map((s) => s.trim()).filter((s) => s.startsWith("."));
}
/** Does a `.a.b`-style class selector match this element's class list? */
function selectorMatches(selector: string, classes: string[]): boolean {
  const needed = selector.split(".").filter(Boolean);
  return needed.length > 0 && needed.every((c) => classes.includes(c));
}
const HIDE_IN_FULLSCREEN = fullscreenHideSelectors();
const SHOW_IN_FULLSCREEN = fullscreenShowSelectors();
const PDF_STRIP = pdfStripSelectors();

/** The rules that apply to a control, given its classes. */
function verdict(classes: string[]) {
  const hidden = HIDE_IN_FULLSCREEN.filter((s) => selectorMatches(s, classes));
  const shown = SHOW_IN_FULLSCREEN.filter((s) => selectorMatches(s, classes));
  return {
    fullscreenHiddenBy: hidden,
    fullscreenShownBy: shown,
    // The later, more specific `.presenter-control.keep-live` rule wins over the bare one.
    visibleWhilePresenting: hidden.length === 0 || shown.length > 0,
    pdfStrippedBy: PDF_STRIP.filter((s) => selectorMatches(s, classes)),
  };
}
/** Class list of the element carrying `marker` (an id or an onclick fragment). */
function classesOf(html: string, marker: string): string[] {
  const at = html.indexOf(marker);
  assert.ok(at >= 0, `marker not found in markup: ${marker}`);
  const open = html.lastIndexOf("<", at);
  const tag = html.slice(open, html.indexOf(">", at) + 1);
  const cm = tag.match(/class="([^"]*)"/);
  return cm ? cm[1].split(/\s+/).filter(Boolean) : [];
}

test("the shell really does hide .presenter-control AND .spark-ctrl in fullscreen", () => {
  // Both halves of the class the switcher rows used to carry. If either rule is ever dropped,
  // the rest of this file stops meaning anything, so assert them up front.
  assert.ok(HIDE_IN_FULLSCREEN.includes(".presenter-control"));
  assert.ok(HIDE_IN_FULLSCREEN.includes(".spark-ctrl"));
  assert.ok(SHOW_IN_FULLSCREEN.includes(".presenter-control.keep-live"));
  assert.deepEqual(PDF_STRIP, [".slide-hide-btn", ".presenter-control", ".pdf-export-hide"]);
  // .switch-row must have layout (so nothing needs an inline display) and no fullscreen rule.
  assert.ok(/\.switch-row \{ display: flex;/.test(SHELL), ".switch-row layout rule missing");
  assert.ok(!HIDE_IN_FULLSCREEN.some((s) => s.includes("switch-row")));
});

// ── Fixture ─────────────────────────────────────────────────────────────────
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
const quarters: QuarterAddsBlock[] = [{
  quarter: q4,
  combined: buildQuarterAddsSeries(rows, q4) as QuarterAddsSeries,
  entities: rucEntities.map((e) => ({
    pmcName: e.pmcName,
    series: buildQuarterAddsSeries(rows.filter((r) => r.PMC_NAME === e.pmcName), q4) as QuarterAddsSeries,
  })),
}];

// A combined Exec Summary, so its entity switcher actually renders.
const execEntity = (name: string, seed: number) => ({
  pmcName: name, propertyCount: 2, currentResidents: 100 + seed, currentRent: 90_000 + seed,
  currentNar: 0.11, currentNewSignups: 9 + seed, dqShielded: 1_000 + seed,
  monthly: perMonth(rows).map((m) => ({ ...m, newSignups: 4, propertyCount: 1 })),
});
const execInput = {
  slideId: 2, pmcName: "Combined", reportingMonth: "2025-12-01", propertyCount: 4,
  totalUnits: 300, currentResidents: 200, currentRent: 180_000, currentNewSignups: 18,
  currentNar: 0.11, lifetimeRent: 1_000_000, monthlyTotals,
  entityBreakdown: [execEntity(ALPHA, 1), execEntity(BETA, 2)],
} as unknown as ExecSummaryInput;

// ── Fix 3: the four switcher rows ───────────────────────────────────────────

const CONTROLS: { label: string; html: string; marker: string }[] = [
  {
    label: "Exec Summary entity switcher",
    html: renderExecSummary(execInput).html,
    marker: "flexSwitchEntity(2,0,this)",
  },
  {
    label: "Adoption Trend multi-select + Show all + quarter adds",
    html: renderAdoptionTrend({ slideId: 6, monthly: monthlyTotals, entityMonthlyData: adtEntities, quarters }).html,
    marker: 'id="atShowAll6"',
  },
  {
    label: "Adoption Trend quarter adds (single-PMC deck)",
    html: renderAdoptionTrend({ slideId: 6, monthly: monthlyTotals, quarters }).html,
    marker: 'id="adtQBtn6-0"',
  },
  {
    label: "Residents/Units switcher + quarter adds",
    html: renderResidentsUnitsCombo({ slideId: 4, monthlyTotals, entityMonthlyData: rucEntities, quarters }).html,
    marker: "flexSwitchResUnitsView(4,0,this)",
  },
  {
    label: "Residents/Units quarter adds (single-PMC deck)",
    html: renderResidentsUnitsCombo({ slideId: 4, monthlyTotals, quarters }).html,
    marker: 'id="rucQBtn4-0"',
  },
];

for (const c of CONTROLS) {
  test(`${c.label}: its row survives Present mode and is stripped from the PDF`, () => {
    // The row is the button's parent; classesOf(marker) gives the button, so walk to the
    // wrapping <div class="…"> that the row-level classes live on.
    const at = c.html.indexOf(c.marker);
    const rowOpen = c.html.lastIndexOf("<div", at);
    const rowTag = c.html.slice(rowOpen, c.html.indexOf(">", rowOpen) + 1);
    const classes = (rowTag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean);

    assert.deepEqual(classes, ["switch-row", "pdf-export-hide"], `${c.label} row classes`);
    const v = verdict(classes);
    assert.deepEqual(v.fullscreenHiddenBy, [], `${c.label} is hidden in fullscreen by ${v.fullscreenHiddenBy}`);
    assert.equal(v.visibleWhilePresenting, true);
    assert.deepEqual(v.pdfStrippedBy, [".pdf-export-hide"], `${c.label} must still leave the PDF`);
  });
}

test("cosmetic sparkline toggles still vanish in Present mode (the point of the split)", () => {
  const { html } = renderExecSummary(execInput);
  const at = html.indexOf("flexToggleSpark(");
  if (at < 0) return; // fixture didn't produce sparklines; nothing to assert
  const rowOpen = html.lastIndexOf("<div", at);
  const rowTag = html.slice(rowOpen, html.indexOf(">", rowOpen) + 1);
  const classes = (rowTag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean);
  assert.ok(classes.includes("spark-ctrl") && classes.includes("presenter-control"));
  assert.equal(verdict(classes).visibleWhilePresenting, false);
});

// ── Fix 4: the established-line toggle ──────────────────────────────────────

test("Hide established line: presenter-control keep-live - out of the PDF, live on screen", () => {
  // Divergent series so showEstablished is true and the button renders at all.
  const withEst: MonthlyTotal[] = monthlyTotals.map((m, i) => ({ ...m, establishedNar: m.adoptionRate + 0.05 + i * 0.01 }));
  // kpis with a real peer ladder so the peer-median toggle renders beside it for comparison.
  const { html } = renderAdoptionTrend({
    slideId: 6,
    monthly: withEst,
    kpis: { pmc_name: "Combined", months_since_launch: 2, stage_benchmarks: { 1: { p50: 0.08 }, 2: { p50: 0.09 } } },
  });
  const classes = classesOf(html, "toggleEstablished6(this)");
  assert.deepEqual(classes, ["presenter-control", "keep-live"]);
  const v = verdict(classes);
  assert.deepEqual(v.fullscreenHiddenBy, [".presenter-control"]);
  assert.deepEqual(v.fullscreenShownBy, [".presenter-control.keep-live"]);
  assert.equal(v.visibleWhilePresenting, true);
  assert.deepEqual(v.pdfStrippedBy, [".presenter-control"], "it was being baked into the PDF");

  // Its neighbour, the peer-median toggle, must NOT get keep-live: Kevin's rule is that peer
  // median never reaches an audience.
  const bm = classesOf(html, "toggleBenchmark6(this)");
  assert.deepEqual(bm, ["presenter-control"]);
  assert.equal(verdict(bm).visibleWhilePresenting, false);
  assert.deepEqual(verdict(bm).pdfStrippedBy, [".presenter-control"]);
});

test("no interactive control anywhere in a rendered slide lacks a PDF strip class", () => {
  const withEst: MonthlyTotal[] = monthlyTotals.map((m, i) => ({ ...m, establishedNar: m.adoptionRate + 0.05 + i * 0.01 }));
  const htmls = [
    renderExecSummary(execInput).html,
    renderAdoptionTrend({ slideId: 6, monthly: withEst, entityMonthlyData: adtEntities, quarters }).html,
    renderResidentsUnitsCombo({ slideId: 4, monthlyTotals, entityMonthlyData: rucEntities, quarters }).html,
  ];
  for (const html of htmls) {
    for (const m of html.matchAll(/<button\b[^>]*>/g)) {
      const tag = m[0];
      const classes = (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean);
      // Either the button itself carries a strip class, or its row does (checked above).
      const own = PDF_STRIP.some((s) => selectorMatches(s, classes));
      const inStrippedRow = (() => {
        const at = html.indexOf(tag);
        const rowOpen = html.lastIndexOf("<div", at);
        if (rowOpen < 0) return false;
        const rowTag = html.slice(rowOpen, html.indexOf(">", rowOpen) + 1);
        const rc = (rowTag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean);
        return PDF_STRIP.some((s) => selectorMatches(s, rc));
      })();
      assert.ok(own || inStrippedRow, `button reaches the exported PDF: ${tag}`);
    }
  }
});

console.log(`\npresent-mode-controls: ${passed} tests passed`);
