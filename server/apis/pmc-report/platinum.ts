/**
 * Platinum deck ("The Case for Marketing") data layer - Clark mirror of Flask's
 * generator/data.py `split_tier_frames` / `platinum_counterfactual` (commit 22d7052; spec:
 * flex-pmc-reports docs/superpowers/specs/2026-09-09-platinum-deck-design.md).
 *
 * Silver = DI (HAS_MARKETING_INTEGRATION) without the marketing opt-in; Platinum = DI + opt-in.
 * Everything here is pure functions over the already-fetched property-month rows and the
 * per-month totals get-pmc-monthly-report.ts already aggregates - no Snowflake, so it is
 * unit-testable in isolation. Flask is the reference; strings and gates below are copied from it.
 */

export const PLATINUM_MIN_PROPERTIES = 3;
export const PLATINUM_OWN_LABEL = "Your platinum properties";
export const PLATINUM_PEERS_PREFIX = "platinum peers · ";
export const PLATINUM_PEERS_DEFAULT_LABEL = "Platinum peers · similar size, footprint & age";

/** Flask `_label` / `locked_criteria` prefixing: "platinum peers · <existing criteria>" when the
 * peer pool is opt-in-restricted, the criteria untouched otherwise. */
export function peerCriteriaLabel(label: string, optInOnly: boolean): string {
  return optInOnly ? `${PLATINUM_PEERS_PREFIX}${label}` : label;
}

// ─── Tier split ──────────────────────────────────────────────────────────────────────────

/** The subset of RawRowSchema the tier split reads. Generic so callers get their own row type
 * back (the per-month aggregation in get-pmc-monthly-report.ts runs unchanged on each tier). */
export interface TierRow {
  BP_MONTH: string;
  PROPERTY_NAME: string;
  PROPERTY_PUBLIC_ID: string | null;
  IS_IN_NETWORK: boolean;
  HAS_MARKETING_INTEGRATION: boolean | null;
  IS_MARKETING_OPT_IN: boolean | null;
}

export interface TierSplit<T> {
  silver: T[];
  platinum: T[];
  unclassified: T[];
}

/** Property key. Flask keys on property_public_id; Clark's RawRowSchema allows it to be null,
 * so a null id falls back to PROPERTY_NAME (the key the rest of this port counts properties by). */
function propertyKey(r: TierRow): string {
  return r.PROPERTY_PUBLIC_ID ?? r.PROPERTY_NAME;
}

/**
 * Flask `split_tier_frames`: partition property-month rows into silver / platinum / unclassified.
 *
 * Each property is classified ONCE, by its LATEST in-network row at or before
 * `latestCompletedMonth` (when given - the caller's already-computed reporting month; omit to
 * consider every in-network row): HAS_MARKETING_INTEGRATION must be TRUE for either tier
 * (DI-less -> unclassified), then IS_MARKETING_OPT_IN TRUE -> platinum, FALSE/null -> silver.
 * A property that flipped mid-window lands wholly in the tier of its latest month. Every tier
 * carries the property's FULL history (all of its input rows, in-network or not) so the existing
 * per-month aggregation runs on each tier exactly as on the whole set. Properties with no
 * in-network row at/before the cutoff are unclassified. The three arrays partition `rows` exactly.
 */
export function splitTierRows<T extends TierRow>(rows: T[], latestCompletedMonth?: string | null): TierSplit<T> {
  const out: TierSplit<T> = { silver: [], platinum: [], unclassified: [] };
  if (rows.length === 0) return out;
  const latest = new Map<string, T>();
  for (const r of rows) {
    if (r.IS_IN_NETWORK !== true) continue;
    if (latestCompletedMonth && r.BP_MONTH > latestCompletedMonth) continue;
    const key = propertyKey(r);
    const cur = latest.get(key);
    // >= : a later row in input order wins a same-month tie, like pandas' stable sort + tail(1).
    if (!cur || r.BP_MONTH >= cur.BP_MONTH) latest.set(key, r);
  }
  const silverIds = new Set<string>();
  const platinumIds = new Set<string>();
  for (const [key, r] of latest) {
    const hasMi = r.HAS_MARKETING_INTEGRATION === true;
    if (!hasMi) continue;
    if (r.IS_MARKETING_OPT_IN === true) platinumIds.add(key);
    else silverIds.add(key);
  }
  for (const r of rows) {
    const key = propertyKey(r);
    if (silverIds.has(key)) out.silver.push(r);
    else if (platinumIds.has(key)) out.platinum.push(r);
    else out.unclassified.push(r);
  }
  return out;
}

// ─── Counterfactual ──────────────────────────────────────────────────────────────────────

/** One row of the per-month totals (monthlyTotals shape in get-pmc-monthly-report.ts), for one
 * tier. residents = billsPaid, matching Flask's bills_paid. */
export interface TierMonthlyRow {
  month: string;
  units: number;
  billsPaid: number;
  rentPaid: number;
  propertyCount: number;
}

/** Peer p50 by month: a plain rate, or the rollingPeerMedianMap entry shape ({ p50, ... }). */
export type PeerRateByMonth = Record<string, number | { p50?: number | null } | null | undefined>;

export interface CounterfactualMonth {
  month: string;
  silverUnits: number;
  silverResidents: number;
  silverRate: number;
  silverRent: number;
  /** rentPaid / billsPaid that month; null when no paying residents (Flask: None). */
  silverAvgRent: number | null;
  cfRate: number | null;
  cfResidents: number | null;
  /** Signed: cfResidents - silverResidents. */
  extraResidents: number | null;
  extraRent: number | null;
  cfRent: number | null;
}

export interface CounterfactualTotals {
  extraResidents: number;
  extraRent: number;
  silverResidents: number;
  cfResidents: number;
  silverRent: number;
  cfRent: number;
  monthsUsed: number;
}

export type CounterfactualSource = "own_platinum" | "peers" | null;

export interface PlatinumCounterfactual {
  source: CounterfactualSource;
  sourceLabel: string | null;
  /** Form message when source is null (Flask's exact strings). */
  reason: string | null;
  /** Months that contributed to the totals (had a source rate and silver units > 0). */
  months: string[];
  /** Every silver window month; cf_* null where the chosen source had no rate. */
  byMonth: CounterfactualMonth[];
  totals: CounterfactualTotals;
  silverWindowRate: number | null;
  cfWindowRate: number | null;
  ownPlatinumRate: number | null;
  peerRate: number | null;
  latest: CounterfactualMonth | null;
  silverProperties: number;
  platinumProperties: number;
}

function monthKey(v: string): string {
  return String(v).slice(0, 10);
}

/** Flask `_peer_rate_map`: {month: rate | {p50}} -> {"YYYY-MM-DD": number}; unusable p50s dropped. */
function peerRateMap(peerRateByMonth: PeerRateByMonth | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(peerRateByMonth ?? {})) {
    const raw = v != null && typeof v === "object" ? v.p50 : v;
    const f = Number(raw);
    if (raw == null || !Number.isFinite(f)) continue;
    out[monthKey(k)] = f;
  }
  return out;
}

interface Evaluation {
  byMonth: CounterfactualMonth[];
  months: string[];
  totals: CounterfactualTotals;
  silverWindowRate: number;
  cfWindowRate: number;
  latest: CounterfactualMonth;
}

/**
 * Flask `platinum_counterfactual`: month-by-month "what if the silver properties had converted at
 * the counterfactual rate".
 *
 * silverMonthly / platinumMonthly are the per-month totals for the subject's silver and platinum
 * tiers (splitTierRows -> the existing per-month aggregation); peerRateByMonth is the platinum-peer
 * median series (rollingPeerMedianMap built with optInOnly); window = the last N silver months.
 *
 * Source (Kevin's order): own platinum properties if >= PLATINUM_MIN_PROPERTIES of them are
 * in-network at the latest month AND they beat silver over the window; else platinum peers if
 * they beat silver over the window; else null with `reason`. "Beat over the window" = sum over
 * months of (cfRate - silverRate) x silverUnits > 0 - units-weighted, never an average of
 * percentages. Months where the chosen source has no rate are left out of the totals (their
 * byMonth row keeps cf* = null).
 *
 * Per month: cfResidents = cfRate x silverUnits; extraResidents = cfResidents - silverResidents
 * (signed); extraRent = extraResidents x the SILVER tier's own avg rent per paying resident that
 * month (rentPaid / billsPaid; a month with 0 paying residents uses the silver window-wide
 * average, 0 if that is undefined too). Never peers' rents. silverWindowRate / cfWindowRate are
 * pooled over the used months; ownPlatinumRate = pooled platinum bills / units over the same
 * months; peerRate = silver-units-weighted peer p50. Both are returned whenever computable so the
 * conclusion table can show them side by side; `source` marks the one the charts draw.
 */
export function platinumCounterfactual(
  silverMonthly: TierMonthlyRow[] | null | undefined,
  platinumMonthly: TierMonthlyRow[] | null | undefined,
  peerRateByMonth: PeerRateByMonth | null | undefined,
  windowMonths: number,
  peerLabel?: string | null,
): PlatinumCounterfactual {
  const result: PlatinumCounterfactual = {
    source: null, sourceLabel: null, reason: null,
    months: [], byMonth: [],
    totals: { extraResidents: 0, extraRent: 0, silverResidents: 0, cfResidents: 0, silverRent: 0, cfRent: 0, monthsUsed: 0 },
    silverWindowRate: null, cfWindowRate: null,
    ownPlatinumRate: null, peerRate: null, latest: null,
    silverProperties: 0, platinumProperties: 0,
  };
  if (!silverMonthly || silverMonthly.length === 0) {
    result.reason = "no silver properties in this window";
    return result;
  }
  let s = [...silverMonthly].sort((a, b) => a.month.localeCompare(b.month));
  if (windowMonths && Math.trunc(windowMonths) > 0) s = s.slice(-Math.trunc(windowMonths));
  const silverProps = Math.trunc(s[s.length - 1].propertyCount ?? 0);
  result.silverProperties = silverProps;
  if (silverProps < PLATINUM_MIN_PROPERTIES) {
    result.reason = `fewer than ${PLATINUM_MIN_PROPERTIES} silver properties`;
    return result;
  }

  const silverRows: CounterfactualMonth[] = s.map((r) => {
    const units = Number(r.units) || 0;
    const bills = Number(r.billsPaid) || 0;
    const rent = Number(r.rentPaid) || 0;
    return {
      month: monthKey(r.month),
      silverUnits: units, silverResidents: bills,
      silverRate: units > 0 ? bills / units : 0,
      silverRent: rent,
      silverAvgRent: bills > 0 ? rent / bills : null,
      cfRate: null, cfResidents: null, extraResidents: null, extraRent: null, cfRent: null,
    };
  });

  const platUnits: Record<string, number> = {};
  const platBills: Record<string, number> = {};
  let platProps = 0;
  if (platinumMonthly && platinumMonthly.length > 0) {
    const p = [...platinumMonthly].sort((a, b) => a.month.localeCompare(b.month));
    platProps = Math.trunc(p[p.length - 1].propertyCount ?? 0);
    for (const r of p) {
      const k = monthKey(r.month);
      platUnits[k] = Number(r.units) || 0;
      platBills[k] = Number(r.billsPaid) || 0;
    }
  }
  result.platinumProperties = platProps;
  const ownRates: Record<string, number> = {};
  for (const [k, u] of Object.entries(platUnits)) if (u > 0) ownRates[k] = platBills[k] / u;
  const peerRates = peerRateMap(peerRateByMonth);

  const evaluate = (rateMap: Record<string, number>): Evaluation | null => {
    const rows: CounterfactualMonth[] = silverRows.map((r) => ({ ...r, cfRate: rateMap[r.month] ?? null }));
    const used = rows.filter((r) => r.cfRate != null && r.silverUnits > 0);
    if (used.length === 0) return null;
    const totUnits = used.reduce((a, r) => a + r.silverUnits, 0);
    const totBills = used.reduce((a, r) => a + r.silverResidents, 0);
    const totRent = used.reduce((a, r) => a + r.silverRent, 0);
    const fallbackAvg = totBills > 0 ? totRent / totBills : 0;
    for (const r of used) {
      r.cfResidents = r.cfRate! * r.silverUnits;
      r.extraResidents = r.cfResidents - r.silverResidents;
      const avg = r.silverAvgRent != null ? r.silverAvgRent : fallbackAvg;
      r.extraRent = r.extraResidents * avg;
      r.cfRent = r.silverRent + r.extraRent;
    }
    const cfRes = used.reduce((a, r) => a + r.cfResidents!, 0);
    return {
      byMonth: rows,
      months: used.map((r) => r.month),
      totals: {
        extraResidents: used.reduce((a, r) => a + r.extraResidents!, 0),
        extraRent: used.reduce((a, r) => a + r.extraRent!, 0),
        silverResidents: totBills, cfResidents: cfRes,
        silverRent: totRent, cfRent: used.reduce((a, r) => a + r.cfRent!, 0),
        monthsUsed: used.length,
      },
      silverWindowRate: totBills / totUnits,
      cfWindowRate: cfRes / totUnits,
      latest: used[used.length - 1],
    };
  };

  const ownEval = platProps >= PLATINUM_MIN_PROPERTIES && Object.keys(ownRates).length > 0 ? evaluate(ownRates) : null;
  const peerEval = Object.keys(peerRates).length > 0 ? evaluate(peerRates) : null;
  if (ownEval) {
    const pu = ownEval.months.reduce((a, k) => a + (platUnits[k] ?? 0), 0);
    result.ownPlatinumRate = pu > 0 ? ownEval.months.reduce((a, k) => a + (platBills[k] ?? 0), 0) / pu : null;
  }
  if (peerEval) result.peerRate = peerEval.cfWindowRate;

  let chosen: Evaluation;
  if (ownEval && ownEval.totals.extraResidents > 0) {
    chosen = ownEval;
    result.source = "own_platinum";
    result.sourceLabel = PLATINUM_OWN_LABEL;
  } else if (peerEval && peerEval.totals.extraResidents > 0) {
    chosen = peerEval;
    result.source = "peers";
    result.sourceLabel = peerLabel || PLATINUM_PEERS_DEFAULT_LABEL;
  } else {
    result.reason = (ownEval || peerEval)
      ? "your silver properties already match or beat the counterfactual"
      : "no platinum peer pool at this size";
    return result;
  }
  result.byMonth = chosen.byMonth;
  result.months = chosen.months;
  result.totals = chosen.totals;
  result.silverWindowRate = chosen.silverWindowRate;
  result.cfWindowRate = chosen.cfWindowRate;
  result.latest = chosen.latest;
  return result;
}
