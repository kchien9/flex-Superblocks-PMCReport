/**
 * Per-property peer median resolver — mirrors resolve_property_peer_nar /
 * resolve_property_peer_engagement from Python generator/data.py.
 *
 * Tiered matching widens until min_peers (8) are found:
 *   0. same state + size ±40% + rent-TO-INCOME ±30% + same age bucket (only when the subject's
 *      own income and the pool properties' median_renter_income are both available — a
 *      cost-of-living-adjusted rent match, since identical rent means very different things in
 *      different local income contexts)
 *   1. same state + size ±40% + raw rent ±30% + same age bucket
 *   2. same state + size ±40% + same age bucket (drop rent)
 *   3. same region + size ±70% + same age bucket (drop state/rent)
 *   4. same region + same age bucket (drop size)
 *   5. same age bucket, network-wide (drop state/region/size entirely)
 */

export interface NetworkPoolProperty {
  pmcName: string;
  propertyName: string;
  propertyState: string;
  propertyUnitCount: number;
  avgRent: number;
  /** Bills paid this property's latest month — lets callers reconstruct a PMC-level
   * bills-weighted average rent (sum(avgRent*billsPaid)/sum(billsPaid)) instead of a plain
   * per-property average, matching Flask's per_pmc_totals (generator/data.py:4118-4121). */
  billsPaid: number;
  monthsLive: number;
  nar: number;
  t12EngPer100: number;
  ageBucket: string;
  /** County median renter household income for this property's ZIP, when resolvable. */
  medianRenterIncome?: number | null;
}

export interface PeerResult {
  p50: number;
  peerCount: number;
  criteria: string;
}

export const STATE_TO_REGION: Record<string, string> = {
  FL: "Southeast", GA: "Southeast", SC: "Southeast", NC: "Southeast",
  TN: "Southeast", AL: "Southeast", MS: "Southeast", VA: "Southeast",
  WV: "Southeast", KY: "Southeast",
  AR: "South Central", LA: "South Central", OK: "South Central", TX: "South Central",
  AZ: "Southwest", NM: "Southwest",
  OH: "Midwest", IN: "Midwest", IL: "Midwest", MI: "Midwest",
  WI: "Midwest", MN: "Midwest", IA: "Midwest", MO: "Midwest",
  ND: "Midwest", SD: "Midwest", NE: "Midwest", KS: "Midwest",
  CO: "Mountain", UT: "Mountain", NV: "Mountain", ID: "Mountain",
  MT: "Mountain", WY: "Mountain",
  CA: "Pacific", WA: "Pacific", OR: "Pacific", AK: "Pacific", HI: "Pacific",
  NY: "Northeast", NJ: "Northeast", PA: "Northeast", MA: "Northeast",
  CT: "Northeast", RI: "Northeast", VT: "Northeast", NH: "Northeast",
  ME: "Northeast", MD: "Northeast", DE: "Northeast", DC: "Northeast",
};

export function propertyAgeBucket(monthsLive: number): string {
  if (monthsLive <= 3) return "1-3mo";
  if (monthsLive <= 6) return "4-6mo";
  if (monthsLive <= 12) return "7-12mo";
  if (monthsLive <= 18) return "13-18mo";
  if (monthsLive <= 24) return "19-24mo";
  if (monthsLive <= 36) return "25-36mo";
  return "37+mo";
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Perf fix (Kevin's catch: GetPMCMonthlyReport's slowest non-query step, ~12.7s of pure
// synchronous "Code" time per Superblocks' own per-step trace): this function is called once
// PER PROPERTY, PER METRIC (NAR and engagement separately) - hundreds of calls in a single
// report. Every call re-filtered the entire pool (thousands of rows) down to "same age bucket,
// PMC excluded" from scratch, even though `pool` and `excludePmcNames` are the exact same
// values on every single call within one report (only `monthsLive`/ageBucket varies, and there
// are only 7 possible age buckets total - see propertyAgeBucket above). That's redundant work
// on a scale of hundreds-of-calls-doing-the-identical-filter, not a few wasted cycles.
//
// WeakMap keyed on the `pool` array reference itself, not a module-level cache - a fresh
// networkPoolProps array is created per report generation (get-pmc-monthly-report.ts), so each
// report's cache entries become garbage-collectable as soon as that array does, with zero risk
// of one report's cached candidates leaking into another's. The inner Map still keys on
// excludePmcNames (not just ageBucket) in case a future caller ever passes a different
// exclusion set against the same pool reference - correctness over assuming today's single
// call pattern holds forever.
const _ageBucketCandidatesCache = new WeakMap<NetworkPoolProperty[], Map<string, NetworkPoolProperty[]>>();
function _candidatesForAgeBucket(
  pool: NetworkPoolProperty[],
  ageBucket: string,
  excludePmcNames: string[],
): NetworkPoolProperty[] {
  let byKey = _ageBucketCandidatesCache.get(pool);
  if (!byKey) {
    byKey = new Map();
    _ageBucketCandidatesCache.set(pool, byKey);
  }
  const key = ageBucket + "|" + excludePmcNames.map((n) => n.toUpperCase()).sort().join(",");
  let candidates = byKey.get(key);
  if (!candidates) {
    const excludeUpperSet = new Set(excludePmcNames.map((n) => n.toUpperCase()));
    candidates = pool.filter((p) => p.ageBucket === ageBucket && !excludeUpperSet.has(p.pmcName.toUpperCase()));
    byKey.set(key, candidates);
  }
  return candidates;
}

/**
 * Resolve per-property peer metric (NAR or engagement) using tiered matching.
 * metricFn extracts the value from a pool property (e.g. p.nar or p.t12EngPer100).
 */
function resolvePropertyPeerMetric(
  state: string,
  units: number,
  avgRent: number,
  monthsLive: number,
  excludePmcNames: string[],
  pool: NetworkPoolProperty[],
  metricFn: (p: NetworkPoolProperty) => number,
  minPeers: number = 8,
  subjectIncome?: number | null,
): PeerResult | null {
  if (pool.length === 0) return null;

  const ageBucket = propertyAgeBucket(monthsLive);

  // Pre-filter to same age bucket, excluding own PMC(s) - memoized per (pool, ageBucket,
  // excludePmcNames), since this exact filter is otherwise recomputed identically on every
  // one of the hundreds of calls this function gets per report (see _candidatesForAgeBucket).
  const candidates = _candidatesForAgeBucket(pool, ageBucket, excludePmcNames);
  if (candidates.length === 0) return null;

  const region = STATE_TO_REGION[state];

  // Define tiers (same ordering as Python)
  const tiers: Array<{
    subset: NetworkPoolProperty[];
    sizeLow: number;
    sizeHigh: number;
    rentMatch: boolean;
    rtiMatch?: boolean;
    subjectRti?: number;
    label: string;
  }> = [];

  // Tier 0: same state + size ±40% + rent-TO-INCOME ±30% + same age bucket — only when the
  // subject's own income and rent are both real, and at least the candidate pool has income
  // data at all (individual candidates without income get dropped when the tier's own filter
  // runs, same as Flask dropping rows with a NaN _rti before taking len()/median()).
  const hasIncome = subjectIncome != null && subjectIncome > 0 && avgRent > 0;
  if (hasIncome) {
    const subjectRti = (avgRent * 12) / subjectIncome!;
    tiers.push({
      subset: candidates.filter((p) => p.propertyState === state),
      sizeLow: 0.60, sizeHigh: 1.40,
      rentMatch: false,
      rtiMatch: true,
      subjectRti,
      label: "same state, comparable size & cost-of-living-adjusted rent",
    });
  }

  // Tier 1: same state + size ±40% + rent ±30% + same age bucket
  tiers.push({
    subset: candidates.filter((p) => p.propertyState === state),
    sizeLow: 0.60, sizeHigh: 1.40,
    rentMatch: true,
    label: "same state, comparable size & rent",
  });
  // Tier 2: same state + size ±40% + same age bucket (drop rent)
  tiers.push({
    subset: candidates.filter((p) => p.propertyState === state),
    sizeLow: 0.60, sizeHigh: 1.40,
    rentMatch: false,
    label: "same state, comparable size",
  });

  if (region) {
    const regionCandidates = candidates.filter(
      (p) => STATE_TO_REGION[p.propertyState] === region,
    );
    // Tier 3: same region + size ±70% + same age bucket
    tiers.push({
      subset: regionCandidates,
      sizeLow: 0.30, sizeHigh: 1.70,
      rentMatch: false,
      label: `${region} region, comparable size`,
    });
    // Tier 4: same region + same age bucket (drop size)
    tiers.push({
      subset: regionCandidates,
      sizeLow: 0.0, sizeHigh: 10_000.0,
      rentMatch: false,
      label: `${region} region`,
    });
  }

  // Tier 5: same age bucket, network-wide
  tiers.push({
    subset: candidates,
    sizeLow: 0.0, sizeHigh: 10_000.0,
    rentMatch: false,
    label: "comparable properties network-wide",
  });

  for (const tier of tiers) {
    if (tier.subset.length === 0) continue;

    let sub = tier.subset.filter(
      (p) => p.propertyUnitCount >= units * tier.sizeLow && p.propertyUnitCount <= units * tier.sizeHigh,
    );
    if (tier.rtiMatch && tier.subjectRti) {
      sub = sub.filter((p) => {
        if (p.medianRenterIncome == null || p.medianRenterIncome <= 0 || p.avgRent <= 0) return false;
        const rti = (p.avgRent * 12) / p.medianRenterIncome;
        return rti >= tier.subjectRti! * 0.70 && rti <= tier.subjectRti! * 1.30;
      });
    } else if (tier.rentMatch && avgRent > 0) {
      sub = sub.filter(
        (p) => p.avgRent >= avgRent * 0.70 && p.avgRent <= avgRent * 1.30,
      );
    }

    const values = sub.map(metricFn).filter((v) => v != null && !isNaN(v));
    if (values.length >= minPeers) {
      return {
        p50: median(values),
        peerCount: values.length,
        criteria: tier.label,
      };
    }
  }

  return null;
}

// ─── PMC-level "largest PMCs on Flex" rung ─────────────────────────────────────────────────
// Kevin's call (2026-09-09): when the PMC-level size ladder in get-pmc-monthly-report.ts
// exhausts every size-matched tier (an 8-entity combined portfolio at ~464k units has no PMC on
// Flex anywhere inside even the widest ±70% band), the peer set should be "the largest PMCs on
// Flex" - the network's top size tier - before falling all the way to the unrestricted
// network-wide median. Defined concretely as the top LARGEST_PMCS_TIER_N candidates by total
// integrated units (the same per-PMC totalUnits every other rung compares against), and only
// eligible when the ladder failed from ABOVE: fewer than `minPeers` candidates reach even the
// last size tier's lower bound (0.30 x subject units), i.e. the subject outsizes the network.
// A tiny PMC that exhausted the ladder for the opposite reason keeps the existing fallback -
// "largest PMCs on Flex" would be a nonsense comparison there.
export const LARGEST_PMCS_TIER_N = 10;
export const LARGEST_PMCS_TIER_LABEL = "largest PMCs on Flex";

export function largestPmcsPeerTier<T extends { name: string; totalUnits: number }>(
  candidates: T[],
  subjectUnits: number,
  opts: { minPeers?: number; topN?: number; sizeLowMult?: number } = {},
): { peers: T[]; label: string } | null {
  const minPeers = opts.minPeers ?? 5;
  const topN = opts.topN ?? LARGEST_PMCS_TIER_N;
  const sizeLowMult = opts.sizeLowMult ?? 0.30;
  if (subjectUnits <= 0) return null;
  // 3 = the ladder's final size tier's own minPeers: if 3+ candidates sit at/above its lower
  // bound, that tier didn't fail because the subject outsizes the network (they were above the
  // upper bound instead, or the subject is the small one) - not this rung's case.
  const reachingBand = candidates.filter((c) => c.totalUnits >= subjectUnits * sizeLowMult).length;
  if (reachingBand >= 3) return null;
  const peers = [...candidates]
    .filter((c) => c.totalUnits > 0)
    .sort((a, b) => b.totalUnits - a.totalUnits)
    .slice(0, topN);
  if (peers.length < minPeers) return null;
  return { peers, label: LARGEST_PMCS_TIER_LABEL };
}

// ─── Locked-peer-cohort SQL (rolling calendar-time median + tenure-cohort benchmark) ──────
// Extracted verbatim from get-pmc-monthly-report.ts so the generated SQL is a pure function of
// its inputs (unit-testable, byte-identity provable). `optInOnly` is the Platinum deck's peer
// pool (Flask `opt_in_only` in pull_rolling_peer_median / _pull_stage_benchmarks, 22d7052): the
// cohort is still locked on each candidate's WHOLE portfolio by the ladder above, but the peers'
// monthly rates are computed from their IS_MARKETING_OPT_IN = TRUE properties only - the one
// added predicate sits on the rate rows, right after IS_INTEGRATED_TOTAL = TRUE, exactly where
// Flask appends it. Default (false) -> the SQL string is byte-identical to the inlined original.
export interface PeerPoolSqlOptions {
  optInOnly?: boolean;
}

/** Rolling peer median NAR (per-month P25/P50/P75 from the locked peers). Bind params, in
 * order: [...lockedPeers, cutoffStr, cutoffStr, lookbackMonths, cutoffStr, cutoffStr]. */
export function rollingPeerMedianSql(lockedPeers: string[], lookbackMonths: number, opts: PeerPoolSqlOptions = {}): string {
  const optInSql = opts.optInOnly ? " AND IS_MARKETING_OPT_IN = TRUE" : "";
  return `WITH peer_monthly AS (
            SELECT
              BP_MONTH,
              PMC_NAME,
              SUM(CHARGED_USERS_COUNT) / NULLIF(SUM(PROPERTY_UNIT_COUNT)::FLOAT, 0) AS nar
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE PMC_NAME IN (${lockedPeers.map(() => "?").join(", ")})
              AND IS_INTEGRATED_TOTAL = TRUE${optInSql}
              -- cutoffStr is an EXCLUSIVE upper bound (1st of the next allowed month) —
              -- BETWEEN is inclusive on both ends, which let this match Snowflake's pre-created
              -- stub row for that month (zeroed billing columns), injecting a bogus NAR=0 point.
              AND BP_MONTH >= DATEADD('month', -${lookbackMonths + 3}, ?::DATE)
              AND BP_MONTH < ?
            GROUP BY BP_MONTH, PMC_NAME
         ),
         smoothed AS (
            SELECT
              BP_MONTH, PMC_NAME,
              AVG(nar) OVER (PARTITION BY PMC_NAME ORDER BY BP_MONTH ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS smoothed_nar
            FROM peer_monthly
         )
         SELECT
           TO_VARCHAR(BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH,
           PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY smoothed_nar) AS SMOOTHED_NAR,
           PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY smoothed_nar) AS P25,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY smoothed_nar) AS P75
         FROM smoothed
         WHERE BP_MONTH >= DATEADD('month', -?, ?::DATE)
           AND BP_MONTH < ?
           AND smoothed_nar IS NOT NULL
         GROUP BY BP_MONTH
         HAVING COUNT(*) >= 3
         ORDER BY BP_MONTH`;
}

/** Tenure-cohort peer benchmark (months-since-launch 1-36) over the locked peers. Bind params,
 * in order: [...lockedPeers, ...lockedPeers, cutoffStr]. pmc_launch stays whole-portfolio under
 * optInOnly (a peer's launch month is a PMC fact); only the monthly_nar rate rows are restricted. */
export function stageBenchmarkSql(lockedPeers: string[], opts: PeerPoolSqlOptions = {}): string {
  const optInSql = opts.optInOnly ? " AND s.IS_MARKETING_OPT_IN = TRUE" : "";
  return `WITH pmc_launch AS (
            SELECT PMC_NAME, MIN(BP_MONTH) AS launch_month
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE PMC_NAME IN (${lockedPeers.map(() => "?").join(", ")})
              AND ROLLOUT_MONTH IS NOT NULL
              AND IS_INTEGRATED_TOTAL = TRUE
            GROUP BY PMC_NAME
         ),
         monthly_nar AS (
            SELECT
              s.PMC_NAME,
              DATEDIFF('month', l.launch_month, s.BP_MONTH) + 1 AS month_number,
              SUM(s.BILLS_PAID_COUNT) / NULLIF(SUM(s.PROPERTY_UNIT_COUNT)::FLOAT, 0) AS adoption_rate
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS s
            JOIN pmc_launch l ON s.PMC_NAME = l.PMC_NAME
            WHERE s.PMC_NAME IN (${lockedPeers.map(() => "?").join(", ")})
              AND s.BP_MONTH >= l.launch_month
              AND s.BP_MONTH < ?
              AND s.IS_INTEGRATED_TOTAL = TRUE${optInSql}
            GROUP BY s.PMC_NAME, month_number
            HAVING adoption_rate IS NOT NULL AND adoption_rate > 0
         ),
         monthly_nar_smoothed AS (
            SELECT
              PMC_NAME, month_number,
              AVG(adoption_rate) OVER (
                PARTITION BY PMC_NAME ORDER BY month_number
                ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
              ) AS smoothed_adoption_rate
            FROM monthly_nar
         )
         SELECT
           month_number AS MONTH_NUMBER,
           PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY smoothed_adoption_rate) AS P25,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY smoothed_adoption_rate) AS P50,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY smoothed_adoption_rate) AS P75,
           COUNT(DISTINCT PMC_NAME) AS PMC_COUNT
         FROM monthly_nar_smoothed
         WHERE month_number BETWEEN 1 AND 36
         GROUP BY month_number
         ORDER BY month_number`;
}

export function resolvePropertyPeerNar(
  state: string, units: number, avgRent: number, monthsLive: number,
  excludePmcNames: string[], pool: NetworkPoolProperty[],
  subjectIncome?: number | null,
): PeerResult | null {
  return resolvePropertyPeerMetric(
    state, units, avgRent, monthsLive, excludePmcNames, pool,
    (p) => p.nar, 8, subjectIncome,
  );
}

export function resolvePropertyPeerEngagement(
  state: string, units: number, avgRent: number, monthsLive: number,
  excludePmcNames: string[], pool: NetworkPoolProperty[],
  subjectIncome?: number | null,
): PeerResult | null {
  return resolvePropertyPeerMetric(
    state, units, avgRent, monthsLive, excludePmcNames, pool,
    (p) => p.t12EngPer100, 8, subjectIncome,
  );
}
