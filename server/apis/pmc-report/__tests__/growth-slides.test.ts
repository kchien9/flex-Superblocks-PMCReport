/**
 * WHY THIS FILE EXISTS
 * ====================
 * Flask's Expansion deck vetoes the three growth-trend slides (54 Residents/Units & Rent,
 * 6 Adoption Trend, 14 Cohort Overview) for anything but an SMB account unless the AE says
 * otherwise: `growth_slides` = "auto" | "include" | "exclude", where auto means SMB-only
 * (app.py:2303-2304). SMB accounts have no dedicated AM/PSM running QBRs, so the Expansion deck
 * is the only place their growth story gets told; a managed account's growth story belongs in
 * its QBR.
 *
 * Clark had replaced the whole thing with `const showGrowthSlides = true` and deleted the
 * parameter, so those three slides rendered for every Expansion deck with no way to turn them
 * off — the main cause of a 6-slide swing between the Flask and Clark Expansion decks for the
 * same PMC. (It also inverted the exec-tile sparklines, which are deliberately suppressed
 * exactly when the full charts render.)
 *
 * The decision itself lives in two places that must agree — the resolver and the veto — so both
 * are checked: the resolver as a truth table, and the veto structurally, from the real source.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/growth-slides.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const serverSrc = readFileSync(new URL("../get-pmc-monthly-report.ts", import.meta.url), "utf8");
const tabSrc = readFileSync(
  new URL("../../../../client/pages/PMCMonthlyReport/components/ExpansionTab.tsx", import.meta.url),
  "utf8",
);
const pageSrc = readFileSync(
  new URL("../../../../client/pages/PMCMonthlyReport/index.tsx", import.meta.url),
  "utf8",
);

/**
 * Flask's rule, verbatim:
 *   _show_growth = _growth_mode == "include" or (_growth_mode == "auto" and is_smb)
 * Re-stated here so the truth table below is checked against the intended contract, and the
 * next test checks the shipped expression is character-for-character this one.
 */
function showGrowth(mode: "auto" | "include" | "exclude" | undefined, isSmb: boolean): boolean {
  const m = mode ?? "auto";
  return m === "include" || (m === "auto" && isSmb);
}

test("the truth table matches Flask: auto = SMB-only, include/exclude force it", () => {
  assert.equal(showGrowth("auto", true), true);
  assert.equal(showGrowth("auto", false), false);
  assert.equal(showGrowth("include", false), true);
  assert.equal(showGrowth("include", true), true);
  assert.equal(showGrowth("exclude", true), false);
  assert.equal(showGrowth("exclude", false), false);
  // An omitted parameter is "auto", NOT "include" - that default is the whole fix.
  assert.equal(showGrowth(undefined, false), false);
  assert.equal(showGrowth(undefined, true), true);
});

test("the server resolves showGrowthSlides with exactly that expression", () => {
  assert.ok(
    serverSrc.includes('const growthMode = growth_slides ?? "auto";'),
    "growth_slides no longer defaults to auto",
  );
  assert.ok(
    serverSrc.includes('const showGrowthSlides = growthMode === "include" || (growthMode === "auto" && isSmb);'),
    "showGrowthSlides is not Flask's expression (hardcoded again?)",
  );
  assert.ok(!/const showGrowthSlides = true/.test(serverSrc), "showGrowthSlides is hardcoded true again");
});

test("SMB detection is the MODE of SEGMENT_TEAM, not the first row", () => {
  // One property must not be able to flip a combined-PMC report's classification
  // (Flask app.py:2294-2298 uses .mode(), with the same comment).
  const block = serverSrc.slice(serverSrc.indexOf("const isSmb = (() => {"));
  assert.ok(block.includes("counts.set(r.SEGMENT_TEAM"), "isSmb no longer counts SEGMENT_TEAM values");
  assert.ok(block.includes('=== "SMB Manager"'), "isSmb no longer compares against SMB Manager");
  assert.ok(block.includes("sort("), "isSmb is not picking the mode");
});

test("the veto covers exactly Flask's three slides (54 / 6 / 14) and nothing else", () => {
  const m = serverSrc.match(/const GROWTH_TREND_SLIDES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, "GROWTH_TREND_SLIDES set is gone - the veto can never fire");
  const ids = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(ids, ["adoption_trend", "cohort_overview", "residents_units"]);
});

test("the veto is actually applied when building the Expansion slide order", () => {
  assert.ok(
    serverSrc.includes("if (!showGrowthSlides && GROWTH_TREND_SLIDES.has(sid)) return false;"),
    "activeOrder does not apply the growth veto",
  );
});

test("the exec-tile sparklines stay coupled to the growth slides", () => {
  // show_sparklines = not (_show_growth and 54 in active_exp_order): with the veto on, the
  // condensed sparklines come back in the full chart's place.
  assert.ok(serverSrc.includes("(sparklinesOverride ?? !(showGrowthSlides && ("));
});

test("the parameter is wired end to end: schema, page handler, Expansion tab", () => {
  assert.ok(
    serverSrc.includes('growth_slides: z.enum(["auto", "include", "exclude"]).optional()'),
    "growth_slides missing from the input schema",
  );
  // Destructured in run()'s argument list, or it can never be read.
  const runSig = serverSrc.slice(serverSrc.indexOf("async run(ctx, {"), serverSrc.indexOf("async run(ctx, {") + 900);
  assert.ok(runSig.includes("growth_slides"), "growth_slides is not destructured in run()");
  assert.ok(pageSrc.includes("growth_slides: state.growth_slides"), "index.tsx does not forward growth_slides");
  assert.ok(tabSrc.includes("growth_slides: growthSlides"), "ExpansionTab does not emit growth_slides");
  assert.ok(tabSrc.includes('useState("auto")'), "ExpansionTab's default is not auto");
  assert.ok(tabSrc.includes("Growth trend slides"), "ExpansionTab has no control for it");
  // The dependency array gates whether the callback ever sees a changed value - the exact
  // mechanism that made other controls no-ops in this file's history.
  assert.ok(/}, \[[^\]]*growthSlides[^\]]*\]\);/.test(tabSrc), "growthSlides missing from the useCallback deps");
});

console.log(`\ngrowth-slides: ${passed} tests passed`);
