/**
 * WHY THIS FILE EXISTS
 * ====================
 * The QBR slide picker shipped INERT. QBRTab.tsx built all 22 checkboxes and wrote them into
 * `selected_slides`; index.tsx's handleQBRGenerate never forwarded them; the server's input
 * schema had no field for them at all. So every QBR deck rendered the fixed `slidesOrdered`
 * array no matter what a rep ticked — and three of the chips (Integration Gap, Adoption
 * Ceiling, D2C Marketing Split) name slides Clark deliberately does not implement, plus one
 * (Properties Offline) that was never built, so even a wired picker would have offered four
 * boxes that could never do anything.
 *
 * Both halves of that are structural, so both are checked structurally:
 *
 *   1. THE GATE'S SEMANTICS — `qbrSlidePicked` is exported and tested directly, including the
 *      load-bearing "omitted or empty means render EVERYTHING" rule that `expansion_slides`
 *      already follows. Inverting that would make a stale caller (one that sends no
 *      qbr_slides) get an empty deck.
 *
 *   2. PICKER LIST == GATED KEYS — scraped from the two real source files and compared as
 *      sets, in both directions:
 *        OFFERED = every id in SlidesPicker.tsx's QBR_SLIDES array
 *        GATED   = every key passed to keepHtml("…") in get-pmc-monthly-report.ts's QBR
 *                  slidesOrdered array
 *      A chip added without a gate fails here (it would silently do nothing — the original
 *      bug), and so does a gate with no chip (unreachable/unselectable slide). Nothing is
 *      hardcoded, so this keeps working as slides come and go.
 *
 *   3. Plus the reverse check on the JS gate: a slide gated in the html but NOT in `extraJs`
 *      leaves its `initSlideN` / `chartN` references behind for the renumbering pass, where
 *      they keep their original number and can collide with whatever slide renumbers onto it.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/qbr-slide-picker.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { qbrSlidePicked } from "../get-pmc-monthly-report.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL: ${name}`);
    throw e;
  }
}

// ── 1. Gate semantics ───────────────────────────────────────────────────────

test("omitted qbr_slides means render everything", () => {
  const picked = qbrSlidePicked(undefined);
  assert.equal(picked("cover"), true);
  assert.equal(picked("full_property_table"), true);
  assert.equal(picked("anything_at_all"), true);
});

test("an EMPTY array also means render everything, not nothing", () => {
  // Same contract as expansion_slides. A stale caller sending [] must not get a blank deck.
  const picked = qbrSlidePicked([]);
  assert.equal(picked("cover"), true);
  assert.equal(picked("retention"), true);
});

test("a non-empty selection keeps exactly what was ticked and drops the rest", () => {
  const picked = qbrSlidePicked(["cover", "exec_summary", "retention"]);
  assert.equal(picked("cover"), true);
  assert.equal(picked("exec_summary"), true);
  assert.equal(picked("retention"), true);
  assert.equal(picked("by_state"), false);
  assert.equal(picked("full_property_table"), false);
  assert.equal(picked("delinquency"), false);
});

test("an unknown id in the selection excludes everything else, not nothing", () => {
  const picked = qbrSlidePicked(["not_a_real_slide"]);
  assert.equal(picked("cover"), false);
  assert.equal(picked("not_a_real_slide"), true);
});

// ── 2. Picker list == gated keys ────────────────────────────────────────────

const pickerSrc = readFileSync(
  new URL("../../../../client/pages/PMCMonthlyReport/components/SlidesPicker.tsx", import.meta.url),
  "utf8",
);
const serverSrc = readFileSync(new URL("../get-pmc-monthly-report.ts", import.meta.url), "utf8");

/** The ids inside `export const QBR_SLIDES: SlideOption[] = [ … ];` only. */
function offeredQbrSlideIds(src: string): string[] {
  const start = src.indexOf("export const QBR_SLIDES");
  assert.ok(start >= 0, "QBR_SLIDES array not found in SlidesPicker.tsx");
  const end = src.indexOf("\n];", start);
  assert.ok(end > start, "QBR_SLIDES array terminator not found");
  const block = src.slice(start, end);
  return [...block.matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((m) => m[1]);
}

const OFFERED = offeredQbrSlideIds(pickerSrc);
const GATED_HTML = [...serverSrc.matchAll(/keepHtml\("([^"]+)"/g)].map((m) => m[1]);
const GATED_JS = [...serverSrc.matchAll(/keepJs\("([^"]+)"/g)].map((m) => m[1]);

test("the picker offers a non-trivial number of slides (scrape sanity)", () => {
  assert.ok(OFFERED.length >= 15, `only scraped ${OFFERED.length} picker ids`);
  assert.ok(GATED_HTML.length >= 15, `only scraped ${GATED_HTML.length} keepHtml keys`);
});

test("no id is offered twice, and no key is gated twice", () => {
  assert.deepEqual([...new Set(OFFERED)].sort(), [...OFFERED].sort());
  assert.deepEqual([...new Set(GATED_HTML)].sort(), [...GATED_HTML].sort());
});

test("every offered chip is actually gated server-side (no silent no-op chips)", () => {
  const gated = new Set(GATED_HTML);
  const orphanChips = OFFERED.filter((id) => !gated.has(id));
  assert.deepEqual(
    orphanChips,
    [],
    `QBR_SLIDES offers ids the server never gates on (ticking them does nothing): ${orphanChips.join(", ")}`,
  );
});

test("every gated slide is offered in the picker (no unselectable slides)", () => {
  const offered = new Set(OFFERED);
  const ungatedKeys = GATED_HTML.filter((k) => !offered.has(k));
  assert.deepEqual(
    ungatedKeys,
    [],
    `the server gates on ids the picker never offers (unreachable slides): ${ungatedKeys.join(", ")}`,
  );
});

test("the four unimplemented chips are gone from the picker", () => {
  // integration_gap (Flask 23) / adoption_ceiling (45) / d2c_split (49) are deliberately not
  // ported — the Platinum and NIRO decks make those arguments. properties_offline (53) was
  // never built; disabled properties live inside the Adoption Opportunities slide.
  for (const id of ["integration_gap", "adoption_ceiling", "d2c_split", "properties_offline"]) {
    assert.ok(!OFFERED.includes(id), `${id} is offered in the picker but nothing renders it`);
  }
});

// ── 3. html gate and JS gate agree ──────────────────────────────────────────

test("every slide with extra JS gates that JS on the same key as its html", () => {
  const gatedHtml = new Set(GATED_HTML);
  const orphanJs = GATED_JS.filter((k) => !gatedHtml.has(k));
  assert.deepEqual(orphanJs, [], `keepJs keys with no matching keepHtml: ${orphanJs.join(", ")}`);
});

test("the JS gate covers the slides that emit JS", () => {
  // These renderers all return a non-empty `js`; their JS must be gated too, or a filtered-out
  // slide leaves initSlideN behind for the renumbering pass to collide with.
  const mustGateJs = [
    "exec_summary", "since_inception", "portfolio_comparison", "residents_units",
    "adoption_trend", "portfolio_projection", "by_state", "peer_benchmarks",
    "high_rent", "delinquency", "retention", "customer_experience",
  ];
  for (const key of mustGateJs) {
    assert.ok(GATED_JS.includes(key), `${key}'s extra JS is not gated on the picker selection`);
  }
});

console.log(`\nqbr-slide-picker: ${passed} tests passed`);
