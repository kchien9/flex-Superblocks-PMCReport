/**
 * WHY THIS FILE EXISTS
 * ====================
 * The combined Exec Summary's entity switcher has shipped INCOMPLETE three separate times:
 *
 *   1. the MoM delta pills never swapped, so every subsidiary showed the combined portfolio's
 *      deltas underneath its own values ("the delta tiles only show change for the all-in PMC
 *      and don't update on the subsidiaries");
 *   2. then the hero's "avg $X/resident" sub-line never swapped ("this number doesnt change
 *      based on the pmc selected either");
 *   3. then the Delinquency-shielded tile never swapped — it was emitted with no id at all, so
 *      picking a subsidiary left the whole combined portfolio's DQ dollar figure and its green
 *      pill on screen under that subsidiary's numbers.
 *
 * Every one of those looked correct on screen and was wrong, in front of a partner. Every one
 * was found by a human noticing a number that didn't move, not by a test. The class is
 * structural: a node is added to the markup with a per-entity id, and the handler that swaps
 * ids is a separate string literal that nobody remembers to extend (or vice versa).
 *
 * So this test does not check a list of tiles. It derives BOTH sides from the rendered output
 * and compares them as sets:
 *
 *   - EMITTED  = every id in the HTML matching the switcher's own id conventions
 *                (ev_* value/text nodes, ep_* pill wrappers) — see ID_PATTERN below.
 *   - UPDATED  = every id the handler JS actually writes to, scraped from its
 *                setTxt('...'+slideId, …) / setHtml('...'+slideId, …) calls.
 *
 * and asserts the two are equal in both directions. A future tile added with an id but no
 * wiring fails here, and so does a handler that writes to an id nobody emits. Nothing is
 * hardcoded, so the test keeps working as tiles come and go.
 *
 * The ONE deliberate exception is the True Repeat Rate tile, which must continue NOT to
 * switch: there is no per-entity source for it anywhere in either repo (it comes from the
 * combined-level retention cohort), and Flask documents the same decision at
 * generator/slides.py:9262-9266. It is asserted to have no id, so "fix" it and this fails.
 *
 * Also pins the single canonical entity ORDER (Fix 2) — see the second section.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/exec-switcher-wiring.test.ts
 */
import assert from "node:assert/strict";

import { renderExecSummary } from "../get-pmc-monthly-report.js";
import type { ExecSummaryInput } from "../get-pmc-monthly-report.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL: ${name}`);
    throw e;
  }
}

// ── Fixture: a 2-entity combined Exec Summary with every node populated ──────
// Real-shaped numbers (Asset Living + FPI at their live 2026-08/09 DQ figures) so every
// optional node — pills, sparklines, the avg sub-line, the DQ tile — is actually emitted. A
// node that renders empty can't be checked for wiring, so the fixture deliberately leaves
// nothing out.
const SLIDE_ID = 2;

function monthly(seed: number): ExecSummaryInput["monthlyTotals"] {
  const out: ExecSummaryInput["monthlyTotals"] = [];
  for (let i = 0; i < 12; i++) {
    const units = 10_000 + seed * 100 + i * 50;
    const billsPaid = Math.round(units * (0.10 + i * 0.002) + seed);
    out.push({
      month: `2025-${String(10 + i).padStart(2, "0")}-01`.replace(/-(\d\d)-01$/, (_m, mm) => {
        const n = parseInt(mm, 10);
        return n > 12 ? `-${String(n - 12).padStart(2, "0")}-01` : `-${mm}-01`;
      }),
      billsPaid,
      units,
      rentPaid: billsPaid * (1200 + seed),
      newSignups: 40 + i + seed,
      adoptionRate: billsPaid / units,
    });
  }
  // Make the month keys strictly increasing and well-formed regardless of the wrap above.
  return out.map((m, i) => ({ ...m, month: `${2025 + Math.floor((9 + i) / 12)}-${String(((9 + i) % 12) + 1).padStart(2, "0")}-01` }));
}

function entity(name: string, seed: number, dqShielded: number | null, dqSince: number | null) {
  const mo = monthly(seed);
  const last = mo[mo.length - 1];
  const prev = mo[mo.length - 2];
  return {
    pmcName: name,
    currentResidents: last.billsPaid,
    currentRent: last.rentPaid,
    currentNar: last.adoptionRate,
    propertyCount: 30 + seed,
    totalUnits: last.units,
    prevResidents: prev.billsPaid,
    prevRent: prev.rentPaid,
    prevNar: prev.adoptionRate,
    prevPropertyCount: 28 + seed,
    currentNewSignups: last.newSignups,
    monthly: mo.map((m) => ({ ...m })),
    dqShielded,
    dqSinceComparison: dqSince,
  };
}

function makeInput(overrides: Partial<ExecSummaryInput> = {}): ExecSummaryInput {
  const combined = monthly(0);
  const last = combined[combined.length - 1];
  const prev = combined[combined.length - 2];
  return {
    slideId: SLIDE_ID,
    pmcName: "Asset Living",
    reportingMonth: last.month,
    partnerSince: "2021-12-01",
    lookbackMonths: 12,
    targetNar: 0.15,
    currentNar: last.adoptionRate,
    currentResidents: last.billsPaid,
    currentRent: last.rentPaid,
    currentNewSignups: last.newSignups,
    lifetimeRent: combined.reduce((s, m) => s + m.rentPaid, 0),
    propertyCount: 62,
    totalUnits: last.units,
    prevNar: prev.adoptionRate,
    prevResidents: prev.billsPaid,
    prevRent: prev.rentPaid,
    prevNewSignups: prev.newSignups,
    prevPropertyCount: 60,
    prevUnits: prev.units,
    monthlyTotals: combined,
    trueRepeatRate: 0.897,
    lifetimeDqShielded: 19_450_012,
    dqSinceComparison: 713_760,
    showSparklines: true,
    entityBreakdown: [
      entity("Asset Living", 1, 6_417_136, 713_760),
      entity("FPI (An Asset Living Company)", 2, 4_578_659, 523_651),
    ],
    ...overrides,
  };
}

// ── Set derivation: both sides scraped from the render, nothing hardcoded ─────

/**
 * The switcher's id conventions, and the reason this can be pattern-based rather than a list:
 *   ev_<name>_<slideId>  a value / text node the handler sets with setTxt or setHtml
 *   ep_<name>_<slideId>  a pill wrapper the handler sets with setHtml
 * Sparkline wrappers (sp_nar_/sp_res_/ss_/sp_mo_) are shared with the show/hide toggle and use
 * their own prefixes; they're covered by the handler-side direction of the check below.
 */
const ID_PATTERN = new RegExp(`\\b(ev|ep)_[a-z]+_${SLIDE_ID}\\b`, "g");

function emittedIds(html: string): Set<string> {
  return new Set(Array.from(html.matchAll(new RegExp(`id="((?:ev|ep)_[a-z]+_${SLIDE_ID})"`, "g"))).map((m) => m[1]));
}

function updatedIds(js: string): Set<string> {
  // setTxt('ev_props_'+slideId, …) / setHtml('ep_dq_'+slideId, …) — recover the full id by
  // substituting the slide id the fixture used.
  const out = new Set<string>();
  for (const m of js.matchAll(/set(?:Txt|Html)\('([a-z_]+?)_'\+slideId/g)) {
    out.add(`${m[1]}_${SLIDE_ID}`);
  }
  return out;
}

const rendered = renderExecSummary(makeInput());

test("the fixture actually renders a switcher (otherwise the rest is vacuous)", () => {
  assert.match(rendered.js, /flexSwitchEntity/);
  assert.match(rendered.html, /flexSwitchEntity\(2,1,this\)/);
  assert.ok(emittedIds(rendered.html).size >= 8, `only ${emittedIds(rendered.html).size} switchable ids emitted`);
});

test("EVERY per-entity id in the markup is in the handler's update set", () => {
  const emitted = emittedIds(rendered.html);
  const updated = updatedIds(rendered.js);
  const orphans = Array.from(emitted).filter((id) => !updated.has(id)).sort();
  assert.deepEqual(
    orphans,
    [],
    `these nodes carry a per-entity id but the switch handler never updates them, so they keep `
      + `showing the Combined figure after a switch: ${orphans.join(", ")}`
  );
});

test("EVERY id the handler references exists in the markup", () => {
  const emitted = emittedIds(rendered.html);
  const updated = updatedIds(rendered.js);
  // The handler also writes the four sparkline wrappers + the hero spark wrapper, which are
  // emitted with their own prefixes rather than ev_/ep_ (they're shared with the show/hide
  // toggle). Accept any id that appears as an id="…" anywhere in the markup.
  const allMarkupIds = new Set(Array.from(rendered.html.matchAll(/id="([^"]+)"/g)).map((m) => m[1]));
  const dangling = Array.from(updated).filter((id) => !allMarkupIds.has(id) && !emitted.has(id)).sort();
  assert.deepEqual(
    dangling,
    [],
    `the switch handler writes to ids that the markup never emits (silently no-ops): ${dangling.join(", ")}`
  );
});

test("the three tiles that have shipped unwired are each wired now", () => {
  // Named explicitly, in addition to the set check above, so a regression names the bug it is.
  const updated = updatedIds(rendered.js);
  const emitted = emittedIds(rendered.html);
  for (const id of [
    "ep_props_2", "ep_res_2", "ep_nar_2", "ep_rent_2", // bug 1: the MoM delta pills
    "ev_avg_2",                                         // bug 2: hero avg $/resident
    "ev_dq_2", "ep_dq_2",                               // bug 3: Delinquency shielded + pill
  ]) {
    assert.ok(emitted.has(id), `${id} is not emitted in the markup`);
    assert.ok(updated.has(id), `${id} is emitted but the handler never updates it`);
  }
});

test("every payload entry carries a value for every id the handler reads off it", () => {
  // The other half of the same class: the handler can reference d.dq correctly while the
  // payload never sets it, which also leaves the node at Combined (setTxt skips undefined).
  const m = rendered.js.match(/window\.execEntityData\[2\]=(\[.*?\]);if\(!window\.flexSwitchEntity\)/s);
  assert.ok(m, "could not find the embedded switcher payload");
  const payload = JSON.parse(m![1].replace(/\\u003c/g, "<")) as Record<string, unknown>[];
  assert.equal(payload.length, 3, "expected Combined + 2 entities");
  const readKeys = Array.from(rendered.js.matchAll(/\bd\.([a-zA-Z]+)/g)).map((x) => x[1]);
  const pillKeys = Array.from(rendered.js.matchAll(/\bp\.([a-zA-Z]+)/g)).map((x) => x[1]);
  for (const [i, entry] of payload.entries()) {
    for (const k of new Set(readKeys)) {
      if (k === "pills" || k === "sparks") continue;
      assert.ok(k in entry, `payload[${i}] (${entry.label}) is missing "${k}", which the handler reads`);
    }
    const pills = entry.pills as Record<string, unknown>;
    for (const k of new Set(pillKeys)) {
      assert.ok(k in pills, `payload[${i}] (${entry.label}) pills is missing "${k}"`);
    }
  }
});

test("the DQ tile's payload values are per-entity, not three copies of Combined", () => {
  const m = rendered.js.match(/window\.execEntityData\[2\]=(\[.*?\]);if\(!window\.flexSwitchEntity\)/s);
  const payload = JSON.parse(m![1].replace(/\\u003c/g, "<")) as { label: string; dq: string }[];
  // Live Asset Living family figures: combined $19.45M, Asset Living $6.42M, FPI $4.58M.
  assert.equal(payload[0].dq, "$19.45M");
  assert.equal(payload[1].dq, "$6.42M");
  assert.equal(payload[2].dq, "$4.58M");
  assert.equal(new Set(payload.map((p) => p.dq)).size, 3, "all three DQ strings should differ");
});

test("True Repeat Rate still does NOT switch — no per-entity source exists for it", () => {
  // Deliberate divergence-free decision, matching Flask (slides.py:9262-9266). The tile's value
  // must not carry an id, and the handler must not reference one.
  assert.match(rendered.html, /True repeat rate/);
  const repeatTile = rendered.html.slice(rendered.html.indexOf("True repeat rate"));
  const tileEnd = repeatTile.indexOf("Delinquency shielded");
  const repeatTileHtml = tileEnd > 0 ? repeatTile.slice(0, tileEnd) : repeatTile;
  assert.ok(
    !/id="(?:ev|ep)_[a-z]+_2"/.test(repeatTileHtml),
    "the True repeat rate tile has been given a switchable id, but there is no per-entity "
      + "source for the metric - it would switch to a fabricated or duplicated number"
  );
  assert.ok(!updatedIds(rendered.js).has("ev_repeat_2"));
});

test("a single-entity report emits no switcher ids at all", () => {
  // The contract that keeps a single-PMC deck byte-identical to before the switcher existed.
  const one = renderExecSummary(makeInput({ entityBreakdown: [entity("Asset Living", 1, 6_417_136, 713_760)] }));
  assert.equal(one.js.includes("flexSwitchEntity"), false);
  assert.equal(emittedIds(one.html).size, 0);
  assert.match(one.html, /Delinquency shielded/);
});

test("an entity with no shielded rent renders the em-dash, like Combined does", () => {
  const r = renderExecSummary(makeInput({
    entityBreakdown: [
      entity("Asset Living", 1, 6_417_136, 713_760),
      entity("Trinity Multifamily (an Asset Living Company)", 2, null, null),
    ],
  }));
  const m = r.js.match(/window\.execEntityData\[2\]=(\[.*?\]);if\(!window\.flexSwitchEntity\)/s);
  const payload = JSON.parse(m![1].replace(/\\u003c/g, "<")) as { dq: string; pills: { dq: string } }[];
  assert.equal(payload[2].dq, "—");
  assert.equal(payload[2].pills.dq, "");
});

// ── Fix 2: one canonical entity order across all three consumers ─────────────
// The colour-identity rule, pinned as a unit. groupRowsByPmc normalizes ORDER but deletes
// empty groups, so three consumers fed three different row sets produced three different
// index->entity maps, and entityColor(i) gave the same subsidiary different colours on
// different slides. canonicalGroups pads every consumer to one list.
//
// The membership facts below are live (2026-09-11, 12-month window, cutoff 2026-10-01):
// Security Properties has 287 in-network rows in the window, its last in-network month is
// 2026-07, it has NO rows at the latest completed month (2026-09), and it has $19.7M of rent
// history — so it appears in inNetwork and in the unbounded yearly pull, but not in latestRows.

interface TestRow { PMC_NAME: string; BP_MONTH: string }
const AL = "Asset Living";
const SP = "Security Properties";
const FPI = "FPI (An Asset Living Company)";
const ALL_PMC_NAMES = [AL, SP, FPI];
const LATEST_MONTH = "2026-09-01";

const IN_NETWORK: TestRow[] = [
  { PMC_NAME: AL, BP_MONTH: "2026-07-01" }, { PMC_NAME: AL, BP_MONTH: LATEST_MONTH },
  { PMC_NAME: SP, BP_MONTH: "2026-06-01" }, { PMC_NAME: SP, BP_MONTH: "2026-07-01" },
  { PMC_NAME: FPI, BP_MONTH: "2026-07-01" }, { PMC_NAME: FPI, BP_MONTH: LATEST_MONTH },
];
const LATEST_ROWS = IN_NETWORK.filter((r) => r.BP_MONTH === LATEST_MONTH);
const YEARLY_ROWS = [{ PMC_NAME: AL }, { PMC_NAME: SP }, { PMC_NAME: FPI }];

// The two rules, reproduced exactly as get-pmc-monthly-report.ts defines them.
function groupRowsByPmc<T extends { PMC_NAME: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const name of ALL_PMC_NAMES) map.set(name, []);
  for (const r of rows) {
    const list = map.get(r.PMC_NAME);
    if (list) list.push(r);
    else map.set(r.PMC_NAME, [r]);
  }
  for (const [name, list] of map) if (list.length === 0) map.delete(name);
  return map;
}
const canonicalEntityNames = Array.from(groupRowsByPmc(IN_NETWORK).keys());
function canonicalGroups<T extends { PMC_NAME: string }>(rows: T[]): [string, T[]][] {
  const map = groupRowsByPmc(rows);
  return canonicalEntityNames.map((name) => [name, map.get(name) ?? []]);
}

test("the OLD rule really did give one entity two different colour indexes", () => {
  // Guards the test itself: if this ever stops failing, the case below proves nothing.
  const monthlyOrder = Array.from(groupRowsByPmc(IN_NETWORK).keys());
  const breakdownOrder = Array.from(groupRowsByPmc(LATEST_ROWS).keys());
  assert.equal(monthlyOrder.indexOf(FPI), 2, "FPI is entityColor(2) on Adoption Trend");
  assert.equal(breakdownOrder.indexOf(FPI), 1, "…but was entityColor(1) on the Exec switcher");
});

test("all three consumers now index off one canonical order", () => {
  const orders = {
    entityMonthlyData: canonicalGroups(IN_NETWORK).map(([n]) => n),
    entityBreakdown: canonicalGroups(LATEST_ROWS).map(([n]) => n),
    entityYearlyData: canonicalGroups(YEARLY_ROWS).map(([n]) => n),
  };
  for (const [consumer, order] of Object.entries(orders)) {
    assert.deepEqual(order, canonicalEntityNames, `${consumer} does not match the canonical order`);
  }
  // The concrete bug, stated as the assertion: FPI is index 2 everywhere.
  for (const order of Object.values(orders)) assert.equal(order.indexOf(FPI), 2);
});

test("an entity absent from a view renders empty there without shifting anyone", () => {
  const breakdown = canonicalGroups(LATEST_ROWS);
  const sp = breakdown.find(([n]) => n === SP);
  assert.ok(sp, "Security Properties must still occupy its slot");
  assert.deepEqual(sp![1], [], "…with no rows, so its current-month figures are zero");
  assert.equal(breakdown.findIndex(([n]) => n === SP), 1);
  assert.equal(breakdown.findIndex(([n]) => n === FPI), 2);
});

test("an entity with rent history but no in-network rows is dropped from every view", () => {
  // Flask's semantic: it never survived compute_pmc_kpis into _splits, so it isn't in the
  // report at all - including the unbounded, unfiltered yearly pull.
  const stranger = [...YEARLY_ROWS, { PMC_NAME: "Some Former Partner" }];
  const names = canonicalGroups(stranger).map(([n]) => n);
  assert.equal(names.includes("Some Former Partner"), false);
  assert.deepEqual(names, canonicalEntityNames);
});

// Keep ID_PATTERN referenced so the convention it documents is enforced, not just described.
test("emitted switcher ids all follow the documented ev_/ep_ convention", () => {
  const ids = Array.from(emittedIds(rendered.html));
  for (const id of ids) {
    assert.match(id, new RegExp(`^(ev|ep)_[a-z]+_${SLIDE_ID}$`), `${id} breaks the id convention`);
  }
  assert.ok(ID_PATTERN.test(rendered.html));
});

console.log(`exec-switcher-wiring: ${passed} tests passed`);
