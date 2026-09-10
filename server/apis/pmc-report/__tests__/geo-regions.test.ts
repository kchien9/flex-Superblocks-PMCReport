/**
 * Fixture tests for geo-regions.ts - mirrors Flask tests/test_data.py (61facd0): the reference
 * frame is shaped after the live Sep 2026 numbers (the three CA rows carrying WA/CO ZIPs, WY's
 * Gillette/Laramie ZIPs inside the DENVER DMA, Morgantown WV inside PITTSBURGH, Valdosta GA inside
 * TALLAHASSEE, ...). No test runner in this repo - run with:
 *   npx tsx server/apis/pmc-report/__tests__/geo-regions.test.ts
 */
import assert from "node:assert/strict";

import {
  _resetGeoRefCache,
  applyGeoRules,
  buildGeoLookups,
  cachedNetworkZipGeo,
  zipPrefixPinsOtherState,
} from "../geo-regions.js";
import type { NetworkZipGeoRow, RegionDetailRawRow, RegionDetailRow } from "../geo-regions.js";

const geoRow = (state: string, region: string, zip5: string | null, props: number, units: number, bills: number): RegionDetailRawRow =>
  ({ PROPERTY_STATE: state, PROPERTY_REGION: region, ZIP5: zip5, PROPERTIES: props, TOTAL_UNITS: units, BILLS_PAID: bills });
const refRow = (zip5: string, state: string, dma: string | null, props: number): NetworkZipGeoRow =>
  ({ ZIP5: zip5, PROPERTY_STATE: state, DMA_NAME: dma, PROPERTIES: props });

const GEO_REFERENCE: NetworkZipGeoRow[] = [
  refRow("98528", "WA", "SEATTLE - TACOMA", 5), refRow("98528", "CA", "SEATTLE - TACOMA", 1),
  refRow("80246", "CO", "DENVER", 55), refRow("80246", "CA", "DENVER", 1),
  refRow("80513", "CO", "DENVER", 67), refRow("80513", "CA", "DENVER", 1),
  refRow("93546", "CA", "RENO", 31), refRow("89501", "NV", "RENO", 300),
  refRow("92243", "CA", "YUMA - EL CENTRO", 40), refRow("85364", "AZ", "YUMA - EL CENTRO", 46),
  refRow("90012", "CA", "LOS ANGELES", 500),
  // (CA, 960): CHICO - REDDING covers 20 of 25 seed-mapped props -> 96099 (not in seed) recovers to it.
  refRow("96001", "CA", "CHICO - REDDING", 20), refRow("96003", "CA", "SACRAMNTO-STKTON-MODESTO", 5),
  refRow("96099", "CA", null, 1),
  // (AK, 996): every seed-mapped neighbour is ANCHORAGE -> 99645 recovers. 99501 is a plain AK ZIP.
  refRow("99501", "AK", "ANCHORAGE", 40), refRow("99669", "AK", "ANCHORAGE", 3), refRow("99645", "AK", null, 2),
  refRow("82718", "WY", "DENVER", 108), refRow("82716", "WY", "DENVER", 72),
  refRow("80031", "CO", "DENVER", 10), refRow("80202", "CO", "DENVER", 5000),
  refRow("26505", "WV", "PITTSBURGH", 50), refRow("15201", "PA", "PITTSBURGH", 3000),
  refRow("31601", "GA", "TALLAHASSEE - THOMASVILLE", 1334), refRow("32301", "FL", "TALLAHASSEE - THOMASVILLE", 1551),
  refRow("98101", "WA", "SEATTLE - TACOMA", 2000),
  // MD has the most DC-DMA properties, but the DMA name says DC - the name wins.
  refRow("20850", "MD", "WASHINGTON, DC (HAGRSTWN)", 2600), refRow("20001", "DC", "WASHINGTON, DC (HAGRSTWN)", 1300),
  refRow("20105", "VA", "WASHINGTON, DC (HAGRSTWN)", 1),
  // 75001 is too rare (2 props) for the majority rule -> prefix table (750 = TX) is the tiebreaker.
  refRow("75001", "TX", "DALLAS - FT. WORTH", 1), refRow("75001", "OK", "DALLAS - FT. WORTH", 1),
  refRow("75201", "TX", "DALLAS - FT. WORTH", 500),
  // 72301: 5 props split 3 AR / 2 TN - a mixed ZIP is trusted, never second-guessed.
  refRow("72301", "AR", "MEMPHIS", 3), refRow("72301", "TN", "MEMPHIS", 2), refRow("38103", "TN", "MEMPHIS", 1000),
];

const GEO_DETAIL: RegionDetailRawRow[] = [
  geoRow("CA", "SEATTLE - TACOMA", "98528", 1, 100, 10),      // A: WA ZIP on a CA row -> Unknown
  geoRow("CA", "DENVER", "80246", 1, 60, 6),                  // A: CO ZIP -> Unknown
  geoRow("CA", "DENVER", "80513", 1, 40, 4),                  // A: CO ZIP -> Unknown
  geoRow("CA", "RENO", "93546", 1, 50, 5),                    // C: real CA ZIP in the NV-home RENO DMA
  geoRow("CA", "YUMA - EL CENTRO", "92243", 1, 40, 4),        // C: AZ-home DMA
  geoRow("CA", "Unknown", null, 1, 30, 3),                    // no ZIP at all -> stays Unknown
  geoRow("CA", "Unknown", "96099", 1, 20, 2),                 // B: seed gap -> CHICO - REDDING
  geoRow("CA", "LOS ANGELES", "90012", 2, 200, 20),
  geoRow("AK", "Unknown", "99645", 2, 80, 8),                 // B: seed gap -> ANCHORAGE
  geoRow("AK", "ANCHORAGE", "99501", 1, 50, 5),               // valid AK row - must NOT demote
  geoRow("WY", "DENVER", "82718", 3, 300, 30),                // C: WY ZIP, DENVER DMA -> kept, "(WY side)"
  geoRow("WY", "DENVER", "80031", 1, 10, 1),                  // A: CO ZIP on a WY row -> Unknown
  geoRow("WV", "PITTSBURGH", "26505", 2, 200, 20),            // C
  geoRow("GA", "TALLAHASSEE - THOMASVILLE", "31601", 2, 150, 15),  // C
  geoRow("WA", "SEATTLE - TACOMA", "98101", 3, 300, 30),      // home state -> plain label
  geoRow("MD", "WASHINGTON, DC (HAGRSTWN)", "20850", 1, 100, 10),  // C via the DMA name's ", DC"
  geoRow("VA", "WASHINGTON, DC (HAGRSTWN)", "20105", 1, 90, 9),    // rare ZIP, prefix 201 = VA -> trusted, "(VA side)"
  geoRow("TX", "DALLAS - FT. WORTH", "75001", 1, 100, 10),    // rare ZIP, prefix agrees -> kept
  geoRow("OK", "DALLAS - FT. WORTH", "75001", 1, 100, 10),    // rare ZIP, prefix 750 = TX only -> Unknown
  geoRow("AR", "MEMPHIS", "72301", 1, 100, 10),               // mixed ZIP -> trusted, "(AR side)"
];

const result = applyGeoRules(GEO_DETAIL, buildGeoLookups(GEO_REFERENCE));
const byState = (st: string) => result.filter((r) => r.PROPERTY_STATE === st);
const get = (st: string, region: string): RegionDetailRow => {
  const row = result.find((r) => r.PROPERTY_STATE === st && r.PROPERTY_REGION === region);
  assert.ok(row, `missing (${st}, ${region})`);
  return row;
};
const regions = (st: string) => new Set(byState(st).map((r) => r.PROPERTY_REGION));

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

test("output contract: one row per (state, region), ZIP5 never reaches the consumers", () => {
  const keys = result.map((r) => `${r.PROPERTY_STATE}|${r.PROPERTY_REGION}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const r of result) {
    assert.deepEqual(Object.keys(r).sort(), ["BILLS_PAID", "DISPLAY_REGION", "PROPERTIES", "PROPERTY_REGION", "PROPERTY_STATE", "TOTAL_UNITS"]);
  }
});

test("rule A demotes only when the network majority puts the ZIP in another state", () => {
  assert.deepEqual(regions("CA"), new Set(["Unknown", "RENO", "YUMA - EL CENTRO", "LOS ANGELES", "CHICO - REDDING"]));
  // Seattle + Denver x2 + the no-ZIP row fold into one Unknown row (98528 is 5/6 WA, 802xx/805xx ~98% CO).
  assert.equal(get("CA", "Unknown").PROPERTIES, 4);
  assert.equal(get("CA", "Unknown").TOTAL_UNITS, 230);
  assert.equal(get("CA", "Unknown").BILLS_PAID, 23);
  assert.equal(get("CA", "LOS ANGELES").TOTAL_UNITS, 200);
  // A genuine AK ZIP under an AK property is never demoted.
  assert.deepEqual(byState("AK").map((r) => r.PROPERTY_REGION), ["ANCHORAGE"]);
  // WY: the 82xxx Denver-DMA rows stay; the lone CO ZIP (80031, 10 CO props) is demoted.
  assert.equal(get("WY", "DENVER").PROPERTIES, 3);
  assert.equal(get("WY", "DENVER").TOTAL_UNITS, 300);
  assert.equal(get("WY", "Unknown").PROPERTIES, 1);
  assert.equal(get("WY", "Unknown").TOTAL_UNITS, 10);
  // A mixed ZIP (3 AR / 2 TN) is trusted, not demoted.
  assert.deepEqual(byState("AR").map((r) => r.PROPERTY_REGION), ["MEMPHIS"]);
});

test("rule A: prefix table is the tiebreaker only for rare ZIPs", () => {
  // 75001 has 2 network props (below GEO_ZIP_MIN_PROPS): the prefix table decides - 750 is TX only.
  assert.deepEqual(byState("TX").map((r) => r.PROPERTY_REGION), ["DALLAS - FT. WORTH"]);
  assert.deepEqual(byState("OK").map((r) => r.PROPERTY_REGION), ["Unknown"]);
  // 20105 has 1 network prop and prefix 201 = VA: agrees, so trusted.
  assert.deepEqual(byState("VA").map((r) => r.PROPERTY_REGION), ["WASHINGTON, DC (HAGRSTWN)"]);
});

test("rule B recovers a seed-gap ZIP from same-state prefix neighbours", () => {
  // 96099 isn't in the DMA seed; 20 of 25 seed-mapped (CA, 960) props are CHICO - REDDING (>= 0.6).
  assert.equal(get("CA", "CHICO - REDDING").PROPERTIES, 1);
  assert.equal(get("CA", "CHICO - REDDING").TOTAL_UNITS, 20);
  assert.equal(get("CA", "CHICO - REDDING").DISPLAY_REGION, "CHICO - REDDING"); // labelled like any DMA
  // 99645 (AK, seed gap) joins the existing ANCHORAGE row: 1 + 2 props, 50 + 80 units.
  assert.equal(get("AK", "ANCHORAGE").PROPERTIES, 3);
  assert.equal(get("AK", "ANCHORAGE").TOTAL_UNITS, 130);
  assert.ok(!regions("AK").has("Unknown"));
});

test("rule B does not recover when prefix neighbours are split", () => {
  const ref = [refRow("96001", "CA", "CHICO - REDDING", 5), refRow("96003", "CA", "SACRAMNTO-STKTON-MODESTO", 5), refRow("96099", "CA", null, 1)];
  const rows = [geoRow("CA", "Unknown", "96099", 1, 20, 2), geoRow("CA", "LOS ANGELES", "90012", 1, 10, 1)];
  const out = applyGeoRules(rows, buildGeoLookups(ref));
  const unk = out.find((r) => r.PROPERTY_REGION === "Unknown");
  assert.equal(unk?.PROPERTIES, 1); // 50/50 split < 0.6 -> stays Unknown
});

test("rule C labels cross-state DMAs with the state side", () => {
  const labels = new Map(result.map((r) => [`${r.PROPERTY_STATE}|${r.PROPERTY_REGION}`, r.DISPLAY_REGION]));
  assert.equal(labels.get("WY|DENVER"), "DENVER (WY side)");
  assert.equal(labels.get("WV|PITTSBURGH"), "PITTSBURGH (WV side)");
  assert.equal(labels.get("GA|TALLAHASSEE - THOMASVILLE"), "TALLAHASSEE - THOMASVILLE (GA side)");
  assert.equal(labels.get("CA|RENO"), "RENO (CA side)");
  assert.equal(labels.get("CA|YUMA - EL CENTRO"), "YUMA - EL CENTRO (CA side)");
  assert.equal(labels.get("AR|MEMPHIS"), "MEMPHIS (AR side)");
  // Home-state rows and Unknown print as-is.
  assert.equal(labels.get("WA|SEATTLE - TACOMA"), "SEATTLE - TACOMA");
  assert.equal(labels.get("CA|LOS ANGELES"), "LOS ANGELES");
  assert.equal(labels.get("CA|Unknown"), "Unknown");
  // The DMA name's own ", DC" beats MD's property-count majority.
  assert.equal(labels.get("MD|WASHINGTON, DC (HAGRSTWN)"), "WASHINGTON, DC (HAGRSTWN) (MD side)");
  assert.equal(labels.get("VA|WASHINGTON, DC (HAGRSTWN)"), "WASHINGTON, DC (HAGRSTWN) (VA side)");
});

test("degrade path: empty reference -> prefix-table tiebreaker only, nothing dropped, no labels", () => {
  const rows = [
    geoRow("CA", "SEATTLE - TACOMA", "98528", 1, 100, 10),
    geoRow("CA", "RENO", "93546", 1, 50, 5),
    geoRow("WY", "DENVER", "82718", 3, 300, 30),
  ];
  const out = applyGeoRules(rows, buildGeoLookups([]));
  const keys = new Set(out.map((r) => `${r.PROPERTY_STATE}|${r.PROPERTY_REGION}`));
  assert.deepEqual(keys, new Set(["CA|Unknown", "CA|RENO", "WY|DENVER"]));
  assert.equal(out.find((r) => r.PROPERTY_REGION === "DENVER")?.DISPLAY_REGION, "DENVER"); // no home-state knowledge -> no label
  assert.equal(out.reduce((s, r) => s + r.TOTAL_UNITS, 0), 450);
});

test("buildGeoLookups: shapes, trimming/uppercasing, DC-name override", () => {
  const lk = buildGeoLookups([
    { ZIP5: "98528", PROPERTY_STATE: "wa ", DMA_NAME: "SEATTLE - TACOMA", PROPERTIES: 5 },
    { ZIP5: "98528", PROPERTY_STATE: "CA", DMA_NAME: "SEATTLE - TACOMA", PROPERTIES: 1 },
    { ZIP5: "96099", PROPERTY_STATE: "CA", DMA_NAME: null, PROPERTIES: 1 },
    { ZIP5: "96001", PROPERTY_STATE: "CA", DMA_NAME: "CHICO - REDDING", PROPERTIES: 3 },
    { ZIP5: "20850", PROPERTY_STATE: "MD", DMA_NAME: "WASHINGTON, DC (HAGRSTWN)", PROPERTIES: 9 },
    { ZIP5: "20001", PROPERTY_STATE: "DC", DMA_NAME: "WASHINGTON, DC (HAGRSTWN)", PROPERTIES: 1 },
  ]);
  const zs = lk.zipState.get("98528");
  assert.equal(zs?.modal, "WA");
  assert.equal(zs?.n, 6);
  assert.ok(Math.abs((zs?.share ?? 0) - 5 / 6) < 1e-9);
  // Seed-gap rows don't count toward the prefix -> DMA share (only seed-mapped props do).
  assert.deepEqual(lk.prefixDma.get("CA|960"), { dma: "CHICO - REDDING", share: 1 });
  assert.equal(lk.dmaHome.get("WASHINGTON, DC (HAGRSTWN)"), "DC");
  assert.equal(lk.dmaHome.get("SEATTLE - TACOMA"), "WA");
  assert.deepEqual(buildGeoLookups([]), { zipState: new Map(), prefixDma: new Map(), dmaHome: new Map() });
});

test("zipPrefixPinsOtherState: single-state prefixes only", () => {
  assert.equal(zipPrefixPinsOtherState("98528", "CA"), true);   // WA ZIP under a CA property
  assert.equal(zipPrefixPinsOtherState("80246", "CA"), true);   // CO ZIP
  assert.equal(zipPrefixPinsOtherState("96150", "CA"), false);  // Reno DMA but a real CA ZIP
  assert.equal(zipPrefixPinsOtherState("20001", "DC"), false);  // shared prefix (DC/VA) never demotes
  assert.equal(zipPrefixPinsOtherState("20001", "MD"), false);
  assert.equal(zipPrefixPinsOtherState("73301", "TX"), false);  // Austin carve-out inside OK's range
  assert.equal(zipPrefixPinsOtherState("ca", "CA"), false);     // unrecognised prefix -> no opinion
  assert.equal(zipPrefixPinsOtherState("00701", "PR"), false);  // territories not mapped -> no opinion
  assert.equal(zipPrefixPinsOtherState(null, "CA"), false);
  assert.equal(zipPrefixPinsOtherState("98528", null), false);
});

await (async () => {
  _resetGeoRefCache();
  let calls = 0;
  const load = async () => { calls++; return [refRow("98101", "WA", "SEATTLE - TACOMA", 3)]; };
  let t = 0;
  const now = () => t;
  const first = await cachedNetworkZipGeo("2026-06-01", load, now);
  const again = await cachedNetworkZipGeo("2026-06-01", load, now);
  assert.equal(again, first);
  assert.equal(calls, 1);
  await cachedNetworkZipGeo("2026-07-01", load, now);
  assert.equal(calls, 2); // a different month is its own entry
  t = 7 * 3600 * 1000;
  await cachedNetworkZipGeo("2026-06-01", load, now);
  assert.equal(calls, 3); // expired after the TTL
  passed++;
  console.log("ok - cachedNetworkZipGeo caches per month with a TTL");
})();

console.log(`\n${passed} geo-regions tests passed`);
