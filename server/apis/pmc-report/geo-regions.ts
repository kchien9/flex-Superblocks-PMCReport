/**
 * Geographic Breakdown ("By State" slide) region drill-down hygiene - Clark mirror of Flask's
 * generator/data.py `_apply_geo_rules` / `_build_geo_lookups` / `pull_network_zip_geo`
 * (commit 61facd0, which superseded the prefix-table-only rule of f7d95a6).
 *
 * The regionDetail query groups by the stats table's PROPERTY_STATE but derives the DMA from the
 * property's ZIP (SEED_ZIP_CODE_TO_DMA_MAPPING). Three things go wrong with that, and each rule
 * below handles one - all against a NETWORK-WIDE reference (every in-network property at the
 * same month, all PMCs, counted by (ZIP5, PROPERTY_STATE, DMA)):
 *
 *   A. Demote: DMA -> 'Unknown' when the ZIP's network majority (>= GEO_ZIP_MIN_PROPS properties,
 *      >= GEO_ZIP_MODAL_SHARE of them in one state) puts the ZIP in a different state than
 *      PROPERTY_STATE (98528 / 80246 / 80513 under CA - a WA/CO ZIP on a CA row). Rare ZIPs fall
 *      back to the USPS prefix table ONLY when the prefix maps to exactly one state; a mixed ZIP
 *      (enough properties, split states) is trusted outright, never second-guessed.
 *   B. Recover: an 'Unknown' whose ZIP the DMA seed simply lacks takes the modal DMA of the other
 *      seed-mapped properties in the same (state, 3-digit prefix) when that DMA covers
 *      >= GEO_PREFIX_DMA_SHARE of them. Labelled like any DMA - it's the best estimate.
 *   C. Label: DISPLAY_REGION = 'DMA (XX side)' when the DMA's home state (modal state of its
 *      network properties, unless the DMA name carries its own ', XX' - WASHINGTON, DC) isn't the
 *      property's (PITTSBURGH (WV side), DENVER (WY side), TALLAHASSEE - THOMASVILLE (GA side)).
 *      Display only: grouping, sort and the tie to the snapshot's state totals are unchanged.
 *
 * Never "let the DMA pick the state" - that would break the tie to the state totals, which come
 * from PROPERTY_STATE. Reference query failure degrades to the prefix-table tiebreaker only and
 * never drops rows.
 *
 * Pure functions, no Snowflake - unit-testable in isolation (see __tests__/geo-regions.test.ts).
 * Flask is the reference; thresholds and the prefix table are copied from it verbatim.
 */

// USPS 3-digit ZIP prefix -> state(s). TIEBREAKER ONLY for rule A: consulted just for a ZIP too
// rare in the network (< GEO_ZIP_MIN_PROPS properties) for the data-derived majority rule to have
// an opinion, and only when the prefix maps to exactly one state. Ranges are inclusive; a prefix
// listed under two states (200 = DC and VA) is ambiguous and never demotes. Prefixes not listed
// (PR/VI/GU, military, unassigned) are "no opinion".
const ZIP3_STATE_RANGES: readonly (readonly [string, string, string])[] = [
  ["005", "005", "NY"], ["010", "027", "MA"], ["028", "029", "RI"], ["030", "038", "NH"],
  ["039", "049", "ME"], ["050", "059", "VT"], ["060", "069", "CT"], ["070", "089", "NJ"],
  ["100", "149", "NY"], ["150", "196", "PA"], ["197", "199", "DE"], ["200", "200", "DC"],
  ["200", "201", "VA"], ["202", "205", "DC"], ["206", "219", "MD"], ["220", "246", "VA"],
  ["247", "268", "WV"], ["270", "289", "NC"], ["290", "299", "SC"], ["300", "319", "GA"],
  ["320", "339", "FL"], ["341", "342", "FL"], ["344", "344", "FL"], ["346", "347", "FL"],
  ["349", "349", "FL"], ["350", "369", "AL"], ["370", "385", "TN"], ["386", "397", "MS"],
  ["398", "399", "GA"], ["400", "427", "KY"], ["430", "459", "OH"], ["460", "479", "IN"],
  ["480", "499", "MI"], ["500", "528", "IA"], ["530", "549", "WI"], ["550", "567", "MN"],
  ["570", "577", "SD"], ["580", "588", "ND"], ["590", "599", "MT"], ["600", "629", "IL"],
  ["630", "658", "MO"], ["660", "679", "KS"], ["680", "693", "NE"], ["700", "714", "LA"],
  ["716", "729", "AR"], ["730", "732", "OK"], ["733", "733", "TX"], ["734", "749", "OK"],
  ["750", "799", "TX"], ["800", "816", "CO"], ["820", "831", "WY"], ["832", "838", "ID"],
  ["840", "847", "UT"], ["850", "865", "AZ"], ["870", "884", "NM"], ["885", "885", "TX"],
  ["889", "898", "NV"], ["900", "961", "CA"], ["967", "968", "HI"], ["970", "979", "OR"],
  ["980", "994", "WA"], ["995", "999", "AK"],
];

export const ZIP3_PREFIX_STATES: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const m = new Map<string, Set<string>>();
  for (const [lo, hi, st] of ZIP3_STATE_RANGES) {
    for (let n = Number(lo); n <= Number(hi); n++) {
      const k = String(n).padStart(3, "0");
      const set = m.get(k) ?? new Set<string>();
      set.add(st);
      m.set(k, set);
    }
  }
  return m;
})();

const US_STATE_CODES: ReadonlySet<string> = new Set(ZIP3_STATE_RANGES.map((r) => r[2]));
// "WASHINGTON, DC (HAGRSTWN)", "COLUMBIA, SC", "PORTLAND, OR": the DMA name itself says which
// state it belongs to - that beats a network-majority guess (MD has more DC-DMA properties than
// DC does, which would otherwise label every DC property "(DC side)").
const DMA_NAME_STATE_RE = /,\s*([A-Z]{2})\b/;

// Thresholds for the data-derived geo rules (Flask _GEO_* constants, live-tuned 2026-09-10).
/** A ZIP5 needs this many network properties before its majority state is trusted. */
export const GEO_ZIP_MIN_PROPS = 3;
/** ...and that majority must be this decisive (98528: 5 of 6 are WA -> 0.83). */
export const GEO_ZIP_MODAL_SHARE = 0.8;
/** (state, zip3) -> DMA fallback needs this share of the prefix's seed-mapped properties. */
export const GEO_PREFIX_DMA_SHARE = 0.6;
/** The network-wide reference is one aggregate per month; reuse it across reports (Flask _GEO_REF_TTL_S). */
export const GEO_REF_TTL_MS = 6 * 3600 * 1000;

/** True only when the ZIP's first 3 digits map to exactly one state and it isn't `state`.
 *
 * Missing/unrecognised prefix, a prefix shared by two states (200 = DC/VA) or a missing state
 * -> false: with no unambiguous evidence we never take a DMA away from a property. */
export function zipPrefixPinsOtherState(zip5: string | null | undefined, state: string | null | undefined): boolean {
  if (zip5 == null || state == null) return false;
  const allowed = ZIP3_PREFIX_STATES.get(String(zip5).trim().slice(0, 3));
  if (!allowed || allowed.size !== 1) return false;
  return !allowed.has(String(state).trim().toUpperCase());
}

/** The frame the By State drill-down (and every other regionDetail consumer) reads. One row per
 * (PROPERTY_STATE, PROPERTY_REGION); DISPLAY_REGION is the label to print (rule C) while
 * PROPERTY_REGION stays the grouping / 'Unknown' key. */
export interface RegionDetailRow {
  PROPERTY_STATE: string;
  PROPERTY_REGION: string;
  DISPLAY_REGION: string;
  PROPERTIES: number;
  TOTAL_UNITS: number;
  BILLS_PAID: number;
}

/** What the regionDetail query returns now that LEFT(PROPERTY_ZIP, 5) rides along in the
 * GROUP BY - ZIP5 does not survive applyGeoRules. */
export interface RegionDetailRawRow {
  PROPERTY_STATE: string;
  PROPERTY_REGION: string;
  ZIP5: string | null;
  PROPERTIES: number;
  TOTAL_UNITS: number;
  BILLS_PAID: number;
}

/** One row of the network-wide reference (Flask pull_network_zip_geo): every in-network property
 * at the month, ALL PMCs, counted by (ZIP5, PROPERTY_STATE, DMA-or-NULL). */
export interface NetworkZipGeoRow {
  ZIP5: string | null;
  PROPERTY_STATE: string | null;
  /** null when the ZIP isn't in SEED_ZIP_CODE_TO_DMA_MAPPING. */
  DMA_NAME: string | null;
  PROPERTIES: number;
}

export const UNKNOWN_REGION = "Unknown";

export interface GeoLookups {
  /** zip5 -> modal state, network property count, modal share (rule A). */
  zipState: Map<string, { modal: string; n: number; share: number }>;
  /** "STATE|zip3" -> modal DMA + its share over seed-mapped properties only (rule B). */
  prefixDma: Map<string, { dma: string; share: number }>;
  /** dma_name -> home state (modal PROPERTY_STATE of the DMA's network properties, unless the
   * DMA name carries its own ", XX") (rule C). */
  dmaHome: Map<string, string>;
}

const prefixKey = (state: string, zip3: string) => `${state}|${zip3}`;

/** Pick the (key -> count) winner: highest count, ties broken by the alphabetically-first key so
 * the lookups are deterministic run to run (Flask sorts [count desc, key asc]). */
function modal(counts: Map<string, number>): { key: string; count: number; total: number } | null {
  let best: { key: string; count: number } | null = null;
  let total = 0;
  for (const [key, count] of counts) {
    total += count;
    if (!best || count > best.count || (count === best.count && key < best.key)) best = { key, count };
  }
  return best ? { ...best, total } : null;
}

/** Turn the network-wide reference into the three lookups applyGeoRules needs. Empty/absent
 * reference -> three empty maps (every rule then trusts the row as-is, bar the prefix-table
 * tiebreaker). Mirrors Flask _build_geo_lookups. */
export function buildGeoLookups(ref: readonly NetworkZipGeoRow[] | null | undefined): GeoLookups {
  const out: GeoLookups = { zipState: new Map(), prefixDma: new Map(), dmaHome: new Map() };
  if (!ref || ref.length === 0) return out;
  const rows = ref
    .map((r) => ({
      zip5: r.ZIP5 == null ? "" : String(r.ZIP5).trim(),
      state: r.PROPERTY_STATE == null ? "" : String(r.PROPERTY_STATE).trim().toUpperCase(),
      dma: r.DMA_NAME,
      props: Number(r.PROPERTIES) || 0,
    }))
    .filter((r) => r.zip5 !== "" && r.state !== "");
  if (rows.length === 0) return out;

  // zip_state: zip5 -> (modal state, n props, share)
  const byZip = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = byZip.get(r.zip5) ?? new Map<string, number>();
    m.set(r.state, (m.get(r.state) ?? 0) + r.props);
    byZip.set(r.zip5, m);
  }
  for (const [zip5, m] of byZip) {
    const top = modal(m);
    if (top && top.total > 0) out.zipState.set(zip5, { modal: top.key, n: top.total, share: top.count / top.total });
  }

  const mapped = rows.filter((r) => r.dma != null);
  if (mapped.length === 0) return out;

  // prefix_dma: (state, zip3) -> (modal DMA, share) over seed-mapped properties only
  const byPrefix = new Map<string, Map<string, number>>();
  for (const r of mapped) {
    const k = prefixKey(r.state, r.zip5.slice(0, 3));
    const m = byPrefix.get(k) ?? new Map<string, number>();
    m.set(r.dma as string, (m.get(r.dma as string) ?? 0) + r.props);
    byPrefix.set(k, m);
  }
  for (const [k, m] of byPrefix) {
    const top = modal(m);
    if (top && top.total > 0) out.prefixDma.set(k, { dma: top.key, share: top.count / top.total });
  }

  // dma_home: dma -> home state (name's ", XX" wins over the property-count majority)
  const byDma = new Map<string, Map<string, number>>();
  for (const r of mapped) {
    const m = byDma.get(r.dma as string) ?? new Map<string, number>();
    m.set(r.state, (m.get(r.state) ?? 0) + r.props);
    byDma.set(r.dma as string, m);
  }
  for (const [dma, m] of byDma) {
    const top = modal(m);
    if (!top) continue;
    const match = DMA_NAME_STATE_RE.exec(dma);
    out.dmaHome.set(dma, match && US_STATE_CODES.has(match[1]) ? match[1] : top.key);
  }
  return out;
}

/** Rule A: the ZIP's network majority (>= GEO_ZIP_MIN_PROPS properties, >= GEO_ZIP_MODAL_SHARE of
 * them in one state) says a different state than the property's. A ZIP with enough properties
 * but a mixed state split is trusted outright - never second-guessed by the prefix table. The
 * prefix table is the tiebreaker only for ZIPs the network barely knows. */
export function zipDisagreesWithState(zip5: string, state: string, zipState: GeoLookups["zipState"]): boolean {
  const hit = zipState.get(zip5);
  if (hit && hit.n >= GEO_ZIP_MIN_PROPS) return hit.share >= GEO_ZIP_MODAL_SHARE && hit.modal !== state;
  return zipPrefixPinsOtherState(zip5, state);
}

function resolveRegion(region: string, zip5: string | null, state: string, lookups: GeoLookups): string {
  const z = zip5 == null ? "" : String(zip5).trim();
  const st = state == null ? "" : String(state).trim().toUpperCase();
  if (!z || !st) return region;
  if (region !== UNKNOWN_REGION && zipDisagreesWithState(z, st, lookups.zipState)) return UNKNOWN_REGION; // rule A
  if (region === UNKNOWN_REGION && !zipDisagreesWithState(z, st, lookups.zipState)) {
    const hit = lookups.prefixDma.get(prefixKey(st, z.slice(0, 3)));
    if (hit && hit.share >= GEO_PREFIX_DMA_SHARE) return hit.dma; // rule B
  }
  return region;
}

/** Rule C label: "DMA (XX side)" when the DMA's home state isn't the property's. */
export function displayRegion(region: string, state: string, dmaHome: GeoLookups["dmaHome"]): string {
  if (region === UNKNOWN_REGION) return region;
  const home = dmaHome.get(region);
  const st = state == null ? "" : String(state).trim().toUpperCase();
  if (home && st && home !== st) return `${region} (${st} side)`;
  return region;
}

/** Post-query step for the regionDetail query over its (state, DMA, ZIP5) rows: rules A/B move
 * the region bucket, everything is re-aggregated to one row per (PROPERTY_STATE, PROPERTY_REGION)
 * and rule C sets DISPLAY_REGION. Output keeps the query's ORDER BY contract (state asc,
 * BILLS_PAID desc). State totals live elsewhere (latestRows) and are untouched. */
export function applyGeoRules(rows: readonly RegionDetailRawRow[], lookups: GeoLookups): RegionDetailRow[] {
  const agg = new Map<string, RegionDetailRow>();
  for (const r of rows) {
    const region = resolveRegion(r.PROPERTY_REGION, r.ZIP5, r.PROPERTY_STATE, lookups);
    const key = JSON.stringify([r.PROPERTY_STATE, region]);
    const cur = agg.get(key);
    if (cur) {
      cur.PROPERTIES += r.PROPERTIES;
      cur.TOTAL_UNITS += r.TOTAL_UNITS;
      cur.BILLS_PAID += r.BILLS_PAID;
    } else {
      agg.set(key, {
        PROPERTY_STATE: r.PROPERTY_STATE,
        PROPERTY_REGION: region,
        DISPLAY_REGION: region,
        PROPERTIES: r.PROPERTIES,
        TOTAL_UNITS: r.TOTAL_UNITS,
        BILLS_PAID: r.BILLS_PAID,
      });
    }
  }
  const out = Array.from(agg.values());
  for (const row of out) row.DISPLAY_REGION = displayRegion(row.PROPERTY_REGION, row.PROPERTY_STATE, lookups.dmaHome);
  return out.sort((a, b) =>
    a.PROPERTY_STATE < b.PROPERTY_STATE ? -1 : a.PROPERTY_STATE > b.PROPERTY_STATE ? 1 : b.BILLS_PAID - a.BILLS_PAID
  );
}

// Per-month cache for the network-wide reference (Flask _GEO_REF_CACHE): it's the same frame for
// every report of that month, so a process serves many decks off one query. Keyed by the month
// string; a failed load is not cached (the caller degrades to the prefix tiebreaker for that deck).
const geoRefCache = new Map<string, { at: number; rows: NetworkZipGeoRow[] }>();

export async function cachedNetworkZipGeo(
  month: string,
  load: () => Promise<NetworkZipGeoRow[]>,
  now: () => number = Date.now,
): Promise<NetworkZipGeoRow[]> {
  const hit = geoRefCache.get(month);
  if (hit && now() - hit.at < GEO_REF_TTL_MS) return hit.rows;
  const rows = await load();
  geoRefCache.set(month, { at: now(), rows });
  return rows;
}

/** Test hook - clears the per-month reference cache. */
export function _resetGeoRefCache(): void {
  geoRefCache.clear();
}
