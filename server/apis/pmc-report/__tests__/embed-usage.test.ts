/**
 * pullEmbedUsage - the data behind the prospect deck's Embed Activation slide (Clark port of
 * Flask prospect.pull_embed_usage), plus the two gaps this file was written to lock down:
 *
 *   1. The MSP-list lag. The Yardi / MRI / Zego embed property lists are monthly snapshots that
 *      trail the stats table by 2-4 months (live 2026-09-11: Yardi 2026-07-01, MRI / Zego
 *      2026-05-01 vs stats 2026-10-01). Flask anchors its list reads at the REPORTING month, so
 *      all three return zero rows and Flask silently drops its own embed slide for every Yardi /
 *      MRI / Zego prospect. Clark must anchor at the list's own MAX(month). The fake query layer
 *      below enforces that structurally: a list read that is NOT anchored at MAX(month) returns
 *      nothing, exactly as the warehouse does.
 *   2. The deck gate. No usage -> no slide, and no slide-id consumed.
 *
 * Live figures used as fixtures (Snowflake, Sep 2026 BP month, verified 2026-09-11):
 *   Harmoniq Residential  - AppFolio - 46 properties, 199 charged users, 152 bills paid
 *   Lindsey Management Co. Inc. - Yardi - 169 properties, 4,570 charged users, 3,865 bills paid
 *   The Dolben Company Inc     - MRI   -  76 properties,   511 charged users,   402 bills paid
 *
 * No test runner in this repo - run with:
 *   npx tsx server/apis/pmc-report/__tests__/embed-usage.test.ts
 */
import assert from "node:assert/strict";

import { embedMspFromPms, findEmbedNameCandidates, latestEmbedBpMonth, pullEmbedUsage } from "../embed.js";
import type { EmbedUsage } from "../embed.js";
import { renderEmbedActivation } from "../slides-prospect.js";
import type { Benchmarks, EmbedData, ProspectInfo } from "../slides-prospect.js";

let passed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed++;
    console.log(`ok - ${name}`);
  });
}

// ─── Fake query layer ───────────────────────────────────────────────────────────

const TODAY = new Date(2026, 8, 11); // 2026-09-11 -> reporting month 2026-09-01
const REPORTING_MONTH = "2026-09-01";

interface Call {
  sql: string;
  params: unknown[];
  label: string;
}

interface Fixture {
  /** Canonical source names the fuzzy search should find, best first. */
  names?: string[];
  /** property_public_id -> {charged_users, bills_paid} for the reporting month. */
  properties?: Record<string, { charged_users: number; bills_paid: number }>;
  /** SUM(unit_count) of the MSP list; null for AppFolio (no per-property units). */
  listUnitTotal?: number | null;
  /** Which MSP branch owns these rows (which RESOLVE_SQL call returns them). */
  msp?: string;
  /** Rows land in a month OTHER than the reporting month (staleness case). */
  statsMonth?: string;
}

function fakeSf(fx: Fixture) {
  const calls: Call[] = [];
  const names = fx.names ?? [];
  const props = fx.properties ?? {};
  const msp = fx.msp ?? "appfolio";
  const statsMonth = fx.statsMonth ?? REPORTING_MONTH;
  const client = {
    calls,
    async query(sql: string, schema: any, params?: unknown[], meta?: { label?: string }): Promise<any[]> {
      const label = meta?.label ?? "";
      calls.push({ sql, params: params ?? [], label });

      if (label.startsWith("Find embed PMC name")) {
        // Only this MSP's list has the name at all.
        if (!label.includes(`(${msp})`)) return [];
        // The warehouse truth: an MSP list read anchored anywhere but its own MAX(month) matches
        // no rows, because the newest snapshot predates the reporting month. AppFolio's
        // toggle_events is not a monthly snapshot and needs no anchor.
        if (msp !== "appfolio" && !sql.includes("(SELECT MAX(month) FROM")) return [];
        return names.map((n, i) => schema.parse({ NAME: n, UNITS: 1000 - i }));
      }

      if (label.startsWith("Resolve embed PMC")) {
        if (!label.includes(`(${msp})`)) return [];
        const picked = String((params ?? [])[0] ?? "");
        if (!names.some((n) => n.toUpperCase() === picked.toUpperCase())) return [];
        if (msp !== "appfolio" && !sql.includes("(SELECT MAX(month) FROM")) return [];
        return Object.keys(props).map((pid) => schema.parse({
          PMC_DISPLAY_NAME: picked,
          PROPERTY_PUBLIC_ID: pid,
          PROPERTY_NAME: pid,
          ADDRESS: "1 Main St",
          CITY: "Austin",
          STATE: "TX",
          ZIP: "78701",
          BILLER_ID: 1,
          INTEGRATION_NAME: msp,
          UNIT_COUNT: 120,
          LIST_UNIT_TOTAL: fx.listUnitTotal ?? null,
        }));
      }

      if (label.startsWith("Pull embed monthly activity")) {
        return Object.entries(props).map(([pid, v]) => schema.parse({
          BP_MONTH: statsMonth,
          PROPERTY_PUBLIC_ID: pid,
          CHARGED_USERS: v.charged_users,
          BILLS_PAID: v.bills_paid,
          RENT_PAID: 0,
        }));
      }

      throw new Error(`unexpected query label: ${label}`);
    },
  };
  return client;
}

/** n properties splitting `charged` users and `bills` bills across them. */
function spread(n: number, charged: number, bills: number): Record<string, { charged_users: number; bills_paid: number }> {
  const out: Record<string, { charged_users: number; bills_paid: number }> = {};
  for (let i = 0; i < n; i++) {
    out[`p${i}`] = {
      charged_users: Math.floor(charged / n) + (i < charged % n ? 1 : 0),
      bills_paid: Math.floor(bills / n) + (i < bills % n ? 1 : 0),
    };
  }
  return out;
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await test("embedMspFromPms maps Flask's four substring branches, null otherwise", () => {
    assert.equal(embedMspFromPms("Yardi Voyager"), "yardi");
    assert.equal(embedMspFromPms("AppFolio"), "appfolio");
    assert.equal(embedMspFromPms("appfolio property manager"), "appfolio");
    assert.equal(embedMspFromPms("MRI Software"), "mri");
    assert.equal(embedMspFromPms("Zego (PayLease)"), "zego");
    // Every PMS with no embed tables - Flask returns {} and the slide never renders.
    assert.equal(embedMspFromPms("Entrata"), null);
    assert.equal(embedMspFromPms("RealPage"), null);
    assert.equal(embedMspFromPms("ResMan"), null);
    assert.equal(embedMspFromPms(""), null);
    assert.equal(embedMspFromPms(null), null);
  });

  await test("reporting month is the latest completed BP month (Flask _bp_safe_cutoff - 1)", () => {
    assert.equal(latestEmbedBpMonth(TODAY), REPORTING_MONTH);
    // Day <= 5: the current month isn't closed, so the reporting month steps back one more.
    assert.equal(latestEmbedBpMonth(new Date(2026, 8, 3)), "2026-08-01");
  });

  await test("appfolio - Harmoniq Residential returns its live Sep 2026 figures", async () => {
    const sf = fakeSf({
      msp: "appfolio",
      names: ["Harmoniq Residential"],
      properties: spread(46, 199, 152),
      listUnitTotal: null,
    });
    const usage = await pullEmbedUsage(sf, "AppFolio", "Harmoniq Residential", TODAY);
    assert.ok(usage);
    const u = usage as EmbedUsage;
    assert.equal(u.pmc_name, "Harmoniq Residential");
    assert.equal(u.msp, "appfolio");
    assert.equal(u.property_count, 46);
    assert.equal(u.charged_users, 199);
    assert.equal(u.bills_paid, 152);
    // AppFolio has no per-property unit counts -> 0, which is what makes renderEmbedActivation
    // fall back to the prospect's own total units and relabel the rate accordingly.
    assert.equal(u.unit_count, 0);
    assert.equal(u.bp_month, REPORTING_MONTH);
  });

  await test("yardi - a list whose newest snapshot predates the reporting month STILL resolves", async () => {
    // This is the whole point: Flask's `month = %(bp_month)s` returns zero rows here, which is
    // why its own embed slide never renders for a Yardi prospect. The fake returns rows only for
    // a MAX(month)-anchored read.
    const sf = fakeSf({
      msp: "yardi",
      names: ["Lindsey Management Co. Inc."],
      properties: spread(169, 4570, 3865),
      listUnitTotal: 45216,
    });
    const usage = await pullEmbedUsage(sf, "Yardi Voyager", "Lindsey Management", TODAY);
    assert.ok(usage, "Yardi usage must resolve despite the 2-month list lag");
    const u = usage as EmbedUsage;
    assert.equal(u.msp, "yardi");
    assert.equal(u.property_count, 169);
    assert.equal(u.charged_users, 4570);
    assert.equal(u.bills_paid, 3865);
    assert.equal(u.unit_count, 45216);
  });

  await test("mri - same lag, same result", async () => {
    const sf = fakeSf({
      msp: "mri",
      names: ["The Dolben Company  Inc"],
      properties: spread(76, 511, 402),
      listUnitTotal: 16502,
    });
    const usage = await pullEmbedUsage(sf, "MRI", "Dolben", TODAY);
    assert.ok(usage);
    const u = usage as EmbedUsage;
    assert.equal(u.msp, "mri");
    assert.equal(u.property_count, 76);
    assert.equal(u.charged_users, 511);
    assert.equal(u.bills_paid, 402);
    assert.equal(u.unit_count, 16502);
  });

  await test("zego - same lag, same result", async () => {
    const sf = fakeSf({
      msp: "zego",
      names: ["Some Zego PMC"],
      properties: spread(12, 88, 71),
      listUnitTotal: 3400,
    });
    const usage = await pullEmbedUsage(sf, "Zego", "Some Zego", TODAY);
    assert.ok(usage);
    const u = usage as EmbedUsage;
    assert.equal(u.msp, "zego");
    assert.equal(u.property_count, 12);
    assert.equal(u.charged_users, 88);
    assert.equal(u.bills_paid, 71);
  });

  await test("every MSP-list read is anchored at MAX(month), never at the reporting month", async () => {
    for (const msp of ["yardi", "mri", "zego"]) {
      const sf = fakeSf({ msp, names: ["X Co"], properties: spread(2, 5, 4), listUnitTotal: 10 });
      await pullEmbedUsage(sf, msp, "X Co", TODAY);
      const listReads = sf.calls.filter((c) =>
        c.label.startsWith("Find embed PMC name") || c.label.startsWith("Resolve embed PMC"));
      assert.ok(listReads.length > 0, `${msp}: expected list reads`);
      for (const c of listReads) {
        if (!c.sql.includes("EMBED_PROPERTY_LIST")) continue;
        assert.ok(
          c.sql.includes("(SELECT MAX(month) FROM"),
          `${msp}: list read is not anchored at MAX(month):\n${c.sql}`,
        );
        assert.ok(
          !c.params.some((p) => String(p).startsWith(REPORTING_MONTH)),
          `${msp}: reporting month bound into a list read - that is Flask's bug`,
        );
      }
    }
  });

  await test("a name that matches nothing returns null (no slide)", async () => {
    const sf = fakeSf({ msp: "appfolio", names: [], properties: {} });
    assert.equal(await pullEmbedUsage(sf, "AppFolio", "Nobody Ltd", TODAY), null);
  });

  await test("a PMS with no embed tables never even queries", async () => {
    const sf = fakeSf({ msp: "appfolio", names: ["Entrata Co"], properties: spread(3, 9, 7) });
    assert.equal(await pullEmbedUsage(sf, "Entrata", "Entrata Co", TODAY), null);
    assert.equal(sf.calls.length, 0);
  });

  await test("resolves but has no billed residents this month -> null (no 0-resident slide)", async () => {
    const sf = fakeSf({
      msp: "appfolio",
      names: ["Quiet Co"],
      properties: { p0: { charged_users: 0, bills_paid: 0 } },
    });
    assert.equal(await pullEmbedUsage(sf, "AppFolio", "Quiet Co", TODAY), null);
  });

  await test("stats that land only in OTHER months are not counted as this month's activity", async () => {
    const sf = fakeSf({
      msp: "appfolio",
      names: ["Stale Co"],
      properties: spread(4, 40, 30),
      statsMonth: "2026-08-01",
    });
    assert.equal(await pullEmbedUsage(sf, "AppFolio", "Stale Co", TODAY), null);
  });

  await test("falls through to the next name candidate when the best one resolves to nothing", async () => {
    // Flask took a single LIMIT 1 candidate; Clark tries up to three. The fake only has
    // properties under the SECOND name, so a single-shot resolver would return null here.
    const sf = fakeSf({
      msp: "appfolio",
      names: ["Harmoniq Residential LLC", "Harmoniq Residential"],
      properties: spread(46, 199, 152),
    });
    // The fake's resolve branch returns rows for any name in `names`, so narrow it: make the
    // first candidate unresolvable by asking for a name only the second entry matches.
    const original = sf.query.bind(sf);
    sf.query = async (sql: string, schema: any, params?: unknown[], meta?: { label?: string }) => {
      if ((meta?.label ?? "").startsWith("Resolve embed PMC")
        && String((params ?? [])[0]) === "Harmoniq Residential LLC") {
        return [];
      }
      return original(sql, schema, params, meta);
    };
    const usage = await pullEmbedUsage(sf, "AppFolio", "Harmoniq", TODAY);
    assert.ok(usage);
    assert.equal((usage as EmbedUsage).pmc_name, "Harmoniq Residential");
  });

  await test("findEmbedNameCandidates drops junk names and ILIKE-wraps the prospect name", async () => {
    const sf = fakeSf({ msp: "appfolio", names: ['"', "-", "Harmoniq Residential"], properties: {} });
    const found = await findEmbedNameCandidates(sf, "appfolio", "Harmoniq");
    assert.deepEqual(found, ["Harmoniq Residential"]);
    assert.equal(sf.calls[0].params[0], "%Harmoniq%");
    // Unknown MSP: no query, no candidates.
    assert.deepEqual(await findEmbedNameCandidates(sf, "entrata", "Harmoniq"), []);
  });

  // ─── The deck gate ────────────────────────────────────────────────────────────
  // get-prospect-deck.ts renders the Embed Activation slide as:
  //     if (embedUsage) { slideId++; const s = renderEmbedActivation(slideId, embedUsage, ...) }
  // so absent usage costs neither a slide nor a slide id. Mirrored here so the contract is
  // covered by a test rather than only by the call site.
  function buildSlides(usage: EmbedData | null, prospect: ProspectInfo, benchmarks: Benchmarks) {
    const slides: { key: string; html: string }[] = [];
    let slideId = 1; // the cover
    if (usage) {
      slideId++;
      const r = renderEmbedActivation(slideId, usage, prospect, benchmarks);
      if (r.html) slides.push({ key: "embed", html: r.html });
    }
    slideId++; // peer_perf
    return { slides, nextSlideId: slideId };
  }

  const prospect: ProspectInfo = {
    name: "Harmoniq Residential", units: 3400, state: "TX", pms: "AppFolio", segment: "Mid Market",
    opp_stage: "Discovery", affordable: false, asset_subtypes: [], avg_rent: 1500, footprint: "TX",
  };
  const benchmarks = { median_nar: 0.056, prospect_units: 3400 } as unknown as Benchmarks;

  await test("deck gate - no usage means no embed slide and no slide id consumed", () => {
    const out = buildSlides(null, prospect, benchmarks);
    assert.equal(out.slides.length, 0);
    assert.equal(out.nextSlideId, 2, "peer_perf must still be slide 2 on a non-embed deck");
  });

  await test("deck gate - usage means the slide renders in Flask's position (right after cover)", () => {
    const usage: EmbedData = {
      pmc_name: "Harmoniq Residential", unit_count: 0, property_count: 46,
      charged_users: 199, bills_paid: 152, msp: "appfolio", bp_month: REPORTING_MONTH,
    };
    const out = buildSlides(usage, prospect, benchmarks);
    assert.equal(out.slides.length, 1);
    assert.equal(out.slides[0].key, "embed");
    assert.ok(out.slides[0].html.includes('id="slide-2"'), "embed slide must be slide 2");
    assert.equal(out.nextSlideId, 3, "peer_perf shifts to slide 3");
    // The prospect's own numbers, on the slide.
    assert.ok(out.slides[0].html.includes("AppFolio · CURRENT ACTIVITY"));
    assert.ok(out.slides[0].html.includes("199"));
    assert.ok(out.slides[0].html.includes("46"));
  });

  console.log(`\n${passed} tests passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
