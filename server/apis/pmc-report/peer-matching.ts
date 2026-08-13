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
  const excludeUpperSet = new Set(excludePmcNames.map(n => n.toUpperCase()));

  // Pre-filter to same age bucket, excluding own PMC(s)
  const candidates = pool.filter(
    (p) => p.ageBucket === ageBucket && !excludeUpperSet.has(p.pmcName.toUpperCase()),
  );
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
