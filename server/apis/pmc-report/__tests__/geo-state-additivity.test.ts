/**
 * The By State slide's drill-down has to ADD UP: for every state bar, the rendered region rows
 * plus the grey "without a mapped market" line must equal that bar's own properties, units AND
 * paying residents. Mirrors Flask d537142's tests/test_app.py additions.
 *
 * The footnote is a residual computed in the renderer, so the only honest way to check it is to
 * parse the rendered markup back out - exactly what the additivity harness does.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/geo-state-additivity.test.ts
 */
import assert from "node:assert/strict";

import { renderStateBreakdown } from "../get-pmc-monthly-report.js";
import type { StateBreakdownInput } from "../get-pmc-monthly-report.js";
import type { RegionDetailRow } from "../geo-regions.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────
// Three states, so the slide's own `statesMap.size <= 2` guard doesn't short-circuit it.
// CA = 3 props / 180 units / 28 bills, WA = 2 / 200 / 60, TX = 1 / 90 / 9.
const snapRow = (
  id: string, name: string, state: string, units: number, bills: number,
): StateBreakdownInput["latestRows"][number] => ({
  PROPERTY_NAME: name, PROPERTY_PUBLIC_ID: id, PROPERTY_UNIT_COUNT: units,
  BILLS_PAID: bills, PROPERTY_STATE: state, ROLLOUT_MONTH: null,
});

const SNAPSHOT: StateBreakdownInput["latestRows"] = [
  snapRow("p1", "A", "CA", 100, 20), snapRow("p2", "B", "CA", 50, 5), snapRow("p3", "C", "CA", 30, 3),
  snapRow("p4", "D", "WA", 120, 36), snapRow("p5", "E", "WA", 80, 24),
  snapRow("p6", "F", "TX", 90, 9),
];

const regionRow = (
  state: string, region: string, props: number, units: number, bills: number,
): RegionDetailRow => ({
  PROPERTY_STATE: state, PROPERTY_REGION: region, DISPLAY_REGION: region,
  PROPERTIES: props, TOTAL_UNITS: units, BILLS_PAID: bills,
});

const render = (regionDetail: RegionDetailRow[], latestRows = SNAPSHOT) =>
  renderStateBreakdown({ latestRows, portfolioNar: 0.15, reportingMonth: "2026-08-01", slideId: 12, regionDetail }).html;

// ── Markup parser (the additivity harness's own approach) ───────────────────────────────────
interface StateBlock {
  state: string; props: number; units: number; bills: number;
  regions: [number, number, number][];
  footnote: [number, number, number] | null;
}
const num = (s: string) => Number(s.replace(/,/g, ""));
const signed = (s: string) => (s.startsWith("-") ? -num(s.slice(1)) : num(s.replace(/^\+/, "")));

function parseStateBlocks(html: string): StateBlock[] {
  const out: StateBlock[] = [];
  // Each top-level state bar opens a 84px label column; its nested region rows (230px) and its
  // footnote live inside the same chunk, before the next state bar starts.
  for (const blk of html.split(/(?=grid-template-columns:84px )/).slice(1)) {
    const m = /title="([^"]*)"[\s\S]*?([\d.]+)%<\/div>\s*<div[^>]*>(\d+) props<\/div>\s*<div[^>]*>([\d,]+) units<\/div>\s*<div[^>]*>([\d,]+) paying/.exec(blk);
    if (!m) continue;
    const regions: [number, number, number][] = [];
    const rre = /grid-template-columns:230px [\s\S]*?(\d+) props<\/div>\s*<div[^>]*>([\d,]+) units<\/div>\s*<div[^>]*>([\d,]+) paying/g;
    let r: RegExpExecArray | null;
    while ((r = rre.exec(blk)) !== null) regions.push([num(r[1]), num(r[2]), num(r[3])]);
    const fn = /([+-][\d,]+) (?:property|properties) · ([+-][\d,]+) units · ([+-][\d,]+) paying without a mapped market/.exec(blk);
    out.push({
      state: m[1], props: num(m[3]), units: num(m[4]), bills: num(m[5]), regions,
      footnote: fn ? [signed(fn[1]), signed(fn[2]), signed(fn[3])] : null,
    });
  }
  return out;
}

// ── Tests ───────────────────────────────────────────────────────────────────────────────────
test("footnote equals state total minus rendered region rows, on all three measures", () => {
  // Deliberately NOT reconciling on their own: CA under-accounts on all three measures, WA
  // over-accounts on units, TX is accounted for exactly (and must get no footnote at all).
  const html = render([
    regionRow("CA", "LOS ANGELES", 1, 100, 20),
    regionRow("CA", "SAN DIEGO", 1, 50, 5),
    regionRow("WA", "SEATTLE - TACOMA", 2, 240, 55),
    regionRow("TX", "DALLAS - FT. WORTH", 1, 90, 9),
  ]);
  const blocks = new Map(parseStateBlocks(html).map((b) => [b.state, b]));
  assert.deepEqual([...blocks.keys()].sort(), ["CA", "TX", "WA"]);
  for (const [st, b] of blocks) {
    const resid = b.footnote ?? [0, 0, 0];
    assert.equal(b.regions.reduce((a, r) => a + r[0], 0) + resid[0], b.props, `${st} properties`);
    assert.equal(b.regions.reduce((a, r) => a + r[1], 0) + resid[1], b.units, `${st} units`);
    assert.equal(b.regions.reduce((a, r) => a + r[2], 0) + resid[2], b.bills, `${st} bills`);
  }
  assert.deepEqual(blocks.get("CA")!.footnote, [1, 30, 3]);
  assert.equal(blocks.get("TX")!.footnote, null, "a fully-accounted state prints no footnote");
  assert.equal((html.match(/without a mapped market/g) ?? []).length, 2);
});

test("a negative residual prints signed rather than being hidden", () => {
  const html = render([
    regionRow("CA", "LOS ANGELES", 3, 180, 28),
    // WA's regions over-account for units (240 > 200) and under-account for bills (55 < 60).
    regionRow("WA", "SEATTLE - TACOMA", 2, 240, 55),
    regionRow("TX", "DALLAS - FT. WORTH", 1, 90, 9),
  ]);
  const blocks = new Map(parseStateBlocks(html).map((b) => [b.state, b]));
  assert.deepEqual(blocks.get("WA")!.footnote, [0, -40, 5]);
  assert.ok(html.includes("+0 properties · -40 units · +5 paying without a mapped market"));
  // The exactly-accounted states are silent, so the negative line is the only footnote.
  assert.equal((html.match(/without a mapped market/g) ?? []).length, 1);
});

test("the 'Unknown' bucket folds into the residual instead of becoming its own bar", () => {
  const html = render([
    regionRow("CA", "LOS ANGELES", 2, 150, 25),
    regionRow("CA", "Unknown", 1, 30, 3),
    regionRow("WA", "SEATTLE - TACOMA", 2, 200, 60),
    regionRow("TX", "DALLAS - FT. WORTH", 1, 90, 9),
  ]);
  assert.ok(!html.includes("Unknown"), "Unknown never renders as a region bar");
  assert.ok(html.includes("+1 property · +30 units · +3 paying without a mapped market"));
  assert.equal((html.match(/without a mapped market/g) ?? []).length, 1);
});

test("state bars count properties by public id, not by name", () => {
  // Two genuinely distinct CA properties share a name; the bar must read 2 props so it ties to
  // the Exec Summary property tile and to the region rows (which now count public ids too).
  const rows: StateBreakdownInput["latestRows"] = [
    snapRow("p1", "The Enclave", "CA", 100, 20), snapRow("p2", "The Enclave", "CA", 50, 5),
    snapRow("p4", "D", "WA", 120, 36), snapRow("p5", "E", "WA", 80, 24),
    snapRow("p6", "F", "TX", 90, 9),
  ];
  const ca = parseStateBlocks(render([], rows)).find((b) => b.state === "CA")!;
  assert.equal(ca.props, 2);
  assert.equal(ca.units, 150);
  assert.equal(ca.bills, 25);
});

test("rows missing a public id still count, falling back to the name", () => {
  const rows: StateBreakdownInput["latestRows"] = [
    { ...snapRow("x", "A", "CA", 100, 20), PROPERTY_PUBLIC_ID: null },
    { ...snapRow("x", "B", "CA", 50, 5), PROPERTY_PUBLIC_ID: undefined },
    snapRow("p4", "D", "WA", 120, 36), snapRow("p5", "E", "WA", 80, 24),
    snapRow("p6", "F", "TX", 90, 9),
  ];
  const ca = parseStateBlocks(render([], rows)).find((b) => b.state === "CA")!;
  assert.equal(ca.props, 2);
});

test("state bars and region rows both print the paying-residents measure", () => {
  const html = render([
    regionRow("CA", "LOS ANGELES", 3, 180, 28),
    regionRow("WA", "SEATTLE - TACOMA", 2, 200, 60),
    regionRow("TX", "DALLAS - FT. WORTH", 1, 90, 9),
  ]);
  assert.ok(html.includes("28 paying"), "CA's state bar carries its bills");
  assert.ok(html.includes("60 paying") && html.includes("9 paying"));
  // 6 rows in total: 3 state bars + 3 nested region rows, each with its own paying column.
  assert.equal((html.match(/ paying<\/div>/g) ?? []).length, 6);
  assert.ok(html.includes("add up to that state's own props, units and paying residents"));
});

test("SUM(state bars) equals the portfolio property count the Exec Summary tile uses", () => {
  // get-pmc-monthly-report builds that tile as
  //   new Set(latestRows.map(r => r.PROPERTY_PUBLIC_ID || r.PROPERTY_NAME)).size
  // A property lives in exactly one state, so the state bars must sum to it exactly. Two CA
  // rows share a name here: a name-based count on either side would break the tie.
  const rows: StateBreakdownInput["latestRows"] = [
    snapRow("p1", "The Enclave", "CA", 100, 20), snapRow("p2", "The Enclave", "CA", 50, 5),
    snapRow("p3", "The Enclave", "WA", 120, 36), snapRow("p4", "E", "WA", 80, 24),
    snapRow("p5", "F", "TX", 90, 9),
  ];
  const execTile = new Set(rows.map((r) => r.PROPERTY_PUBLIC_ID || r.PROPERTY_NAME)).size;
  const blocks = parseStateBlocks(render([], rows));
  assert.equal(blocks.reduce((a, b) => a + b.props, 0), execTile);
  assert.equal(execTile, 5);
  assert.equal(blocks.reduce((a, b) => a + b.units, 0), 440);
  assert.equal(blocks.reduce((a, b) => a + b.bills, 0), 94);
});

test("no region detail at all leaves the state bars alone and prints no footnote", () => {
  const html = render([]);
  assert.ok(!html.includes("without a mapped market"));
  assert.ok(!html.includes("Click a state to see its regions"));
  const blocks = parseStateBlocks(html);
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((b) => b.regions.length), [0, 0, 0]);
});

console.log(`\ngeo-state-additivity: ${passed} tests passed`);
