/**
 * New Logo (prospect) peer-group logic regressions. No test runner in this repo - run with:
 *   npx tsx server/apis/pmc-report/__tests__/peer-logic.test.ts
 *
 * Covers the six Flask-parity defects fixed on feature/fix-peers:
 *   1. latestMonth() must be derived from the cutoff, not from today.
 *   2. The peer ramp-age floor (DATEADD('month', -3, ?)) is relative to latestMo, not cutoff.
 *   3. "New Paying Residents" reads pmc_new_residents, not the raw NEW_SIGNUPS_COUNT sum.
 *   4. median() is a true median (averages the two middle elements on an even-sized pool).
 *   5. Tier 3 runs established -> overlap swap -> footprint, and prints the footprint note.
 *   6. overlap_states counts states the peer has PROPERTIES in, not states with bills paid.
 */
import assert from "node:assert/strict";

import { latestMonth } from "../get-prospect-deck.js";
import { median, pullPeerBenchmark } from "../peer-benchmark.js";
import type { PeerBenchmarkInput } from "../peer-benchmark.js";

let passed = 0;
function test(name: string, fn: () => void | Promise<void>): void | Promise<void> {
  const done = () => { passed++; console.log(`ok - ${name}`); };
  const r = fn();
  if (r instanceof Promise) return r.then(done);
  done();
}

// ─── 1. latestMonth is cutoff - 1 month ─────────────────────────────────────

test("latestMonth is exactly cutoff minus one month", () => {
  assert.equal(latestMonth("2026-10-01"), "2026-09-01");
  assert.equal(latestMonth("2026-09-01"), "2026-08-01");
  assert.equal(latestMonth("2026-03-01"), "2026-02-01");
});

test("latestMonth crosses the year boundary", () => {
  assert.equal(latestMonth("2027-01-01"), "2026-12-01");
  assert.equal(latestMonth("2026-01-01"), "2025-12-01");
});

test("latestMonth does not depend on today's date", () => {
  // The bug: latestMonth() read `new Date()`, so after the 5th (when bpSafeCutoff rolls to the
  // following month) it returned cutoff - 2. Asserting a fixed input/output pair pins that shut.
  const cutoffs = ["2025-02-01", "2025-07-01", "2026-12-01"];
  const expected = ["2025-01-01", "2025-06-01", "2026-11-01"];
  cutoffs.forEach((c, i) => assert.equal(latestMonth(c), expected[i]));
});

// ─── 4. median on even-sized pools ──────────────────────────────────────────

test("median averages the two middle elements on an even-sized array", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([10, 20]), 15);
  // The real 14-peer Harmoniq months_live shape: Flask's pandas .median() gives 17.5, the old
  // hand-rolled sort(...)[floor(len/2)] gave 18 (the upper middle element).
  const monthsLive = [6, 9, 11, 13, 14, 16, 17, 18, 20, 22, 25, 28, 31, 40];
  assert.equal(monthsLive.length % 2, 0);
  assert.equal(median(monthsLive), 17.5);
  assert.notEqual(median(monthsLive), [...monthsLive].sort((a, b) => a - b)[monthsLive.length / 2]);
});

test("median on odd-sized and empty arrays", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([5]), 5);
  assert.equal(median([]), 0);
});

// ─── Fake Snowflake client for the cascade tests ────────────────────────────

interface Captured { sql: string; params: unknown[] }

function fakeSf(rows: any[], captured: Captured[]) {
  return {
    async query<T>(sql: string, _schema: unknown, params?: unknown[]): Promise<T[]> {
      captured.push({ sql, params: params ?? [] });
      return rows as unknown as T[];
    },
  };
}

const BASE_INPUT: PeerBenchmarkInput = {
  pms: "Appfolio", states: [], segment: "smb", affordable: false, mixed: false, isSfr: false,
  units: 1162, footprint: "single", avgRent: 0, cutoff: "2026-10-01", latestMo: "2026-09-01",
};

function peer(over: Record<string, any>): any {
  return {
    PMC_NAME: "Peer", TOTAL_UNITS: 1000, AVG_RENT: 1400, CURRENT_ADOPTION: 0.05,
    CURRENT_MONTHLY_RENT: 70000, NEW_SIGNUPS: 10, MONTHS_LIVE: 24, PMS: "Appfolio",
    PROPERTY_COUNT: 30, DQ_SHIELDED_MO: 0, PRIMARY_STATE: "CA", STATE_COUNT: 1,
    OVERLAP_PROPERTY_COUNT: 12, OVERLAP_ADOPTION_RATE: 0.05, OVERLAP_UNITS: 400,
    OVERLAP_MONTHLY_RENT: 20000, OVERLAP_AVG_RENT: 1400, OVERLAP_STATES: "CA",
    ...over,
  };
}

// ─── 2/3/6. The pool SQL and its params ─────────────────────────────────────

const sqlTests = (async () => {
  await test("ramp-age floor params are latestMo, not cutoff", async () => {
    const captured: Captured[] = [];
    await pullPeerBenchmark(
      fakeSf([peer({ PMC_NAME: "A" }), peer({ PMC_NAME: "B" }), peer({ PMC_NAME: "C" })], captured),
      { ...BASE_INPUT, states: ["CA", "WA"] },
    );
    const { params } = captured[0];
    // baseParams: [cutoff, latestMo, <ramp>, cutoff, latestMo, latestMo, latestMo, latestMo, latestMo]
    assert.equal(params[0], "2026-10-01", "pmc_qualified BP_MONTH < cutoff");
    assert.equal(params[1], "2026-09-01", "pmc_latest BP_MONTH = latestMo");
    assert.equal(params[2], "2026-09-01", "pmc_latest ramp floor is latestMo - 3, not cutoff - 3");
    assert.equal(params[3], "2026-10-01", "pmc_avg_rent BP_MONTH < cutoff");
    // overlapParams start right after the 9 base params: [latestMo, <ramp>, ...states, cutoff, ...states]
    assert.equal(params[9], "2026-09-01", "pmc_overlap_by_state BP_MONTH = latestMo");
    assert.equal(params[10], "2026-09-01", "overlap ramp floor is latestMo - 3, not cutoff - 3");
    assert.deepEqual(params.slice(11, 13), ["CA", "WA"]);
    assert.equal(params[13], "2026-10-01", "pmc_overlap_avg_rent BP_MONTH < cutoff");
  });

  await test("NEW_SIGNUPS is sourced from pmc_new_residents, not NEW_SIGNUPS_COUNT", async () => {
    const captured: Captured[] = [];
    await pullPeerBenchmark(fakeSf([peer({})], captured), BASE_INPUT);
    const { sql } = captured[0];
    assert.match(sql, /COALESCE\(nr\.new_residents, 0\) AS NEW_SIGNUPS/);
    assert.doesNotMatch(sql, /l\.new_signups/);
    assert.doesNotMatch(sql, /SUM\(t\.NEW_SIGNUPS_COUNT\)/);
    // The duplicate, dead NEW_RESIDENTS alias is gone - one column, correctly named.
    assert.doesNotMatch(sql, /AS NEW_RESIDENTS/);
  });

  await test("overlap_states is not gated on state-level bills paid", async () => {
    const captured: Captured[] = [];
    await pullPeerBenchmark(fakeSf([peer({})], captured), { ...BASE_INPUT, states: ["CA", "WA"] });
    const { sql } = captured[0];
    assert.match(sql, /LISTAGG\(PROPERTY_STATE, ', '\)/);
    assert.doesNotMatch(sql, /LISTAGG\(IFF\(state_bills_paid/);
    // The bills-paid floor still applies once, at PMC level.
    assert.match(sql, /HAVING SUM\(state_bills_paid\) > 0/);
  });

  // ─── 5. Tier 3 ordering + label ───────────────────────────────────────────

  await test("Tier 3 narrows to established peers BEFORE the footprint preference", async () => {
    // 3 established peers in a "multi" footprint bucket (STATE_COUNT 5) + 3 young peers in the
    // prospect's own "single" bucket. Flask's order (established first) keeps the established
    // three; the old footprint-first order kept the young three instead.
    const rows = [
      ...[1, 2, 3].map(i => peer({ PMC_NAME: `EST${i}`, MONTHS_LIVE: 24, STATE_COUNT: 5 })),
      ...[1, 2, 3].map(i => peer({ PMC_NAME: `YOUNG${i}`, MONTHS_LIVE: 6, STATE_COUNT: 1 })),
    ];
    const res = await pullPeerBenchmark(fakeSf(rows, []), { ...BASE_INPUT, states: ["CA"] });
    assert.equal(res.error, null);
    assert.deepEqual(res.peerPmcNames.sort(), ["EST1", "EST2", "EST3"]);
    // Established pool + "multi" peers against a "single" prospect -> no footprint note.
    assert.ok(!res.benchmarks.match_level.includes("footprint"), res.benchmarks.match_level);
  });

  await test("Tier 3 label appends the footprint note and comma-joins the states", async () => {
    // 4 established peers all in the prospect's own "single" bucket: established narrowing is a
    // no-op, the exact-bucket footprint preference holds, so Flask appends " & footprint".
    // Tier 1 is dodged by concentration 12/30 = 0.4 < 0.70; Tier 2 needs 6 peers, not 4.
    const rows = [1, 2, 3, 4].map(i =>
      peer({ PMC_NAME: `P${i}`, MONTHS_LIVE: 24, STATE_COUNT: 1, OVERLAP_STATES: "CA, WA" }));
    const res = await pullPeerBenchmark(fakeSf(rows, []), { ...BASE_INPUT, states: ["CA", "WA"] });
    assert.equal(res.error, null);
    assert.equal(res.benchmarks.match_mode, "overlap");
    assert.ok(
      res.benchmarks.match_level.startsWith("large presence in CA, WA & footprint"),
      `got: ${res.benchmarks.match_level}`,
    );
    // Flask joins with ", "; Clark used "/" here.
    assert.ok(!res.benchmarks.match_level.includes("CA/WA"), res.benchmarks.match_level);
  });
})();

sqlTests.then(() => {
  console.log(`\n${passed} tests passed`);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
