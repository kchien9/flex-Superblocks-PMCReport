/**
 * Peer benchmark pool + 5-tier cascade matching, and the Platinum (DI + marketing opt-in)
 * comparator - Clark's port of Flask `generator/prospect.pull_peer_benchmark` /
 * `pull_peer_platinum_rate` (e138728).
 *
 * Lifted verbatim out of get-prospect-deck.ts's `run()` (no logic change) so the Embed deck can
 * reuse the exact same pool, medians and Platinum rate the New Logo deck shows - Flask shares one
 * `pull_peer_benchmark` between both decks, and duplicating the cascade would have let the two
 * drift. GetProspectDeck now calls these two functions; everything downstream of them there
 * (peer trend / cohort / ramp / rent-distribution pulls, renderers) is unchanged.
 */

import { z } from "@superblocksteam/sdk-api";
import { STATE_TO_REGION } from "./peer-matching.js";
import type { Benchmarks } from "./slides-prospect.js";

const TBL = "PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS";

interface SnowflakeClient {
  query<T>(sql: string, schema: z.ZodType<T>, params?: unknown[], meta?: { label?: string }): Promise<T[]>;
}

/** ctx.log's shape, narrowed to what this module uses (optional so tests can omit it). */
export interface PeerBenchmarkLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const PeerBenchmarkRow = z.object({
  PMC_NAME: z.string(),
  TOTAL_UNITS: z.coerce.number(),
  AVG_RENT: z.coerce.number().nullable(),
  CURRENT_ADOPTION: z.coerce.number(),
  CURRENT_MONTHLY_RENT: z.coerce.number(),
  NEW_SIGNUPS: z.coerce.number(),
  MONTHS_LIVE: z.coerce.number(),
  PMS: z.string().nullable(),
  PROPERTY_COUNT: z.coerce.number(),
  DQ_SHIELDED_MO: z.coerce.number().nullable(),
  PRIMARY_STATE: z.string().nullable(),
  STATE_COUNT: z.coerce.number(),
  NEW_RESIDENTS: z.coerce.number().nullable(),
});

export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function quantile(arr: number[], q: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export interface PeerBenchmarkInput {
  /** Prospect / subject attributes - the same values Flask's pull_peer_benchmark takes. */
  pms: string;
  states: string[];
  segment: string;
  affordable: boolean;
  mixed: boolean;
  isSfr: boolean;
  units: number;
  footprint: string;
  avgRent: number;
  /** bp_safe_cutoff() and the latest completed BP month, computed by the caller. */
  cutoff: string;
  latestMo: string;
}

export interface PeerBenchmarkResult {
  /** The matched peer rows (overlap-scoped columns already swapped in for tiers 1-3). */
  pool: any[];
  peerPmcNames: string[];
  benchmarks: Benchmarks;
  /** The rent-band HAVING fragment the caller's follow-up peer queries re-use. */
  rentFilter: string;
  /** Non-null when no pool could be built - the caller decides what to return to the client. */
  error: string | null;
}

const EMPTY_BENCHMARKS: Benchmarks = {
  median_nar: 0, avg_nar: 0, pool_size: 0, match_level: "none", match_mode: "portfolio",
} as Benchmarks;

/**
 * Simplified port of Flask pull_peer_benchmark - runs the new SQL only (no shadow mode), then the
 * 5-tier cascade. Priority order: strongest geo match first, stops at the tier that clears
 * threshold.
 */
export async function pullPeerBenchmark(
  sf: SnowflakeClient,
  input: PeerBenchmarkInput,
  log?: PeerBenchmarkLogger,
): Promise<PeerBenchmarkResult> {
  const { pms, states, segment, affordable, mixed, isSfr, units, footprint, avgRent, cutoff, latestMo } = input;

  // ─── Step 1: Pull peer benchmark pool ────────────────────────────────────
  const rentFilter = mixed ? "" : affordable
    ? "AND (SUM(t.RENT_PAID_AMOUNT) / NULLIF(SUM(t.BILLS_PAID_COUNT), 0)) < 1100"
    : "AND (SUM(t.RENT_PAID_AMOUNT) / NULLIF(SUM(t.BILLS_PAID_COUNT), 0)) >= 1100";

  const propertyTypeFilter = isSfr
    ? "AND SUM(t.PROPERTY_UNIT_COUNT) / NULLIF(COUNT(DISTINCT t.PROPERTY_NAME), 0) < 5"
    : "AND SUM(t.PROPERTY_UNIT_COUNT) / NULLIF(COUNT(DISTINCT t.PROPERTY_NAME), 0) >= 20";

  // Build optional overlap CTE for state-based matching
  const hasStates = states.length > 0;
  const statesPlaceholders = states.map(() => "?").join(",");

  const overlapCte = hasStates ? `,
      pmc_overlap_by_state AS (
        SELECT
          t.PMC_NAME,
          t.PROPERTY_STATE,
          SUM(t.PROPERTY_UNIT_COUNT) AS state_units,
          COUNT(DISTINCT t.PROPERTY_PUBLIC_ID) AS state_property_count,
          SUM(t.BILLS_PAID_COUNT) AS state_bills_paid,
          SUM(t.RENT_PAID_AMOUNT) AS state_rent_paid,
          MIN(t.ROLLOUT_MONTH) AS state_first_rollout
        FROM ${TBL} t
        JOIN pmc_qualified q ON t.PMC_NAME = q.PMC_NAME
        WHERE t.IS_INTEGRATED_TOTAL = TRUE
          AND t.BP_MONTH = ?
          AND t.ROLLOUT_MONTH <= DATEADD('month', -3, ?)
          AND UPPER(t.PROPERTY_STATE) IN (${statesPlaceholders})
        GROUP BY t.PMC_NAME, t.PROPERTY_STATE
      ),
      pmc_overlap AS (
        SELECT
          PMC_NAME,
          SUM(state_units) AS overlap_units,
          SUM(state_property_count) AS overlap_property_count,
          LISTAGG(IFF(state_bills_paid > 0, PROPERTY_STATE, NULL), ', ')
            WITHIN GROUP (ORDER BY PROPERTY_STATE) AS overlap_states,
          SUM(state_rent_paid) AS overlap_monthly_rent,
          SUM(state_bills_paid)::FLOAT / NULLIF(SUM(state_units), 0) AS overlap_adoption_rate
        FROM pmc_overlap_by_state
        GROUP BY PMC_NAME
        HAVING SUM(state_bills_paid) > 0
          AND SUM(state_property_count) >= 3
      ),
      pmc_overlap_avg_rent AS (
        SELECT
          t.PMC_NAME,
          SUM(t.RENT_PAID_AMOUNT) / NULLIF(SUM(t.BILLS_PAID_COUNT), 0) AS overlap_avg_rent
        FROM ${TBL} t
        JOIN pmc_qualified q ON t.PMC_NAME = q.PMC_NAME
        WHERE t.IS_INTEGRATED_TOTAL = TRUE
          AND t.BP_MONTH < ?
          AND UPPER(t.PROPERTY_STATE) IN (${statesPlaceholders})
        GROUP BY t.PMC_NAME
      )` : "";

  const overlapJoin = hasStates ? `
      LEFT JOIN pmc_overlap ov ON q.PMC_NAME = ov.PMC_NAME
      LEFT JOIN pmc_overlap_avg_rent oar ON q.PMC_NAME = oar.PMC_NAME` : "";

  const overlapSelect = hasStates ? `,
      COALESCE(ov.overlap_adoption_rate, 0) AS OVERLAP_ADOPTION_RATE,
      COALESCE(ov.overlap_monthly_rent, 0) AS OVERLAP_MONTHLY_RENT,
      COALESCE(ov.overlap_property_count, 0) AS OVERLAP_PROPERTY_COUNT,
      COALESCE(ov.overlap_units, 0) AS OVERLAP_UNITS,
      ov.overlap_states AS OVERLAP_STATES,
      COALESCE(oar.overlap_avg_rent, 0) AS OVERLAP_AVG_RENT` : "";

  const peerSql = `
      WITH pmc_qualified AS (
        SELECT t.PMC_NAME
        FROM ${TBL} t
        WHERE t.IS_INTEGRATED_TOTAL = TRUE
          AND t.BP_MONTH < ?
          AND t.ROLLOUT_MONTH IS NOT NULL
        GROUP BY t.PMC_NAME
        HAVING COUNT(DISTINCT t.BP_MONTH) >= 4
          AND SUM(t.BILLS_PAID_COUNT) > 0
          ${rentFilter}
          ${propertyTypeFilter}
      ),
      pmc_latest AS (
        SELECT
          t.PMC_NAME,
          COUNT(DISTINCT t.PROPERTY_STATE) AS state_count,
          SUM(t.BILLS_PAID_COUNT)::FLOAT / NULLIF(SUM(t.PROPERTY_UNIT_COUNT), 0) AS current_adoption,
          SUM(t.RENT_PAID_AMOUNT) AS current_monthly_rent,
          SUM(t.NEW_SIGNUPS_COUNT) AS new_signups,
          SUM(t.PROPERTY_UNIT_COUNT) AS total_units,
          COUNT(DISTINCT t.PROPERTY_PUBLIC_ID) AS property_count
        FROM ${TBL} t
        JOIN pmc_qualified q ON t.PMC_NAME = q.PMC_NAME
        WHERE t.IS_INTEGRATED_TOTAL = TRUE
          AND t.BP_MONTH = ?
          AND t.ROLLOUT_MONTH <= DATEADD('month', -3, ?)
        GROUP BY t.PMC_NAME
        HAVING SUM(t.BILLS_PAID_COUNT) > 0
      ),
      pmc_avg_rent AS (
        SELECT
          t.PMC_NAME,
          SUM(t.RENT_PAID_AMOUNT) / NULLIF(SUM(t.BILLS_PAID_COUNT), 0) AS avg_rent
        FROM ${TBL} t
        JOIN pmc_qualified q ON t.PMC_NAME = q.PMC_NAME
        WHERE t.IS_INTEGRATED_TOTAL = TRUE
          AND t.BP_MONTH < ?
        GROUP BY t.PMC_NAME
      ),
      pmc_tenure AS (
        SELECT
          t.PMC_NAME,
          DATEDIFF('month', MIN(t.ROLLOUT_MONTH), ?) AS months_live
        FROM ${TBL} t
        JOIN pmc_qualified q ON t.PMC_NAME = q.PMC_NAME
        WHERE t.IS_INTEGRATED_TOTAL = TRUE
          AND t.ROLLOUT_MONTH IS NOT NULL
        GROUP BY t.PMC_NAME
      ),
      pmc_pms AS (
        SELECT t.PMC_NAME, t.PMS
        FROM ${TBL} t
        JOIN pmc_qualified q ON t.PMC_NAME = q.PMC_NAME
        WHERE t.IS_INTEGRATED_TOTAL = TRUE
          AND t.BP_MONTH = ?
          AND t.PMS IS NOT NULL AND t.PMS != ''
        GROUP BY t.PMC_NAME, t.PMS
        QUALIFY ROW_NUMBER() OVER (
          PARTITION BY t.PMC_NAME ORDER BY SUM(t.PROPERTY_UNIT_COUNT) DESC
        ) = 1
      ),
      pmc_dq AS (
        SELECT PMC_NAME, SUM(TOTAL_RENT_SHIELDED) AS dq_shielded_mo
        FROM PRODUCTION.EXTERNAL_REPORTING.DQ_PROPERTY
        WHERE BP_MONTH = DATEADD('month', -1, ?)
        GROUP BY PMC_NAME
      ),
      pmc_primary_state AS (
        SELECT t.PMC_NAME, t.PROPERTY_STATE AS primary_state
        FROM ${TBL} t
        JOIN pmc_qualified q ON t.PMC_NAME = q.PMC_NAME
        WHERE t.IS_INTEGRATED_TOTAL = TRUE AND t.BP_MONTH = ?
          AND t.PROPERTY_STATE IS NOT NULL
        GROUP BY t.PMC_NAME, t.PROPERTY_STATE
        QUALIFY ROW_NUMBER() OVER (PARTITION BY t.PMC_NAME ORDER BY SUM(t.PROPERTY_UNIT_COUNT) DESC) = 1
      ),
      pmc_new_residents AS (
        SELECT PMC_NAME, COUNT(DISTINCT CUSTOMER_PUBLIC_ID) AS new_residents
        FROM (
          SELECT
            PMC_NAME, CUSTOMER_PUBLIC_ID, BP_MONTH,
            MIN(BP_MONTH) OVER (PARTITION BY PMC_NAME, CUSTOMER_PUBLIC_ID) AS first_paid_month
          FROM FLEX.REPORT.RPT_RENT_CUSTOMER_STATS_MONTHLY
          WHERE PMC_NAME IN (SELECT PMC_NAME FROM pmc_qualified)
            AND BILL_PAID_AMOUNT > 0
        )
        WHERE BP_MONTH = ? AND BP_MONTH = first_paid_month
        GROUP BY PMC_NAME
      )${overlapCte}
      SELECT
        q.PMC_NAME,
        COALESCE(l.total_units, 0) AS TOTAL_UNITS,
        COALESCE(ar.avg_rent, 0) AS AVG_RENT,
        COALESCE(l.current_adoption, 0) AS CURRENT_ADOPTION,
        COALESCE(l.current_monthly_rent, 0) AS CURRENT_MONTHLY_RENT,
        COALESCE(l.new_signups, 0) AS NEW_SIGNUPS,
        COALESCE(ten.months_live, 0) AS MONTHS_LIVE,
        pm.PMS,
        COALESCE(l.property_count, 0) AS PROPERTY_COUNT,
        COALESCE(dq.dq_shielded_mo, 0) AS DQ_SHIELDED_MO,
        ps.primary_state AS PRIMARY_STATE,
        COALESCE(l.state_count, 1) AS STATE_COUNT,
        COALESCE(nr.new_residents, 0) AS NEW_RESIDENTS
        ${overlapSelect}
      FROM pmc_qualified q
      LEFT JOIN pmc_latest l ON q.PMC_NAME = l.PMC_NAME
      LEFT JOIN pmc_avg_rent ar ON q.PMC_NAME = ar.PMC_NAME
      LEFT JOIN pmc_tenure ten ON q.PMC_NAME = ten.PMC_NAME
      LEFT JOIN pmc_pms pm ON q.PMC_NAME = pm.PMC_NAME
      LEFT JOIN pmc_dq dq ON q.PMC_NAME = dq.PMC_NAME
      LEFT JOIN pmc_primary_state ps ON q.PMC_NAME = ps.PMC_NAME
      LEFT JOIN pmc_new_residents nr ON q.PMC_NAME = nr.PMC_NAME
      ${overlapJoin}
      WHERE l.current_adoption > 0
    `;

  // Build params in the order the CTEs reference them
  const baseParams: unknown[] = [
    cutoff,         // pmc_qualified: BP_MONTH < ?
    latestMo,       // pmc_latest: BP_MONTH = ?
    cutoff,         // pmc_latest: DATEADD('month', -3, ?) — use cutoff as ramp reference
    cutoff,         // pmc_avg_rent: BP_MONTH < ?
    latestMo,       // pmc_tenure: DATEDIFF(..., ?)
    latestMo,       // pmc_pms: BP_MONTH = ?
    latestMo,       // pmc_dq: DATEADD('month', -1, ?)
    latestMo,       // pmc_primary_state: BP_MONTH = ?
    latestMo,       // pmc_new_residents: BP_MONTH = ?
  ];

  // Overlap CTE params matching the new structure:
  // pmc_overlap_by_state: BP_MONTH = ?, DATEADD('month', -3, ?), PROPERTY_STATE IN (...)
  // pmc_overlap_avg_rent: BP_MONTH < ?, PROPERTY_STATE IN (...)
  const overlapParams: unknown[] = hasStates ? [
    latestMo,  // pmc_overlap_by_state: BP_MONTH = ?
    cutoff,    // pmc_overlap_by_state: DATEADD('month', -3, ?) — use cutoff as ramp reference
    ...states, // pmc_overlap_by_state: PROPERTY_STATE IN (...)
    cutoff,    // pmc_overlap_avg_rent: BP_MONTH < ?
    ...states, // pmc_overlap_avg_rent: PROPERTY_STATE IN (...)
  ] : [];

  const allParams = [...baseParams, ...overlapParams];

  // Extended schema for overlap columns
  const ExtendedPeerRow = hasStates ? PeerBenchmarkRow.extend({
    OVERLAP_ADOPTION_RATE: z.coerce.number().nullable(),
    OVERLAP_MONTHLY_RENT: z.coerce.number().nullable(),
    OVERLAP_PROPERTY_COUNT: z.coerce.number().nullable(),
    OVERLAP_UNITS: z.coerce.number().nullable(),
    OVERLAP_STATES: z.string().nullable(),
    OVERLAP_AVG_RENT: z.coerce.number().nullable(),
  }) : PeerBenchmarkRow;

  let poolRows: z.infer<typeof PeerBenchmarkRow>[];
  try {
    poolRows = await sf.query(
      peerSql,
      ExtendedPeerRow as any,
      allParams,
      { label: "Pull peer benchmark pool" },
    );
  } catch (e: any) {
    log?.error("Peer benchmark query failed", { error: e.message });
    return { pool: [], peerPmcNames: [], benchmarks: EMPTY_BENCHMARKS, rentFilter, error: `Peer benchmark query failed: ${e.message}` };
  }

  if (poolRows.length === 0) {
    return {
      pool: [], peerPmcNames: [], benchmarks: EMPTY_BENCHMARKS, rentFilter,
      error: "No comparable Flex properties found for this profile. Try broader attributes.",
    };
  }

  // ─── Step 2: 5-Tier Cascade Peer Matching ─────────────────────────────
  // Mirrors pull_peer_benchmark from generator/prospect.py (lines 640-862)
  const MIN_POOL_SIZE = 3;
  const NOT_THIN = MIN_POOL_SIZE * 2; // = 6 — looser tiers need this many to be credible

  // ── Footprint bucketing (matches Flask's _footprint_bucket) ──
  function footprintBucket(stateCount: number): string {
    if (stateCount <= 1) return "single";
    if (stateCount <= 4) return "regional";
    if (stateCount <= 9) return "multi";
    return "national";
  }
  const ADJACENT_FOOTPRINTS: Record<string, string[]> = {
    single:   ["single", "regional"],
    regional: ["single", "regional", "multi"],
    multi:    ["regional", "multi", "national"],
    national: ["multi", "national"],
  };

  // ── Segment ranges (matches Flask _SEG_RANGES / _SEG_ADJACENT) ──
  const SEG_RANGES_MAP: Record<string, [number, number]> = {
    dsmb:       [0, 749],
    smb:        [750, 3_999],
    mm:         [4_000, 11_999],
    enterprise: [12_000, 29_999],
    strategic:  [30_000, 9_999_999],
  };
  const SEG_ADJACENT: Record<string, string[]> = {
    dsmb:       ["dsmb", "smb"],
    smb:        ["dsmb", "smb", "mm"],
    mm:         ["smb", "mm", "enterprise"],
    enterprise: ["mm", "enterprise", "strategic"],
    strategic:  ["enterprise", "strategic"],
  };
  function segFromUnits(u: number): string {
    if (u < 750) return "dsmb";
    if (u < 4000) return "smb";
    if (u < 12000) return "mm";
    if (u < 30000) return "enterprise";
    return "strategic";
  }
  const prospectSeg = units > 0 ? segFromUnits(units) : "mm";

  // Global established preference: prefer 12+ months peers for basePool (tiers 4/5)
  // Flask line 641: established = pool[pool["months_live"] >= 12]; if enough, narrow.
  let basePool: any[] = poolRows.filter((r: any) => (r.CURRENT_ADOPTION || 0) > 0);
  const establishedBase = basePool.filter((r: any) => (r.MONTHS_LIVE || 0) >= 12);
  if (establishedBase.length >= MIN_POOL_SIZE) {
    basePool = establishedBase;
  }

  // Rent-band tightening helper: ±30% of prospect's avg rent
  // For overlap tiers, pass useOverlapRent=true to check overlap_avg_rent instead
  function withRentBand(frame: any[], _threshold: number, useOverlapRent = false): [any[], boolean] {
    if (avgRent > 0) {
      const tightened = frame.filter((r: any) => {
        const rent = useOverlapRent ? (r.OVERLAP_AVG_RENT || r.AVG_RENT || 0) : (r.AVG_RENT || 0);
        return rent >= avgRent * 0.70 && rent <= avgRent * 1.30;
      });
      if (tightened.length >= MIN_POOL_SIZE) return [tightened, true];
    }
    return [frame, false];
  }

  // Footprint preference: prefer peers whose state_count bucket matches prospect's
  function withFootprint(frame: any[]): any[] {
    if (!footprint) return frame;
    const prospectBucket = footprint; // Already bucketed from input
    // Exact bucket match
    const exact = frame.filter((r: any) => footprintBucket(r.STATE_COUNT || 1) === prospectBucket);
    if (exact.length >= MIN_POOL_SIZE) return exact;
    // Adjacent bucket
    const adjBuckets = ADJACENT_FOOTPRINTS[prospectBucket] || [prospectBucket];
    const adjacent = frame.filter((r: any) => adjBuckets.includes(footprintBucket(r.STATE_COUNT || 1)));
    if (adjacent.length >= MIN_POOL_SIZE) return adjacent;
    return frame;
  }

  // Helper: narrow to established (12+ months) if enough remain — Flask's per-tier preference
  function preferEstablished(frame: any[], threshold: number): any[] {
    const est = frame.filter((r: any) => (r.MONTHS_LIVE || 0) >= 12);
    return est.length >= threshold ? est : frame;
  }

  // Helper: swap in overlap-scoped stats before rent-band filtering in Tiers 1-3
  // (Flask's _apply_overlap_cols — must run BEFORE withRentBand so the rent filter
  // uses AZ/CA-specific rent, not the PMC's portfolio-wide average)
  // CRITICAL: Do NOT fall back to portfolio-wide AVG_RENT when overlap is 0 —
  // a PMC with 0 overlap rent has no meaningful rent data in the prospect's states
  // and should fail the rent-band check rather than sneaking through on portfolio avg.
  function applyOverlapCols(rows: any[]): any[] {
    return rows.map((r: any) => ({
      ...r,
      TOTAL_UNITS: r.OVERLAP_UNITS ?? r.TOTAL_UNITS,
      CURRENT_ADOPTION: r.OVERLAP_ADOPTION_RATE ?? r.CURRENT_ADOPTION,
      CURRENT_MONTHLY_RENT: r.OVERLAP_MONTHLY_RENT ?? r.CURRENT_MONTHLY_RENT,
      AVG_RENT: r.OVERLAP_AVG_RENT ?? r.AVG_RENT,
      PROPERTY_COUNT: r.OVERLAP_PROPERTY_COUNT ?? r.PROPERTY_COUNT,
    }));
  }

  // Determine regions for tier 4
  const regions = new Set(states.map(s => STATE_TO_REGION[s]).filter(Boolean));
  const targetRegion = regions.size === 1 ? [...regions][0] : ""; // empty = cross-region → skip tier 4

  // Min coverage: peer needs presence in at least half of prospect's states
  // Flask: _min_coverage = (len(states) + 1) // 2
  const minCoverage = Math.floor((states.length + 1) / 2);

  // Build overlap-scoped candidates (Tiers 1-3 operate on this subset)
  // Flask's _conc_base: overlap_property_count >= 3 AND overlap_adoption_rate > 0 AND property_count > 0
  // Then filters to _state_coverage >= _min_coverage
  const overlapCandidates = hasStates
    ? poolRows.filter((r: any) => {
        if ((r.OVERLAP_PROPERTY_COUNT || 0) < 3) return false;
        if ((r.OVERLAP_ADOPTION_RATE || 0) <= 0) return false;
        if ((r.PROPERTY_COUNT || 0) <= 0) return false; // Flask: property_count > 0
        // Count how many of the prospect's states this peer covers (_state_coverage)
        const peerStates = (r.OVERLAP_STATES || "").split(",").map((s: string) => s.trim().toUpperCase()).filter(Boolean);
        const stateCoverage = peerStates.length; // Total states the peer has overlap in
        return stateCoverage >= minCoverage;
      }).map((r: any) => {
        // Compute _concentration = overlap_property_count / property_count (Flask line 730)
        // NOT units-based! This is the key difference from the previous buggy implementation.
        const concentration = (r.OVERLAP_PROPERTY_COUNT || 0) / (r.PROPERTY_COUNT || 1);
        const peerStates = (r.OVERLAP_STATES || "").split(",").map((s: string) => s.trim().toUpperCase()).filter(Boolean);
        return { ...r, _concentration: concentration, _state_coverage: peerStates.length };
      })
    : [];

  // Tier selection logic
  let pool: any[] = [];
  let matchLevel = "segment";
  let matchMode = "portfolio";
  let tierUsed = 0;

  // Tier 1: Concentrated overlap — ≥70% of peer's properties in prospect's states
  // AND state_coverage >= len(states) (every prospect state covered)
  if (hasStates && overlapCandidates.length > 0) {
    let tier1 = overlapCandidates.filter((r: any) =>
      r._concentration >= 0.70 && r._state_coverage >= states.length
    );
    // Per-tier: established filter first (on portfolio-wide MONTHS_LIVE), then swap overlap cols
    tier1 = preferEstablished(tier1, MIN_POOL_SIZE);
    tier1 = applyOverlapCols(tier1);
    if (tier1.length >= MIN_POOL_SIZE) {
      const [t1Rent, usedRent] = withRentBand(tier1, MIN_POOL_SIZE);
      if (t1Rent.length >= MIN_POOL_SIZE) {
        pool = t1Rent;
        matchLevel = `true 1:1 match in ${states.join(", ")}` + (usedRent ? " & avg rent" : "");
        matchMode = "overlap";
        tierUsed = 1;
      }
    }
  }

  // Tier 2: All-state coverage, no concentration requirement
  // Only tried if len(states) >= 2. Threshold: NOT_THIN (6).
  if (pool.length === 0 && hasStates && states.length >= 2 && overlapCandidates.length > 0) {
    let tier2 = overlapCandidates.filter((r: any) => r._state_coverage >= states.length);
    tier2 = preferEstablished(tier2, MIN_POOL_SIZE);
    tier2 = applyOverlapCols(tier2);
    if (tier2.length >= NOT_THIN) {
      const [t2Rent, usedRent] = withRentBand(tier2, NOT_THIN);
      if (t2Rent.length >= NOT_THIN) {
        pool = t2Rent;
        matchLevel = `presence in every one of ${states.join(", ")}` + (usedRent ? " & avg rent" : "");
        matchMode = "overlap";
        tierUsed = 2;
      }
    }
  }

  // Tier 3: Large presence in ANY ONE given state (≥10 properties, falls back to ≥3)
  if (pool.length === 0 && hasStates && overlapCandidates.length > 0) {
    // Try ≥10 properties first, fall back to the full overlap base (≥3)
    const large = overlapCandidates.filter((r: any) => (r.OVERLAP_PROPERTY_COUNT || 0) >= 10);
    let ov = large.length >= MIN_POOL_SIZE ? large : overlapCandidates;
    if (ov.length >= MIN_POOL_SIZE) {
      // Footprint preference + overlap swap + established + rent band
      ov = withFootprint(ov);
      ov = preferEstablished(ov, MIN_POOL_SIZE);
      ov = applyOverlapCols(ov);
      const [t3Rent, usedRent] = withRentBand(ov, MIN_POOL_SIZE);
      if (t3Rent.length >= MIN_POOL_SIZE) {
        pool = t3Rent;
        matchLevel = `large presence in ${states.join("/")}` + (usedRent ? " & avg rent" : "");
        matchMode = "overlap";
        tierUsed = 3;
      }
    }
  }

  // Tier 4: Primary state match OR region — SKIPPED if cross-region (targetRegion = "")
  if (pool.length === 0) {
    let chosen: any[] | null = null;
    let chosenLabel = "";
    // First try: primary_state is one of the prospect's states
    if (states.length > 0) {
      const sameState = basePool.filter((r: any) =>
        states.includes((r.PRIMARY_STATE || "").toUpperCase())
      );
      if (sameState.length >= MIN_POOL_SIZE) {
        chosen = withFootprint(sameState);
        chosenLabel = `same state (${states.join(", ")})`;
      }
    }
    // Fallback: same region
    if (!chosen && targetRegion) {
      const sameRegion = basePool.filter((r: any) =>
        STATE_TO_REGION[(r.PRIMARY_STATE || "").toUpperCase()] === targetRegion
      );
      if (sameRegion.length >= MIN_POOL_SIZE) {
        chosen = withFootprint(sameRegion);
        chosenLabel = `${targetRegion} region`;
      }
    }
    if (chosen) {
      const [t4Rent, usedRent] = withRentBand(chosen, NOT_THIN);
      if (t4Rent.length >= NOT_THIN) {
        pool = t4Rent;
        matchLevel = chosenLabel + (usedRent ? " & avg rent" : "");
        matchMode = "portfolio";
        tierUsed = 4;
      }
    }
  }

  // Tier 5: Segment-size fallback — no geography at all
  if (pool.length === 0) {
    const [segMin, segMax] = SEG_RANGES_MAP[prospectSeg] || [0, 9_999_999];
    let sized = basePool.filter((r: any) => {
      const u = r.TOTAL_UNITS || 0;
      return u >= segMin && u <= segMax;
    });
    if (sized.length < MIN_POOL_SIZE) {
      // Widen to adjacent segments
      const adjSegs = SEG_ADJACENT[prospectSeg] || [prospectSeg];
      const adjMin = Math.min(...adjSegs.map(s => SEG_RANGES_MAP[s]?.[0] ?? 0));
      const adjMax = Math.max(...adjSegs.map(s => SEG_RANGES_MAP[s]?.[1] ?? 9_999_999));
      sized = basePool.filter((r: any) => {
        const u = r.TOTAL_UNITS || 0;
        return u >= adjMin && u <= adjMax;
      });
    }

    let chosen: any[] | null = null;
    let chosenLabel = "";
    if (footprint && sized.length >= MIN_POOL_SIZE) {
      const exactFp = sized.filter((r: any) => footprintBucket(r.STATE_COUNT || 1) === footprint);
      if (exactFp.length >= MIN_POOL_SIZE) {
        chosen = exactFp;
        chosenLabel = "similar size & footprint";
      } else {
        const adjBuckets = ADJACENT_FOOTPRINTS[footprint] || [footprint];
        const adjFp = sized.filter((r: any) => adjBuckets.includes(footprintBucket(r.STATE_COUNT || 1)));
        if (adjFp.length >= MIN_POOL_SIZE) {
          chosen = adjFp;
          chosenLabel = "similar footprint (national)";
        }
      }
    }
    if (!chosen && sized.length >= MIN_POOL_SIZE) {
      chosen = sized;
      chosenLabel = "similar size";
    }

    if (chosen) {
      const [t5Rent, usedRent] = withRentBand(chosen, MIN_POOL_SIZE);
      pool = t5Rent.length >= MIN_POOL_SIZE ? t5Rent : chosen;
      matchLevel = chosenLabel + (t5Rent.length >= MIN_POOL_SIZE && usedRent ? " & avg rent" : "");
    } else {
      // Absolute fallback — use entire basePool
      pool = basePool;
      matchLevel = "segment & portfolio size";
    }
    matchMode = "portfolio";
    tierUsed = 5;
  }

  // Append tenure note when established-narrowed pool was used
  if (establishedBase.length >= MIN_POOL_SIZE) {
    matchLevel = matchLevel + " · 1yr+ on Flex";
  }

  log?.info("Peer matching result", {
    tierUsed, poolSize: pool.length, matchLevel, matchMode, footprint,
    overlapCandidateCount: overlapCandidates.length,
    basePoolSize: basePool.length,
    establishedNarrowed: establishedBase.length >= MIN_POOL_SIZE,
  });

  // Extract peer PMC names
  const peerPmcNames = pool.map((r: any) => r.PMC_NAME as string);

  // Compute benchmarks
  const adoptionRates = pool.map((r: any) => r.CURRENT_ADOPTION as number);
  const monthlyRents = pool.map((r: any) => r.CURRENT_MONTHLY_RENT as number);
  const avgRents = pool.map((r: any) => (r.AVG_RENT || 0) as number);
  const signups = pool.map((r: any) => r.NEW_SIGNUPS as number);

  const benchmarks: Benchmarks = {
    median_nar: median(adoptionRates),
    avg_nar: mean(adoptionRates),
    p25_nar: quantile(adoptionRates, 0.25),
    p75_nar: Math.min(quantile(adoptionRates, 0.75), 0.50),
    p75_signups: quantile(signups, 0.75),
    median_avg_rent: median(avgRents),
    avg_avg_rent: mean(avgRents),
    median_monthly_rent: median(monthlyRents),
    avg_monthly_rent: mean(monthlyRents),
    pool_size: pool.length,
    footprint,
    match_level: matchLevel,
    match_mode: matchMode,
    established_only: establishedBase.length >= MIN_POOL_SIZE,
    pms,
    affordable,
    is_sfr: isSfr,
    prospect_units: units,
    prospect_segment: segment.toUpperCase().replace("_", " "),
    prospect_region: targetRegion,
    _peer_pmc_names: peerPmcNames,
    median_signups_pmc: median(signups),
  };

  return { pool, peerPmcNames, benchmarks, rentFilter, error: null };
}

// ─── Platinum comparator ───────────────────────────────────────────────────────

const PlatinumSchema = z.object({
  PMC_NAME: z.string().nullable(),
  PLATINUM_NAR: z.coerce.number().nullable(),
  OPT_IN_UNITS: z.coerce.number().nullable(),
});

export interface PlatinumRate {
  platinum_median_nar: number;
  platinum_peer_count: number;
  platinum_scope: "comparable" | "network";
}

/**
 * Platinum comparator - Clark mirror of Flask pull_peer_platinum_rate (e138728). One query at
 * latestMo over IS_INTEGRATED_TOTAL AND IS_MARKETING_OPT_IN properties: per-PMC bills_paid/units,
 * keep PMCs with > 0 opt-in units, median across PMCs. >= 3 peers -> scope "comparable"; else
 * network-wide (>= 100 opt-in units per PMC) -> "network". Any failure / no rows -> null (the
 * caller falls back to its old comparator).
 */
export async function pullPeerPlatinumRate(
  sf: SnowflakeClient,
  latestMo: string,
  peerPmcNames: string[],
  log?: PeerBenchmarkLogger,
): Promise<PlatinumRate | null> {
  const runPlatinum = async (names: string[] | null): Promise<{ nar: number; units: number }[]> => {
    const nameFilter = names ? `AND PMC_NAME IN (${names.map(() => "?").join(",")})` : "";
    const having = names ? "" : "HAVING SUM(PROPERTY_UNIT_COUNT) >= 100";
    const platSql = `
        SELECT PMC_NAME,
               SUM(BILLS_PAID_COUNT)::FLOAT / NULLIF(SUM(PROPERTY_UNIT_COUNT), 0) AS PLATINUM_NAR,
               SUM(PROPERTY_UNIT_COUNT)                                          AS OPT_IN_UNITS
        FROM ${TBL}
        WHERE BP_MONTH = ?
          AND IS_INTEGRATED_TOTAL = TRUE
          AND IS_MARKETING_OPT_IN = TRUE
          ${nameFilter}
        GROUP BY PMC_NAME
        ${having}
      `;
    const rows = await sf.query(
      platSql, PlatinumSchema, [latestMo, ...(names ?? [])],
      { label: names ? "Pull peer platinum rate" : "Pull network platinum rate" },
    );
    return rows
      .filter(r => r.PLATINUM_NAR != null && r.OPT_IN_UNITS != null && r.OPT_IN_UNITS > 0)
      .map(r => ({ nar: r.PLATINUM_NAR as number, units: r.OPT_IN_UNITS as number }));
  };
  try {
    let rows = peerPmcNames.length > 0 ? await runPlatinum(peerPmcNames) : [];
    let scope: "comparable" | "network" = "comparable";
    if (rows.length < 3) {
      rows = await runPlatinum(null);
      scope = "network";
    }
    if (rows.length === 0) return null;
    return {
      platinum_median_nar: median(rows.map(r => r.nar)),
      platinum_peer_count: rows.length,
      platinum_scope: scope,
    };
  } catch (e: any) {
    log?.warn("pull_peer_platinum_rate failed", { error: e.message });
    return null;
  }
}
