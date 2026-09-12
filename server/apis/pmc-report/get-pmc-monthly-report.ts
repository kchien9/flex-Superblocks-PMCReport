import { api, z, snowflake, restApiIntegration } from "@superblocksteam/sdk-api";
import {
  renderMetrosightEvidence,
  renderResidentsUnitsCombo,
  renderSinceInception,
  renderQbrClose,
  renderLaunchSnapshot,
  renderHighRentAdoption,
  renderAdoptionTrend,
  renderPropertiesWorthCelebrating,
  renderAdoptionOpportunities,
  renderPeerBenchmarks,
  renderDelinquency,
  delinquencyWindowMonths,
  renderRetention,
  renderCustomerExperience,
  computePropertyTrendFlags,
  renderImportedSlide,
  renderPortfolioComparison,
  displayEntityNames,
  entitySwitchButton,
  sparklineSvg,
  previousCalendarQuarters,
  buildQuarterAddsSeries,
  renderPlatinumCover,
  renderPlatinumClose,
  platinumHeadline,
  // "Jun 2026" (Flask _month_label) - this file's own monthLabel prints the long month name.
  monthLabel as shortMonthLabel,
  // "September 2026" (Flask _month_full) - Exec Summary subtitle ONLY.
  monthFull,
} from "./slide-renderers.js";
import type { BenchmarkMetric, ResidentTrend, Testimonial, TrendFlag, YearlyData, NewRolloutCandidate, DisabledPropertyRow, PortfolioComparisonEntity, QuarterAddsBlock, QuarterAddsSeries } from "./slide-renderers.js";
import { buildSpeakerNotesHtml, buildExpansionSpeakerNotesHtml, EXPANSION_SLIDE_TITLES, buildPlatinumSpeakerNotesHtml, buildCheckinSpeakerNotesHtml } from "./speaker-notes.js";
import type { SpeakerNotesKpis, SpeakerNotesBenchmark, SpeakerNotesMonthlyRow } from "./speaker-notes.js";
import {
  renderExpansionMetrosight,
  renderExpansionGap,
  renderExpansionCaseClose,
} from "./expansion-renderers.js";
import {
  type NetworkPoolProperty,
  type SubjectPortfolioRow,
  propertyAgeBucket,
  resolvePropertyPeerNar,
  resolvePropertyPeerEngagement,
  resolveSubjectPortfolioUnits,
  largestPmcsPeerTier,
  rollingPeerMedianSql,
  stageBenchmarkSql,
} from "./peer-matching.js";
// The deck's single set of number formatters - see formatters.ts for why they live in one
// place now (three drifted copies, e.g. 999,999,000 -> "$1000.0M" here vs Flask's "$1.0B").
import { fmtCurrency, fmtPct, fmtPct100, fmtPp } from "./formatters.js";
import { peerCriteriaLabel, splitTierRows, platinumCounterfactual, PLATINUM_MIN_PROPERTIES } from "./platinum.js";
import type { PeerRateByMonth } from "./platinum.js";
import { parseCheckinMonth, checkinLookback, checkinProjectionEnd, checkinSummary, renderCheckinCover, renderAdoptionCheckin } from "./checkin.js";
import { applyGeoRules, buildGeoLookups, cachedNetworkZipGeo, UNKNOWN_REGION } from "./geo-regions.js";
import type { NetworkZipGeoRow, RegionDetailRow } from "./geo-regions.js";
// Embed → DI deck (deck_mode "embed"): its own data layer + slides, plus the shared peer benchmark
// (Platinum floor) and market-map pipeline the New Logo deck uses.
import {
  resolveEmbedPmc, pullEmbedMonthly, summarizeEmbedMonthly, pullGraduationCurve,
  pullChannelRepeatRates, pullNiroSnapshot, pullSfTotalUnits, embedStatesFromDim,
  applyPropertyUpload, embedUploadRows, embedMarkets, embedProjectionRange,
  latestEmbedBpMonth, bpSafeCutoff, EMBED_MIN_MONTHS, EMBED_GATES,
} from "./embed.js";
import type { EmbedProperty } from "./embed.js";
import {
  renderEmbedCover, renderEmbedToday, renderEmbedGraduation, renderEmbedProjection,
  renderEmbedVisibility, renderEmbedNextSteps,
} from "./slides-embed.js";
import type { EmbedCtx } from "./slides-embed.js";
import { pullPeerBenchmark, pullPeerPlatinumRate } from "./peer-benchmark.js";
import { geocodeAddressesConcurrent } from "./market-map-geocode.js";
import type { CensusGeocoderClient } from "./market-map-geocode.js";
import {
  assignMarkets, pullMarketSummary, fetchRelevantNetworkPins, filterProspectPinsForMarket,
  filterPinsNearAny,
} from "./market-map-data.js";
import type { Market, MarketSummary, SimilarityInfo, ProspectPin, NetworkPin } from "./market-map-data.js";
import { renderMarketMap } from "./market-map-slides.js";
import type { SubjectEmbed } from "./market-map-slides.js";
import { buildEmbedSpeakerNotesHtml } from "./speaker-notes.js";
import type { Benchmarks } from "./slides-prospect.js";
// The faithful port of Flask's render_affordable_housing_slide (generator/slides.py:8408) -
// see the "high_rent" / evidence_type === "affordable" case below for why the Expansion deck
// now calls THIS one instead of expansion-renderers' renderAffordableHousing.
import { renderAffordableHousingSlide } from "./slides-prospect.js";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";
// "Census Geocoder" REST API integration (the same one GetProspectDeck declares) - only the
// Embed deck's market-map slides use it here.
const CENSUS_GEOCODER_ID = "3d0e85c7-61d4-402f-bf97-64a3428c15a4";

/** { html, js } - slide-renderers.ts's SlideResult, restated locally for the embed pushSlide. */
interface SlideResultLike { html: string; js: string }

// ─── Shared row shape for the property-pool peer-matching query below ───
type NetworkPoolRow = { PMC_NAME: string; PROPERTY_NAME: string; PROPERTY_STATE: string | null; PROPERTY_UNIT_COUNT: number; RENT_PAID_AMOUNT: number | null; BILLS_PAID_COUNT: number | null; ROLLOUT_MONTH: string | null; T12_CONNECTIONS: number | null; MEDIAN_RENTER_INCOME: number | null };

// ─── Peer-matching geo helpers (faithful port of Flask's generator/data.py:1047-1440) ───
// Ported because the peer-median/Peer Benchmarks cohort was found to diverge from Flask's:
// the tier ladder further down was missing the multi-state overlap tier AND the region tier
// entirely, and its "footprint" tiers didn't actually check footprint (no bucket match — they
// behaved like Flask's unconditional "none" tiers under a misleading label). All four pieces
// below exist purely to let the tier ladder match Flask's real ladder tier-for-tier.
const STATE_TO_REGION: Record<string, string> = {
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

/** Flask: _dominant_region (generator/data.py:1298) — only a real >=45% plurality counts as a
 * region identity; a genuinely national footprint (e.g. 36/35/23% split) must fall through to
 * the footprint-bucket tiers instead of being mislabeled with whichever region barely edges out. */
function dominantRegion(stateUnits: Map<string, number>, minShare = 0.45): string | null {
  const regionUnits = new Map<string, number>();
  for (const [st, units] of stateUnits) {
    const r = STATE_TO_REGION[st];
    if (r) regionUnits.set(r, (regionUnits.get(r) ?? 0) + units);
  }
  if (regionUnits.size === 0) return null;
  let total = 0;
  for (const u of regionUnits.values()) total += u;
  if (total <= 0) return null;
  let topRegion = "", topUnits = -1;
  for (const [r, u] of regionUnits) { if (u > topUnits) { topUnits = u; topRegion = r; } }
  return topUnits / total >= minShare ? topRegion : null;
}

/** Flask: _primary_state_if_dominant (generator/data.py:1325) — same real-plurality guard
 * (>=35%) as dominantRegion, one level down. A PMC spread thin across many states in one
 * region has no single-state identity and should fall through to region matching instead. */
function primaryStateIfDominant(stateUnits: Map<string, number>, minShare = 0.35): string | null {
  let total = 0;
  for (const u of stateUnits.values()) total += u;
  if (total <= 0) return null;
  let topState = "", topUnits = -1;
  for (const [st, u] of stateUnits) { if (u > topUnits) { topUnits = u; topState = st; } }
  return topUnits / total >= minShare ? topState : null;
}

/** Flask: _fp_bucket (generator/data.py:1426) — footprint bucket by state count. */
function fpBucket(stateCount: number): string {
  if (stateCount <= 1) return "single";
  if (stateCount <= 4) return "regional";
  if (stateCount <= 9) return "multi";
  return "national";
}

interface GeoTierCandidate { name: string; totalUnits: number; stateUnits: Map<string, number> }

/** Flask: _resolve_geo_tier (generator/data.py:1341) — multi-state overlap matching, tried
 * BEFORE the dominant-state/region/footprint tiers below. A subject genuinely present in two
 * states with neither dominant (e.g. real CA+WA presence) previously reduced to
 * primaryState=null/dominantRegion=null and fell straight to a count-based footprint bucket
 * with no attempt to find peers who ALSO operate in those same states — this fixes that blind
 * spot without replacing the existing tiers, which remain the fallback when no overlap match. */
function resolveGeoTier<T extends GeoTierCandidate>(
  candidates: T[],
  subjectStateUnits: Map<string, number>,
  minPoolSize = 3
): { matched: T[]; label: string; isOverlap: boolean } {
  const subjectStates = new Set<string>();
  for (const [st, u] of subjectStateUnits) if (u > 0) subjectStates.add(st);
  if (subjectStates.size === 0 || candidates.length === 0) {
    return { matched: [], label: "", isOverlap: false };
  }

  const overlapUnits = (su: Map<string, number>) => {
    let s = 0;
    for (const [st, u] of su) if (subjectStates.has(st)) s += u;
    return s;
  };
  const coverage = (su: Map<string, number>) => {
    let c = 0;
    for (const st of subjectStates) if ((su.get(st) ?? 0) > 0) c++;
    return c;
  };

  const withMeta = candidates.map((c) => {
    const ov = overlapUnits(c.stateUnits);
    return { c, overlapUnits: ov, coverage: coverage(c.stateUnits), concentration: c.totalUnits > 0 ? ov / c.totalUnits : 0 };
  });

  const nStates = subjectStates.size;
  const notThin = minPoolSize * 2;
  const sortedStates = [...subjectStates].sort();
  const statesLabel = nStates <= 6 ? sortedStates.join(", ") : "your markets";

  // Tier 1: true 1:1 — candidate's own portfolio is >=70% concentrated inside the subject's
  // states AND covers every one of them.
  const t1 = withMeta.filter((m) => m.concentration >= 0.70 && m.coverage >= nStates && m.overlapUnits > 0);
  if (t1.length >= minPoolSize) {
    return { matched: t1.map((m) => m.c), label: `true 1:1 match in ${statesLabel}`, isOverlap: true };
  }

  // Tier 2: both-state presence — covers every one of the subject's states, any concentration.
  if (nStates >= 2) {
    const t2 = withMeta.filter((m) => m.coverage >= nStates && m.overlapUnits > 0);
    if (t2.length >= notThin) {
      return { matched: t2.map((m) => m.c), label: `presence in every one of ${statesLabel}`, isOverlap: true };
    }
  }

  // Tier 3: any real overlap presence in at least one of the subject's states.
  const t3 = withMeta.filter((m) => m.overlapUnits > 0);
  if (t3.length >= minPoolSize) {
    return { matched: t3.map((m) => m.c), label: `presence in ${statesLabel}`, isOverlap: true };
  }

  return { matched: [], label: "", isOverlap: false };
}

const RawRowSchema = z.object({
  BP_MONTH: z.string(),
  PROPERTY_NAME: z.string(),
  PMC_NAME: z.string(),
  PROPERTY_UNIT_COUNT: z.coerce.number(),
  ROLLOUT_MONTH: z.string().nullable(),
  CHARGED_USERS: z.coerce.number(),
  NEW_SIGNUPS: z.coerce.number().nullable(),
  BILLS_PAID: z.coerce.number(),
  RENT_PAID: z.coerce.number(),
  PROPERTY_PUBLIC_ID: z.string().nullable(),
  IS_IN_NETWORK: z.boolean(),
  PROPERTY_STATE: z.string().nullable(),
  NEW_BILL_CONNECTIONS: z.coerce.number(),
  HUBSPOT_DEAL_TOTAL_COMPANY_UNITS: z.coerce.number().nullable(),
  // Internal Flex sales/CS team assignment (Flask: app.py "segment_team", used as the mode
  // across a PMC's rows to detect SMB-managed accounts) — NOT a HubSpot company-segment field.
  SEGMENT_TEAM: z.string().nullable(),
  // Whether the marketing integration is technically wired up — a DIFFERENT flag from actual
  // opt-in (below). Kept for whatever else already reads it (e.g. the D2C-split unit count
  // further down this file); NOT the badge driver — see IS_MARKETING_OPT_IN.
  HAS_MARKETING_INTEGRATION: z.boolean().nullable(),
  // Direct-to-resident marketing opt-in (Flask: is_marketing_opt_in) — the actual driver of the
  // "Direct Marketing on/off" badge and D2C tiebreaker on the Property Deep Dive slides. Kevin's
  // catch: this file previously read HAS_MARKETING_INTEGRATION for that badge instead, a
  // genuinely different per-property flag (integration wired up ≠ opted in to direct
  // marketing), which produced a scattered, per-property mismatch against Flask's badges.
  IS_MARKETING_OPT_IN: z.boolean().nullable(),
});

// Partner-relevant deactivation reasons (Flask: PARTNER_DEACTIVATION_REASONS, generator/data.py:3860)
// — internal ops codes are excluded entirely (not in this map, filtered out at the query's
// WHERE clause). Human-friendly labels for the "No Longer Active" section.
const DEACTIVATION_LABELS: Record<string, string> = {
  CHURN_PARTNER_PROCESS: "Churned — misalignment with Flex",
  CHURN_PRODUCT: "Churned — product dissatisfaction",
  PARTNER_VOLUNTARY_CHURN: "Churned",
  FAILED_TO_ACTIVATE: "Failed to activate",
  PMC_TO_PMC_TRANSFER: "Transferred to new management",
  PARTNER_INITIATED_LOSS_OF_API_ACCESS: "API access revoked — needs investigation",
};

// --- Helpers ---

/**
 * The QBR slide picker's gate: given the `qbr_slides` input (SlidesPicker's QBR_SLIDES ids),
 * returns a predicate saying whether a given slide key was selected.
 *
 * An omitted or EMPTY list means "no filter" — render everything. That's deliberate and
 * matches both Flask (`body.get("slides", list(SLIDE_RENDERERS.keys()))`) and this file's own
 * `expansion_slides` handling: every caller that predates this field sends nothing, and they
 * must keep getting the whole deck rather than an empty one.
 *
 * Exported so the picker contract is directly testable — see
 * __tests__/qbr-slide-picker.test.ts.
 */
export function qbrSlidePicked(qbrSlides: string[] | undefined): (key: string) => boolean {
  const selected = qbrSlides && qbrSlides.length > 0 ? new Set(qbrSlides) : null;
  return (key: string) => selected === null || selected.has(key);
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Re-stamp one slide's internal ids from `oldId` to `newId` (its final 1-based document
 * position after `.filter(Boolean)` dropped the empty slides).
 *
 * These six patterns are the WHOLE of what renumbering can reach. Notably absent, and not
 * fixable here: a bare `N` inside an `onclick` argument list, which is indistinguishable from
 * any other number in JS source. So a handler must never use its passed id for anything these
 * patterns rewrite — see SLIDE_DOM_HELPERS_JS in slide-renderers.ts, and the
 * __tests__/renumber-safety.test.ts that pins the invariant.
 *
 * Exported so that test can renumber with the REAL regexes rather than a drifting copy.
 */
export function renumberSlideHtml(html: string, oldId: string, newId: string): string {
  return html
    .replace(new RegExp(`id="slide-${oldId}"`, "g"), `id="slide-${newId}"`)
    .replace(new RegExp(`#slide-${oldId}\\b`, "g"), `#slide-${newId}`)
    .replace(new RegExp(`id="chart${oldId}"`, "g"), `id="chart${newId}"`)
    .replace(new RegExp(`chart${oldId}(?=['"])`, "g"), `chart${newId}`)
    .replace(new RegExp(`initSlide${oldId}`, "g"), `initSlide${newId}`)
    .replace(new RegExp(`slide-${oldId}(?=['"\\.\\s])`, "g"), `slide-${newId}`);
}

function monthLabel(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function monthOnly(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}

// Reporting-month labelling (Kevin, 2026-09-09: "can we be clear that we're showing September
// BP month (which is technically like August cal)... don't want to invite questions of 'we're
// only 9 days into September'"): every place the deck prints the reporting month as a label
// says "BP month" / "BP" (footer, cover, table headers, delta pills); chart axis ticks are left
// alone. EXCEPTION (Kevin 2026-09-10, "this is too wordy too - just say coast property mgmt -
// september 2026 (remove bp month), partner since date"; Flask 56265fa): the Exec Summary
// subtitle prints the bare full month and no longer carries the one-line "Months are Flex
// bill-pay (BP) months..." definition - that sentence survives only in the Adoption Check-in
// footnote (checkin.ts bpMonthExplainer).

// A closed-won opp this many months (or more) before the PMC's first BP row is a deal that never
// launched (or churned and re-signed), not the start of the partnership. Shared by the
// partner-since combine (rolloutDatePromise / partnerSince) and the tenure-percentile population
// CTE so the subject and its ranking peers are dated by the same rule. Flask c2e2057
// (_STALE_OPP_GAP_MONTHS).
const STALE_OPP_GAP_MONTHS = 12;

/** Whole calendar months from `earlier` to `later` (YYYY-MM-DD strings), like Snowflake's
 * DATEDIFF('month'). Flask _months_after. */
function monthsAfter(earlier: string, later: string): number {
  const [ay, am] = earlier.slice(0, 7).split("-").map(Number);
  const [by, bm] = later.slice(0, 7).split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

// Snowflake's PMC_NAME sometimes carries a "(FKA <old name>)" suffix for continuity after a
// rename/acquisition (e.g. "AG Living (FKA Ashland Greene Capital Partners)"). Useful in a
// system-of-record, but reads as clutter on every slide title across QBR/Expansion/New Logo —
// strip it for display everywhere the PMC name is shown, while leaving the raw pmc_name
// variable itself untouched everywhere it's used as a query parameter.
function stripFkaSuffix(name: string): string {
  return name.replace(/\s*\(\s*FKA\b[^)]*\)\s*$/i, "").trim();
}

function yearOnly(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { year: "numeric", timeZone: "UTC" });
}

function _e(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// fmtPct / fmtCurrency / fmtPct100 / fmtPp now come from ./formatters.js - ONE implementation
// each, shared with the other renderer modules (see that file's header for the three-way
// divergence this replaced, e.g. 999,999,000 printing here as "$1000.0M" against Flask's
// "$1.0B"). This file's own local copies are gone.

// Resident/household terminology toggle (Kevin's ask, 2026-08-19) — applied once to a fully-
// assembled HTML document (deck or speaker notes), not threaded through every render
// function. Ports Flask's app.py:_apply_terminology (recently made bidirectional there too).
// Safe as a whole-word substitution: every "resident"-containing identifier/dict-key in this
// codebase either never appears as literal text in rendered output, or is a compound
// identifier with no word boundary at "resident(s)" (e.g. residentsAlign), so \b skips it.
const TERM_MAP: Record<string, string> = {
  Residents: "Households", residents: "households",
  Resident: "Household", resident: "household",
  RESIDENTS: "HOUSEHOLDS", RESIDENT: "HOUSEHOLD",
};
const TERM_MAP_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(TERM_MAP).map(([k, v]) => [v, k])
);

function applyTerminology(html: string, terminology: string | undefined): string {
  const mapping = terminology === "household" ? TERM_MAP : TERM_MAP_REVERSE;
  let out = html;
  for (const [src, dst] of Object.entries(mapping)) {
    out = out.replace(new RegExp(`\\b${src}\\b`, "g"), dst);
  }
  return out;
}

function rentWindowLabel(opts: { partnerSince: string | null; lookbackMonths: number; coversFullTenure: boolean }): string {
  if (opts.coversFullTenure && opts.partnerSince) {
    return `since ${monthLabel(opts.partnerSince)}`;
  }
  return `last ${opts.lookbackMonths} months`;
}

// sparklineSvg moved to slide-renderers.ts (Task 13) - exported and imported from there now, so
// the new Portfolio Comparison table's per-row trend cell reuses this exact mechanism instead of
// a second one, and this file no longer keeps its own separate copy.

// --- HTML Slide Renderers ---

/**
 * Exported ONLY so __tests__/expansion-cover.test.ts can assert the Expansion cover's
 * "Total Portfolio" tile (same reason renderExecSummary below is exported). The deck builds this
 * slide through the in-module call sites, as it always has.
 */
export function renderCover(kpis: { pmcName: string; reportingMonth: string; partnerSince: string | null; propertyCount: number; firstMonth: string | null; isExpansion?: boolean; totalUnits?: number; totalPortfolioUnits?: number }): string {
  // Deck label / props label vary by mode (Flask render_cover, generator/slides.py:53-67).
  // Only branching on is_expansion here (Kevin's catch). Flask's old third branch, is_pitch_mode
  // ("Flex Integration Opportunity" / OON-specific props label), is gone: Pitch Mode was deleted
  // in Flask and replaced by the Embed → DI deck, which has its own cover (renderEmbedCover in
  // slides-embed.ts) and never reaches this function.
  const deckLabel = kpis.isExpansion ? "Portfolio Expansion Opportunity" : "Flex Performance Review";
  const propsLabel = kpis.isExpansion ? "Properties on Flex" : "Properties Active";
  // Third tile: "Reporting Period" (firstMonth–reportingMonth) on QBR, "Total Portfolio"
  // ("1,232 of 11,000 units") on Expansion - Flask's render_cover, generator/slides.py:310-311.
  // The Expansion framing was previously dropped entirely (Kevin's ask was only to kill the
  // "Reporting Period"/"Track Record" label on a deck that isn't a review), which left the
  // Expansion cover with no portfolio size on it at all - the one number the whole deck argues
  // about. Restored as Flask has it, and it self-gates: no resolved total, no tile.
  // "BP month(s)" suffix (Kevin's ask) so the period reads as Flex bill-pay months, not calendar
  // months (the Exec Summary subtitle itself is the one label that prints the bare month - see
  // the reporting-month labelling note near the top of this file).
  const periodRange = kpis.firstMonth
    ? `${monthLabel(kpis.firstMonth)} – ${monthLabel(kpis.reportingMonth)} BP months`
    : `${monthLabel(kpis.reportingMonth)} BP month`;
  const totalPortfolioUnits = kpis.totalPortfolioUnits ?? 0;
  const thirdTile = kpis.isExpansion
    ? (totalPortfolioUnits > 0
        ? { label: "Total Portfolio", value: `${(kpis.totalUnits ?? 0).toLocaleString("en-US")} of ${totalPortfolioUnits.toLocaleString("en-US")} units` }
        : null)
    : { label: "Reporting Period", value: periodRange };
  const periodTileHtml = thirdTile === null ? "" : `
      <div><div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.28);margin-bottom:6px;font-family:'ABCDiatype',sans-serif;">${thirdTile.label}</div>
           <div style="font-size:16px;font-weight:600;color:rgba(255,255,255,0.85);font-family:'ABCDiatype',sans-serif;">${thirdTile.value}</div></div>`;
  return `
  <div class="slide active" id="slide-1" style="background:#2C194D;justify-content:center;align-items:flex-start;">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#DDC6F9;margin-bottom:20px;font-weight:600;font-family:'ABCDiatype',sans-serif;">${deckLabel}</div>
    <div style="font-size:76px;font-weight:500;line-height:1.0;color:#fff;margin-bottom:12px;letter-spacing:-0.02em;font-family:'ABCDiatype',sans-serif;">${kpis.pmcName}</div>
    <div style="font-size:22px;font-weight:400;color:rgba(255,255,255,0.45);margin-bottom:72px;font-family:'ABCDiatype',sans-serif;">${monthLabel(kpis.reportingMonth)} BP month</div>
    <div style="display:flex;gap:52px;">
      <div><div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.28);margin-bottom:6px;font-family:'ABCDiatype',sans-serif;">Partner Since</div>
           <div style="font-size:16px;font-weight:600;color:rgba(255,255,255,0.85);font-family:'ABCDiatype',sans-serif;">${monthLabel(kpis.partnerSince)}</div></div>
      <div><div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.28);margin-bottom:6px;font-family:'ABCDiatype',sans-serif;">${propsLabel}</div>
           <div style="font-size:16px;font-weight:600;color:rgba(255,255,255,0.85);font-family:'ABCDiatype',sans-serif;">${kpis.propertyCount.toLocaleString("en-US")}</div></div>
      ${periodTileHtml}
    </div>
    <div style="position:absolute;right:100px;top:50%;transform:translateY(-50%);width:380px;height:380px;border-radius:50%;background:radial-gradient(circle,rgba(106,61,184,0.22) 0%,transparent 68%);"></div>
    <div style="position:absolute;bottom:60px;right:80px;font-size:28px;font-weight:500;letter-spacing:-0.04em;color:rgba(255,255,255,0.15);font-family:'ABCDiatype',sans-serif;">flex</div>
  </div>`;
}

/**
 * Exported ONLY so __tests__/exec-switcher-wiring.test.ts can render a combined Exec Summary
 * and assert the switcher's wiring is complete. Nothing else imports it - the deck builds this
 * slide through renderExecSummary below, in-module, as it always has.
 */
export interface ExecSummaryInput {
  slideId: number;
  pmcName: string;
  reportingMonth: string;
  partnerSince: string | null;
  lookbackMonths: number;
  targetNar: number;
  currentNar: number;
  currentResidents: number;
  currentRent: number;
  currentNewSignups: number;
  lifetimeRent: number;
  propertyCount: number;
  totalUnits: number;
  prevNar: number | null;
  prevResidents: number | null;
  prevRent: number | null;
  prevNewSignups: number | null;
  prevPropertyCount: number | null;
  prevUnits: number | null;
  monthlyTotals: { month: string; billsPaid: number; units: number; rentPaid: number; newSignups: number; adoptionRate: number; establishedNar?: number | null }[];
  trueRepeatRate: number | null;
  lifetimeDqShielded: number | null;
  dqSinceComparison: number | null;
  execNotes?: string;
  showSparklines?: boolean;
  // Kevin's ask: an explicit form-level control over the exec tile's period-comparison pills
  // (rent %, DQ $, etc. - anything using the shared "_vs" delta pill builder below), independent
  // of showSparklines. The live in-deck toggle button (deltaToggle below) already lets an AE
  // flip this DURING a meeting; this just sets which state it STARTS in when the deck is
  // generated, same relationship showSparklines already has to the individual sparkline
  // toggle buttons.
  hidePeriodComparison?: boolean;
  vsLabel?: string;
  // Keys: active_properties, residents_paying, new_residents, adoption_rate, true_repeat_rate,
  // delinquency_shielded. Chosen at generation time (Kevin's ask) - see hidden_kpi_tiles on the
  // top-level input schema for why this isn't a live post-generation toggle.
  hiddenTiles?: string[];
  // One entry per combined entity's own current-month numbers (Task 9: Exec Summary switcher).
  // Built by the call site via groupRowsByPmc(latestRows), grouped + aggregated once per entity
  // instead of once overall. A switcher is rendered only when this has more than 1 entry - a
  // single-PMC report passes either [] or a 1-entry array and gets no switcher at all, with
  // output identical to before this field existed. The prev* fields are each entity's OWN
  // figures at the same comparison month the combined prevResidents/prevRent/prevNar/
  // prevPropertyCount above come from (null when the entity has no rows that month), so
  // switching entities swaps the period-comparison pills along with the tile values (Kevin's
  // catch: "the delta tiles only show change for the all-in PMC and don't update on the
  // subsidiaries"). currentNewSignups + monthly (Kevin's follow-up on the hero sub-line: "this
  // number doesnt change based on the pmc selected either") let the switcher swap EVERY node the
  // Combined view derives from kpis/monthlyTotals - the hero window rent, the new-residents tile
  // + its "N last 3 months" sub-label, and all five sparklines - not just the four tile values.
  // `monthly` is this entity's own series over the same window monthlyTotals covers (sparse:
  // only months the entity has rows in, chronological), built from the same inNetwork rows, so
  // the per-entity figures sum exactly to the combined ones.
  //
  // dqShielded / dqSinceComparison are the Delinquency-shielded tile's value and its
  // since-comparison pill, per entity - the last node on this slide that didn't switch. The
  // tile used to be emitted with no id at all, so picking a subsidiary left the whole combined
  // portfolio's DQ dollar figure and its green pill on screen under that subsidiary's numbers:
  // plausible, and wrong. Flask has always swapped it (_exec_switch_ids["dq"] /
  // _exec_pill_ids["dq"], generator/slides.py:9057/9068, emitted at :9546-9549), fed by these
  // same two per-entity values (app.py:2204-2229); the call site's entityDqFor computes them
  // from a dedicated per-entity DQ_PROPERTY pull. null means "no shielded rent for this entity
  // in the window", which renders the same em-dash + empty pill Combined shows in that state.
  //
  // What STILL doesn't switch, deliberately: True repeat rate. It comes from the retention
  // cohort / PARTNER_REPORTING_CORE_METRICS, computed at the combined level only - there is no
  // per-entity source for it anywhere in either repo, and Flask documents the same decision
  // (slides.py:9262-9266: "that one tile intentionally does NOT switch and always shows the
  // combined figure, documented rather than faked"). Do not give that tile an id.
  entityBreakdown?: {
    pmcName: string; currentResidents: number; currentRent: number; currentNar: number; propertyCount: number; totalUnits: number;
    prevResidents: number | null; prevRent: number | null; prevNar: number | null; prevPropertyCount: number | null;
    currentNewSignups: number;
    monthly: { month: string; billsPaid: number; units: number; rentPaid: number; newSignups: number; adoptionRate: number }[];
    dqShielded: number | null;
    dqSinceComparison: number | null;
  }[];
}

/**
 * Exported ONLY for __tests__/exec-switcher-wiring.test.ts (see ExecSummaryInput above).
 */
export function renderExecSummary(d: ExecSummaryInput): { html: string; js: string } {
  const slideId = d.slideId;
  const pmc = _e(d.pmcName);
  // Bare full month, no "BP month" suffix (Flask _month_full, 56265fa) - the ONE reporting-month
  // label in the deck that reads "September 2026". Deliberately monthFull and not this file's
  // own monthLabel: monthLabel happens to print a long month today, but it also feeds the cover
  // and every "… BP month" caption, so the subtitle must not depend on its format staying long.
  const reportingMonth = monthFull(d.reportingMonth);
  const nar = d.currentNar;

  // Partner since label
  let sinceLbl = "launch";
  if (d.partnerSince) {
    try {
      const dt = new Date(d.partnerSince + "T00:00:00Z");
      sinceLbl = dt.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    } catch { sinceLbl = d.partnerSince.slice(0, 7); }
  }

  // ── Delta pill builder (exec-delta class for toggle) ──────────────────────
  const _vs = d.vsLabel ?? "vs last month";
  function pill(cur: number, prev: number | null, fmt: "abs" | "pct" | "pp" | "currency"): string {
    if (prev === null || prev === 0) return "";
    const delta = cur - prev;
    if (Math.abs(delta) < 0.001 && fmt === "pp") return "";
    if (Math.abs(delta) < 1 && fmt !== "pp" && fmt !== "pct") return "";
    const pct = (delta / prev) * 100;
    const isUp = delta > 0;
    // Format the text first so we can detect rounded-to-zero
    // fmtPct100 / fmtPp, not .toFixed(1): Kevin's rule (shipped in Flask as _fmt_pct100 /
    // _fmt_pp, slides.py:60-69) is no bare trailing ".0" on any percentage the deck PRINTS.
    // These pills were the last inline ":.1f" in this file, so a clean +2% move rendered
    // "+2.0%" here while the identical number read "+2%" everywhere else in the deck.
    let txt: string;
    if (fmt === "pct") txt = fmtPct100(Math.abs(pct));
    else if (fmt === "pp") txt = fmtPp(Math.abs(delta) * 100);
    else if (fmt === "currency") txt = fmtCurrency(Math.abs(delta));
    else txt = Math.abs(Math.round(delta)).toLocaleString("en-US");
    // "No change" handling: if the formatted text would display as 0, show grey "No change" instead
    if (/^0(\.0+)?(pp|%|)$/.test(txt)) {
      const lbl = fmt === "pp" ? "adoption" : fmt === "pct" ? "change" : "";
      return `<div class="exec-delta" style="display:inline-block;background:rgba(156,163,175,0.10);color:#9ca3af;font-size:10px;font-weight:600;border-radius:5px;padding:2px 7px;margin-top:8px;">No change${lbl ? " " + lbl : ""} ${_vs}</div>`;
    }
    const bg = isUp ? "rgba(26,158,106,0.11)" : "rgba(220,80,80,0.09)";
    const col = isUp ? "#1a9e6a" : "#dc5050";
    const sign = isUp ? "+" : "\u2212";
    return `<div class="exec-delta" style="display:inline-block;background:${bg};color:${col};font-size:10px;font-weight:600;border-radius:5px;padding:2px 7px;margin-top:8px;">${sign}${txt} ${_vs}</div>`;
  }

  // ── Sparkline builder ─────────────────────────────────────────────────────
  function sparkSvg(values: number[], width = 72, height = 22): string {
    const valid = values.filter((v) => v > 0);
    if (valid.length < 3) return "";
    const mn = Math.min(...values);
    const mx = Math.max(...values);
    const rng = mx - mn || 1;
    const trend = values[values.length - 1] - values[0];
    const color = trend > rng * 0.05 ? "#1a9e6a" : trend < -rng * 0.05 ? "#dc5050" : "#9ca3af";
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 4) + 2;
      const y = (height - 4) - ((v - mn) / rng) * (height - 4) + 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" L ");
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" style="display:block;margin-top:8px;opacity:0.7;"><path d="M ${pts}" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // Hero sparkline: Flask's real version (render_expansion_bottom_line, generator/slides.py:
  // ~7750-7767, ~7967-7993) is a CUMULATIVE running sum of monthly rent — deliberately always
  // rising, drawn as a filled area, purely visual ("visualises growth story," not meant to show
  // month-to-month movement). A prior pass here swapped this for the raw monthly series
  // assuming the ramp shape was a bug; it isn't — confirmed against Kevin's reference screenshot.
  function heroSparkSvg(values: number[], width = 200, height = 40): string {
    if (values.filter((v) => v > 0).length < 3) return "";
    let running = 0;
    const cumulative = values.map((v) => (running += v));
    const mn = Math.min(...cumulative);
    const mx = Math.max(...cumulative);
    const rng = mx - mn || 1;
    const pad = 2;
    const pts = cumulative.map((v, i) => {
      const x = (i / (cumulative.length - 1)) * (width - pad * 2) + pad;
      const y = (height - pad * 2) - ((v - mn) / rng) * (height - pad * 2) + pad;
      return { x, y };
    });
    const lineD = "M " + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ");
    const areaD = `${lineD} L ${pts[pts.length - 1].x.toFixed(1)},${height} L ${pts[0].x.toFixed(1)},${height} Z`;
    // width="100%" + preserveAspectRatio="none" so the line stretches to fill the hero card
    // regardless of its actual rendered width — a fixed pixel width left the line stopping
    // partway across the tile instead of spanning it.
    return `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" fill="none" style="display:block;">`
      + `<path d="${areaD}" fill="rgba(255,255,255,0.06)" stroke="none"/>`
      + `<path d="${lineD}" stroke="rgba(255,255,255,0.55)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
      + `</svg>`;
  }

  const showSparks = d.showSparklines !== false;
  // Every sparkline on the slide (the four small trend lines + the hero's cumulative area) comes
  // out of this one function - applied to monthlyTotals for the Combined view, and to each
  // entity's own monthly series for the switcher payload below - so an entity's sparks are built
  // by the exact code path the Combined ones are, over the same trailing-12 window.
  function sparksFor(monthly: ExecSummaryInput["monthlyTotals"]) {
    const t12 = monthly.slice(-12);
    const rentVals = t12.map((m) => m.rentPaid);
    return {
      nar: showSparks ? sparkSvg(t12.map((m) => m.adoptionRate)) : "",
      res: showSparks ? sparkSvg(t12.map((m) => m.billsPaid)) : "",
      sig: showSparks ? sparkSvg(t12.map((m) => m.newSignups)) : "",
      hero: heroSparkSvg(rentVals),
      // Monthly rent sparkline (small white line in hero bottom) - same builder, recolored.
      mo: showSparks ? sparkSvg(rentVals, 100, 36).replace(/#1a9e6a|#dc5050|#9ca3af/g, "rgba(255,255,255,0.6)") : "",
    };
  }
  const combinedSparks = sparksFor(d.monthlyTotals);
  const narSparkRaw = combinedSparks.nar;
  const residentsSparkRaw = combinedSparks.res;
  const signupsSparkRaw = combinedSparks.sig;
  // Wrap in identifiable divs so toggle buttons can show/hide them (and, with the entity
  // switcher live, so flexSwitchEntity can swap the svg inside each wrapper).
  const narSparkHtml = narSparkRaw ? `<div id="sp_nar_${slideId}">${narSparkRaw}</div>` : "";
  const residentsSparkHtml = residentsSparkRaw ? `<div id="sp_res_${slideId}">${residentsSparkRaw}</div>` : "";
  const signupsSparkHtml = signupsSparkRaw ? `<div id="ss_${slideId}">${signupsSparkRaw}</div>` : "";
  const heroSparkSvgHtml = combinedSparks.hero;
  const moRentSparkRaw = combinedSparks.mo;
  const moRentSparkSvg = moRentSparkRaw ? `<div id="sp_mo_${slideId}">${moRentSparkRaw}</div>` : "";

  // ── Hero rent pill (white-on-dark) ────────────────────────────────────────
  // A function (not a one-off) so the entity switcher below can build each entity's own hero
  // pill with the exact same rule the Combined one uses.
  function heroRentPill(curRent: number, prevRent: number | null): string {
    if (prevRent === null || prevRent <= 0) return "";
    const delta = curRent - prevRent;
    const pctDelta = (delta / prevRent) * 100;
    const sign = delta >= 0 ? "+" : "\u2212";
    const col = delta >= 0 ? "#6dffca" : "#ffaaaa";
    return `<div class="exec-delta" style="display:inline-block;background:rgba(255,255,255,0.12);color:${col};font-size:10px;font-weight:700;border-radius:6px;padding:3px 9px;margin-top:8px;">${sign}${fmtPct100(Math.abs(pctDelta))} ${_vs}</div>`;
  }
  const heroPill = heroRentPill(d.currentRent, d.prevRent);

  // ── Avg rent per household ────────────────────────────────────────────────
  const avgPayment = d.currentResidents > 0 ? Math.round(d.currentRent / d.currentResidents) : 0;

  // ── Retention metric ──────────────────────────────────────────────────────
  let retentionVal = "\u2014";
  let retentionSub = "";
  if (d.trueRepeatRate !== null) {
    retentionVal = fmtPct(d.trueRepeatRate);
    retentionSub = "of eligible residents came back";
  } else if (d.prevResidents !== null && d.prevResidents > 0) {
    const momRet = (d.currentResidents - d.currentNewSignups) / d.prevResidents;
    retentionVal = fmtPct(Math.max(0, Math.min(momRet, 1)));
    retentionSub = "users who paid again this month";
  }

  // ── Rent window label ─────────────────────────────────────────────────────
  // coversFullTenure = true ONLY when the partner's actual tenure is ≤ lookback window
  // For mature partners (e.g. since 2021 with lookback=12), show "last 12 months" not "since 2021"
  const tenureMonths = d.partnerSince
    ? Math.round((new Date(d.reportingMonth + "T00:00:00Z").getTime() - new Date(d.partnerSince + "T00:00:00Z").getTime()) / (30.44 * 24 * 60 * 60 * 1000))
    : 999;
  const rwl = rentWindowLabel({ partnerSince: d.partnerSince, lookbackMonths: d.lookbackMonths, coversFullTenure: tenureMonths <= d.lookbackMonths && !!d.partnerSince });

  // ── DQ shielded ───────────────────────────────────────────────────────────
  // The tile's value string, a function for the same reason dqPillFor below is one - the
  // switcher builds each entity's own with this exact rule. Combined's output is byte-identical
  // to what it was before the switcher existed; an entity's is what the tile WOULD read if the
  // deck were that entity alone.
  const dqValFor = (shielded: number | null): string =>
    shielded != null && shielded > 0 ? fmtCurrency(shielded) : "\u2014";
  const dqVal = dqValFor(d.lifetimeDqShielded);
  // Window now tracks the report's own period (Full/Quarter/YTD via lookbackMonths) instead of
  // a fixed 13 months — caption names the real window so it's never ambiguous (Kevin's catch).
  // The caption is deliberately NOT per-entity and does not switch: every entity's figure is
  // summed over the same lookbackMonths window (see entityDqFor at the call site), so one
  // caption is true for all of them — same as Flask, whose _dq_caption sits outside
  // _exec_switch_ids entirely.
  const dqSub = d.lifetimeDqShielded != null && d.lifetimeDqShielded > 0
    ? `rent covered when residents missed — trailing ${d.lookbackMonths} month${d.lookbackMonths === 1 ? "" : "s"}`
    : "";
  // DQ since-comparison pill — always green/positive framing. A function (not a one-off) so
  // the entity switcher below builds each entity's own DQ pill with the exact same rule the
  // Combined one uses; same reason heroRentPill / sparksFor / signupsSubFor are functions.
  const dqPillFor = (sinceComparison: number | null): string =>
    sinceComparison == null || sinceComparison <= 0
      ? ""
      : `<div class="exec-delta" style="display:inline-block;background:rgba(26,158,106,0.11);color:#1a9e6a;font-size:10px;font-weight:700;border-radius:6px;padding:3px 9px;margin-top:6px;">+${fmtCurrency(sinceComparison)} ${_vs}</div>`;
  const dqPill = dqPillFor(d.dqSinceComparison);

  // ── New signups QTD sub-label ─────────────────────────────────────────────
  // A function so the entity switcher below can build each entity's own sub-label with the
  // exact rule the Combined one uses (same reason heroRentPill / sparksFor are functions).
  function signupsSubFor(monthly: ExecSummaryInput["monthlyTotals"]): string {
    const qtd = monthly.slice(-3).reduce((s, m) => s + m.newSignups, 0);
    return qtd > 0 ? `${qtd.toLocaleString("en-US")} last 3 months` : "first-time Flex payments this month";
  }
  const signupsSub = signupsSubFor(d.monthlyTotals);

  // ── SVG icons for tiles ────────────────────────────────────────────────────
  const svgBldg = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="2" y="4" width="7" height="8.5" rx="0.8" stroke="#6A3DB8" stroke-width="1.3"/><path d="M9 7h2.5v5.5H9" stroke="#6A3DB8" stroke-width="1.3" stroke-linejoin="round"/><path d="M4.5 7v0M6.5 7v0M4.5 9.5v0M6.5 9.5v0" stroke="#6A3DB8" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const svgPerson = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="4.5" r="2.5" stroke="#6A3DB8" stroke-width="1.3"/><path d="M2 12.5c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="#6A3DB8" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const svgNewP = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="5.5" cy="4.5" r="2.3" stroke="#6A3DB8" stroke-width="1.3"/><path d="M1 12.5c0-2.5 2-4.5 4.5-4.5" stroke="#6A3DB8" stroke-width="1.3" stroke-linecap="round"/><path d="M10.5 8.5v4M8.5 10.5h4" stroke="#6A3DB8" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const svgPct = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="4" cy="4" r="1.8" stroke="#6A3DB8" stroke-width="1.3"/><circle cx="10" cy="10" r="1.8" stroke="#6A3DB8" stroke-width="1.3"/><path d="M11 3L3 11" stroke="#6A3DB8" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const svgRepeat = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3 5a4 4 0 0 1 6.5-1.5L11 5" stroke="#6A3DB8" stroke-width="1.3" stroke-linecap="round"/><path d="M11 3v2H9" stroke="#6A3DB8" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 9a4 4 0 0 1-6.5 1.5L3 9" stroke="#6A3DB8" stroke-width="1.3" stroke-linecap="round"/><path d="M3 11V9h2" stroke="#6A3DB8" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const svgShield = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1.5L2 3.5v4c0 2.5 2 4.5 5 5 3-0.5 5-2.5 5-5v-4L7 1.5z" stroke="#6A3DB8" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const svgCoinsW = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="5" cy="5" r="3.5" stroke="rgba(255,255,255,0.6)" stroke-width="1.3"/><circle cx="9" cy="9" r="3.5" stroke="rgba(255,255,255,0.6)" stroke-width="1.3"/></svg>';

  function iconCircle(svg: string, dark = false): string {
    const bg = dark ? "rgba(255,255,255,0.12)" : "rgba(106,61,184,0.09)";
    return `<div style="width:22px;height:22px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">${svg}</div>`;
  }

  // ── Small tile helper ─────────────────────────────────────────────────────
  function tile(label: string, value: string, sublabel: string, pillHtml: string, sparkHtml = "", icon = "", valueId = "", sublabelId = ""): string {
    const labelRow = icon
      ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">${iconCircle(icon)}<div style="font-size:13px;color:#2d2550;font-weight:700;">${label}</div></div>`
      : `<div style="font-size:13px;color:#2d2550;font-weight:700;margin-bottom:10px;">${label}</div>`;
    return `<div style="padding:18px 18px 16px;border-radius:10px;background:#f8f7ff;display:flex;flex-direction:column;">
      ${labelRow}
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;">
        <div style="font-size:34px;font-weight:700;color:#1a1040;letter-spacing:-0.03em;line-height:1;"${valueId ? ` id="${valueId}"` : ""}>${value}</div>
        ${pillHtml}${sparkHtml}${sublabel ? `<div style="font-size:11px;color:#6b7280;font-weight:500;margin-top:6px;"${sublabelId ? ` id="${sublabelId}"` : ""}>${sublabel}</div>` : ""}
      </div>
    </div>`;
  }

  const hiddenTileSet = new Set(d.hiddenTiles ?? []);
  // Column count that avoids stranding a lonely single tile in its own row (Kevin's ask) -
  // the grid used to be a fixed 3 columns, which left a 3-then-1 split whenever exactly 4
  // tiles were visible (e.g. 2 hidden via hiddenTileSet above). Mirrors Flask's
  // render_expansion_bottom_line - same mapping, same reasoning.
  const ALL_TILE_KEYS = ["active_properties", "residents_paying", "new_residents",
    "adoption_rate", "true_repeat_rate", "delinquency_shielded"];
  const visibleTileCount = ALL_TILE_KEYS.filter((k) => !hiddenTileSet.has(k)).length;
  const TILE_COLS_BY_VISIBLE_COUNT: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 3, 4: 2, 5: 3, 6: 3 };
  const tileCols = TILE_COLS_BY_VISIBLE_COUNT[visibleTileCount] ?? 3;

  // ── Entity switcher (Task 9: combined multi-PMC exec summary) ─────────────
  // Only rendered when entityBreakdown has 2+ entries. Everything else in this function stays
  // untouched when it doesn't - the value-tile ids below are only added when the switcher is
  // actually rendered, so a single-PMC report's HTML is byte-identical to before this existed.
  const entities = d.entityBreakdown ?? [];
  const showEntitySwitcher = entities.length > 1;
  let entitySwitcherHtml = "";
  let entitySwitcherJs = "";

  // Period-comparison pills for the un-switched (Combined) tiles. Built here, ahead of the
  // switcher payload, because the Combined payload entry reuses these exact strings.
  const pillProps = pill(d.propertyCount, d.prevPropertyCount, "abs");
  const pillResidents = pill(d.currentResidents, d.prevResidents, "abs");
  const pillNar = pill(nar, d.prevNar, "pp");
  // Per-entity pills, computed with the same pill()/heroRentPill() rules and the same "_vs"
  // label as the Combined ones - only the inputs differ (each entity's own current + prior-
  // period figures). An entity with no prior-period rows gets prev* = null and therefore the
  // same empty pill the Combined view shows when its own prior is missing.
  const entityPills = entities.map((e) => ({
    props: pill(e.propertyCount, e.prevPropertyCount, "abs"),
    res: pill(e.currentResidents, e.prevResidents, "abs"),
    nar: pill(e.currentNar, e.prevNar, "pp"),
    rent: heroRentPill(e.currentRent, e.prevRent),
    // Fifth pill, matching Flask's _entity_pills (slides.py:9398-9418), which has had a "dq"
    // key all along. Built by the same dqPillFor the Combined pill uses, off this entity's own
    // windowed DQ sum since the same combined comparison month.
    dq: dqPillFor(e.dqSinceComparison),
  }));
  // Wraps a pill in a swappable container when the switcher is live. display:contents keeps
  // the pill div itself as the flex item / inline-block it already is (the wrapper generates
  // no box), so the switcher's presence changes nothing about layout - and the wrapper is
  // always emitted (even around an empty Combined pill) so an entity that DOES have a delta
  // has somewhere to land.
  const wrapPill = (key: string, html: string) => showEntitySwitcher
    ? `<span id="ep_${key}_${slideId}" style="display:contents">${html}</span>`
    : html;

  if (showEntitySwitcher) {
    // Explicit "en-US" (here and on the tile values below) - a bare toLocaleString() follows the
    // runtime's default ICU locale, which in a container with no LANG set is the POSIX variant
    // that prints "2717" with no grouping at all (Kevin: "2,717 instead of 2717").
    const fmtEntity = (residents: number, rent: number, narVal: number, properties: number) => ({
      residents: residents.toLocaleString("en-US"),
      rent: fmtCurrency(rent),
      nar: fmtPct(narVal),
      properties: properties.toLocaleString("en-US"),
      avg: residents > 0 ? `avg $${Math.round(rent / residents).toLocaleString("en-US")}/resident` : "",
    });
    // Combined entry mirrors exactly what the tile grid already shows (d.currentResidents etc,
    // same numbers the un-switched tiles render below) - not re-derived from entities, so
    // "Combined" always matches today's existing behavior regardless of how entityBreakdown was
    // built upstream.
    // Each entry also carries its fully rendered pills (same builders, see entityPills above) -
    // Combined's are the very strings the static tiles below render, so restoring Combined puts
    // back exactly what was there.
    // Labels are display-shortened (displayEntityNames - "FPI (An Asset Living Company)" ->
    // "FPI", full names if that would collide); the payload entries are addressed by index, so
    // this is display-only and every number still comes from the full-name entity.
    //
    // Beyond the four tile values + pills, each entry carries every other node the slide derives
    // from kpis/monthlyTotals (Kevin, on the hero sub-line: "this number doesnt change based on
    // the pmc selected either" - the bar is that a Combined vs Entity screenshot differs in
    // every pixel that encodes entity data): the hero window rent (`lifetime`), the new-
    // residents tile value + "N last 3 months" sub-label, and all five sparklines - each built
    // by the SAME function the static Combined markup uses (fmtCurrency / signupsSubFor /
    // sparksFor), so Combined's strings here are byte-equal to what's rendered and an entity's
    // are what the slide WOULD render if the deck were that entity alone. An entity's window
    // rent is the sum of its own monthly rent - the same reduce the call site does over
    // monthlyTotals for d.lifetimeRent.
    const viewFor = (monthly: ExecSummaryInput["monthlyTotals"], newSignups: number, windowRent: number) => ({
      lifetime: fmtCurrency(windowRent),
      newSignups: newSignups.toLocaleString("en-US"),
      signupsSub: signupsSubFor(monthly),
      sparks: sparksFor(monthly),
    });
    const entityLabels = displayEntityNames(entities.map((e) => e.pmcName));
    // `dq` is the Delinquency-shielded tile's value string, built by the same dqValFor the
    // Combined tile uses. It joins the payload (and the handler's update set below) because the
    // tile had no id at all until now: selecting a subsidiary left the entire combined
    // portfolio's DQ figure and its green pill on screen. Flask has swapped this since
    // _exec_switch_ids gained its "dq" key (slides.py:9057).
    const payload = [
      { label: "Combined", ...fmtEntity(d.currentResidents, d.currentRent, nar, d.propertyCount), ...viewFor(d.monthlyTotals, d.currentNewSignups, d.lifetimeRent), dq: dqVal, pills: { props: pillProps, res: pillResidents, nar: pillNar, rent: heroPill, dq: dqPill } },
      ...entities.map((e, i) => ({
        label: entityLabels[i],
        ...fmtEntity(e.currentResidents, e.currentRent, e.currentNar, e.propertyCount),
        ...viewFor(e.monthly, e.currentNewSignups, e.monthly.reduce((s, m) => s + m.rentPaid, 0)),
        dq: dqValFor(e.dqShielded),
        pills: entityPills[i],
      })),
    ];
    // Index-based onclick (not the entity name) - sidesteps having to escape arbitrary PMC names
    // (apostrophes, quotes, etc.) into a JS string literal inside an HTML attribute. "Combined"
    // (payload index 0) stays a plain un-accented pill; entity pills (payload index i = entity
    // i-1) go through the shared entitySwitchButton (short name + entityColor(i-1) left accent,
    // the same index that colors this entity on the chart slides) - the Adoption Trend style,
    // standardized across all three switchers.
    const btns = payload.map((p, i) =>
      i === 0
        ? `<button class="spark-ctrl-btn ctl-btn is-active" onclick="flexSwitchEntity(${slideId},0,this)">${_e(p.label)}</button>`
        : entitySwitchButton(i - 1, _e(p.label), `flexSwitchEntity(${slideId},${i},this)`)
    ).join("");
    // .switch-row (not .spark-ctrl / .presenter-control) so neither fullscreen rule hides it -
    // this control has to stay usable while presenting. See .switch-row's CSS comment.
    entitySwitcherHtml = `<div class="switch-row pdf-export-hide" style="flex-wrap:wrap;max-width:460px;">${btns}</div>`;
    // Embed everything as JSON in a script variable, toggle via a shared function defined once -
    // same convention as flexToggleSpark just above. Escape "<" so a PMC name containing
    // "</script>" can't break out of the inline script tag.
    const jsonPayload = JSON.stringify(payload).replace(/</g, "\\u003c");
    entitySwitcherJs = `window.execEntityData=window.execEntityData||{};window.execEntityData[${slideId}]=${jsonPayload};`
      + `if(!window.flexSwitchEntity){window.flexSwitchEntity=function(slideId,idx,btn){`
      + `var d=(window.execEntityData[slideId]||[])[idx];if(!d)return;`
      + `function setTxt(id,txt){var el=document.getElementById(id);if(el&&txt!==undefined)el.textContent=txt;}`
      + `function setHtml(id,h){var el=document.getElementById(id);if(el&&h!==undefined)el.innerHTML=h;}`
      + `setTxt('ev_props_'+slideId,d.properties);setTxt('ev_res_'+slideId,d.residents);`
      + `setTxt('ev_nar_'+slideId,d.nar);setTxt('ev_rent_'+slideId,d.rent);setTxt('ev_avg_'+slideId,d.avg);`
      + `setTxt('ev_lifetime_'+slideId,d.lifetime);setTxt('ev_newsig_'+slideId,d.newSignups);setTxt('ev_sigsub_'+slideId,d.signupsSub);`
      // Delinquency shielded - the tile this handler used to leave at the combined figure.
      + `setTxt('ev_dq_'+slideId,d.dq);`
      + `var p=d.pills||{};setHtml('ep_props_'+slideId,p.props);setHtml('ep_res_'+slideId,p.res);`
      + `setHtml('ep_nar_'+slideId,p.nar);setHtml('ep_rent_'+slideId,p.rent);setHtml('ep_dq_'+slideId,p.dq);`
      // Sparklines swap INSIDE their existing wrappers (sp_nar_/sp_res_/ss_/sp_mo_ are the same
      // divs flexToggleSpark shows/hides, so a hidden sparkline stays hidden across a switch);
      // the hero area gets its own wrapper id below. A wrapper only exists when the Combined
      // view has that sparkline, and an entity can only have one when Combined does (Combined's
      // months are a superset of every entity's), so a missing wrapper is never a lost entity spark.
      + `var s=d.sparks||{};setHtml('ev_hspark_'+slideId,s.hero);setHtml('sp_nar_'+slideId,s.nar);`
      + `setHtml('sp_res_'+slideId,s.res);setHtml('ss_'+slideId,s.sig);setHtml('sp_mo_'+slideId,s.mo);`
      + `var row=btn.parentElement;if(row){Array.prototype.forEach.call(row.children,function(b){b.classList.toggle('is-active',b===btn);});}`
      + `};}`;
  }

  // ── Delta toggle check ────────────────────────────────────────────────────
  // With the switcher live, an entity's pill can exist even when Combined's doesn't, so the
  // Hide/Show-change toggle has to account for every entry's pills - otherwise a subsidiary's
  // delta would have no way to be hidden. Without the switcher this is exactly the old check.
  // p.dq included since the DQ pill is now swappable too - an entity whose only delta is its
  // DQ pill would otherwise have no way to be hidden. Flask's own _any_delta already counts
  // every value in every entity's pill dict plus the combined _dq_since_pill (slides.py:9520).
  const anyEntityDelta = showEntitySwitcher && entityPills.some((p) => !!(p.props || p.res || p.nar || p.rent || p.dq));
  const anyDelta = !!(pillProps || pillResidents || pillNar || heroPill || dqPill) || anyEntityDelta;

  // Starts hidden when the form-level toggle forces it (Kevin's ask) - the button and its
  // onclick logic are otherwise unchanged, so the live in-deck override still works exactly the
  // same either way, just flipped from its new starting point.
  const startDeltasHidden = anyDelta && d.hidePeriodComparison === true;
  const deltaToggle = anyDelta
    ? `<button class="presenter-control" onclick="var s=document.getElementById('slide-${slideId}');s.classList.toggle('hide-deltas');this.textContent=s.classList.contains('hide-deltas')?'Show change ${_vs}':'Hide change ${_vs}';" style="padding:4px 10px;border-radius:5px;border:1px solid #e5e7eb;background:#fff;color:#6b7280;font-size:10px;font-weight:600;cursor:pointer;letter-spacing:0.04em;font-family:'Lexend',sans-serif;">${startDeltasHidden ? `Show change ${_vs}` : `Hide change ${_vs}`}</button>`
    : "";

  // ── Sparkline toggle controls ──────────────────────────────────────────────
  const sparkCtrlBtns: string[] = [];
  if (showSparks) {
    if (narSparkRaw) sparkCtrlBtns.push(`<button class="spark-ctrl-btn" onclick="flexToggleSpark('sp_nar_${slideId}',this)">NAR trend</button>`);
    if (residentsSparkRaw) sparkCtrlBtns.push(`<button class="spark-ctrl-btn" onclick="flexToggleSpark('sp_res_${slideId}',this)">Resident trend</button>`);
    if (signupsSparkRaw) sparkCtrlBtns.push(`<button class="spark-ctrl-btn" onclick="flexToggleSpark('ss_${slideId}',this)">New residents trend</button>`);
    if (moRentSparkRaw) sparkCtrlBtns.push(`<button class="spark-ctrl-btn" onclick="flexToggleSpark('sp_mo_${slideId}',this)">Monthly rent trend</button>`);
  }
  const sparkCtrlHtml = sparkCtrlBtns.length > 0
    ? `<div class="spark-ctrl presenter-control">${sparkCtrlBtns.join("")}</div>`
    : "";

  const html = `
  <div class="slide${startDeltasHidden ? " hide-deltas" : ""}" id="slide-${slideId}" style="background:#fff;flex-direction:column;padding:44px 56px 36px;overflow:hidden;">
    <style>#slide-${slideId}.hide-deltas .exec-delta { display: none !important; }</style>
    <div style="flex-shrink:0;margin-bottom:24px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div class="slide-label" style="margin-bottom:10px;">EXECUTIVE SUMMARY</div>
        <!-- Kevin's ask: the sparkline toggles were the last thing on the slide, easy to miss
             below the tile grid - moved up next to the other presenter control (deltaToggle)
             so both are visible together at the top, not hunted for at the bottom. -->
        <div style="display:flex;align-items:center;gap:8px;">${entitySwitcherHtml}${sparkCtrlHtml}${deltaToggle}</div>
      </div>
      <div class="slide-title" style="margin-bottom:6px;">What we've built together.</div>
      <div style="font-size:12px;color:#6b7280;">${pmc} &middot; ${reportingMonth} &nbsp;&middot;&nbsp; Partner since ${_e(sinceLbl)}</div>
    </div>
    <div style="flex:1;display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:16px;min-height:0;">
      <!-- Hero: Rent Guaranteed -->
      <div style="background:#2C194D;border-radius:12px;padding:26px 24px;display:flex;flex-direction:column;min-height:0;overflow:hidden;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
        ${iconCircle(svgCoinsW, true)}
        <span style="font-size:13px;color:rgba(255,255,255,0.75);font-weight:700;">Rent guaranteed</span>
      </div>
        <div style="font-size:46px;font-weight:700;color:#fff;letter-spacing:-0.03em;line-height:1;"${showEntitySwitcher ? ` id="ev_lifetime_${slideId}"` : ""}>${fmtCurrency(d.lifetimeRent)}</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.55);font-weight:500;margin-top:5px;">${rwl.toLowerCase()}</div>
        <div style="flex:1;min-height:40px;display:flex;align-items:flex-end;margin:12px 0 4px;"${showEntitySwitcher ? ` id="ev_hspark_${slideId}"` : ""}>${heroSparkSvgHtml}</div>
        <div style="border-top:1px solid rgba(255,255,255,0.10);padding-top:14px;">
          <div style="font-size:13px;color:rgba(255,255,255,0.75);font-weight:700;margin-bottom:5px;">Rent guaranteed this month</div>
          <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:8px;">
            <div>
              <div style="font-size:28px;font-weight:700;color:#fff;letter-spacing:-0.02em;"${showEntitySwitcher ? ` id="ev_rent_${slideId}"` : ""}>${fmtCurrency(d.currentRent)}</div>
              ${wrapPill("rent", heroPill)}
              ${avgPayment > 0 ? `<div style="font-size:11px;color:rgba(255,255,255,0.40);margin-top:5px;"${showEntitySwitcher ? ` id="ev_avg_${slideId}"` : ""}>avg $${avgPayment.toLocaleString("en-US")}/resident</div>` : ""}
            </div>
            ${moRentSparkSvg ? `<div style="flex-shrink:0;">${moRentSparkSvg}</div>` : ""}
          </div>
        </div>
      </div>
      <!-- 6 Metric Tiles (3-wide grid, rows auto-size to however many remain after hiding) -->
      <div style="display:grid;grid-template-columns:repeat(${tileCols},1fr);grid-auto-rows:1fr;gap:12px;">
        ${hiddenTileSet.has("active_properties") ? "" : tile("Active properties", d.propertyCount.toLocaleString("en-US"), "", wrapPill("props", pillProps), "", svgBldg, showEntitySwitcher ? `ev_props_${slideId}` : "")}
        ${hiddenTileSet.has("residents_paying") ? "" : tile("Residents paying", d.currentResidents.toLocaleString("en-US"), "", wrapPill("res", pillResidents), residentsSparkHtml, svgPerson, showEntitySwitcher ? `ev_res_${slideId}` : "")}
        ${hiddenTileSet.has("new_residents") ? "" : tile("New residents paying this month", d.currentNewSignups.toLocaleString("en-US"), signupsSub, "", signupsSparkHtml, svgNewP, showEntitySwitcher ? `ev_newsig_${slideId}` : "", showEntitySwitcher ? `ev_sigsub_${slideId}` : "")}
        ${hiddenTileSet.has("adoption_rate") ? "" : tile("Adoption rate", fmtPct(nar), "", wrapPill("nar", pillNar), narSparkHtml, svgPct, showEntitySwitcher ? `ev_nar_${slideId}` : "")}
        <!-- True repeat rate gets NO value id on purpose: no per-entity source exists for it
             (combined-level cohort / PARTNER_REPORTING_CORE_METRICS only), and Flask makes the
             same call explicitly at slides.py:9262-9266. It is the one tile that stays
             Combined in every switcher view. -->
        ${hiddenTileSet.has("true_repeat_rate") ? "" : tile("True repeat rate", retentionVal, retentionSub, "", "", svgRepeat)}
        ${hiddenTileSet.has("delinquency_shielded") ? "" : tile("Delinquency shielded", dqVal, dqSub, wrapPill("dq", dqPill), "", svgShield, showEntitySwitcher ? `ev_dq_${slideId}` : "")}
      </div>
    </div>
  </div>`;

  // flexToggleSpark JS — shared utility, only define once
  const sparkJs = sparkCtrlBtns.length > 0
    ? `if(!window.flexToggleSpark){window.flexToggleSpark=function(id,btn){var el=document.getElementById(id);if(!el)return;var h=el.style.display==="none";el.style.display=h?"":"none";btn.classList.toggle("is-hidden",!h);};}`
    : "";

  return { html, js: sparkJs + entitySwitcherJs };
}



export interface CohortRow {
  rolloutMonth: string;
  propertyCount: number;
  totalUnits: number;
  currentResidents: number;
  currentRent: number;
  cumulativeRent: number;
  cohortNar: number;
}

export interface CohortOverviewInput {
  cohorts: CohortRow[];
  reportingMonth: string;
  cohortMonthly: Map<string, (number | null)[]>; // rolloutMonth → array of monthly NAR values
  presentingMode?: boolean;
}

/** Exported for the subset-remainder tests (__tests__/subset-remainders.test.ts). */
export function renderCohortAnalysis(input: CohortOverviewInput & { slideId: number }): string {
  const { cohorts, reportingMonth, cohortMonthly, slideId, presentingMode } = input;
  const totalCohorts = cohorts.length;
  const MAX_COHORTS = presentingMode ? Infinity : 6;
  const display = cohorts.slice(-MAX_COHORTS);
  const hiddenCohorts = Math.max(0, totalCohorts - MAX_COHORTS);

  let rows = "";
  let anySpark = false;

  for (const c of display) {
    // Compute months active
    let monthsActive: number | null = null;
    if (reportingMonth && c.rolloutMonth) {
      try {
        const rmYear = parseInt(reportingMonth.slice(0, 4));
        const rmMon = parseInt(reportingMonth.slice(5, 7));
        const coYear = parseInt(c.rolloutMonth.slice(0, 4));
        const coMon = parseInt(c.rolloutMonth.slice(5, 7));
        monthsActive = (rmYear - coYear) * 12 + (rmMon - coMon);
        if (monthsActive < 0) monthsActive = 0;
      } catch {
        monthsActive = null;
      }
    }

    let ageLabel = "";
    if (monthsActive !== null) {
      const monthNum = monthsActive + 1;
      ageLabel = monthsActive <= 3
        ? `Month ${monthNum} - Ramping`
        : `${monthNum} months active`;
    }
    const ageTag = ageLabel
      ? `<div style="font-size:9px;color:#a09cb0;margin-top:1px;">${ageLabel}</div>`
      : "";

    // Sparkline for this cohort's NAR trend
    const sparkVals = cohortMonthly.get(c.rolloutMonth) || [];
    const validSpark = sparkVals.filter((v): v is number => v !== null);
    let sparkColor = "#a09cb0";
    if (validSpark.length >= 2) {
      sparkColor = validSpark[validSpark.length - 1] > validSpark[0] ? "#1a9e6a" : "#dc5050";
    }
    const sparkHtml = sparklineSvg(sparkVals, sparkColor);
    anySpark = anySpark || sparkHtml !== "";
    const sparkCell = sparkHtml
      ? `<div class="cohort-trend-col" style="display:flex;flex-direction:column;justify-content:center;">` +
        `<div style="font-size:9px;text-transform:uppercase;letter-spacing:0.07em;color:#a09cb0;margin-bottom:4px;">Trend</div>` +
        sparkHtml +
        `</div>`
      : `<div class="cohort-trend-col"></div>`;

    const avgRent = c.currentResidents > 0 ? c.currentRent / c.currentResidents : 0;

    rows += `
        <div style="display:grid;grid-template-columns:1.8fr 0.6fr 1.0fr 1.0fr 1.0fr 1.1fr 1.0fr 0.9fr;gap:10px;align-items:center;
                    padding:14px 20px;background:#f7f7f7;border-radius:8px;border:1px solid #eceaf2;">
          <div>
            <div style="font-size:13px;font-weight:600;white-space:nowrap;">${monthLabel(c.rolloutMonth)} Cohort</div>
            ${ageTag}
          </div>
          <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:0.07em;color:#a09cb0;">Active</div>
               <div style="font-size:17px;font-weight:700;color:#1d1d1d;">${c.propertyCount.toLocaleString("en-US")}</div></div>
          <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:0.07em;color:#a09cb0;">Total Units</div>
               <div style="font-size:17px;font-weight:700;color:#1d1d1d;">${c.totalUnits.toLocaleString()}</div></div>
          <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:0.07em;color:#a09cb0;">Residents Paying</div>
               <div style="font-size:17px;font-weight:700;color:#1d1d1d;">${c.currentResidents.toLocaleString()}</div></div>
          <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:0.07em;color:#a09cb0;">Avg Rent</div>
               <div style="font-size:17px;font-weight:700;color:#1d1d1d;">$${Math.round(avgRent).toLocaleString()}</div></div>
          <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:0.07em;color:#a09cb0;">Total Rent Paid</div>
               <div style="font-size:17px;font-weight:700;color:#6A3DB8;">${fmtCurrency(c.cumulativeRent)}</div></div>
          <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:0.07em;color:#a09cb0;">Adoption Rate</div>
               <div style="font-size:17px;font-weight:700;color:#1d1d1d;">${fmtPct(c.cohortNar)}</div></div>
          ${sparkCell}
        </div>`;
  }

  // The remainder has to carry its MAGNITUDE, not just its count. The totals bar directly
  // below is portfolio-wide (every cohort), so a rep reading "62 older cohorts not shown"
  // against a 403,415-unit total had no way to know the six rows above account for 54,830 of
  // them (13.6%) - Asset Living, live. A count alone reads like a footnote about tidiness; the
  // units/properties/residents behind it are what someone actually asks about. Mirrors Flask's
  // overflow_note (generator/slides.py:3222).
  const sumBy = (rows: CohortRow[], f: (c: CohortRow) => number) => rows.reduce((s, c) => s + f(c), 0);
  const shownIds = new Set(display.map((c) => c.rolloutMonth));
  const hidden = cohorts.filter((c) => !shownIds.has(c.rolloutMonth));
  const shownUnits = sumBy(display, (c) => c.totalUnits);
  const allUnits = sumBy(cohorts, (c) => c.totalUnits);
  const shownShare = allUnits > 0 ? (shownUnits / allUnits) * 100 : 0;
  const overflowNote = hiddenCohorts > 0
    ? `<div style="font-size:10px;color:#a09cb0;margin-top:6px;flex-shrink:0;">` +
      `The ${display.length} cohort${display.length !== 1 ? "s" : ""} above are ` +
      `${shownUnits.toLocaleString()} of ${allUnits.toLocaleString()} units ` +
      `(${shownShare.toFixed(1)}% of the portfolio) and ` +
      `${sumBy(display, (c) => c.currentResidents).toLocaleString()} of ` +
      `${sumBy(cohorts, (c) => c.currentResidents).toLocaleString()} paying residents &middot; the other ` +
      `${hiddenCohorts} cohort${hiddenCohorts !== 1 ? "s" : ""} ` +
      `(${sumBy(hidden, (c) => c.propertyCount).toLocaleString()} properties, ` +
      `${sumBy(hidden, (c) => c.totalUnits).toLocaleString()} units, ` +
      `${sumBy(hidden, (c) => c.currentResidents).toLocaleString()} paying) are in the workbook's full ` +
      `cohort table. Totals below cover every cohort.</div>`
    : "";

  // Totals bar
  const totalActiveProps = cohorts.reduce((s, c) => s + c.propertyCount, 0);
  const totalUnitsSum = cohorts.reduce((s, c) => s + c.totalUnits, 0);
  const totalResidents = cohorts.reduce((s, c) => s + c.currentResidents, 0);
  const overallNar = totalUnitsSum > 0 ? totalResidents / totalUnitsSum : 0;

  const totalsBar = `
    <div style="display:flex;gap:12px;margin-bottom:12px;">
      <div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:8px;padding:8px 16px;flex:1;text-align:center;">
        <div style="font-size:10px;color:#a09cb0;text-transform:uppercase;letter-spacing:0.08em;">Total Cohorts</div>
        <div style="font-size:18px;font-weight:700;color:#1d1d1d;">${totalCohorts}</div>
      </div>
      <div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:8px;padding:8px 16px;flex:1;text-align:center;">
        <div style="font-size:10px;color:#a09cb0;text-transform:uppercase;letter-spacing:0.08em;">Active Properties</div>
        <div style="font-size:18px;font-weight:700;color:#1d1d1d;">${totalActiveProps.toLocaleString()}</div>
      </div>
      <div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:8px;padding:8px 16px;flex:1;text-align:center;">
        <div style="font-size:10px;color:#a09cb0;text-transform:uppercase;letter-spacing:0.08em;">Total Units</div>
        <div style="font-size:18px;font-weight:700;color:#1d1d1d;">${totalUnitsSum.toLocaleString()}</div>
      </div>
      <div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:8px;padding:8px 16px;flex:1;text-align:center;">
        <div style="font-size:10px;color:#a09cb0;text-transform:uppercase;letter-spacing:0.08em;">Residents Paying</div>
        <div style="font-size:18px;font-weight:700;color:#1d1d1d;">${totalResidents.toLocaleString()}</div>
      </div>
      <div style="background:#ede9fe;border:1px solid #c4b5fd;border-radius:8px;padding:8px 16px;flex:1;text-align:center;">
        <div style="font-size:10px;color:#6A3DB8;text-transform:uppercase;letter-spacing:0.08em;">Adoption Rate</div>
        <div style="font-size:18px;font-weight:700;color:#6A3DB8;">${fmtPct(overallNar)}</div>
      </div>
    </div>`;

  const trendToggleHtml = anySpark
    ? `<button class="presenter-control" onclick="var s=document.getElementById('slide-${slideId}');` +
      `s.classList.toggle('hide-cohort-trend');` +
      `this.textContent=s.classList.contains('hide-cohort-trend')?'Show adoption trend':'Hide adoption trend';"` +
      ` style="padding:4px 10px;border-radius:5px;border:1px solid #e5e7eb;background:#fff;` +
      `color:#524e5b;font-size:10px;font-weight:600;cursor:pointer;font-family:'ABCDiatype',sans-serif;` +
      `letter-spacing:0.04em;">Hide adoption trend</button>`
    : "";

  return `
  <div class="slide" id="slide-${slideId}" style="background:#fff;justify-content:flex-start;">
    <style>#slide-${slideId}.hide-cohort-trend .cohort-trend-col { display: none !important; }</style>
    <div class="slide-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
      <div>
        <div class="slide-label">Launch Cohorts</div>
        <div class="slide-title">Performance by Rollout Month</div>
      </div>
      ${trendToggleHtml}
    </div>
    ${totalsBar}
    <div style="flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding-right:4px;">
      ${rows}
    </div>
    ${overflowNote}
  </div>`;
}

interface ProjectionInput {
  currentResidents: number;
  currentRent: number;
  currentNar: number;
  totalUnits: number;
  monthlyTotals: { month: string; adoptionRate: number; propertyCount?: number }[];
  pmcName: string;
  showProjection?: boolean;
  slideId?: number;
  peerPercentiles?: { p25: number; p50: number; p75: number; p90: number; p99: number };
}

function renderPortfolioProjection(p: ProjectionInput): { html: string; js: string } {
  const slideId = p.slideId ?? 5;
  const showProjection = p.showProjection !== false;
  const avgRent = p.currentResidents > 0 ? Math.round(p.currentRent / p.currentResidents) : 1365;

  const conservativeNar = p.currentNar;
  let projectedNar = p.currentNar;
  let avgMom = 0;
  let lastMomOutlier = false;
  let projDesc = `If current adoption rate holds at ${fmtPct(p.currentNar)} across all enrolled units`;

  if (p.monthlyTotals.length >= 3) {
    const rates = p.monthlyTotals.map((m) => m.adoptionRate);
    const momChanges = rates.slice(1).map((r, i) => r - rates[i]);
    const sortedChanges = [...momChanges].sort((a, b) => a - b);
    const n = sortedChanges.length;
    const medianMom = n % 2 === 1 ? sortedChanges[Math.floor(n / 2)] : (sortedChanges[Math.floor(n / 2) - 1] + sortedChanges[Math.floor(n / 2)]) / 2;
    avgMom = medianMom;
    projectedNar = Math.min(Math.max(p.currentNar + medianMom * 12, 0.001), 0.80);
    const trendStr = `${medianMom >= 0 ? "+" : ""}${(medianMom * 100).toFixed(2)}pp/mo`;
    projDesc = `Median ${trendStr} adoption trend across ${momChanges.length} months, projected 12-month rate`;

    // Outlier detection
    if (momChanges.length >= 3) {
      const sortedAbsDev = momChanges.map((c) => Math.abs(c - medianMom)).sort((a, b) => a - b);
      const mad = sortedAbsDev[Math.floor(n / 2)];
      const lastChange = momChanges[momChanges.length - 1];
      if (mad > 0 && Math.abs(lastChange - medianMom) > 2 * mad && lastChange < 0) {
        lastMomOutlier = true;
      }
    }
  }

  // Auto-target: next peer-percentile tier up from current NAR
  // Flask rounds to whole percent: "12.1% reads as oddly precise for a directional peer-tier goal"
  let targetNar: number;
  const targetLabel = "Target"; // Never expose which tier (P75/P90) — backend-only logic
  if (p.peerPercentiles) {
    const { p50, p75, p90, p99 } = p.peerPercentiles;
    if (p.currentNar >= p90) {
      targetNar = p99 + 0.02;
    } else if (p.currentNar >= p75) {
      targetNar = p90;
    } else if (p.currentNar >= p50) {
      targetNar = p75;
    } else {
      targetNar = p50;
    }
  } else {
    // Fallback when no peer data available
    targetNar = 0.20;
  }
  // Round to nearest whole percent BEFORE computing any downstream values (households, rent, run-rate)
  targetNar = Math.round(targetNar * 100) / 100;
  if (targetNar <= projectedNar) {
    targetNar = projectedNar + 0.01;
    targetNar = Math.round(targetNar * 100) / 100;
  }

  const projDeclining = projectedNar < p.currentNar - 0.0005;
  const projectedColor = projDeclining ? "#dc2626" : "#6A3DB8";

  const scenarios: [string, number, string, string][] = [
    ["Conservative", conservativeNar, "#d97706",
      `If adoption stays exactly where it is today - your floor with no new resident growth`],
    ["Projected", projectedNar, projectedColor, projDesc],
    [targetLabel, targetNar, "#1a9e6a",
      `Closing to ${fmtPct(targetNar)} means ${Math.round(p.totalUnits * targetNar).toLocaleString()} more active residents - each adds ~$${avgRent >= 1000 ? Math.round(avgRent / 1000) + 'K' : avgRent}/month.`],
  ];

  const pctEnrolled = Math.min(p.totalUnits > 0 ? (p.currentResidents / p.totalUnits) * 100 : 0, 100);
  const untapped = p.totalUnits - p.currentResidents;

  const progressBar = `
    <div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:12px;padding:10px 16px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#524e5b;font-weight:500;">Resident Adoption Today</div>
        <div style="font-size:12px;color:#a09cb0;">${p.currentResidents.toLocaleString()} of ${p.totalUnits.toLocaleString()} units paying &middot; <strong style="color:#dc5050;">${untapped.toLocaleString()} not yet paying</strong></div>
      </div>
      <div style="background:#eceaf2;border-radius:99px;height:8px;overflow:hidden;">
        <div style="background:#6A3DB8;height:100%;width:${pctEnrolled.toFixed(1)}%;border-radius:99px;"></div>
      </div>
    </div>`;

  // --- Insight text per scenario ---
  const gapResidents = Math.round(p.totalUnits * targetNar) - p.currentResidents;
  const conservativeResidents = Math.round(p.totalUnits * conservativeNar);

  let conText: string;
  if (lastMomOutlier) {
    // Check if new properties drove the dip
    let propDelta = 0;
    if (p.monthlyTotals.length >= 2) {
      const last = p.monthlyTotals[p.monthlyTotals.length - 1];
      const prev = p.monthlyTotals[p.monthlyTotals.length - 2];
      if (last.propertyCount != null && prev.propertyCount != null) {
        propDelta = last.propertyCount - prev.propertyCount;
      }
    }
    if (propDelta >= 5) {
      conText = `<strong>Adoption dipped last month</strong> - ${propDelta >= 0 ? "+" : ""}${propDelta.toLocaleString()} new properties joined, diluting the overall rate. Floor holds at today's ${fmtPct(p.currentNar)}: ${conservativeResidents.toLocaleString()} residents.`;
    } else {
      conText = `<strong>Adoption dipped last month</strong> - fewer residents paid through Flex. Could reflect seasonal patterns or a real signal; worth monitoring. Floor: ${conservativeResidents.toLocaleString()} residents at ${fmtPct(p.currentNar)}.`;
    }
  } else {
    conText = `Conservative floor: <strong>${conservativeResidents.toLocaleString()} residents</strong> at today's ${fmtPct(p.currentNar)} rate - the baseline if nothing changes.`;
  }

  let projText: string;
  if (avgMom < -0.001) {
    projText = `<strong>Rate being diluted by rapid enrollment</strong> - new properties joining faster than residents activate. Projected scenario reflects this unless activation pace picks up.`;
  } else if (avgMom > 0.001) {
    projText = `<strong>Momentum is positive</strong> at +${(avgMom * 100).toFixed(2)}pp/month - at this pace, adoption reaches <strong>${fmtPct(projectedNar)}</strong> in 12 months.`;
  } else if (projDeclining) {
    projText = `<strong>Adoption is trending down</strong> - recent months have softened, projecting to <strong>${fmtPct(projectedNar)}</strong> over 12 months if the pattern holds, down from today's ${fmtPct(p.currentNar)}. Worth a closer look at what's driving the recent dip.`;
  } else {
    projText = `<strong>Adoption is flat</strong> near ${fmtPct(p.currentNar)}. Re-engaging lapsed residents or improving new-property activation would move the needle.`;
  }
  projText += ` <span style="color:#a09cb0;">Assumes today's portfolio size - doesn't include any properties not yet live.</span>`;

  const tgtText = `Closing to <strong>${fmtPct(targetNar)}</strong> means <strong>${gapResidents.toLocaleString()} more active residents</strong> - each adds ~${fmtCurrency(avgRent)}/month.`;

  const insightTexts: Record<string, string> = { Conservative: conText, Projected: projText, [targetLabel]: tgtText };

  const gridId = `proj-grid-${slideId}`;
  const projTileId = `proj-tile-projected-${slideId}`;

  let cards = "";
  let visibleCount = 0;
  for (const [label, nar, color] of scenarios) {
    const residents = Math.round(p.totalUnits * nar);
    const monthlyRent = residents * avgRent;
    const annual = monthlyRent * 12;
    const tileInsight = insightTexts[label] || "";
    const labelColor = (label === "Projected" && projDeclining) ? color : "#524e5b";
    const isProjected = label === "Projected";
    const initiallyHidden = isProjected && !showProjection;
    if (!initiallyHidden) visibleCount++;
    const tileIdAttr = isProjected ? ` id="${projTileId}"` : "";
    const tileDisplay = initiallyHidden ? "display:none;" : "display:flex;";
    cards += `
        <div${tileIdAttr} style="${tileDisplay}background:#f7f7f7;border:1px solid #eceaf2;border-radius:14px;padding:20px 22px;
                    flex-direction:column;justify-content:space-between;">
          <div style="display:flex;flex-direction:column;flex:1;">
            <div style="font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:${labelColor};font-weight:600;margin-bottom:8px;">${label} &middot; ${fmtPct(nar)} adoption</div>
            <div style="font-size:15px;color:#a09cb0;margin-bottom:0;line-height:1.5;">${tileInsight}</div>
            <div style="margin-top:28px;padding-top:8px;">
              <div style="font-size:15px;color:#524e5b;margin-bottom:10px;">${residents.toLocaleString()} active residents</div>
              <div style="font-size:52px;font-weight:400;color:${color};letter-spacing:-0.04em;line-height:1;font-family:'ABCDiatype',sans-serif;">${fmtCurrency(monthlyRent)}</div>
              <div style="font-size:13px;color:#a09cb0;margin-top:8px;">monthly rent collected</div>
            </div>
          </div>
          <div style="padding-top:16px;border-top:1px solid #eceaf2;margin-top:16px;">
            <div style="font-size:12px;color:#524e5b;margin-bottom:2px;">Annual run rate</div>
            <div style="font-size:26px;font-weight:700;">${fmtCurrency(annual)} / yr</div>
          </div>
        </div>`;
  }

  const gridCols = Array(visibleCount).fill("1fr").join(" ");

  // Projected tile toggle button
  const btnHiddenClass = showProjection ? "" : " is-hidden";
  const btnLabel = showProjection ? "Hide Projected tile" : "Show Projected tile";
  const projToggleHtml = `
    <div class="presenter-control" style="margin-top:10px;">
      <button class="spark-ctrl-btn${btnHiddenClass}" onclick="flexToggleProjTile('${projTileId}','${gridId}',this)">${btnLabel}</button>
    </div>
    <script>if(!window.flexToggleProjTile){window.flexToggleProjTile=function(tileId,gridId,btn){
      var el=document.getElementById(tileId); if(!el) return;
      var wasVisible=el.style.display!=='none';
      el.style.display=wasVisible?'none':'flex';
      btn.classList.toggle('is-hidden',wasVisible);
      btn.textContent=wasVisible?'Show Projected tile':'Hide Projected tile';
      var grid=document.getElementById(gridId);
      if(grid){
        var visible=0;
        Array.prototype.forEach.call(grid.children,function(c){if(c.style.display!=='none')visible++;});
        grid.style.gridTemplateColumns=new Array(visible).fill('1fr').join(' ');
      }
    };}<\/script>`;

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header" style="margin-bottom:12px;flex-shrink:0;">
      <div class="slide-label">The Opportunity Ahead</div>
      <div class="slide-title">What ${p.totalUnits.toLocaleString()} Units Looks Like in 12 Months</div>
    </div>
    <div style="flex-shrink:0;">${progressBar}</div>
    <div id="${gridId}" style="display:grid;grid-template-columns:${gridCols};gap:14px;flex:1;min-height:0;">${cards}</div>
    ${projToggleHtml}
  </div>`;
  return { html, js: "" };
}

interface StateRowData {
  state: string;
  properties: number;
  totalUnits: number;
  billsPaid: number;
  adoptionRate: number;
  estRate?: number;
}

export interface StateBreakdownInput {
  // PROPERTY_PUBLIC_ID is optional only so older/synthetic callers (and the geo unit tests) can
  // omit it; when present it is what the state bars count by - see renderStateBreakdown.
  latestRows: { PROPERTY_NAME: string; PROPERTY_PUBLIC_ID?: string | null; PROPERTY_UNIT_COUNT: number; BILLS_PAID: number; PROPERTY_STATE: string | null; ROLLOUT_MONTH: string | null }[];
  portfolioNar: number;
  reportingMonth: string;
  slideId?: number;
  regionDetail?: RegionDetailRow[];
}

/** Exported for the geo-additivity tests (__tests__/geo-state-additivity.test.ts) - the footnote
 * is a residual, so the only honest way to check it is to parse the rendered markup. */
export function renderStateBreakdown(input: StateBreakdownInput): { html: string; js: string } {
  const { latestRows, portfolioNar, reportingMonth, slideId = 6, regionDetail = [] } = input;

  // --- Aggregate by state ---
  const statesMap = new Map<string, { properties: Set<string>; totalUnits: number; billsPaid: number }>();
  for (const row of latestRows) {
    if (!row.PROPERTY_STATE) continue;
    const s = statesMap.get(row.PROPERTY_STATE) || { properties: new Set<string>(), totalUnits: 0, billsPaid: 0 };
    // Count by PROPERTY_PUBLIC_ID - the same key the Exec Summary's own property tile uses, and
    // the same key the region-detail query now counts by. PROPERTY_NAME is not unique, so a
    // name-based count here could not tie to either the tile above it or the drill-down rows
    // below it. Rows without a public id fall back to the name as before. Mirrors Flask d537142.
    s.properties.add(row.PROPERTY_PUBLIC_ID || row.PROPERTY_NAME);
    s.totalUnits += row.PROPERTY_UNIT_COUNT;
    s.billsPaid += row.BILLS_PAID;
    statesMap.set(row.PROPERTY_STATE, s);
  }

  // Flask: snapshot["property_state"].nunique() > 2 — strictly greater than 2.
  // At 2 states or fewer, render nothing (empty string).
  if (statesMap.size <= 2) {
    return { html: "", js: "" };
  }

  const states: StateRowData[] = Array.from(statesMap.entries())
    .map(([st, s]) => ({
      state: st,
      properties: s.properties.size,
      totalUnits: s.totalUnits,
      billsPaid: s.billsPaid,
      adoptionRate: s.totalUnits > 0 ? s.billsPaid / s.totalUnits : 0,
    }))
    .sort((a, b) => b.adoptionRate - a.adoptionRate);

  // --- Dynamic title from top-performing states ---
  const aboveAvgStates = states.filter((s) => s.adoptionRate >= portfolioNar);
  const topStates = (aboveAvgStates.length > 0 ? aboveAvgStates : states).slice(0, 3).map((s) => s.state);
  let stateTitle: string;
  if (topStates.length === 1) {
    stateTitle = `${topStates[0]} leads - what&apos;s working there?`;
  } else if (topStates.length === 2) {
    stateTitle = `${topStates[0]} and ${topStates[1]} are ahead - what can other markets learn?`;
  } else {
    stateTitle = `${topStates[0]}, ${topStates[1]}, and ${topStates[2]} lead - what can other markets learn?`;
  }

  // --- Single-state guard ---
  if (states.length <= 1) {
    const stateName = states[0]?.state || "N/A";
    const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header">
      <div class="slide-label">Geographic Breakdown</div>
      <div class="slide-title">Adoption by State</div>
    </div>
    <div style="color:#524e5b;font-size:15px;padding:40px 0;">
      All properties are located in <strong>${htmlEscape(stateName)}</strong> - no multi-state comparison available.
    </div>
  </div>`;
    return { html, js: "" };
  }

  // --- Established-property rate (properties 3+ months old) ---
  let hasEst = false;
  try {
    const rmDate = new Date(reportingMonth);
    const cutoffDate = new Date(rmDate.getFullYear(), rmDate.getMonth() - 3, 1);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);

    // Filter to established properties (rollout_month <= cutoff)
    const estRows = latestRows.filter(
      (r) => r.PROPERTY_STATE && r.ROLLOUT_MONTH && r.ROLLOUT_MONTH <= cutoffStr
    );
    if (estRows.length > 0) {
      const estMap = new Map<string, { billsPaid: number; units: number }>();
      for (const row of estRows) {
        const key = row.PROPERTY_STATE!;
        const e = estMap.get(key) || { billsPaid: 0, units: 0 };
        e.billsPaid += row.BILLS_PAID;
        e.units += row.PROPERTY_UNIT_COUNT;
        estMap.set(key, e);
      }
      for (const s of states) {
        const est = estMap.get(s.state);
        if (est && est.units > 0) {
          s.estRate = est.billsPaid / est.units;
        }
      }
      hasEst = states.some((s) => s.estRate != null && s.estRate > 0);
    }
  } catch {
    // Skip est computation on error
  }

  // --- Metrics ---
  const aboveAvgCount = states.filter((s) => s.adoptionRate >= portfolioNar).length;
  const bestState = states[0];
  const barScale = (Math.max(...states.map((s) => s.adoptionRate)) * 1.15) || 1.0;
  const rowMargin = states.length <= 7 ? "10px" : "0";

  // --- KPI card helper ---
  function kpiCard(label: string, value: string, delta: string, color: string): string {
    const colorMap: Record<string, string> = { purple: "#6A3DB8", teal: "#0d9488", amber: "#d97706" };
    const c = colorMap[color] || "#6A3DB8";
    return `
      <div style="background:#fff;border:1px solid #eceaf2;border-radius:16px;padding:20px 20px 16px;">
        <div style="font-size:11px;text-transform:uppercase;color:#524e5b;margin-bottom:10px;font-weight:500;">${label}</div>
        <div style="font-size:36px;font-weight:400;color:${c};margin-bottom:6px;">${value}</div>
        <div style="font-size:12px;color:#524e5b;">${delta}</div>
      </div>`;
  }

  // --- Bar row helper ---
  function barRow(opts: {
    stateLabel: string;
    rate: number;
    avg: number;
    estRate?: number;
    props: number;
    units: number;
    bills?: number;
    extraHtml?: string;
    onclick?: string;
    scale?: number;
  }): string {
    const { stateLabel, rate, avg, estRate = 0, props, units, bills = 0, extraHtml = "", onclick = "", scale } = opts;
    const isNested = scale != null;
    const localScale = scale ?? barScale;
    const barPct = (rate / localScale) * 100;
    const markerPct = Math.min((avg / localScale) * 100, 100);
    const gap = rate - avg;

    let lightShade: string, darkShade: string, labelColor: string;
    if (gap >= 0) {
      lightShade = "#bdead9"; darkShade = "#1a9e6a"; labelColor = "#1a9e6a";
    } else if (gap >= -0.03) {
      lightShade = "#f6d9ab"; darkShade = "#d97706"; labelColor = "#d97706";
    } else {
      lightShade = "#DDC6F9"; darkShade = "#6A3DB8"; labelColor = "#524e5b";
    }

    const barOpacity = isNested ? "opacity:0.55;" : "";
    const estPct = estRate > 0 ? (estRate / localScale) * 100 : 0;

    let barsHtml: string;
    if (estRate > 0) {
      const blendedDiv = `<div style="background:${lightShade};height:100%;width:${barPct.toFixed(0)}%;border-radius:4px;position:absolute;top:0;left:0;${barOpacity}"></div>`;
      const estDiv = `<div style="background:${darkShade};height:100%;width:${estPct.toFixed(0)}%;border-radius:4px;position:absolute;top:0;left:0;${barOpacity}${estPct > 0 ? "border-right:2px solid #fff;" : ""}"></div>`;
      barsHtml = estPct <= barPct ? (blendedDiv + estDiv) : (estDiv + blendedDiv);
    } else {
      barsHtml = `<div style="background:${darkShade};height:100%;width:${barPct.toFixed(0)}%;border-radius:4px;position:absolute;top:0;left:0;${barOpacity}"></div>`;
    }

    const cursorStyle = onclick ? "cursor:pointer;" : "";
    const chevron = onclick ? ` <span style="color:#a09cb0;font-size:11px;">&#9662;</span>` : "";
    const labelColWidth = isNested ? "230px" : "84px";
    const labelStyle = isNested
      ? "font-size:11px;font-weight:500;color:#524e5b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
      : "font-size:13px;font-weight:600;color:#1d1d1d;";

    // The paying-residents column exists so the drill-down accounts for the adoption rate's own
    // NUMERATOR, not just its denominator - without it, a state's region rows could silently
    // leave real paying residents on no row at all (see unmappedByState). Mirrors Flask d537142.
    return `
      <div style="display:grid;grid-template-columns:${labelColWidth} 1fr 62px 68px 68px 74px;gap:10px;align-items:center;margin-bottom:${rowMargin};">
        <div ${onclick} style="${labelStyle}${cursorStyle}" title="${htmlEscape(stateLabel)}">${htmlEscape(stateLabel)}${chevron}</div>
        <div style="position:relative;background:#eceaf2;border-radius:4px;height:10px;overflow:visible;">
          ${barsHtml}
          <div style="position:absolute;top:-5px;bottom:-5px;left:${markerPct.toFixed(1)}%;width:2px;background:#2C194D;opacity:0.3;border-radius:1px;"></div>
        </div>
        <div style="font-size:13px;font-weight:700;color:${labelColor};text-align:right;">${fmtPct(rate)}</div>
        <div style="font-size:11px;color:#a09cb0;text-align:right;">${props} props</div>
        <div style="font-size:11px;color:#a09cb0;text-align:right;">${units.toLocaleString()} units</div>
        <div style="font-size:11px;color:#a09cb0;text-align:right;">${bills.toLocaleString()} paying</div>
      </div>${extraHtml}`;
  }

  // --- Build region map by state ---
  const regionsByState = new Map<string, { region: string; properties: number; totalUnits: number; billsPaid: number; adoptionRate: number }[]>();
  // state -> (properties, units, bills) NOT shown on any region bar: the 'Unknown' bucket (ZIP
  // had no DMA and no usable neighbours, or the network puts its ZIP in a different state than
  // PROPERTY_STATE - see geo-regions.ts) plus anything else the region pull didn't account for.
  // Those never render as a bar labelled "Unknown"; they become one grey footnote line under
  // that state's regions. DISPLAY_REGION (rule C) is the label to print - "PITTSBURGH (WV side)"
  // for a WV property in a PA-home DMA - while PROPERTY_REGION stays the grouping key.
  //
  // This is computed HERE as `state total - SUM(rendered region rows)`, per state, per measure -
  // NOT read off the region query's own Unknown rows, which is what it used to do. Two
  // independently sourced numbers cannot be made to add up by asserting that they do: live,
  // Asset Living CA's 13 region bars already summed to the bar's 604 properties and the footnote
  // still claimed "+4", while RPM Living TX's regions summed to 425 under a 424 bar with no
  // footnote at all. As a residual it is arithmetically exact by construction - the rendered rows
  // plus this line always equal the state bar for properties, units AND bills. Mirrors Flask
  // d537142 (superseding f7d95a6 / 61facd0).
  const unmappedByState = new Map<string, { properties: number; units: number; bills: number }>();
  for (const r of regionDetail) {
    if (!r.PROPERTY_STATE) continue;
    if (r.PROPERTY_REGION === UNKNOWN_REGION) continue; // folded into the residual below
    const arr = regionsByState.get(r.PROPERTY_STATE) || [];
    const rate = r.TOTAL_UNITS > 0 ? r.BILLS_PAID / r.TOTAL_UNITS : 0;
    arr.push({ region: r.DISPLAY_REGION || r.PROPERTY_REGION, properties: r.PROPERTIES, totalUnits: r.TOTAL_UNITS, billsPaid: r.BILLS_PAID, adoptionRate: rate });
    regionsByState.set(r.PROPERTY_STATE, arr);
  }
  // Sort regions within each state by adoption rate desc
  for (const [, regions] of regionsByState) {
    regions.sort((a, b) => b.adoptionRate - a.adoptionRate);
  }
  // Residual per state, against the state bars rendered above. Only states that actually have a
  // bar are considered - a region row for a state with no bar has nothing to reconcile against.
  if (regionDetail.length > 0) {
    for (const s of states) {
      const rendered = regionsByState.get(s.state) ?? [];
      const resid = {
        properties: s.properties - rendered.reduce((a, r) => a + r.properties, 0),
        units: s.totalUnits - rendered.reduce((a, r) => a + r.totalUnits, 0),
        bills: s.billsPaid - rendered.reduce((a, r) => a + r.billsPaid, 0),
      };
      if (resid.properties !== 0 || resid.units !== 0 || resid.bills !== 0) {
        unmappedByState.set(s.state, resid);
      }
    }
  }
  const hasDrilldown = regionsByState.size > 0 || unmappedByState.size > 0;

  // --- Build state rows ---
  let stateRowsHtml = "";
  let stateIdx = 0;
  for (const s of states) {
    const regions = regionsByState.get(s.state);
    const unmapped = unmappedByState.get(s.state);
    let regionBlock = "";
    let onclick = "";
    if ((regions && regions.length > 0) || unmapped) {
      const rowsId = `geo-region-${slideId}-${stateIdx}`;
      let regionRows = "";
      if (regions && regions.length > 0) {
        const localScale = Math.max(Math.max(...regions.map(r => r.adoptionRate)), portfolioNar) * 1.15 || 1.0;
        for (const rr of regions) {
          regionRows += barRow({
            stateLabel: rr.region,
            rate: rr.adoptionRate,
            avg: portfolioNar,
            props: rr.properties,
            units: rr.totalUnits,
            bills: rr.billsPaid,
            scale: localScale,
          });
        }
      }
      if (unmapped) {
        // Footnote, not a bar: an "Unknown" row ranked among real markets read as a data error
        // to Kevin (Allied combined deck). A state with ONLY unmapped properties still gets the
        // expand affordance so the footnote is reachable. Every measure the rows above carry
        // appears here too, signed, so the rows plus this line reconcile to the state bar
        // exactly. A negative figure would mean the region pull over-accounts for the state and
        // is printed as such rather than hidden - a wrong number a rep can see beats one they
        // can't. String matches Flask's exactly.
        const sgn = (v: number) => `${v < 0 ? "-" : "+"}${Math.abs(v).toLocaleString()}`;
        regionRows += `<div style="font-size:10px;color:#a09cb0;margin-top:4px;margin-bottom:${rowMargin};">${sgn(unmapped.properties)} ${Math.abs(unmapped.properties) === 1 ? "property" : "properties"} · ${sgn(unmapped.units)} units · ${sgn(unmapped.bills)} paying without a mapped market</div>`;
      }
      // Left border acts as a visible tree guide-line connecting every region row back to
      // its parent state - a plain padding-left (the old approach) only nudged the label
      // text a little to the right, which read as barely-there hierarchy (Kevin's catch:
      // hard to tell these roll up into the state total above them). Deeper padding-left
      // than the first pass (18px -> 28px) makes the indent itself more decisive, and
      // margin-bottom gives the group a visible close before the next state starts -
      // without it, the gap after the last region row was the same rowMargin used between
      // every row throughout the list, so nothing signaled "this nested group just ended"
      // before the next top-level state appeared right after it (Kevin's follow-up catch:
      // hard to tell FL's rows end and TN begins). Mirrors the identical fix in Flask's
      // render_state_breakdown.
      regionBlock = `<div id="${rowsId}" style="display:none;margin-top:6px;margin-bottom:14px;margin-left:6px;padding-left:28px;border-left:2px solid #e5e2f0;">${regionRows}</div>`;
      onclick = `onclick="flexToggleGeoRegion('${rowsId}')"`;
    }
    stateRowsHtml += barRow({
      stateLabel: s.state,
      rate: s.adoptionRate,
      avg: portfolioNar,
      estRate: s.estRate ?? 0,
      props: s.properties,
      units: s.totalUnits,
      bills: s.billsPaid,
      extraHtml: regionBlock,
      onclick,
    });
    stateIdx++;
  }

  // --- KPI row ---
  const kpiRow = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px;">
      ${kpiCard("States", String(states.length), "active markets", "purple")}
      ${kpiCard("Above Portfolio Avg", `${aboveAvgCount} / ${states.length}`, `portfolio avg ${fmtPct(portfolioNar)}`, aboveAvgCount >= Math.floor(states.length / 2) ? "teal" : "amber")}
      ${kpiCard("Top State", fmtPct(bestState.adoptionRate), htmlEscape(bestState.state), "teal")}
    </div>`;

  // --- Legend footer ---
  let legendText = `Line = portfolio avg ${fmtPct(portfolioNar)} &middot; Green = above avg &middot; Amber = within 3pp &middot; Purple = below avg`;
  if (hasEst) {
    legendText += ` &middot; Darker shade = established properties (3+ mo.) &middot; Lighter shade = all properties`;
  }
  if (hasDrilldown) {
    legendText += ` &middot; Click a state to see its regions - each state's region rows plus its grey line add up to that state's own props, units and paying residents`;
  }

  const regionScript = hasDrilldown
    ? `<script>if(!window.flexToggleGeoRegion){window.flexToggleGeoRegion=function(rowId){var block=document.getElementById(rowId);if(!block)return;block.style.display=(block.style.display==='none')?'block':'none';};}</script>`
    : "";

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;justify-content:flex-start;">
    <div class="slide-header">
      <div class="slide-label">Geographic Breakdown</div>
      <div class="slide-title">${stateTitle}</div>
    </div>
    ${kpiRow}
    <div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:12px;padding:20px 20px 14px;
                flex:1;min-height:0;display:flex;flex-direction:column;">
      <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#524e5b;margin-bottom:16px;font-weight:600;">
        Current Month - Ranked by Adoption Rate
      </div>
      <div style="flex:1;min-height:0;overflow-y:auto;padding-right:4px;display:flex;flex-direction:column;justify-content:space-evenly;">
        ${stateRowsHtml}
      </div>
      <div style="font-size:11px;color:#a09cb0;margin-top:10px;border-top:1px solid #eceaf2;padding-top:10px;flex-shrink:0;">
        ${legendText}
      </div>
    </div>
  </div>
  ${regionScript}`;
  return { html, js: "" };
}



function renderFullPropertyTable(
  snapshot: { propertyName: string; pmcName?: string; units: number; billsPaid: number; newSignups: number; prevSignups?: number; adoptionRate: number; rentPaid?: number; cumRent?: number; rolloutMonth?: string | null }[],
  slideId: number
): string {
  // "PMC" column right after Property, ONLY when the report combines 2+ PMCs (Kevin's ask on the
  // 8-entity Asset Living deck: with every subsidiary's properties in one list, the property
  // name alone doesn't say whose it is). Gated on >= 2 DISTINCT pmcName values in the snapshot -
  // not on the field merely being present - so a single-PMC report's table is byte-identical
  // to before this existed. Wraps rather than truncates, same as the Entity cell in Portfolio
  // Comparison. Names are display-shortened via displayEntityNames (same call as every other
  // entity label in a combined deck; collision-safe, so sorting on the short name groups
  // exactly as the full name would) - mirrors Flask's _pmc_disp.
  const uniqPmc = [...new Set(snapshot.map((r) => r.pmcName).filter((n): n is string => !!n))];
  const showPmc = uniqPmc.length >= 2;
  const pmcShort = displayEntityNames(uniqPmc);
  const pmcDisp = new Map(uniqPmc.map((n, i) => [n, pmcShort[i]]));
  let rows = "";
  for (const row of snapshot) {
    const narColor = row.adoptionRate >= 0.20 ? "#1a9e6a" : row.adoptionRate >= 0.10 ? "#d97706" : "#dc5050";
    const curSig = Math.round(row.newSignups);
    const prevSig = Math.round(row.prevSignups ?? 0);
    let sigHtml = curSig.toLocaleString("en-US");
    if (prevSig > 0) {
      const delta = curSig - prevSig;
      const deltaPct = Math.abs(delta / prevSig) * 100;
      const arr = delta >= 0 ? "▲" : "▼";
      const sigColor = delta >= 0 ? "#1a9e6a" : "#dc5050";
      sigHtml = `${curSig.toLocaleString("en-US")} <span style="font-size:10px;color:${sigColor};white-space:nowrap;">${arr}${deltaPct.toFixed(0)}%</span>`;
    }
    const thisMonthRent = row.rentPaid ?? 0;
    const totalRent = row.cumRent ?? thisMonthRent;
    // Rollout month: sort key as plain YYYYMM digits (fixes parseFloat stopping at dash)
    const rmRaw = row.rolloutMonth ?? "";
    const rmSort = rmRaw ? rmRaw.replace(/-/g, "").slice(0, 6) : "0";
    const rmDisplay = rmRaw ? new Date(rmRaw + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "short", timeZone: "UTC" }) : "-";
    const pmcName = _e(pmcDisp.get(row.pmcName ?? "") ?? row.pmcName ?? "");
    const pmcCell = showPmc
      ? `\n          <td data-sort="${pmcName}" style="padding:6px 8px;font-size:11px;color:#524e5b;white-space:normal;overflow-wrap:anywhere;line-height:1.3;">${pmcName}</td>`
      : "";
    rows += `
        <tr>
          <td data-sort="${_e(row.propertyName)}" style="padding:6px 8px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">${_e(row.propertyName)}</td>${pmcCell}
          <td data-sort="${rmSort}" style="padding:6px 8px;font-size:12px;text-align:right;color:#a09cb0;">${rmDisplay}</td>
          <td data-sort="${row.units}" style="padding:6px 8px;font-size:12px;text-align:right;">${row.units.toLocaleString("en-US")}</td>
          <td data-sort="${row.billsPaid}" style="padding:6px 8px;font-size:12px;text-align:right;">${Math.round(row.billsPaid).toLocaleString("en-US")}</td>
          <td data-sort="${curSig}" style="padding:6px 8px;font-size:12px;text-align:right;">${sigHtml}</td>
          <td data-sort="${row.adoptionRate}" style="padding:6px 8px;font-size:12px;text-align:right;font-weight:700;color:${narColor};">${fmtPct(row.adoptionRate)}</td>
          <td data-sort="${thisMonthRent}" style="padding:6px 8px;font-size:12px;text-align:right;">${fmtCurrency(thisMonthRent)}</td>
          <td data-sort="${totalRent}" style="padding:6px 8px;font-size:12px;text-align:right;color:#6A3DB8;">${fmtCurrency(totalRent)}</td>
        </tr>`;
  }

  // With the PMC column in, Property + PMC share what Property alone had (18% -> 16% + 12%) and
  // the numeric columns give up a point or two each, so the row still sums to 100%.
  const cols = showPmc
    ? ["Property", "PMC", "Rollout Month", "Units", "Current Paying Residents", "New Signups (vs Last Mo.)", "Adoption", "This Month Rent", "Total Rent Paid"]
    : ["Property", "Rollout Month", "Units", "Current Paying Residents", "New Signups (vs Last Mo.)", "Adoption", "This Month Rent", "Total Rent Paid"];
  const colWidths = showPmc
    ? ["16%", "12%", "10%", "7%", "12%", "13%", "8%", "11%", "11%"]
    : ["18%", "11%", "8%", "13%", "14%", "10%", "13%", "13%"];
  const thHtml = cols
    .map((c, i) =>
      `<th onclick="flexSortTable(${slideId},${i})" id="th${slideId}-${i}" ` +
      `style="padding:6px 8px;text-align:${i === 0 ? "left" : "right"};font-size:10px;` +
      `color:${i === cols.length - 1 ? "#6A3DB8" : "#524e5b"};text-transform:uppercase;` +
      `letter-spacing:0.06em;cursor:pointer;user-select:none;white-space:normal;word-wrap:break-word;` +
      `width:${colWidths[i]};">` +
      `${c}<span id="arrow${slideId}-${i}" style="display:inline-block;width:12px;"></span></th>`
    )
    .join("");

  return `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header">
      <div class="slide-label">Appendix</div>
      <div class="slide-title">All Properties - Full Metrics</div>
      <div style="font-size:11px;color:#a09cb0;margin-top:4px;">Click a column header to sort</div>
    </div>
    <div style="overflow-y:auto;max-height:520px;overflow-x:hidden;">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <thead><tr id="thead${slideId}" style="border-bottom:2px solid #eceaf2;position:sticky;top:0;background:#fff;z-index:1;">${thHtml}</tr></thead>
        <tbody id="tbody${slideId}">${rows}</tbody>
      </table>
    </div>
  </div>
  <script>if(!window.flexSortTable){window.flexSortTable=function(sid,col){
    var tbody=document.getElementById('tbody'+sid); if(!tbody) return;
    var rows=Array.prototype.slice.call(tbody.querySelectorAll('tr'));
    var thead=document.getElementById('thead'+sid);
    var prevCol=thead.getAttribute('data-sort-col'), prevDir=thead.getAttribute('data-sort-dir');
    var asc = !(String(col)===prevCol && prevDir==='asc');
    rows.sort(function(a,b){
      var av=a.children[col].getAttribute('data-sort'), bv=b.children[col].getAttribute('data-sort');
      var an=parseFloat(av), bn=parseFloat(bv);
      var cmp = (!isNaN(an) && !isNaN(bn)) ? (an-bn) : String(av).localeCompare(String(bv));
      return asc ? cmp : -cmp;
    });
    rows.forEach(function(r){ tbody.appendChild(r); });
    thead.setAttribute('data-sort-col', col);
    thead.setAttribute('data-sort-dir', asc?'asc':'desc');
    for(var i=0;i<${cols.length};i++){
      var el=document.getElementById('arrow'+sid+'-'+i);
      if(el) el.textContent = (i===col) ? (asc?'\\u25B2':'\\u25BC') : '';
    }
  };}</script>`;
}

// --- Deck Template ---

/**
 * Exported so __tests__/present-mode-controls.test.ts can check the shell's real CSS against
 * the real emitted control classes - the only evidence available for a fullscreen/PDF-visibility
 * claim without a browser.
 */
export function buildDeckHtml(params: {
  slides: string;
  pmc_name: string;
  report_month: string;
  report_year: string;
  slide_count: number;
  pdf_filename: string;
  extra_js?: string;
}): string {
  const { slides, pmc_name, report_month, report_year, slide_count, pdf_filename, extra_js } = params;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pmc_name} - Flex Performance Review | ${report_month}</title>
<style>
  @font-face { font-family: 'ABCDiatype'; src: url('/static/fonts/ABCDiatype-Regular.otf') format('opentype'); font-weight: 400; font-style: normal; }
  @font-face { font-family: 'ABCDiatype'; src: url('/static/fonts/ABCDiatype-Medium.otf') format('opentype'); font-weight: 500; font-style: normal; }
  @font-face { font-family: 'ABCDiatype'; src: url('/static/fonts/ABCDiatype-Bold.otf') format('opentype'); font-weight: 700; font-style: normal; }
  @font-face { font-family: 'ABCDiatype'; src: url('/static/fonts/ABCDiatype-Bold.otf') format('opentype'); font-weight: 800; font-style: normal; }
  @font-face { font-family: 'ABCDiatype'; src: url('/static/fonts/ABCDiatype-Bold.otf') format('opentype'); font-weight: 900; font-style: normal; }
  @font-face { font-family: 'CooperBT'; src: url('/static/fonts/CooperMdBT-Regular.ttf') format('truetype'); font-weight: 500; font-style: normal; }
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js"><\/script>
<!-- Leaflet: the Embed deck's market-map slides (74) render inside this shell, where the New Logo
     deck's slides are wrapped client-side by wrap-slides-html.ts instead. Mirrors Flask adding
     Leaflet to the shared deck_base.html. Inert for every other deck mode. -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --black: #1D1D1D; --navy: #2C194D; --white: #ffffff; --purple: #6A3DB8;
    --purple-mid: #DDC6F9; --purple-light: #EEE2FC; --gray: #524e5b; --bg: #F7F7F7;
    --border: #eceaf2; --green: #1a9e6a; --amber: #d97706;
    --orange: #ea8c28; --red: #dc5050;
  }
  body { font-family: 'ABCDiatype', 'Lexend', sans-serif; background: #111; color: var(--navy); overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
  .deck-viewport { flex: 1; position: relative; overflow: hidden; }
  .deck { position: relative; }
  .slide { display: none; position: absolute; width: 1280px; height: 720px; padding: 40px 72px 52px; background: #fff; flex-direction: column; justify-content: flex-start; overflow: hidden; }
  .slide.active { display: flex; }
  .slide::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 44px; pointer-events: none; }
  .footer-left { position: fixed; bottom: 14px; left: 44px; font-family: 'ABCDiatype', sans-serif; font-size: 11px; color: #9896a4; letter-spacing: 0.02em; z-index: 100; line-height: 1; }
  .footer-right { position: fixed; bottom: 10px; right: 44px; display: flex; align-items: center; gap: 16px; z-index: 100; }
  .flex-wordmark { font-family: 'ABCDiatype', sans-serif; font-size: 22px; font-weight: 800; letter-spacing: -0.04em; color: var(--navy); line-height: 1; }
  .slide-counter { font-family: 'ABCDiatype', sans-serif; font-size: 12px; color: #9896a4; line-height: 1; }
  .slide-label { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--purple); margin-bottom: 8px; font-weight: 600; font-family: 'ABCDiatype', sans-serif; }
  .slide-title { font-size: 34px; font-weight: 700; color: var(--navy); line-height: 1.15; letter-spacing: -0.02em; font-family: 'ABCDiatype', sans-serif; }
  .slide-header { margin-bottom: 20px; }
  .chart-wrap { position: relative; flex: 1; min-height: 280px; width: 100%; background: var(--bg); border-radius: 16px; border: 1px solid var(--border); padding: 22px; }
  .deck-actions { display: flex; gap: 6px; align-items: center; }
  .action-btn { display: flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); color: #9896a4; font-family: 'ABCDiatype', sans-serif; font-size: 11px; cursor: pointer; transition: all 0.15s; letter-spacing: 0.02em; }
  .action-btn:hover { background: rgba(255,255,255,0.14); color: #fff; border-color: rgba(255,255,255,0.28); }
  .action-btn.is-active { background: #6A3DB8; color: #fff; border-color: #6A3DB8; }
  #deck[contenteditable="true"] .slide { cursor: text; }
  .slide-hide-btn { position: absolute; top: 10px; right: 10px; z-index: 50; padding: 4px 10px; border-radius: 5px; border: 1px solid #e5e7eb; background: rgba(255,255,255,0.92); color: #9ca3af; font-size: 10px; font-weight: 600; cursor: pointer; font-family: 'ABCDiatype', sans-serif; letter-spacing: 0.04em; backdrop-filter: blur(4px); transition: all 0.12s; }
  .slide-hide-btn:hover { background: #f9f5ff; color: #6A3DB8; border-color: #6A3DB8; }
  .slide-hide-btn.is-hidden { background: #fee2e2; color: #dc5050; border-color: #fca5a5; }
  .slide-copy-btn { position: absolute; top: 10px; right: 90px; z-index: 50; padding: 4px 10px; border-radius: 5px; border: 1px solid #e5e7eb; background: rgba(255,255,255,0.92); color: #9ca3af; font-size: 10px; font-weight: 600; cursor: pointer; font-family: 'ABCDiatype', sans-serif; letter-spacing: 0.04em; backdrop-filter: blur(4px); transition: all 0.12s; }
  .slide-copy-btn:hover { background: #f0edff; color: #6A3DB8; border-color: #6A3DB8; }
  .slide.slide-excluded { opacity: 0.35; outline: 2px solid #dc5050; }
  :fullscreen .slide-hide-btn, :-webkit-full-screen .slide-hide-btn { display: none; }
  :fullscreen .slide.slide-excluded, :-webkit-full-screen .slide.slide-excluded { opacity: 1; outline: none; }
  :fullscreen .presenter-control, :-webkit-full-screen .presenter-control { display: none; }
  /* keep-live opts ONE presenter-control back into visibility during an actual presentation
     (Flask deck_base.html:146). Used by the Adoption Trend established-line toggle: Kevin -
     that line has a real story worth telling live, unlike peer median, which should never
     reach an audience. Still stripped from the PDF by the .presenter-control half. */
  :fullscreen .presenter-control.keep-live,
  :-webkit-full-screen .presenter-control.keep-live { display: inline-block; }
  :fullscreen #editBtn, :-webkit-full-screen #editBtn { display: none; }
  .bm-metric-toggles { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
  .stat-toggle-bar { display: flex; gap: 4px; }
  /* Kevin's ask: was position:absolute;bottom:44px;left:72px, pinned to the slide corner
     regardless of where its HTML sits - moved into normal header flow instead (next to
     deltaToggle) so it's visible at the top without hunting for it at the bottom. */
  .spark-ctrl { display: flex; gap: 5px; align-items: center; }
  .spark-ctrl-btn { padding: 3px 9px; border-radius: 4px; border: 1px solid #e5e7eb; background: rgba(255,255,255,0.92); color: #9ca3af; font-size: 10px; font-weight: 600; cursor: pointer; font-family: 'ABCDiatype', sans-serif; letter-spacing: 0.04em; backdrop-filter: blur(4px); transition: all 0.12s; }
  .spark-ctrl-btn:hover { background: #f9f5ff; color: #6A3DB8; border-color: #6A3DB8; }
  .spark-ctrl-btn.is-hidden { color: #dc5050; background: #fee2e2; border-color: #fca5a5; text-decoration: line-through; }
  .spark-ctrl-btn.is-active { color: #fff; background: #6A3DB8; border-color: #6A3DB8; }
  .spark-ctrl-btn.is-active:hover { color: #fff; background: #6A3DB8; }
  /* View-level controls (Combined / Show all / "Q3 2026 adds") in the entity switcher rows -
     a rounded purple-outlined pill so they read as controls, distinct from the per-entity
     buttons' grey square-cornered look with a colored left border (Kevin: "make these a
     little more visually apparent so theyre more distinct from the individual subsidiary
     buttons"). .is-active still fills solid purple; the pill shape carries the distinction.
     Mirrors Flask deck_base.html (2785a75). */
  .spark-ctrl-btn.ctl-btn { border-radius: 999px; border-color: #c4b5e6; color: #6A3DB8; background: #f5f1fb; font-weight: 700; padding: 3px 11px; }
  .spark-ctrl-btn.ctl-btn:hover { border-color: #6A3DB8; }
  :fullscreen .spark-ctrl, :-webkit-full-screen .spark-ctrl { display: none; }
  /* SELECTION controls - the entity switchers (Exec Summary, Adoption Trend, Residents/Units)
     and the quarter-adds buttons. Kevin's ask is explicitly that these stay usable while
     presenting a combined deck live, unlike the purely cosmetic sparkline toggles above. So
     they get their own container class that is deliberately NEITHER .spark-ctrl NOR
     .presenter-control, which is exactly why no fullscreen rule can reach them - the same
     trick, for the same stated reason, as Flask's .exec-switch-row / .adt-switch-row
     (generator/slides.py:9703). They shipped as class="spark-ctrl presenter-control", which
     BOTH fullscreen rules above hid, right below a Clark comment claiming the opposite.
     Layout lives here rather than in an inline style so nothing out-specificities a future
     rule; .pdf-export-hide on the rows still strips them from the exported PDF. */
  .switch-row { display: flex; gap: 5px; align-items: center; }
  .stat-toggle-btn.is-active { background: #6A3DB8; color: #fff; border-color: #6A3DB8; }
  .nav-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(17,17,17,0.72); display: flex; align-items: center; justify-content: center; }
  .nav-panel { background: #fff; border-radius: 16px; width: min(720px, 88vw); max-height: 78vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 64px rgba(0,0,0,0.4); }
  .nav-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 22px; border-bottom: 1px solid var(--border); font-family: 'ABCDiatype', sans-serif; }
  .nav-panel-title { font-size: 15px; font-weight: 700; color: var(--navy); }
  .nav-panel-close { border: none; background: transparent; color: #9896a4; cursor: pointer; font-size: 20px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
  .nav-panel-close:hover { background: var(--bg); color: var(--navy); }
  .nav-list { overflow-y: auto; padding: 8px; }
  .nav-row { display: flex; align-items: baseline; gap: 12px; padding: 10px 14px; border-radius: 8px; cursor: pointer; font-family: 'ABCDiatype', sans-serif; color: var(--navy); transition: background 0.1s; }
  .nav-row:hover { background: var(--purple-light); }
  .nav-row.is-current { background: var(--purple-light); outline: 1.5px solid var(--purple); }
  .nav-row-num { font-size: 12px; color: #9896a4; font-weight: 600; min-width: 22px; flex-shrink: 0; }
  .nav-row-label { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--purple); font-weight: 600; flex-shrink: 0; }
  .nav-row-title { font-size: 13px; color: var(--navy); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media print {
    body { background: #fff; overflow: visible; height: auto; display: block; }
    .deck-viewport, .deck { position: static !important; transform: none !important; width: auto !important; height: auto !important; }
    .slide { display: flex !important; position: relative !important; transform: none !important; width: 100% !important; height: auto !important; min-height: 720px; page-break-after: always; }
    .footer-left, .footer-right, .deck-actions, .nav-overlay { display: none; }
    .slide::before { content: 'Flexible Finance, Inc. \\00A9 ${report_year} | Confidential'; position: absolute; bottom: 14px; left: 80px; font-family: 'ABCDiatype', sans-serif; font-size: 11px; color: #9896a4; }
    .slide-brand::after { content: 'flex'; position: absolute; bottom: 12px; right: 80px; font-family: 'ABCDiatype', sans-serif; font-size: 22px; font-weight: 800; letter-spacing: -0.04em; color: #6A3DB8; }
  }
</style>
</head>
<body>
<div class="deck-viewport" id="deckViewport">
  <div class="deck" id="deck">
    ${slides}
  </div>
</div>
<div class="footer-left">
  Flexible Finance, Inc. &copy; ${report_year} | Confidential &nbsp;&middot;&nbsp; ${pmc_name} &middot; ${report_month} ${report_year} BP month
</div>
<div class="footer-right">
  <div class="deck-actions">
    <button class="action-btn" id="pdfBtn" title="Save as PDF" onclick="exportDeckPDF(this)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      PDF
    </button>
    <button class="action-btn" id="fsBtn" title="Fullscreen (F)" onclick="toggleFullscreen()">
      <svg id="fsIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      Present
    </button>
    <button class="action-btn" id="navToggleBtn" title="Jump to Slide (G)" onclick="toggleNavigator()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      Slides
    </button>
    <button class="action-btn" id="editBtn" title="Quick-edit slide text" onclick="toggleEditMode()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
      Edit
    </button>
  </div>
  <span class="slide-counter" id="navCounter">1 / ${slide_count}</span>
  <span class="flex-wordmark">flex</span>
</div>
<div class="nav-overlay" id="navOverlay" style="display:none;" onclick="if (event.target === this) closeNavigator();">
  <div class="nav-panel">
    <div class="nav-panel-header">
      <span class="nav-panel-title">Jump to Slide</span>
      <button class="nav-panel-close" onclick="closeNavigator()" title="Close (Esc)">&times;</button>
    </div>
    <div class="nav-list" id="navList"></div>
  </div>
</div>
<script>
  Chart.register(ChartDataLabels);
  let current = 1;
  const total = ${slide_count};
  const HIDE_KEY = 'flex_hidden_${pdf_filename}';
  let hiddenSlides = new Set(JSON.parse(localStorage.getItem(HIDE_KEY) || '[]'));
  function saveHidden() { localStorage.setItem(HIDE_KEY, JSON.stringify([...hiddenSlides])); }
  function visibleSlides() { const v = []; for (let i = 1; i <= total; i++) if (!hiddenSlides.has(i)) v.push(i); return v; }
  function updateCounter() {
    const hidden = hiddenSlides.size;
    if (document.fullscreenElement) {
      const vis = visibleSlides();
      const pos = vis.indexOf(current) + 1 || 1;
      document.getElementById('navCounter').textContent = pos + ' / ' + vis.length + (hidden ? ' (' + hidden + ' hidden)' : '');
    } else {
      document.getElementById('navCounter').textContent = current + ' / ' + total + (hidden ? ' \\u00b7 ' + hidden + ' hidden' : '');
    }
  }
  function toggleHide(n) {
    if (hiddenSlides.has(n)) { hiddenSlides.delete(n); }
    else {
      hiddenSlides.add(n);
      if (current === n) {
        const vis = visibleSlides();
        if (vis.length > 0) showSlide(vis.reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a));
      }
    }
    saveHidden(); refreshHideButtons(); updateCounter();
  }
  function refreshHideButtons() {
    document.querySelectorAll('.slide').forEach(slide => {
      const n = parseInt(slide.id.replace('slide-', ''));
      const btn = slide.querySelector('.slide-hide-btn');
      if (!btn) return;
      const hidden = hiddenSlides.has(n);
      slide.classList.toggle('slide-excluded', hidden);
      btn.classList.toggle('is-hidden', hidden);
      btn.textContent = hidden ? 'Show' : 'Hide';
      btn.title = hidden ? 'Click to include in presentation' : 'Click to skip in presentation';
    });
  }
  document.querySelectorAll('.slide').forEach(slide => {
    const n = parseInt(slide.id.replace('slide-', ''));
    if (isNaN(n)) return;
    const btn = document.createElement('button');
    btn.className = 'slide-hide-btn';
    btn.textContent = 'Hide';
    btn.title = 'Click to skip in presentation';
    btn.addEventListener('click', e => { e.stopPropagation(); toggleHide(n); });
    slide.appendChild(btn);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'slide-copy-btn pdf-export-hide presenter-control';
    copyBtn.textContent = 'Copy slide';
    copyBtn.title = 'Copy this slide as an image - paste into a Sheet, Doc, or Slide';
    copyBtn.addEventListener('click', e => { e.stopPropagation(); copySlideImage(n, copyBtn); });
    slide.appendChild(copyBtn);
  });
  refreshHideButtons();
  function showSlide(n) {
    current = n;
    document.querySelectorAll('.slide').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('slide-' + n);
    if (el) el.classList.add('active');
    updateCounter();
    if (window['initSlide' + n]) { try { window['initSlide' + n](); } catch(e) { console.error('slide', n, 'init failed:', e); } }
    if (window.flexSetStatMode) flexSetStatMode(window.flexStatMode || 'median');
  }
  function buildNavList() {
    const list = document.getElementById('navList');
    list.innerHTML = '';
    visibleSlides().forEach(n => {
      const slide = document.getElementById('slide-' + n);
      if (!slide) return;
      const label = slide.querySelector('.slide-label')?.textContent?.trim() || '';
      const title = slide.querySelector('.slide-title')?.textContent?.trim() || ('Slide ' + n);
      const row = document.createElement('div');
      row.className = 'nav-row' + (n === current ? ' is-current' : '');
      row.innerHTML = '<span class="nav-row-num">' + n + '</span>' + (label ? '<span class="nav-row-label">' + label + '</span>' : '') + '<span class="nav-row-title">' + title + '</span>';
      row.addEventListener('click', () => { showSlide(n); closeNavigator(); });
      list.appendChild(row);
    });
  }
  function toggleNavigator() {
    const overlay = document.getElementById('navOverlay');
    if (overlay.style.display === 'none') {
      buildNavList();
      overlay.style.display = 'flex';
      const currentRow = document.querySelector('.nav-row.is-current');
      if (currentRow) currentRow.scrollIntoView({ block: 'center' });
    } else { closeNavigator(); }
  }
  function closeNavigator() { document.getElementById('navOverlay').style.display = 'none'; }
  function isNavigatorOpen() { return document.getElementById('navOverlay').style.display !== 'none'; }
  let editMode = false;
  function toggleEditMode() {
    editMode = !editMode;
    document.getElementById('deck').setAttribute('contenteditable', editMode ? 'true' : 'false');
    document.getElementById('editBtn').classList.toggle('is-active', editMode);
  }
  function navigate(dir) {
    if (document.fullscreenElement) {
      const vis = visibleSlides();
      if (!vis.length) return;
      const idx = vis.indexOf(current);
      const next = idx + dir;
      if (next >= 0 && next < vis.length) showSlide(vis[next]);
    } else {
      const next = current + dir;
      if (next >= 1 && next <= total) showSlide(next);
    }
  }
  function fitSlides() {
    var vp = document.getElementById('deckViewport');
    if (!vp) return;
    var scale = Math.min(vp.offsetWidth / 1280, vp.offsetHeight / 720);
    var left = Math.max(0, (vp.offsetWidth  - 1280 * scale) / 2);
    var top  = Math.max(0, (vp.offsetHeight - 720  * scale) / 2);
    var deck = document.getElementById('deck');
    deck.style.transform = 'scale(' + scale + ')';
    deck.style.transformOrigin = 'top left';
    deck.style.left = left + 'px';
    deck.style.top  = top  + 'px';
    deck.style.position = 'absolute';
  }
  fitSlides();
  window.addEventListener('resize', fitSlides);
  document.addEventListener('fullscreenchange', fitSlides);
  document.addEventListener('keydown', (e) => {
    if (editMode) {
      if (e.key === 'Escape' && document.fullscreenElement) document.exitFullscreen();
      return;
    }
    if (e.key === 'Escape' && isNavigatorOpen()) { closeNavigator(); return; }
    if (isNavigatorOpen()) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') navigate(+1);
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   navigate(-1);
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    if (e.key === 'g' || e.key === 'G') toggleNavigator();
    if (e.key === 'Escape' && document.fullscreenElement) document.exitFullscreen();
  });
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        document.getElementById('fsBtn').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg> Exit';
      }).catch(() => {});
    } else { document.exitFullscreen(); }
  }
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      document.getElementById('fsBtn').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg> Present';
    } else if (editMode) { toggleEditMode(); }
    updateCounter();
  });
  showSlide(1);

  // Extra slide-specific JS (sparklines, toggles)
  ${extra_js || ''}

  // Chart.js initialization for adoption trend
  (function initCharts() {
    const canvas = document.getElementById('adoptionChart');
    if (!canvas) return;
    const configStr = canvas.getAttribute('data-chart-config');
    if (!configStr) return;
    try {
      const chartData = JSON.parse(configStr.replace(/&#39;/g, "'"));
      new Chart(canvas, {
        type: 'line',
        data: chartData,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, datalabels: { display: false } },
          scales: { y: { ticks: { callback: function(v) { return v + '%'; } } } },
        },
      });
    } catch (e) { console.error('Chart init failed:', e); }
  })();

  // Shared by exportDeckPDF's per-page loop AND copySlideImage's single-slide capture below -
  // mirrors Flask's captureSlideCanvas (deck_base.html / app.py) exactly, so the two apps'
  // capture behavior doesn't drift. Deliberately does NOT touch deck.style.transform or
  // el.style.position - the loop resets those once for its whole run, the single-slide button
  // resets them once for its one capture; bundling that in here would make the loop reset on
  // every iteration and flicker across each page of a full-deck PDF export.
  async function captureSlideCanvas(el) {
    await document.fonts.ready;
    void el.offsetHeight;
    el.querySelectorAll('canvas').forEach(cv => {
      const c = Chart.getChart(cv);
      if (!c) return;
      try { c.resize(); c.update('none'); } catch(e) {}
    });
    await new Promise(r => setTimeout(r, 100));
    return html2canvas(el, {
      scale: 2, useCORS: true, allowTaint: true,
      backgroundColor: '#ffffff', width: 1280, height: 720,
      logging: false, imageTimeout: 0, x: 0, y: 0,
      windowWidth: 1280, windowHeight: 720,
      onclone: (doc) => {
        const s = doc.createElement('style');
        s.textContent = '* { letter-spacing: 0 !important; word-spacing: normal !important; } .slide-hide-btn, .presenter-control, .pdf-export-hide { display: none !important; } .slide-excluded { opacity: 1 !important; outline: none !important; }';
        doc.head.appendChild(s);
      },
    });
  }

  async function exportDeckPDF(btn) {
    const origHTML = btn.innerHTML;
    btn.innerHTML = '\\u23f3 Building\\u2026';
    btn.disabled = true;
    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1280, 720], hotfixes: ['px_scaling'] });
      const deck = document.getElementById('deck');
      const savedDeckT = deck.style.transform, savedDeckL = deck.style.left, savedDeckTop = deck.style.top;
      deck.style.transform = 'none'; deck.style.left = '0'; deck.style.top = '0'; deck.style.position = 'relative';
      const exportList = visibleSlides();
      let pageAdded = false;
      for (let i = 0; i < exportList.length; i++) {
        const n = exportList[i];
        document.querySelectorAll('.slide').forEach(s => { s.classList.remove('active'); s.style.position = 'absolute'; });
        const el = document.getElementById('slide-' + n);
        if (!el) continue;
        el.classList.add('active');
        el.style.position = 'relative';
        void el.offsetHeight;
        if (window['initSlide' + n]) { try { window['initSlide' + n](); } catch(e) {} }
        // Optional per-slide export hook (mirrors Flask deck_base.html): a slide whose PDF page
        // should show a specific toggle state (the Platinum deck's "With direct marketing"
        // charts - the toggled-ON view IS the deck's point) defines flexPdfPrep<N>; 'before'
        // sets that state for the capture, 'after' puts the slide back the way the viewer had
        // it. Slides without one are captured as-is, exactly as before.
        if (window['flexPdfPrep' + n]) { try { window['flexPdfPrep' + n]('before'); } catch(e) {} }
        await new Promise(r => setTimeout(r, 300));
        const canvas = await captureSlideCanvas(el);
        if (window['flexPdfPrep' + n]) { try { window['flexPdfPrep' + n]('after'); } catch(e) {} }
        el.style.position = 'absolute';
        if (pageAdded) pdf.addPage([1280, 720], 'landscape');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 1280, 720);
        pageAdded = true;
        btn.innerHTML = '\\u23f3 ' + (i + 1) + '/' + exportList.length;
      }
      deck.style.transform = savedDeckT; deck.style.left = savedDeckL; deck.style.top = savedDeckTop; deck.style.position = 'absolute';
      showSlide(current);
      pdf.save('${pdf_filename}');
    } catch(e) { alert('PDF export failed: ' + e.message); }
    btn.innerHTML = origHTML;
    btn.disabled = false;
  }

  // Copy (or, on clipboard failure, download) just the currently-active slide as a flat PNG -
  // replaces the screenshot-into-a-Sheet/Doc workaround people were already doing by hand.
  async function copySlideImage(n, btn) {
    const el = document.getElementById('slide-' + n);
    if (!el) return;
    const origLabel = btn.textContent;
    btn.textContent = '\\u2026';
    btn.disabled = true;
    try {
      const deck = document.getElementById('deck');
      const savedDeckT = deck.style.transform, savedDeckL = deck.style.left, savedDeckTop = deck.style.top, savedDeckPos = deck.style.position;
      deck.style.transform = 'none'; deck.style.left = '0'; deck.style.top = '0'; deck.style.position = 'relative';
      const savedElPos = el.style.position;
      el.style.position = 'relative';
      const canvas = await captureSlideCanvas(el);
      el.style.position = savedElPos;
      deck.style.transform = savedDeckT; deck.style.left = savedDeckL; deck.style.top = savedDeckTop; deck.style.position = savedDeckPos;

      await new Promise(resolve => canvas.toBlob(async (blob) => {
        let copied = false;
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          copied = true;
        } catch (e) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'slide-' + n + '.png';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
        btn.textContent = copied ? 'Copied!' : 'Downloaded';
        resolve();
      }, 'image/png'));
    } catch (e) {
      btn.textContent = 'Failed';
    }
    setTimeout(() => { btn.textContent = origLabel; btn.disabled = false; }, 1500);
  }
<\/script>
</body>
</html>`;
}

// ─── Embed → DI deck (deck_mode "embed") ───────────────────────────────────────
// Clark mirror of Flask app.py `_embed_total_units` / `_generate_embed` (spec:
// flex-pmc-reports docs/superpowers/specs/2026-09-10-embed-deck-design.md). None of the QBR
// pipeline applies - an embed-only PMC has no PROPERTY_BP_MONTH_STATS rows under its own name
// (everything lives under PMC 2476), so this runs as an early return before the rows query and
// resolves the PMC through generator/embed.py's Clark port instead.

/** `EMBED_SLIDE_ORDER = [70, 71, 72, 73, 74, 75, 76]` (Flask); string-keyed here like every other
 * fixed-order Clark deck. 74 is the per-DMA market map, 72 self-gates without a cohort. */
const EMBED_SLIDE_ORDER = ["cover", "embed_today", "graduation", "projection", "market", "visibility", "next_steps"] as const;

interface EmbedDeckCtx {
  integrations: {
    snowflake_sso: { query<T>(sql: string, schema: z.ZodType<T>, params?: unknown[], meta?: { label?: string }): Promise<T[]> };
    census: CensusGeocoderClient;
  };
  log: {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

export interface EmbedDeckArgs {
  pmc_name: string;
  total_units: number;
  avg_rent: number | null;
  /** Optional New Logo-shaped property rows ({header: cell}) - address/units overrides only. */
  properties: Record<string, unknown>[] | undefined;
  lookback_months: number;
  terminology: "resident" | "household" | undefined;
}

/**
 * Total-units resolution for the Embed deck, first hit wins: the request body (the tab's
 * prefilled/edited input) -> the SF account whose name matches the resolved display name exactly
 * -> the MSP embed list's unit total (yardi / mri / zego) -> the sum of REAL dim unit counts ->
 * null (400 gate). Flask `_embed_total_units`.
 */
async function embedTotalUnits(
  ctx: EmbedDeckCtx,
  bodyUnits: number,
  pmcDisplayName: string,
  resolved: { list_unit_total: number | null; properties: EmbedProperty[] },
): Promise<number | null> {
  const n = Math.trunc(Number(bodyUnits) || 0);
  if (n > 0) return n;
  try {
    const sf = await pullSfTotalUnits(ctx.integrations.snowflake_sso, pmcDisplayName);
    if (sf) return sf;
  } catch (e) {
    ctx.log.warn("embed: SF total-units lookup failed", { pmc: pmcDisplayName, error: e instanceof Error ? e.message : String(e) });
  }
  if (resolved.list_unit_total) return Math.trunc(resolved.list_unit_total);
  const real = resolved.properties.map((p) => p.unit_count).filter((u): u is number => u !== null && u !== undefined);
  return real.length > 0 ? real.reduce((a, b) => a + b, 0) : null;
}

async function generateEmbedDeck(
  ctx: EmbedDeckCtx,
  args: EmbedDeckArgs,
): Promise<{ html: string; empty: boolean; error?: string; notes_html?: string }> {
  const sf = ctx.integrations.snowflake_sso;
  const resolvedRaw = await resolveEmbedPmc(sf, args.pmc_name);
  if (resolvedRaw === null) {
    return { html: "", empty: false, error: EMBED_GATES.unknownPmc(args.pmc_name) };
  }
  const display = stripFkaSuffix(resolvedRaw.pmc_display_name);
  const { msp, msp_label: mspLabel } = resolvedRaw;
  const props = applyPropertyUpload(resolvedRaw.properties, args.properties);
  const resolved = { ...resolvedRaw, properties: props };
  const pids = props.map((p) => p.property_public_id);

  const lookback = Math.max(3, Math.min(Math.trunc(args.lookback_months || 12), 24));
  const monthlyRaw = await pullEmbedMonthly(sf, pids, lookback);
  let monthly = summarizeEmbedMonthly(monthlyRaw);
  if (monthly.filter((m) => m.bills_paid > 0).length < EMBED_MIN_MONTHS) {
    return { html: "", empty: false, error: EMBED_GATES.tooEarly(display) };
  }
  monthly = monthly.slice(-12);
  const reportingMonth = monthly[monthly.length - 1].bp_month;
  const latest = monthly[monthly.length - 1];
  // "Residents paying" = BILLS_PAID, the same basis as every adoption number this deck is compared
  // against (platinum_median_nar, the graduation curve, pullMarketSummary and the review /
  // Platinum / Check-in decks are all bills ÷ units). CHARGED_USERS is wider - every Flex customer
  // at those buildings, any channel, incl. residents who found Flex directly - so it is carried
  // separately as flexCustomers, never as "paying".
  const paying = Math.trunc(latest.bills_paid);
  const rentPaid = Number(latest.rent_paid);
  const flexCustomers = Math.trunc(latest.charged_users);
  const propertyPaying: Record<string, number> = {};
  const propertyRent: Record<string, number> = {};
  for (const r of monthlyRaw) {
    if (r.bp_month !== reportingMonth) continue;
    propertyPaying[r.property_public_id] = (propertyPaying[r.property_public_id] ?? 0) + r.bills_paid;
    propertyRent[r.property_public_id] = (propertyRent[r.property_public_id] ?? 0) + r.rent_paid;
  }

  const totalUnits = await embedTotalUnits(ctx, args.total_units, display, resolved);
  if (!totalUnits) {
    return { html: "", empty: false, error: EMBED_GATES.noTotalUnits(display, mspLabel) };
  }
  const unitsKnown = props.some((p) => p.unit_count !== null && p.unit_count !== undefined);

  // Platinum floor: pullPeerBenchmark on the dim-derived states (unit-share, or property-count
  // share when units are placeholders), size = totalUnits, footprint from the state count (same
  // buckets as the New Logo deck). platinum_median_nar when present, else the plain DI median.
  const statesSummary = embedStatesFromDim(props);
  const states = statesSummary.included;
  const nStates = states.length;
  const footprint = nStates <= 1 ? "single" : nStates <= 4 ? "regional" : nStates <= 9 ? "multi" : "national";
  const avgRentIn = Number(args.avg_rent) > 0 ? Number(args.avg_rent) : null;
  const cutoff = bpSafeCutoff();
  // Flask's pull_peer_benchmark measures at bp_safe_cutoff - 1 month (the reporting BP month), not
  // the previous calendar month GetProspectDeck's own latestMonth() uses.
  const latestMo = latestEmbedBpMonth();
  let benchmarks: Partial<Benchmarks> = {};
  let peerPmcNames: string[] = [];
  try {
    const peer = await pullPeerBenchmark(sf, {
      pms: mspLabel, states, segment: "SMB", affordable: false, mixed: false, isSfr: false,
      units: Math.trunc(totalUnits), footprint, avgRent: avgRentIn ?? 0, cutoff, latestMo,
    }, ctx.log);
    if (!peer.error) {
      benchmarks = peer.benchmarks;
      peerPmcNames = peer.peerPmcNames;
    } else {
      ctx.log.warn("embed: peer benchmark unavailable", { pmc: display, error: peer.error });
    }
  } catch (e) {
    ctx.log.warn("embed: pullPeerBenchmark failed", { pmc: display, error: e instanceof Error ? e.message : String(e) });
  }
  if (Object.keys(benchmarks).length > 0) {
    const plat = await pullPeerPlatinumRate(sf, latestMo, peerPmcNames, ctx.log);
    if (plat) {
      benchmarks = { ...benchmarks, platinum_median_nar: plat.platinum_median_nar, platinum_peer_count: plat.platinum_peer_count, platinum_scope: plat.platinum_scope };
    }
  }
  let floorRate: number;
  let floorLabel: string;
  if (benchmarks.platinum_median_nar !== undefined && benchmarks.platinum_median_nar !== null) {
    floorRate = Number(benchmarks.platinum_median_nar);
    floorLabel = benchmarks.platinum_scope === "network" ? "Platinum properties across Flex" : "similar PMCs' opted-in properties";
  } else if (benchmarks.median_nar !== undefined && benchmarks.median_nar !== null) {
    floorRate = Number(benchmarks.median_nar);
    floorLabel = "similar PMCs on Flex (direct integration)";
  } else {
    floorRate = 0.0;
    floorLabel = "no comparable peer pool at this size";
  }
  const avgRent = avgRentIn ?? Number(benchmarks.median_avg_rent ?? 0);
  const avgRentSource: "input" | "peer" = avgRentIn ? "input" : "peer";

  let cohort = null;
  try {
    cohort = await pullGraduationCurve(sf, msp);
  } catch (e) {
    ctx.log.warn("embed: pullGraduationCurve failed - slide 72 omitted", { msp, error: e instanceof Error ? e.message : String(e) });
  }
  let repeat = null;
  try {
    repeat = await pullChannelRepeatRates(sf, 6);
  } catch (e) {
    ctx.log.warn("embed: pullChannelRepeatRates failed", { error: e instanceof Error ? e.message : String(e) });
  }
  let niro = null;
  try {
    niro = await pullNiroSnapshot(sf, display);
  } catch (e) {
    ctx.log.warn("embed: pullNiroSnapshot failed", { pmc: display, error: e instanceof Error ? e.message : String(e) });
  }
  const ceilingRate = cohort ? Number(cohort.after_rate) : null;

  const embedCtx: EmbedCtx = {
    pmc_name: display, msp, msp_label: mspLabel,
    reporting_month: reportingMonth, property_count: props.length,
    paying, bills_paid: paying, rent_paid: rentPaid, flex_customers: flexCustomers,
    total_units: Math.trunc(totalUnits), units_known: unitsKnown,
    adoption: paying / Math.trunc(totalUnits),
    monthly,
    floor_rate: floorRate, floor_label: floorLabel,
    ceiling_rate: ceilingRate, cohort, repeat, niro,
    avg_rent: avgRent, avg_rent_source: avgRentSource,
    range: embedProjectionRange(paying, Math.trunc(totalUnits), floorRate, ceilingRate, avgRent),
    properties: props, property_paying: propertyPaying, property_rent: propertyRent,
    lookback_months: lookback,
  };

  // Slide 74: the dim rows through the shared market-map pipeline; markets are DMAs with >= 2 of
  // THEIR properties (embed.ts embedMarkets, ranked by their units), each slide carrying their own
  // embed activity in that DMA via renderMarketMap's subjectEmbed. Best-effort: any failure drops
  // the market slides only.
  const marketItems: { market: Market; summaryByDma: Record<string, MarketSummary>; prospectPins: ProspectPin[]; networkPins: NetworkPin[]; units: number; subject: SubjectEmbed }[] = [];
  try {
    const uploadRows = embedUploadRows(props);
    const { results: geoResults } = await geocodeAddressesConcurrent(uploadRows.map((r) => r.address), ctx.integrations.census);
    const withGeo = uploadRows.map((r) => ({ ...r, ...(geoResults[r.address] || {}) }));
    const geocoded = await assignMarkets(withGeo, sf);
    // assignMarkets drops the extra key from its output, so the pid stays index-aligned here.
    const pidByIndex = uploadRows.map((r) => r.property_public_id);
    const markets = embedMarkets(geocoded);
    if (markets.length > 0) {
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const allDmas = [...new Set(markets.flatMap((m) => m.sub_markets))];
      const summaryByDma: Record<string, MarketSummary> = {};
      const similarityByDma: Record<string, SimilarityInfo | null> = {};
      const knownUnits = props.map((p) => p.unit_count).filter((u): u is number => u !== null && u !== undefined);
      const avgUnitsPerProperty = knownUnits.length > 0 ? knownUnits.reduce((a, b) => a + b, 0) / knownUnits.length : 0;
      const effectiveRentForMap = avgRentIn ?? Number(benchmarks.median_avg_rent ?? 0);
      for (const dma of allDmas) {
        summaryByDma[dma] = await pullMarketSummary(dma, latestMo, yearStart, sf, { avgRent: effectiveRentForMap, avgUnitsPerProperty });
        similarityByDma[dma] = summaryByDma[dma]?.similarity ?? null;
      }
      for (const market of markets) {
        const inMarket = geocoded
          .map((p, i) => ({ p, pid: pidByIndex[i] }))
          .filter(({ p }) => market.sub_markets.includes(p.dma));
        const rawProspectPins: ProspectPin[] = inMarket.map(({ p }) => ({ property_name: p.property_name, lat: p.lat, lon: p.lon }));
        const networkPins = await fetchRelevantNetworkPins(market.sub_markets, latestMo, yearStart, rawProspectPins, sf, similarityByDma);
        const prospectPins = filterProspectPinsForMarket(rawProspectPins, networkPins);
        const filteredNetworkPins = prospectPins.length > 0
          ? (filterPinsNearAny(networkPins, prospectPins) as NetworkPin[])
          : networkPins;
        const dmaPids = inMarket.map(({ pid }) => pid);
        const dmaUnits = props.filter((p) => dmaPids.includes(p.property_public_id)).map((p) => p.unit_count);
        const realUnits = dmaUnits.filter((u): u is number => u !== null && u !== undefined);
        marketItems.push({
          market,
          summaryByDma,
          prospectPins,
          networkPins: filteredNetworkPins.slice(0, 300),
          units: market.prospect_units,
          subject: {
            paying: dmaPids.reduce((a, pid) => a + Math.trunc(propertyPaying[pid] ?? 0), 0),
            properties: dmaPids.length,
            // Flask: a market says "unit counts not available" unless EVERY property in it has one.
            units: realUnits.length > 0 && realUnits.length === dmaPids.length ? realUnits.reduce((a, b) => a + b, 0) : null,
            msp_label: mspLabel,
          },
        });
      }
    }
  } catch (e) {
    ctx.log.warn("embed: market map skipped", { pmc: display, error: e instanceof Error ? e.message : String(e) });
  }

  const slideHtmls: string[] = [];
  const slideJsList: string[] = [];
  const renderedKeys: string[] = [];
  let slideCounter = 0;
  const pushSlide = (key: string, result: SlideResultLike) => {
    if (!result.html) return;
    slideCounter++;
    slideHtmls.push(result.html);
    renderedKeys.push(key);
    if (result.js) slideJsList.push(result.js);
  };
  for (const key of EMBED_SLIDE_ORDER) {
    switch (key) {
      case "cover": pushSlide(key, renderEmbedCover(slideCounter + 1, embedCtx)); break;
      case "embed_today": pushSlide(key, renderEmbedToday(slideCounter + 1, embedCtx)); break;
      case "graduation": pushSlide(key, renderEmbedGraduation(slideCounter + 1, embedCtx)); break;
      case "projection": pushSlide(key, renderEmbedProjection(slideCounter + 1, embedCtx)); break;
      case "market":
        for (const item of marketItems) {
          pushSlide(key, renderMarketMap(
            slideCounter + 1, item.market, item.summaryByDma, item.prospectPins, item.networkPins,
            item.units, avgRentIn, { matched_count: 0, residents: 0, ytd_rent: 0 }, item.subject,
          ));
        }
        break;
      case "visibility": pushSlide(key, renderEmbedVisibility(slideCounter + 1, embedCtx)); break;
      case "next_steps": pushSlide(key, renderEmbedNextSteps(slideCounter + 1, embedCtx)); break;
    }
  }

  // Flask base_name: "{PMC}_embed_to_DI" (spaces / slashes -> "_", 30-char cap).
  const safePmc = display.replace(/ /g, "_").replace(/\//g, "_").slice(0, 30);
  const html = applyTerminology(buildDeckHtml({
    slides: slideHtmls.join("\n"),
    pmc_name: display,
    report_month: monthOnly(reportingMonth),
    report_year: yearOnly(reportingMonth),
    slide_count: slideHtmls.length,
    pdf_filename: `${safePmc}_embed_to_DI.pdf`,
    extra_js: slideJsList.filter(Boolean).join("\n"),
  }), args.terminology);

  // Speaker notes always (spec) - 3-line script per slide, every number from this same ctx.
  let notesHtml: string | undefined;
  try {
    notesHtml = applyTerminology(
      buildEmbedSpeakerNotesHtml(renderedKeys, {
        pmcName: display,
        reportingMonth,
        monthsSinceLaunch: 0,
        embed: {
          pmcName: display, mspLabel, msp, reportingMonth,
          propertyCount: props.length, paying, flexCustomers, rentPaid,
          adoption: embedCtx.adoption, totalUnits: Math.trunc(totalUnits), unitsKnown,
          floorRate, floorLabel, ceilingRate, avgRentSource,
          range: {
            today: embedCtx.range.today, floorGain: embedCtx.range.floor_gain, ceilingGain: embedCtx.range.ceiling_gain,
            rentLo: embedCtx.range.rent_lo, rentHi: embedCtx.range.rent_hi, floorAlreadyHere: embedCtx.range.floor_already_here,
          },
          repeat: repeat ? { embed: repeat.embed, di: repeat.di } : null,
          niro: niro ? { niroUnits: niro.niro_units, niroRate: niro.niro_rate } : null,
        },
        embedCohort: cohort
          ? { properties: cohort.properties, units: cohort.units, pmcs: cohort.pmcs, beforeRate: cohort.before_rate, afterRate: cohort.after_rate, scope: cohort.scope }
          : null,
      }),
      args.terminology,
    );
  } catch (e) {
    console.warn(`[PMC Report] embed speaker notes generation failed for ${display}: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { html, empty: false, notes_html: notesHtml };
}

// --- Main API ---

export default api({
  name: "GetPMCMonthlyReport",
  description: "Queries Snowflake PMC stats and returns a complete deck HTML document.",

  integrations: {
    snowflake_sso: snowflake(SNOWFLAKE_SSO),
    // Embed deck only (deck_mode "embed") - geocodes the resolved embed properties for slide 74's
    // market maps. Every other deck mode ignores it.
    census: restApiIntegration(CENSUS_GEOCODER_ID),
  },

  input: z.object({
    pmc_name: z.string(),
    // Replaces the old single extra-PMC field (capped at exactly one extra entity) - a real
    // array, no hardcoded limit. pmc_name stays the "primary" entity for display (cover title, etc.);
    // this is everyone else being combined in. Plain .optional() + resolve the [] default at the
    // call site below, NOT .optional().default([]) - that combo makes the field required in the
    // generated call-site type, the same zod gotcha this file's other optional fields already
    // avoid (see sparklines for precedent).
    additional_pmc_names: z.array(z.string()).optional(),
    report_name: z.string().optional().default(""),
    lookback_months: z.number().int().default(12),
    // "platinum" = "The Case for Marketing" (Flask report_type "platinum", 0de2310) - one PMC per
    // deck, fixed 4-slide order, its own early-return branch below.
    // "checkin" = the one-slide Adoption Check-in (Flask report_type "checkin", 013c659) - one PMC,
    // cover + wedge slide, requires checkin_date below.
    // "embed" = the Embed → Direct Integration deck (Flask report_type "embed", spec
    // docs/superpowers/specs/2026-09-10-embed-deck-design.md) - one embed-only PMC, slides 70-76,
    // resolved through embed.ts instead of the QBR rows query (its properties live under the
    // internal placeholder PMC 2476). Takes total_units / avg_rent / properties below.
    deck_mode: z.enum(["qbr", "new_logo", "expansion", "platinum", "checkin", "embed"]).default("qbr"),
    // Embed deck only. total_units: the tab prefills it from the SF account search, and the
    // resolution chain in embedTotalUnits falls back to SF -> the MSP embed list total -> the sum
    // of real dim unit counts. properties: optional New Logo-shaped rows ({header: cell}) used
    // only to override address / city / state / zip / units by property name. All plain optional -
    // same call-site-required gotcha as every other optional field in this schema.
    total_units: z.number().int().optional(),
    avg_rent: z.number().optional(),
    properties: z.array(z.record(z.string(), z.unknown())).optional(),
    // Check-in deck only: the working session / prior review being measured from, ISO YYYY-MM-DD,
    // snapped server-side to its BP month. Plain optional - same call-site-required gotcha as the
    // other optional fields in this schema.
    checkin_date: z.string().optional(),
    adoption_target: z.number().default(15), // percent, e.g. 15 = 15%
    testimonials: z.array(z.object({
      name: z.string(),
      propertyName: z.string(),
      quote: z.string(),
    })).default([]),

    total_portfolio_units: z.number().int().optional().default(0),
    expansion_slides: z.array(z.string()).optional(),
    // QBR slide picker (SlidesPicker's QBR_SLIDES ids). Kevin's catch: QBRTab built all the
    // checkboxes and wrote them into form state, index.tsx never forwarded them, and this
    // schema had no field for them at all - so every QBR deck rendered the full fixed order no
    // matter what a rep ticked (the same silent-no-op bug class as the terminology / hide_d2c
    // fixes above). Mirrors Flask's `slides` body key -> `slide_ids` gate over ALL_SLIDES, and
    // expansion_slides' own semantics right above: omitted / empty array means "no filter"
    // (render everything), NOT "render nothing". Plain optional, not .default([]) - same
    // call-site-required zod gotcha as every other optional field here.
    qbr_slides: z.array(z.string()).optional(),
    presenting_mode: z.boolean().optional().default(false),
    comparison_months: z.number().int().optional().default(1),
    // Exec tile sparklines / period-comparison pills, independent manual overrides (Kevin's
    // ask - "I want to be able to toggle everything if we want", on top of the implicit
    // sparklines-follow-growth-trend-slides behavior — see showGrowthSlides below). "auto"
    // preserves today's derived default for each; "include"/"exclude" force it either way.
    // Plain optional (not .default()) like expansion_slides above — a concurrent edit changing
    // either to .default("auto") would make the field REQUIRED in the generated call-site type
    // (breaks QBR/new_logo callers that don't pass it).
    sparklines: z.enum(["auto", "include", "exclude"]).optional(),
    period_comparison: z.enum(["auto", "include", "exclude"]).optional(),
    // Resident/household terminology, every deck mode (Kevin's ask, 2026-08-19). Plain
    // optional like sparklines above — same .default() call-site-required gotcha.
    terminology: z.enum(["resident", "household"]).optional(),
    // Which of the 6 exec-summary KPI tiles to omit entirely (Kevin's ask). Chosen at
    // generation time, not a live post-generation toggle — the download button re-serializes
    // this API's original response string, not whatever's currently in the preview iframe, so
    // a live click-to-hide wouldn't survive into the downloaded file with today's architecture.
    // Valid keys: active_properties, residents_paying, new_residents, adoption_rate,
    // true_repeat_rate, delinquency_shielded.
    // Plain optional (not .default()), like sparklines above — a concurrent edit changing
    // any of these to .default() would make it REQUIRED in the generated call-site type
    // (breaks every caller that doesn't pass it). Fallback handled at the usage site instead:
    // hiddenTileSet = new Set(d.hiddenTiles ?? []), and benchmarkTableHeader/benchmarkRowCells
    // treat an omitted show* flag as `!== false` → shown, so undefined already means "default".
    hidden_kpi_tiles: z.array(z.string()).optional(),
    // Property Deep Dive benchmark columns (Kevin's ask) — full per-column control, since
    // sometimes the benchmarking isn't relevant but the property listing itself still is.
    // Applies to both the celebrating and needs-attention tables (they share one structure).
    show_adoption_portfolio_avg: z.boolean().optional(),
    show_adoption_peer_median: z.boolean().optional(),
    // Engagement's Observed is toggleable (Kevin's ask) - Adoption's Observed isn't, since
    // it's the metric that decided which properties are on this table in the first place.
    show_engagement_observed: z.boolean().optional(),
    show_engagement_portfolio_avg: z.boolean().optional(),
    show_engagement_peer_median: z.boolean().optional(),
    // "Include D2C Marketing Language" QBRTab toggle (Kevin's catch: this existed in the UI
    // and updated local state, but was never actually read server-side, nor even included in
    // index.tsx's generate args - the control did nothing at all, badges always showed
    // regardless. Mirrors Flask's hide_d2c: hides the Direct Marketing on/off badge on the
    // adoption-opportunities ("needs attention") slide).
    hide_d2c: z.boolean().optional(),
    // Slides pulled in from an uploaded PDF (Import Slides picker, QBR only for now) - pages
    // are rendered to images client-side (pdf.js), so the server never touches the PDF itself.
    // anchor is "start" | "end" only in this first pass (mirrors Flask's app.py comment shape,
    // minus the "after:<slide_id>" variant - see renderImportedSlide's docstring in
    // slide-renderers.ts for why that's out of scope here). Plain optional, not .default([]) -
    // same call-site-required gotcha as every other optional field in this schema.
    imported_slides: z.array(z.object({
      anchor: z.string(),
      image_b64: z.string(),
      image_mime: z.string(),
      source_title: z.string().optional(),
      deck_title: z.string().optional(),
    })).optional(),
  }),

  output: z.object({
    html: z.string(),
    empty: z.boolean(),
    // Platinum only: Flask answers its self-gates ("No Platinum deck for {PMC}: fewer than 3
    // silver properties." etc.) and the one-PMC-per-deck rule with a 400/422 + error body. A
    // Superblocks API has no status code to set, so the same string rides here on an
    // otherwise-empty payload (the shape GetProspectDeck already uses for its own `error`) and
    // the client shows it in the standard error box.
    error: z.string().optional(),
    notes_html: z.string().optional(),
    // Expansion only for now (Kevin's ask) - slides the AE selected that got auto-hidden for
    // not having enough real data to make a credible chart, so the UI can tell them what
    // happened instead of leaving a silent gap they have to notice and wonder about.
    skipped_slides: z.array(z.object({ key: z.string(), label: z.string() })).optional(),
    // Raw rows for the client-side "Data Workbook" download (Kevin's ask) - QBR + Expansion
    // only for now. Built client-side, not server-side: this repo already treats server-side
    // xlsx generation as unreliable inside the Superblocks sandbox (see market-map-data.ts's
    // dynamic-import-with-soft-fail), while client-side xlsx usage (NewLogoTab.tsx) is a proven
    // working path - so this just ships the already-computed rows as plain JSON and lets the
    // browser build the actual .xlsx.
    workbook_data: z.object({
      summary: z.object({
        pmcName: z.string(),
        reportingMonth: z.string().nullable(),
        partnerSince: z.string().nullable(),
        propertyCount: z.number(),
        currentAdoptionRate: z.number(),
        currentResidents: z.number(),
        currentRentPaid: z.number(),
        lifetimeRent: z.number(),
      }),
      historical: z.array(z.object({
        month: z.string(), billsPaid: z.number(), units: z.number(),
        rentPaid: z.number(), newSignups: z.number(), adoptionRate: z.number(),
      })),
      properties: z.array(z.object({
        propertyName: z.string(), units: z.number(), billsPaid: z.number(),
        newSignups: z.number(), adoptionRate: z.number(), propertyState: z.string(),
        rentPaid: z.number(), cumRent: z.number(), rolloutMonth: z.string().nullable(),
      })),
      cohorts: z.array(z.object({
        rolloutMonth: z.string(), propertyCount: z.number(), totalUnits: z.number(),
        currentResidents: z.number(), currentRent: z.number(), cohortNar: z.number(),
      })),
    }).optional(),
  }),

  async run(ctx, { pmc_name, additional_pmc_names, report_name, lookback_months, deck_mode, adoption_target, testimonials, total_portfolio_units, expansion_slides, qbr_slides, presenting_mode, comparison_months, sparklines, period_comparison, terminology, hidden_kpi_tiles, show_adoption_portfolio_avg, show_adoption_peer_median, show_engagement_observed, show_engagement_portfolio_avg, show_engagement_peer_median, imported_slides, hide_d2c, checkin_date, total_units, avg_rent, properties }) {
    // Single resolved list every downstream query/array-builder reads from - pmc_name first
    // (the "primary" entity), then whatever else is being combined in. Replaces the old
    // old `hasSecondPmc ? [pmc_name, secondPmcName] : [pmc_name]` ternary pattern repeated at 4 call sites below.
    const allPmcNames = [pmc_name, ...(additional_pmc_names ?? [])];

    // Platinum deck ("The Case for Marketing") is one PMC per deck by design - the silver /
    // platinum split and the peer ladder are both about ONE portfolio (spec: multi-PMC combining
    // is out of scope for v1). Reject rather than silently dropping the extras - Flask's exact
    // wording, before any query fires.
    if (deck_mode === "platinum") {
      if (!pmc_name.trim()) {
        return { html: "", empty: false, error: "The Platinum deck needs a PMC name." };
      }
      if ((additional_pmc_names ?? []).some((n) => n.trim())) {
        return { html: "", empty: false, error: "The Platinum deck is one PMC per deck - remove the additional PMCs / property list and try again." };
      }
    }

    // Adoption Check-in - same one-PMC contract; the check-in date is required and snapped to its
    // BP month here so the lookback can be widened before the rows query (spec: history must cover
    // check-in - 2 months; min 6 / max 24). Flask's exact wording, before any query fires.
    let checkinMonth: string | null = null;
    if (deck_mode === "checkin") {
      if (!pmc_name.trim()) {
        return { html: "", empty: false, error: "The Check-in deck needs a PMC name." };
      }
      if ((additional_pmc_names ?? []).some((n) => n.trim())) {
        return { html: "", empty: false, error: "The Check-in deck is one PMC per deck - remove the additional PMCs / property list and try again." };
      }
      const parsed = parseCheckinMonth(checkin_date);
      if (parsed.error || !parsed.month) {
        return { html: "", empty: false, error: parsed.error ?? "checkin_date must be an ISO date (YYYY-MM-DD)." };
      }
      checkinMonth = parsed.month;
      // Widened in place so every downstream window (rows query, rolling peer median, DQ, ...)
      // reads the same one value, exactly as Flask reassigns `lookback`.
      lookback_months = checkinLookback(checkinMonth, lookback_months);
    }

    // Embed → DI deck: one embed-only PMC, resolved through embed.ts (its rows live under PMC
    // 2476, so the standard rows query below finds nothing). Everything lives in
    // generateEmbedDeck. Returns before any QBR query fires. Flask's exact gate wording.
    if (deck_mode === "embed") {
      if (!pmc_name.trim()) {
        return { html: "", empty: false, error: EMBED_GATES.noName };
      }
      if ((additional_pmc_names ?? []).some((n) => n.trim())) {
        return { html: "", empty: false, error: EMBED_GATES.onePmc };
      }
      return generateEmbedDeck(ctx, {
        pmc_name: pmc_name.trim(),
        total_units: total_units ?? 0,
        avg_rent: avg_rent ?? null,
        properties,
        lookback_months,
        terminology,
      });
    }

    // Compute bp_safe_cutoff
    const today = new Date();
    const dayOfMonth = today.getDate();
    let cutoff: Date;
    if (dayOfMonth <= 5) {
      cutoff = new Date(today.getFullYear(), today.getMonth(), 1);
    } else {
      cutoff = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    }
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Perf fix (Kevin's catch: the 3 Zendesk queries below - testimonials/CSAT/response-time -
    // showed up as ~8.6s/7.6s/9.5s in Superblocks' own trace after the peer-matching and
    // peerCandidateRows fixes landed). Hoisted from their old position (~line 3230, right after
    // `await Promise.all([networkPoolPromise, propertyPoolPromise, ...])`) to here. A comment
    // sitting right next to networkPoolPromise below already claimed these followed the same
    // "fire early, await late" pattern - they didn't; they were only ever DEFINED after that
    // whole batch had already resolved, so they ran fully serial after it instead of overlapping
    // it. Both only depend on `pmc_name`/`testimonials`, both already-destructured function
    // params available from the first line of run() - nothing downstream of them needs to run
    // first. Moving the definition (not the await - both are still awaited at their original
    // late call sites, just before the slides that need them) costs nothing and overlaps this
    // ~9.5s (the slower of the two) with the network/property-pool batch's own ~14s instead of
    // adding to it.
    const ZendeskTestimonialSchema = z.object({
      COMMENT: z.string(),
      RESIDENT_NAME: z.string().nullable(),
      PROPERTY_NAME: z.string().nullable(),
    });
    const zendeskPromise = testimonials.length > 0
      ? null // User provided testimonials, no need to query
      : ctx.integrations.snowflake_sso.query(
          `WITH latest_prop AS (
              SELECT CUSTOMER_PUBLIC_ID, PROPERTY_NAME
              FROM PRODUCTION.ANALYTICS.CUSTOMER_BP_MONTH_OUTCOMES
              WHERE UPPER(PMC_NAME) = UPPER(?)
              QUALIFY ROW_NUMBER() OVER (PARTITION BY CUSTOMER_PUBLIC_ID ORDER BY BP_MONTH DESC) = 1
           )
           SELECT
              sr.COMMENT,
              u.NAME AS RESIDENT_NAME,
              o.PROPERTY_NAME
           FROM EXTERNAL_DATA.STITCH_ZENDESK_NEW.SATISFACTION_RATINGS sr
           JOIN EXTERNAL_DATA.STITCH_ZENDESK_NEW.USERS u
              ON u.ID = sr.REQUESTER_ID
           JOIN latest_prop o
              ON o.CUSTOMER_PUBLIC_ID = u.USER_FIELDS:customer_id::VARCHAR
           WHERE sr.SCORE = 'good'
             AND sr.COMMENT IS NOT NULL
             AND LENGTH(TRIM(sr.COMMENT)) > 50
           ORDER BY sr.CREATED_AT DESC
           LIMIT 30`,
          ZendeskTestimonialSchema,
          [pmc_name],
          { label: "Pull Zendesk testimonials for PMC" }
        ).catch(() => [] as z.infer<typeof ZendeskTestimonialSchema>[]);

    const CsatMonthSchema = z.object({
      MONTH: z.string(),
      N_TOTAL: z.number(),
      N_GOOD: z.number(),
    });
    const ResponseMonthSchema = z.object({
      MONTH: z.string(),
      N_TICKETS: z.number(),
      AVG_REPLY_MIN: z.number().nullable(),
    });
    const residentTrendPromise = Promise.all([
      ctx.integrations.snowflake_sso.query(
        `WITH latest_prop AS (
            SELECT CUSTOMER_PUBLIC_ID, PROPERTY_NAME
            FROM PRODUCTION.ANALYTICS.CUSTOMER_BP_MONTH_OUTCOMES
            WHERE UPPER(PMC_NAME) = UPPER(?)
            QUALIFY ROW_NUMBER() OVER (PARTITION BY CUSTOMER_PUBLIC_ID ORDER BY BP_MONTH DESC) = 1
         )
         SELECT
            TO_VARCHAR(DATE_TRUNC('month', sr.CREATED_AT), 'YYYY-MM-DD') AS MONTH,
            COUNT(*) AS N_TOTAL,
            SUM(CASE WHEN sr.SCORE = 'good' THEN 1 ELSE 0 END) AS N_GOOD
         FROM EXTERNAL_DATA.STITCH_ZENDESK_NEW.SATISFACTION_RATINGS sr
         JOIN EXTERNAL_DATA.STITCH_ZENDESK_NEW.USERS u ON u.ID = sr.REQUESTER_ID
         JOIN latest_prop o ON o.CUSTOMER_PUBLIC_ID = u.USER_FIELDS:customer_id::VARCHAR
         WHERE sr.SCORE IN ('good', 'bad')
           AND sr.CREATED_AT >= DATEADD(month, -12, CURRENT_DATE())
           AND sr.CREATED_AT < DATE_TRUNC('month', CURRENT_DATE())
         GROUP BY 1 ORDER BY 1`,
        CsatMonthSchema,
        [pmc_name],
        { label: "Pull monthly CSAT trend from Zendesk" }
      ).catch(() => [] as z.infer<typeof CsatMonthSchema>[]),
      ctx.integrations.snowflake_sso.query(
        `WITH latest_prop AS (
            SELECT CUSTOMER_PUBLIC_ID, PROPERTY_NAME
            FROM PRODUCTION.ANALYTICS.CUSTOMER_BP_MONTH_OUTCOMES
            WHERE UPPER(PMC_NAME) = UPPER(?)
            QUALIFY ROW_NUMBER() OVER (PARTITION BY CUSTOMER_PUBLIC_ID ORDER BY BP_MONTH DESC) = 1
         )
         SELECT
            TO_VARCHAR(DATE_TRUNC('month', t.CREATED_AT), 'YYYY-MM-DD') AS MONTH,
            COUNT(*) AS N_TICKETS,
            AVG(tm.REPLY_TIME_IN_MINUTES:business::FLOAT) AS AVG_REPLY_MIN
         FROM EXTERNAL_DATA.STITCH_ZENDESK_NEW.TICKET_METRICS tm
         JOIN EXTERNAL_DATA.STITCH_ZENDESK_NEW.TICKETS t ON t.ID = tm.TICKET_ID
         JOIN EXTERNAL_DATA.STITCH_ZENDESK_NEW.USERS u ON u.ID = t.REQUESTER_ID
         JOIN latest_prop o ON o.CUSTOMER_PUBLIC_ID = u.USER_FIELDS:customer_id::VARCHAR
         WHERE t.CREATED_AT >= DATEADD(month, -12, CURRENT_DATE())
           AND t.CREATED_AT < DATE_TRUNC('month', CURRENT_DATE())
         GROUP BY 1 ORDER BY 1`,
        ResponseMonthSchema,
        [pmc_name],
        { label: "Pull monthly response-time trend from Zendesk" }
      ).catch(() => [] as z.infer<typeof ResponseMonthSchema>[]),
    ]).catch(() => [[], []] as [z.infer<typeof CsatMonthSchema>[], z.infer<typeof ResponseMonthSchema>[]]);

    // Peer-candidate profile for GEO-TIER matching - fired here, immediately, rather than at
    // its point of use (~line 3700, after two entire sequential query batches) because its
    // inputs (pmc_name/allPmcNames/cutoffStr) are already available and it depends on nothing
    // else this function computes. Awaited later at its original call site - same "fire early,
    // await late" pattern as networkPoolPromise/rollingPromise/zendeskPromise below. Performance
    // fix (Kevin's catch: GetPMCMonthlyReport taking 60+s vs Flask's ~20s) - this alone removes
    // one full sequential stage (an unbatched, standalone await) from the critical path by
    // overlapping it with the rows query and the two query batches that come after it instead.
    //
    // A SEPARATE, dedicated query at (PMC, STATE) grain, deliberately NOT built from
    // networkPoolProps. networkPoolProps is capped (top-20-properties-per-PMC, 3000 rows total)
    // to survive Superblocks' 5MB step-output limit - fine for the property-level things it's
    // built for (income lookups, T12 engagement), but fatal for geo-matching specifically: if a
    // candidate PMC's smaller in-state properties get sampled out in favor of its bigger
    // properties elsewhere, it looks state-absent here when it isn't, and a real multi-state
    // overlap match (which Flask found for this exact PMC — "true 1:1 match in NC, SC" — while
    // this port fell through to the region tier instead) never gets a chance to match. Matches
    // Flask's own pull_rolling_peer_median Step A (generator/data.py:4088-4104) exactly:
    // aggregated to (PMC_NAME, PROPERTY_STATE) grain in SQL, not fetched as raw property rows -
    // a PMC operates in a handful of states, not thousands of properties, so this is naturally
    // tiny and needs no row cap at all.
    const PeerCandidateProfileSchema = z.object({
      PMC_NAME: z.string(),
      PROPERTY_STATE: z.string(),
      UNITS: z.coerce.number().nullable(),
      RENT: z.coerce.number().nullable(),
      BILLS: z.coerce.number().nullable(),
    });
    // Excluding the subject PMC(s) from the candidate pool HERE, before resolveGeoTier ever
    // runs, is deliberate and is a KNOWN, CONFIRMED deviation from Flask - do not "fix" this to
    // match Flask's behavior. Flask's own candidate pool (pmc_state_totals in
    // _run_benchmark_query, generator/data.py:1530-1587) never excludes the subject before
    // calling _resolve_geo_tier - the subject trivially matches its own true-1:1-match tier
    // (100% concentration in its own states, by definition), so it lands in Flask's
    // overlap_names/geo_names list as one of the "matched" candidates. Only the FINAL SQL query
    // that computes peer percentiles adds `PMC_NAME != subject` (generator/data.py:1740) to
    // exclude it - which means Flask's reported peer_count always undercounts the true number
    // of matching OTHER PMCs by exactly one. Confirmed live for Wellington: Flask showed "7
    // comparable PMCs", this pool correctly finds 8 real distinct other PMCs matching the same
    // "true 1:1 match in NC, SC" criteria - the missing 8th is Wellington counting itself, then
    // subtracting itself back out. Kevin's call (2026-08-13): keep this side correct rather than
    // reproducing Flask's undercount; Flask should get the equivalent fix (exclude subject
    // before the candidate pool is built) instead.
    const peerCandidateSubjectPmcs = allPmcNames;
    const peerCandidateRowsPromise = ctx.integrations.snowflake_sso.query(
      `SELECT PMC_NAME, PROPERTY_STATE,
              SUM(PROPERTY_UNIT_COUNT) AS UNITS,
              SUM(RENT_PAID_AMOUNT) AS RENT,
              SUM(BILLS_PAID_COUNT) AS BILLS
       FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
       WHERE IS_INTEGRATED_TOTAL = TRUE
         AND ROLLOUT_MONTH IS NOT NULL
         AND PROPERTY_STATE IS NOT NULL AND PROPERTY_STATE != ''
         AND PMC_NAME NOT IN (${peerCandidateSubjectPmcs.map(() => "?").join(", ")})
         AND BP_MONTH = (
            SELECT MAX(BP_MONTH) FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE BP_MONTH < ? AND IS_INTEGRATED_TOTAL = TRUE
         )
       GROUP BY PMC_NAME, PROPERTY_STATE`,
      PeerCandidateProfileSchema,
      [...peerCandidateSubjectPmcs, cutoffStr],
      { label: "Peer-candidate geo profile for tier matching (PMC x state grain, unsampled)" }
    ).catch(() => [] as z.infer<typeof PeerCandidateProfileSchema>[]);

    const pmcNamePlaceholders = allPmcNames.map(() => "?").join(", ");
    const allRows = await ctx.integrations.snowflake_sso.query(
      `SELECT
          TO_VARCHAR(BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH,
          PROPERTY_NAME,
          PMC_NAME,
          PROPERTY_UNIT_COUNT,
          TO_VARCHAR(ROLLOUT_MONTH, 'YYYY-MM-DD') AS ROLLOUT_MONTH,
          CHARGED_USERS_COUNT AS CHARGED_USERS,
          COALESCE(NEW_SIGNUPS_COUNT, 0) AS NEW_SIGNUPS,
          BILLS_PAID_COUNT AS BILLS_PAID,
          COALESCE(RENT_PAID_AMOUNT, 0) AS RENT_PAID,
          PROPERTY_PUBLIC_ID,
          PROPERTY_STATE,
          IS_IN_NETWORK,
          COALESCE(NEW_BILL_CONNECTIONS_PROPERTY, 0) AS NEW_BILL_CONNECTIONS,
          HUBSPOT_DEAL_TOTAL_COMPANY_UNITS,
          STATIC_PARENT_TEAM_NAME_OPPORTUNITY AS SEGMENT_TEAM,
          HAS_MARKETING_INTEGRATION,
          IS_MARKETING_OPT_IN
       FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
       WHERE PMC_NAME IN (${pmcNamePlaceholders})
         AND BP_MONTH >= DATEADD('month', -?, CURRENT_DATE())
         AND BP_MONTH < ?
       -- NO LIMIT, deliberately. This used to end "LIMIT 10000", which - because the sort is
       -- ASCENDING by BP_MONTH - silently discarded the NEWEST months, not the oldest. Every
       -- number in the deck sits under these rows (allRows/inNetwork feed monthlyTotals, the
       -- reporting month, every KPI, engagement, cohorts and the property snapshot), so the cap
       -- didn't degrade a chart, it made the whole deck quietly wrong for any PMC over the cap:
       -- 63 PMCs at the default 12-month lookback, 108 at 24. Live-verified damage: RPM Living
       -- (10,712 rows) reported 6,525 residents / $11.4M / 50,318 units / 12.97% adoption
       -- against a real 29,202 / $48.2M / 207,670 / 14.06%, and Tricon Residential (495,237
       -- rows) had its slice end in Nov-2025, dating the entire deck 10 months stale. Flask's
       -- pull_pmc_data (generator/data.py:196-238) is this same query with no LIMIT and has
       -- always been correct here; a truncating cap cannot sit under every number in a
       -- partner-facing deck, so if a row ceiling is ever needed again it has to be an in-SQL
       -- aggregation (or a loud failure), never a silent ORDER BY + LIMIT slice.
       ORDER BY BP_MONTH, PROPERTY_NAME`,
      RawRowSchema,
      [...allPmcNames, lookback_months, cutoffStr],
      { label: "Fetch PMC monthly report data (all combined entities)" }
    );

    // Display-only PMC name (FKA suffix stripped) — pmc_name itself stays untouched everywhere
    // it's used as a query parameter; this is only for what actually shows up on a slide.
    const pmcDisplayName = stripFkaSuffix(pmc_name);

    // Apply report_name override if provided
    const displayName = report_name || pmcDisplayName;

    // Filter to in-network only
    const inNetwork = allRows.filter((r) => r.IS_IN_NETWORK === true);

    if (inNetwork.length === 0) {
      return { html: "", empty: true };
    }

    // --- Additional data queries (run in parallel) ---
    const MetricsRowSchema = z.object({
      BP_MONTH: z.string(),
      NAR: z.number().nullable(),
      SEGMENT_NAR_AVG: z.number().nullable(),
      BILLS_PAID: z.number().nullable(),
      BILLS_PAID_NEW: z.number().nullable(),
      BILLS_PAID_REPEAT: z.number().nullable(),
      BILLS_PAID_PREV_MONTH: z.number().nullable(),
      RENT_PAID: z.number().nullable(),
      HUBSPOT_COMPANY_SEGMENT: z.string().nullable(),
    });

    const DqShieldedRowSchema = z.object({
      BP_MONTH: z.string().nullable(),
      TOTAL_RENT_SHIELDED: z.number().nullable(),
      RENT_NOT_COLLECTED: z.number().nullable(),
      NUMBER_OF_RESIDENTS: z.number().nullable(),
    });

    // Per-entity DQ rows (PMC_NAME x BP_MONTH grain) for the Exec Summary switcher's
    // Delinquency-shielded tile + pill. A separate query from the combined one rather than
    // adding PMC_NAME to its GROUP BY, for the same reason EntityYearlyRentSchema is separate:
    // the combined pull's month-grain shape is what the Delinquency slide's trend chart reads.
    const EntityDqShieldedRowSchema = z.object({
      PMC_NAME: z.string(),
      BP_MONTH: z.string().nullable(),
      TOTAL_RENT_SHIELDED: z.number().nullable(),
    });

    const SegmentPercentilesSchema = z.object({
      METRIC: z.string(),
      P25: z.number().nullable(),
      P50: z.number().nullable(),
      P75: z.number().nullable(),
      P90: z.number().nullable(),
      P99: z.number().nullable(),
      PMC_VALUE: z.number().nullable(),
    });

    const YearlyRentBillsSchema = z.object({
      YEAR: z.number(),
      TOTAL_RENT: z.number().nullable(),
      BILLS_PAID: z.number().nullable(),
      MONTHS_ACTIVE: z.number().nullable(),
      YTD_RENT: z.number().nullable(),
      YTD_BILLS: z.number().nullable(),
      YTD_MONTHS_ACTIVE: z.number().nullable(),
    });

    // Task 10 (Since Inception stacked bar): per-entity breakdown of the SAME yearly rent
    // history above, for combined multi-PMC reports only. Deliberately a SEPARATE query rather
    // than adding PMC_NAME to YearlyRentBillsSchema's own GROUP BY - that query's MONTHS_ACTIVE
    // is COUNT(DISTINCT BP_MONTH) computed across whichever combined entities have data in a
    // given month; regrouping it by (YEAR, PMC_NAME) would turn that into a per-entity count,
    // and summing per-entity counts back up would OVERCOUNT months where two entities both had
    // activity in the same calendar month (which combined entities typically do) - silently
    // breaking the incomplete-current-year projection logic that reads combined MONTHS_ACTIVE.
    // TOTAL_RENT/YTD_RENT have no such issue (SUM is additive over any partition), so this query
    // reuses the exact same WHERE filter (same allPmcNames IN-list, same BP_MONTH < cutoffStr
    // bound, same deliberately-unfiltered "true history" convention - no IS_IN_NETWORK clause)
    // as the combined query, just grouped one dimension finer - guaranteeing per-entity totals
    // sum exactly to the combined ones for the same year (verified in this task's synthetic
    // check). Only fires for QBR + more than 1 combined entity - a single-PMC report never pays
    // for it.
    // TOTAL_BILLS added for the Portfolio Comparison slide's all-time "Total Bills Paid" column
    // (Kevin's ask) - same additive SUM over the same rows, so per-entity lifetime bills sum
    // exactly to the combined query's BILLS_PAID, i.e. the Since Inception subtitle's figure.
    const EntityYearlyRentSchema = z.object({
      PMC_NAME: z.string(),
      YEAR: z.number(),
      TOTAL_RENT: z.number().nullable(),
      TOTAL_BILLS: z.number().nullable(),
      YTD_RENT: z.number().nullable(),
    });

    const PropertyTrendSchema = z.object({
      PROPERTY_NAME: z.string(),
      BP_MONTH: z.string(),
      BILLS_PAID_COUNT: z.number().nullable(),
      PROPERTY_UNIT_COUNT: z.number().nullable(),
      ROLLOUT_MONTH: z.string().nullable(),
      // Signup timing uses THIS, not BILLS_PAID_COUNT — "first payment" is gated by the BP
      // cycle (a property rolling out on the 2nd of a month can still make that month's bill
      // run; one rolling out on the 28th can't, purely by calendar luck, nothing to do with
      // marketing/ops), while a bill CONNECTION isn't tied to a monthly cutoff the same way.
      NEW_BILL_CONNECTIONS_PROPERTY: z.number().nullable(),
    });

    const RetentionCohortSchema = z.object({
      LOYALTY_BUCKET: z.string(),
      BUCKET_COUNT: z.number(),
      TOTAL_CUSTOMERS: z.number(),
      TRUE_REPEAT_RATE: z.number().nullable(),
    });

    // Raw (customer, month) pairs for the MoM retention chart — Flask's real method
    // (render_retention, generator/slides.py) computes MoM retention as a true customer-level
    // set intersection between consecutive months: rate = |prior month's customers ∩ this
    // month's customers| / |prior month's customers| — NOT an aggregate ratio from a
    // pre-computed "repeat" column. Same NAR_CHARGED_USERS source as the loyalty-bucket query
    // above, just unaggregated.
    const CustomerMonthSchema = z.object({
      CUSTOMER_PUBLIC_ID: z.string(),
      BP_MONTH: z.string(),
    });

    // BILLS_PAID_COUNT and T12_CONNECTIONS were declared non-nullable here, but the query
    // computes BILLS_PAID_COUNT via MAX(CASE WHEN BP_MONTH = latest THEN BILLS_PAID_COUNT END) —
    // NULL for any property where that column itself is null even in its "latest" row (a real,
    // observed case, not hypothetical: live-verified this exact query returns 78,224 real rows
    // directly against Snowflake, but the app's own networkPool ended up with 0 — the only
    // place that many real rows can vanish silently is schema validation rejecting the whole
    // array over a single non-matching row, caught by this query's outer .catch(() => []).
    // z.coerce.number() rather than z.number() on every numeric field below — the previous
    // fix (making BILLS_PAID_COUNT/T12_CONNECTIONS nullable) did NOT resolve networkPool
    // silently coming back empty despite the exact same query, live-verified, returning
    // 78,224 real rows with no error. That means the actual mismatch is a TYPE issue, not
    // (only) a nullability one — most likely FIPS_TO_CENSUS_DATA (a UDF returning a
    // semi-structured/VARIANT value) coming back as a string-shaped number rather than a
    // strict JS number, which z.number() rejects outright. z.coerce.number() accepts either.
    // (.nullable() still short-circuits real SQL NULLs before coercion ever runs, so this
    // doesn't change null-handling — only accepts non-null values in more shapes.)
    const NetworkPoolSchema = z.object({
      PMC_NAME: z.string(),
      PROPERTY_NAME: z.string(),
      PROPERTY_STATE: z.string().nullable(),
      PROPERTY_UNIT_COUNT: z.coerce.number(),
      RENT_PAID_AMOUNT: z.coerce.number().nullable(),
      BILLS_PAID_COUNT: z.coerce.number().nullable(),
      ROLLOUT_MONTH: z.string().nullable(),
      T12_CONNECTIONS: z.coerce.number().nullable(),
      MEDIAN_RENTER_INCOME: z.coerce.number().nullable(),
    });

    const RegionDetailSchema = z.object({
      PROPERTY_STATE: z.string(),
      PROPERTY_REGION: z.string(),
      // The property's 5-digit ZIP - consumed (and dropped) by applyGeoRules, which looks it up
      // in the network-wide reference below; see geo-regions.ts. NULL when no ZIP is on file.
      ZIP5: z.string().nullable(),
      PROPERTIES: z.number(),
      TOTAL_UNITS: z.number(),
      BILLS_PAID: z.number(),
    });
    // Network-wide ZIP reference (Flask pull_network_zip_geo): every in-network property at the
    // month, ALL PMCs, by (ZIP5, state, DMA-or-NULL). DMA_NAME is NULL when the seed lacks the ZIP.
    const NetworkZipGeoSchema = z.object({
      ZIP5: z.string().nullable(),
      PROPERTY_STATE: z.string().nullable(),
      DMA_NAME: z.string().nullable(),
      PROPERTIES: z.number(),
    });

    // Compute cutoff month number for YTD calculation
    const cutoffMonthNum = cutoff.getMonth() === 0 ? 12 : cutoff.getMonth();

    // Reporting month = most recent fully-completed month with real, in-network data for this
    // PMC (used for the retention-cohort eligibility cutoff below). Previously guessed as
    // "cutoff minus one calendar month" before any query had run — that guess can genuinely
    // disagree with the PMC's real latest reported month, which shifts who counts as "eligible"
    // in the retention-cohort query and skews the true-repeat-rate / loyalty-bucket numbers.
    // `rows` (fetched above, ORDER BY BP_MONTH ascending) is already resolved by this point, so
    // derive the real value directly from it instead of approximating.
    //
    // Requires CHARGED_USERS > 0, matching Flask's _latest_completed_month (generator/data.py:
    // 370-399), which explicitly requires real billing data, not just an IS_IN_NETWORK flag —
    // a month can be flagged in-network before its billing data has actually landed. Using only
    // IS_IN_NETWORK let a billing-lagged month count as "reporting month," which pushed this
    // anchor date later than Flask's, diluting the retention-cohort's eligible pool with
    // brand-new signups who hadn't had a chance to repeat yet (this is what was pulling
    // true_repeat_rate below Flask's real number). `latestCompletedMonth` (computed further
    // down from monthlyTotals) is the same concept but isn't available yet at this point in
    // the pipeline — this mirrors its exact filter using the already-fetched `rows` instead.
    //
    // Post-unification note (Task 2, multi-PMC combining): the old two-query architecture kept
    // a separate `rows` (subject `pmc_name` only, pre-merge) around specifically for this calc,
    // distinct from the merged `allRows`. Resolved (Kevin's call): "latest completed month"
    // considers the FULL combined set, not just the primary pmc_name - if any combined entity
    // has real in-network activity in a month, that month counts, and the roll-up for that
    // month sums whatever's actually there. Explicitly NOT gated on every entity having data
    // (a lagging subsidiary doesn't hold the whole report back a month) - "just show everything
    // that's available in any given month... make sure the roll up accounts for the roll up
    // each time."
    // ── ONE definition of "latest completed month", for the whole request ─────────────────
    // This deck used to carry TWO, and they disagreed for 110 live PMCs (74 of them >= 100
    // units): `reportingMonthStr` here was a ROW-level test (any in-network row with
    // CHARGED_USERS > 0), while `latestCompletedMonth` further down was a MONTH-AGGREGATE test
    // on billsPaid > 0. The first anchored the retention cohort, MoM retention, regionDetail
    // and the network zip/geo cache; the second drove the headline, latestRows, the Exec
    // Summary tiles and by_state's portfolioNar - so one deck could date its By-State
    // drill-down to a different month than its own Exec Summary and no slide would tie to
    // another. Live: Villa Serena Communities (7,471 units, 32 properties) built By-State from
    // a month with 31 properties and ZERO bills while the Exec Summary reported a month with 2
    // bills and $1,691.
    //
    // Flask has exactly one definition - _latest_completed_month (generator/data.py:422-455) -
    // and calls it at all 8 of its own call sites. Its semantics, reproduced verbatim below:
    //   * group by BP_MONTH and SUM charged_users (a MONTH aggregate, never a single row),
    //   * drop the current calendar month outright while BP is still open (day <= 5),
    //   * take the latest month whose charged_users sum is > 0,
    //   * fall back to the absolute latest month present when none have billed yet.
    // charged_users (not bills_paid) is the gate: a month can be flagged in-network, and can
    // even carry bills, before its billing has actually closed.
    //
    // Scoped to `inNetwork` - the same row set monthlyTotals is built from, which is what the
    // old latestCompletedMonth effectively read - so the one value is correct for both of the
    // old call-site groups. Computed here, the first point `inNetwork` exists, because the
    // retention-cohort query below needs it long before monthlyTotals is built.
    //
    // Multi-PMC (Task 2) behaviour is unchanged and deliberate: the aggregate spans the FULL
    // combined set, so a lagging subsidiary doesn't hold the whole report back a month.
    const currentMonthStrForReporting = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    function latestCompletedMonthOf(rows: typeof inNetwork): string | null {
      const chargedByMonth = new Map<string, number>();
      for (const r of rows) {
        if (dayOfMonth <= 5 && r.BP_MONTH === currentMonthStrForReporting) continue;
        chargedByMonth.set(r.BP_MONTH, (chargedByMonth.get(r.BP_MONTH) ?? 0) + (r.CHARGED_USERS ?? 0));
      }
      let latestBilled: string | null = null;
      let latestAny: string | null = null;
      for (const [month, charged] of chargedByMonth) {
        if (latestAny === null || month > latestAny) latestAny = month;
        if (charged > 0 && (latestBilled === null || month > latestBilled)) latestBilled = month;
      }
      return latestBilled ?? latestAny;
    }
    const reportingMonthStr = latestCompletedMonthOf(inNetwork)
      ?? new Date(cutoff.getFullYear(), cutoff.getMonth() - 1, 1).toISOString().slice(0, 10);

    // For expansion/new_logo modes, skip expensive queries that are only used by QBR:
    // - yearlyRentBillsRows: Since Inception slide (now QBR + Expansion, see needsSinceInception
    //   below - was QBR-only until Kevin's scope addition wiring this slide into Expansion too)
    // - trendRawRows: Property trend badges (QBR appendix only)
    const needsQBRQueries = deck_mode === "qbr";
    // Since Inception (Task 10's stacked-bar-by-entity slide) now also renders on Expansion
    // decks (Kevin's scope addition after Task 15) - both queries this gates just below are
    // already scoped to allPmcNames (not a network-wide scan) and cheap, same "safe to widen"
    // reasoning as needsRegionDetail a few lines down, so broadening the gate is preferred over
    // computing a separate Expansion-only version of the same query.
    const needsSinceInception = needsQBRQueries || deck_mode === "expansion";

    // Dedicated property-level peer pool (Flask's pull_network_property_pool,
    // generator/data.py:4900-5066) — see the full comment on PROPERTY_POOL_SQL below.
    let propertyPool: NetworkPoolRow[] = [];
    // Currently write-only (debug-panel reader removed); underscore-prefixed per this
    // codebase's convention for intentionally-idle diagnostics rather than silently
    // dropping a traced pipeline.
    let _propertyPoolError: string | null = null;
    // Region detail (DMA sub-region breakdown, "By State" slide's drill-down rows) - Kevin's
    // ask: Expansion's own "By State" slide never got this even though QBR's has had it all
    // along. Hoisted out of the QBR-only batch below (same "fire early" pattern networkPoolPromise
    // already uses) and gated on its OWN flag rather than needsQBRQueries, since this one query
    // is cheap (scoped to the subject PMC family, no network-wide scan, no UDF chain) and safe to
    // also run for Expansion - unlike network pool/property pool just below, which stay QBR-only
    // on purpose (that's real, deliberately-tuned query cost this session already fought to keep
    // under control; Kevin didn't ask for those in Expansion, so they're untouched).
    const needsRegionDetail = needsQBRQueries || deck_mode === "expansion";
    // The SQL additionally groups by LEFT(PROPERTY_ZIP, 5) as ZIP5 so applyGeoRules (geo-regions.ts)
    // can (A) demote a DMA whose ZIP the rest of the network puts in another state, (B) recover a
    // ZIP the DMA seed lacks from its (state, prefix) neighbours and (C) label legit cross-state
    // DMAs "(XX side)" - all against the network-wide reference query below for the same month,
    // then re-aggregate to (state, region) before anything downstream sees the rows - so both
    // await sites (QBR batch + Expansion) get the fixed frame. Mirrors Flask 61facd0 (superseding
    // the prefix-only f7d95a6 rule: SEATTLE - TACOMA / DENVER under CA on Kevin's Allied combined
    // deck, then CA/AK/AR "Unknown" seed gaps and PITTSBURGH-under-WV reading as wrong-state bugs).
    // State totals elsewhere are untouched; only the region bucket / label moves. The reference is
    // best-effort: on failure the rows are served with the prefix-table tiebreaker only, never dropped.
    const regionDetailPromise: Promise<RegionDetailRow[]> = !needsRegionDetail
      ? Promise.resolve([] as RegionDetailRow[])
      : Promise.all([
          ctx.integrations.snowflake_sso.query(
            `WITH prop_zip AS (
                SELECT PROPERTY_PUBLIC_ID, PROPERTY_ZIP,
                       ROW_NUMBER() OVER (PARTITION BY PROPERTY_PUBLIC_ID ORDER BY CREATED_AT_UTC DESC) AS rn
                FROM PRODUCTION.ANALYTICS.DIM_PROPERTIES_PMCS
             )
             SELECT
                t.PROPERTY_STATE                            AS PROPERTY_STATE,
                COALESCE(dma.DMA_NAME, 'Unknown')           AS PROPERTY_REGION,
                LEFT(p.PROPERTY_ZIP, 5)                     AS ZIP5,
                -- PROPERTIES counts DISTINCT PROPERTY_PUBLIC_ID, not PROPERTY_NAME. The GROUP BY
                -- includes ZIP5 and applyGeoRules then SUMs those rows up to (state, region), so
                -- a name-based count counted two genuinely distinct same-named properties in
                -- different ZIPs once each and summed them to 2, while the state bar it has to
                -- tie to counted that name once. Live before the fix: RPM Living TX summed to 425
                -- region properties under a 424-property state bar; Asset Living CA's 13 region
                -- bars already totalled the bar's 604 with a "+4" footnote still printed under
                -- them. PROPERTY_PUBLIC_ID is the same key the Exec Summary property tile and the
                -- property snapshot use, so every count on the slide now counts the same thing.
                -- Mirrors Flask d537142 (pull_property_region_detail).
                COUNT(DISTINCT t.PROPERTY_PUBLIC_ID)        AS PROPERTIES,
                SUM(t.PROPERTY_UNIT_COUNT)                  AS TOTAL_UNITS,
                SUM(t.BILLS_PAID_COUNT)                     AS BILLS_PAID
             FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
             LEFT JOIN prop_zip p
               ON p.PROPERTY_PUBLIC_ID = t.PROPERTY_PUBLIC_ID AND p.rn = 1
             LEFT JOIN PRODUCTION.SEEDS.SEED_ZIP_CODE_TO_DMA_MAPPING dma
               ON dma.ZIP_CODE = LEFT(p.PROPERTY_ZIP, 5)
             -- allPmcNames, NOT the primary pmc_name alone. The state bars this drill-down has
             -- to reconcile against come from latestRows, which is scoped to every combined
             -- entity - so a primary-only region pull left every subsidiary's properties on no
             -- region row. Now that the footnote is an exact residual it would have absorbed
             -- them silently and honestly: Asset Living's 8-entity deck would have printed 7/8
             -- of its portfolio as "without a mapped market" and still added up. Flask's
             -- pull_property_region_detail has always scoped this to the full pmc_names list.
             WHERE t.PMC_NAME IN (${pmcNamePlaceholders})
               AND t.BP_MONTH = ?
               AND t.IS_IN_NETWORK = TRUE
               AND t.PROPERTY_STATE IS NOT NULL AND t.PROPERTY_STATE != ''
             GROUP BY t.PROPERTY_STATE, COALESCE(dma.DMA_NAME, 'Unknown'), LEFT(p.PROPERTY_ZIP, 5)
             ORDER BY t.PROPERTY_STATE, BILLS_PAID DESC`,
            RegionDetailSchema,
            [...allPmcNames, reportingMonthStr],
            { label: "Pull DMA region detail for geo slide dropdowns" }
          ),
          // Same ZIP source/dedup as the detail query so the two agree ZIP for ZIP; no PMC scope
          // (all PMCs). Cached per month (geo-regions.ts) - it's one network-wide aggregate.
          cachedNetworkZipGeo(reportingMonthStr, () => ctx.integrations.snowflake_sso.query(
            `WITH prop_zip AS (
                SELECT PROPERTY_PUBLIC_ID, PROPERTY_ZIP,
                       ROW_NUMBER() OVER (PARTITION BY PROPERTY_PUBLIC_ID ORDER BY CREATED_AT_UTC DESC) AS rn
                FROM PRODUCTION.ANALYTICS.DIM_PROPERTIES_PMCS
             )
             SELECT
                LEFT(p.PROPERTY_ZIP, 5)                     AS ZIP5,
                t.PROPERTY_STATE                            AS PROPERTY_STATE,
                dma.DMA_NAME                                AS DMA_NAME,
                COUNT(DISTINCT t.PROPERTY_PUBLIC_ID)        AS PROPERTIES
             FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
             JOIN prop_zip p
               ON p.PROPERTY_PUBLIC_ID = t.PROPERTY_PUBLIC_ID AND p.rn = 1
             LEFT JOIN PRODUCTION.SEEDS.SEED_ZIP_CODE_TO_DMA_MAPPING dma
               ON dma.ZIP_CODE = LEFT(p.PROPERTY_ZIP, 5)
             WHERE t.BP_MONTH = ?
               AND t.IS_IN_NETWORK = TRUE
               AND t.PROPERTY_STATE IS NOT NULL AND t.PROPERTY_STATE != ''
               AND p.PROPERTY_ZIP IS NOT NULL
             GROUP BY LEFT(p.PROPERTY_ZIP, 5), t.PROPERTY_STATE, dma.DMA_NAME`,
            NetworkZipGeoSchema,
            [reportingMonthStr],
            { label: "Pull network-wide ZIP -> state/DMA reference for geo region rules" }
          )).catch((err) => {
            console.warn(`[PMC Report] network ZIP geo reference failed for ${reportingMonthStr} (region rules degrade to prefix table): ${err instanceof Error ? err.message : String(err)}`);
            return [] as NetworkZipGeoRow[];
          }),
        ]).then(([detail, ref]) => applyGeoRules(detail, buildGeoLookups(ref))).catch(() => [] as RegionDetailRow[]);

    // Dedicated property-level peer pool — Flask's real pull_network_property_pool
    // (generator/data.py:4900-5066), NOT a reuse of networkPool above. networkPool is
    // deliberately SAMPLED (top 20 properties per PMC by unit count, capped at 3000 total) to
    // stay under Superblocks' ~5MB step-output limit for PMC-level geo-tier matching, where
    // that sampling is a reasonable trade-off. Per-property peer matching (resolvePropertyPeerNar/
    // resolvePropertyPeerEngagement below) was reading from that SAME sampled pool though —
    // confirmed live: per-property peer medians on the Property Deep Dive slide came back
    // close-but-not-exact vs Flask across the board (e.g. adoption peer median 15.4% vs
    // Flask's 11.7%, engagement 29 vs 30), even for tiny 12-unit sister properties that should
    // land in an identical peer bucket. Root cause: the top-20-per-PMC cap silently drops most
    // small/mid-size properties from every PMC, and the 3000-row cap drops entire
    // alphabetically-late PMCs once the true network exceeds it — exactly the kind of
    // systematic bias that shows up as "close but consistently off," not random noise. Flask's
    // real pool has no such sampling at all.
    // months_live >= 7 (Flask's own filter) is pushed into a HAVING clause here specifically
    // to shrink the response payload before it hits Snowflake's wire, since that's the actual
    // constraint surface — not to introduce new filtering behavior. The other Flask filter
    // (rent band 700-2500, bypassed when bills_paid_count < 3) stays a JS post-filter below,
    // matching the existing pattern; it's a much smaller row-count lever than months_live and
    // doesn't need to move.
    // CORRECTION #2 (verified live against real Snowflake data — measured actual JSON payload
    // bytes, not estimated): the flat 8,000-row hash-ordered sample from the previous version of
    // this comment was itself the bug, just a different one than "no cap needed." A flat random
    // sample applies the SAME retention rate (8,000/55,901 ≈ 14.3%) to every (state, age_bucket)
    // cell regardless of that cell's real size — fine for a large cell (NC's 37+mo bucket has
    // 2,184 real rows, retains ~310), but for a genuinely small cell a 14.3% sample can land
    // right at or below min_peers=8 by pure chance. Confirmed live: Congaree Villas (SC, 9mo -
    // the "7-12mo" bucket) has only 69 real qualifying candidates network-wide in its exact
    // state+size band; the flat sample retained exactly 8 (barely enough for the loosest
    // no-rent tier, nowhere near enough after an RTI/rent filter), while Flask's unsampled data
    // found 40 passing its rent-adjusted tier. Every other metric's peer bands had already
    // reconciled almost exactly by this point, so this was the last real gap.
    // Fix: STRATIFY the cap per (state, age_bucket) cell instead of sampling flat -
    // ROW_NUMBER() OVER (PARTITION BY PROPERTY_STATE, age_bucket ORDER BY HASH(...)) capped at
    // 80. Any cell at or under 80 real rows (the overwhelming majority - Congaree's 69 included)
    // keeps ALL of them, zero sampling loss; only cells bigger than 80 (which have plenty of
    // margin above any min_peers threshold even after capping) get trimmed. Measured the real
    // wire payload directly (not the ~500 bytes/row guess from the first version of this query):
    // actual is ~278 bytes/row for this exact 9-column shape, so a ~16,000-row result under this
    // scheme is ~4.5MB - comfortably under Superblocks' ~5MB limit with real margin, not a guess.
    // age_bucket here matches _property_age_bucket exactly (generator/data.py:4886, and this
    // file's own propertyAgeBucket) - only 7-12mo..37+mo are ever reachable since months_live>=7
    // is already enforced above, but the full scheme is kept for the same "consistency with the
    // rest of this file" reason Flask's own docstring gives.
    // CORRECTION #3 (verified live): this query was STILL failing in Superblocks
    // (IntegrationError code 4, pluginName "JavaScript SDK API") even after the stratified-
    // sampling fix above - confirmed via the retry+error-dump diagnostic that it fails
    // identically all 3 attempts, i.e. a consistent, reproducible cost problem, not a transient
    // blip. Verified directly against Snowflake outside Superblocks: this exact query with the
    // FIPS_TO_CENSUS_DATA/ZIP_TO_FIPS UDF chain (for MEDIAN_RENTER_INCOME, feeding ONLY the
    // optional RTI-adjusted-rent tier 0 in resolvePropertyPeerMetric) takes 8.5s; the identical
    // query with that UDF chain removed takes 2.9s - the UDF chain alone is ~66% of this query's
    // cost, evaluated once per sampled row (up to 16,144 times). networkPool's own query has the
    // same UDF chain but only ever evaluates it 3,080 times and succeeds reliably - strong
    // evidence the UDF chain's cost, not row count or payload size, is what's tipping this query
    // over Superblocks' real (undocumented) per-query cost ceiling under production concurrency
    // that an isolated test doesn't reproduce.
    // Fix: drop the UDF chain (and its prop_zip CTE/join) entirely, selecting MEDIAN_RENTER_INCOME
    // as a literal NULL. Tier 0 (RTI-adjusted rent) will never fire for property-level peer
    // matching as a result - _resolve_property_peer_metric's own hasIncome gate requires a real
    // (non-null) income value on the candidate side, so it falls through to tier 1 (same state +
    // size + raw rent) instead, same as it already does for any candidate lacking income data
    // today. This is a real feature loss (a somewhat less precise rent comparison for the
    // fraction of properties that would have hit tier 0), but strictly better than the current
    // state, where propertyPool is empty and NO per-property peer matching works at all.
    // CORRECTION #4 (verified live via the version marker below): the UDF-chain removal above
    // was NOT sufficient on its own - PROPERTY_POOL_SQL_VERSION "v4-no-udf-stratified-80"
    // confirmed in the debug panel that the UDF-free query genuinely ran and still failed
    // identically. Rules out both the UDF-chain theory (on its own) AND a working-tree sync-lag
    // repeat (the version marker proved the new code was live). What's left: raw row count.
    // networkPool's own query succeeds reliably at 3,080 rows; this query, even UDF-free, was
    // still 16,144 rows - over 5x larger. Cutting the per-cell cap to 15 (3,521 rows total)
    // confirmed live: it works. Two real data points now: 3,521 succeeds, 16,144 fails - the
    // real threshold sits somewhere between them.
    // Cap=15 was a real completeness cost (Congaree Villas' 69-row SC cell kept only 15 of
    // them), so once cap=15 was confirmed working, raised it to 30 (6,780 rows, measured 4.4s
    // standalone) - confirmed working in production too.
    // At cap=30, a real second-order issue surfaced: several tiny (10-20 unit), mature (37+mo)
    // NC/SC properties (the CumTow sister properties) showed an adoption peer median of exactly
    // 0.0%, which looked wrong but wasn't fabricated - verified live against the true unsampled
    // population that ~31% of tiny mature Southeast properties genuinely have zero bills paid
    // that month (true median across 154 real candidates is ~10%, not 0%). The problem was
    // sample SIZE, not sample correctness: the region-tier match for these properties was
    // landing on only ~9 peers after cap=30 thinned the pool, small enough that a real 31%-
    // zero-mass population can swing the reported median all the way to 0% by chance. Raised
    // to 45 (9,827 rows, verified this specific tiny-Southeast segment's candidate count grows
    // from 82 to 121 going 30->45) - confirmed working in production, 0%-median issue resolved.
    // Kevin asked to push further for a more compelling sample size generally; raised to 60
    // (12,648 rows, verified live 4.4s standalone) - this is closer to the confirmed-failing
    // 16,144 than earlier steps (~78% of the way there vs. ~61% at cap=45), so if this specific
    // step fails, the real threshold is somewhere between 45 and 60, not further out.
    // TEMPORARY diagnostic — this exact query has failed identically ("IntegrationError code 4")
    // across two substantively different versions now (stratified-with-UDF, then stratified-
    // without-UDF), and Superblocks' error text is too generic to tell whether that's the same
    // underlying cost problem persisting or another instance of the working-tree sync-lag that's
    // hit this session repeatedly. A version marker in the debug panel removes the ambiguity:
    // if the NEXT failure shows this exact string, we know for certain the UDF-free query is
    // really what ran and the problem is something else entirely; if the panel is missing this
    // line or shows old debugInfo shape, the working tree is still stale.
    // CORRECTION #5 (Kevin's catch): stratifying by (state, age_bucket) alone, with no size
    // dimension, meant the retained 60 rows per cell were a RANDOM hash-ordered sample across
    // every size in that state/age combo - a property's own size-matched tier (±40% units,
    // e.g. resolvePropertyPeerNar's tier 1/2) then had to filter that already-random 60 down
    // further, and for a size band far from the cell's bulk, could land on anywhere from 0 to
    // a handful of real candidates. Confirmed real: LC Dublin (552 units, OH, 13-18mo) showed
    // a peer median of 7.2% one run and 0.0% another, vs. Flask's real unsampled 1.7% - not
    // sample-size noise at a stable N, but the SAMPLE ITSELF changing composition run to run
    // because size was never part of what the cap preserved.
    // Fix: add a size-bucket dimension to the partition key, cap reduced from 60 to 10 per
    // (state, age_bucket, size_bucket) cell (6 size buckets x 10 = 60 worst-case per original
    // (state, age_bucket) cell - same ceiling as before for a maximally dense cell, but now
    // every size band within it is guaranteed representation instead of a coin flip). Real
    // total row count should come in AT OR BELOW today's ~12,648 (most cells aren't dense
    // enough to hit 10 in every size band, let alone 60 in aggregate) - not expected to
    // reopen the IntegrationError code 4 cost ceiling documented above, but worth confirming
    // live after this ships.
    // Version-history marker, no remaining reader since its debug-panel display was removed;
    // underscore-prefixed rather than deleted, so a future diagnostic pass can find this thread.
    const _PROPERTY_POOL_SQL_VERSION = "v9-no-udf-stratified-state-age-size-10";
    const PROPERTY_POOL_SQL = `WITH latest AS (
                SELECT MAX(BP_MONTH) AS bp_month
                FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
                WHERE BP_MONTH < ? AND IS_INTEGRATED_TOTAL = TRUE
             ),
             agg AS (
                SELECT
                  PMC_NAME, PROPERTY_NAME,
                  MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN PROPERTY_STATE END) AS PROPERTY_STATE,
                  MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN PROPERTY_UNIT_COUNT END) AS PROPERTY_UNIT_COUNT,
                  MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN RENT_PAID_AMOUNT END) AS RENT_PAID_AMOUNT,
                  MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN BILLS_PAID_COUNT END) AS BILLS_PAID_COUNT,
                  MAX(ROLLOUT_MONTH) AS ROLLOUT_MONTH,
                  SUM(CASE WHEN BP_MONTH >= DATEADD('month', -12, (SELECT bp_month FROM latest))
                            AND BP_MONTH <= (SELECT bp_month FROM latest)
                       THEN NEW_BILL_CONNECTIONS_PROPERTY ELSE 0 END) AS T12_CONNECTIONS,
                  ANY_VALUE(PROPERTY_PUBLIC_ID) AS PROPERTY_PUBLIC_ID
                FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
                WHERE IS_INTEGRATED_TOTAL = TRUE
                  AND ROLLOUT_MONTH IS NOT NULL
                  -- Lossless perf optimization, same reasoning as networkPool's identical bound:
                  -- nothing below reads data older than 13mo back from "latest".
                  AND BP_MONTH >= DATEADD('month', -13, (SELECT bp_month FROM latest))
                  AND BP_MONTH <= (SELECT bp_month FROM latest)
                GROUP BY PMC_NAME, PROPERTY_NAME
                HAVING MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN PROPERTY_UNIT_COUNT END) >= 10
                   AND MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN PROPERTY_STATE END) IS NOT NULL
                   AND MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN PROPERTY_STATE END) != ''
                   AND DATEDIFF('month', MAX(ROLLOUT_MONTH), (SELECT bp_month FROM latest)) >= 7
             ),
             ranked AS (
                SELECT *,
                       ROW_NUMBER() OVER (
                         PARTITION BY PROPERTY_STATE,
                           CASE
                             WHEN DATEDIFF('month', ROLLOUT_MONTH, (SELECT bp_month FROM latest)) <= 3  THEN '1-3mo'
                             WHEN DATEDIFF('month', ROLLOUT_MONTH, (SELECT bp_month FROM latest)) <= 6  THEN '4-6mo'
                             WHEN DATEDIFF('month', ROLLOUT_MONTH, (SELECT bp_month FROM latest)) <= 12 THEN '7-12mo'
                             WHEN DATEDIFF('month', ROLLOUT_MONTH, (SELECT bp_month FROM latest)) <= 18 THEN '13-18mo'
                             WHEN DATEDIFF('month', ROLLOUT_MONTH, (SELECT bp_month FROM latest)) <= 24 THEN '19-24mo'
                             WHEN DATEDIFF('month', ROLLOUT_MONTH, (SELECT bp_month FROM latest)) <= 36 THEN '25-36mo'
                             ELSE '37+mo'
                           END,
                           -- Size bucket - roughly doubling steps, aligned with the ±40%
                           -- relative-size tiers resolvePropertyPeerMetric filters by
                           -- downstream, so no size band gets starved by a cap that only
                           -- ever preserved state+age composition.
                           CASE
                             WHEN PROPERTY_UNIT_COUNT < 50   THEN 'xs'
                             WHEN PROPERTY_UNIT_COUNT < 100  THEN 'sm'
                             WHEN PROPERTY_UNIT_COUNT < 200  THEN 'md'
                             WHEN PROPERTY_UNIT_COUNT < 400  THEN 'lg'
                             WHEN PROPERTY_UNIT_COUNT < 800  THEN 'xl'
                             ELSE 'xxl'
                           END
                         ORDER BY HASH(PMC_NAME, PROPERTY_NAME)
                       ) AS rn
                FROM agg
             ),
             sampled AS (
                SELECT * FROM ranked WHERE rn <= 10
             )
             SELECT PMC_NAME, PROPERTY_NAME, PROPERTY_STATE, PROPERTY_UNIT_COUNT,
                    RENT_PAID_AMOUNT, BILLS_PAID_COUNT, ROLLOUT_MONTH, T12_CONNECTIONS,
                    NULL AS MEDIAN_RENTER_INCOME
             FROM sampled`;
    const propertyPoolPromise = !needsQBRQueries
      ? Promise.resolve([] as NetworkPoolRow[])
      : (async (): Promise<NetworkPoolRow[]> => {
          // Confirmed live: this exact query, run directly against Snowflake outside
          // Superblocks, returns 16,144 real rows in ~9s with no error - so the generic
          // "IntegrationError ... failed during 'query'" here is Superblocks-integration-layer
          // specific (timeout under real concurrent load, a payload/driver difference from the
          // isolated test, or a transient blip), not a SQL problem. Same retry-with-backoff +
          // rich-error-dump pattern as networkPoolPromise above, for the same reason: get real
          // diagnostic signal instead of guessing again.
          const maxAttempts = 3;
          let lastErr: unknown = null;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              return await ctx.integrations.snowflake_sso.query(
                PROPERTY_POOL_SQL,
                NetworkPoolSchema,
                [cutoffStr],
                { label: "Pull network-wide property pool for per-property peer matching, stratified per state x age-bucket cell (Property Deep Dive)" }
              );
            } catch (err) {
              lastErr = err;
              if (attempt < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
              }
            }
          }
          const err = lastErr;
          const base = err instanceof Error ? err.message : String(err);
          let extra = "";
          try {
            const props = err && typeof err === "object" ? Object.getOwnPropertyNames(err) : [];
            const extraProps = props.filter((p) => p !== "message" && p !== "stack");
            if (extraProps.length > 0) {
              const dump: Record<string, unknown> = {};
              for (const p of extraProps) dump[p] = (err as Record<string, unknown>)[p];
              extra = " | extra: " + JSON.stringify(dump, null, 0).slice(0, 2000);
            }
          } catch {
            // ignore — best-effort diagnostic only
          }
          _propertyPoolError = `${base}${extra} (failed after ${maxAttempts} attempts)`;
          return [] as NetworkPoolRow[];
        })();

    const SubjectSignupTimingSchema = z.object({
      PROPERTY_NAME: z.string(),
      ROLLOUT_DATE: z.string(),
      FIRST_CONNECTED_AT: z.string(),
    });
    const [metricsRows, dqShieldedRows, entityDqShieldedRows, yearlyRentBillsRows, entityYearlyRentRows, trendRawRows, retentionCohortRows, customerMonthRows, subjectSignupTimingRows] = await Promise.all([
      ctx.integrations.snowflake_sso.query(
        `SELECT TO_VARCHAR(BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH, NAR, SEGMENT_NAR_AVG,
                BILLS_PAID, BILLS_PAID_NEW, BILLS_PAID_REPEAT, BILLS_PAID_PREV_MONTH,
                RENT_PAID, HUBSPOT_COMPANY_SEGMENT
         FROM PRODUCTION.EXTERNAL_REPORTING.PARTNER_REPORTING_CORE_METRICS
         WHERE PMC_NAME = ?
           AND BP_MONTH >= DATEADD('month', -?, CURRENT_DATE())
         ORDER BY BP_MONTH
         LIMIT 100`,
        MetricsRowSchema,
        [pmc_name, lookback_months],
        { label: "Fetch PMC core metrics (repeat rate, segment NAR)" }
      ),
      ctx.integrations.snowflake_sso.query(
        // Stays a fixed 13-month pull (a safe superset covering the Delinquency slide's own
        // 12-month display cap) regardless of the report's own lookback_months — that slide's
        // trend chart always wants the full window. The exec-summary tile's period-scoped
        // figure (Full/Quarter/YTD) is computed separately below by filtering dqShieldedRows
        // to lookback_months, not by shrinking this pull.
        `SELECT TO_VARCHAR(BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH,
                SUM(TOTAL_RENT_SHIELDED) AS TOTAL_RENT_SHIELDED,
                SUM(RENT_NOT_COLLECTED) AS RENT_NOT_COLLECTED,
                SUM(NUMBER_OF_RESIDENTS) AS NUMBER_OF_RESIDENTS
         FROM PRODUCTION.EXTERNAL_REPORTING.DQ_PROPERTY
         WHERE PMC_NAME IN (${allPmcNames.map(() => "?").join(", ")})
           AND BP_MONTH >= DATEADD('month', -13, CURRENT_DATE())
           AND BP_MONTH < ?
         GROUP BY 1
         ORDER BY 1 DESC
         LIMIT 50`,
        DqShieldedRowSchema,
        [...allPmcNames, cutoffStr],
        { label: "Fetch DQ shielded data from DQ_PROPERTY" }
      ),
      // Per-entity DQ, for the Exec Summary switcher's Delinquency-shielded tile. Same table,
      // same 13-month bounds and same cutoff as the combined pull directly above - one grain
      // finer - so the per-entity figures sum exactly to the combined one rather than
      // approximately. Gated on allPmcNames.length > 1: a single-PMC report has no switcher
      // and never fires this. Mirrors Flask, which pulls each entity's own delinquency frame
      // into _dq_split for exactly this purpose (app.py:2196-2201).
      allPmcNames.length > 1
        ? ctx.integrations.snowflake_sso.query(
            `SELECT PMC_NAME,
                    TO_VARCHAR(BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH,
                    SUM(TOTAL_RENT_SHIELDED) AS TOTAL_RENT_SHIELDED
             FROM PRODUCTION.EXTERNAL_REPORTING.DQ_PROPERTY
             WHERE PMC_NAME IN (${allPmcNames.map(() => "?").join(", ")})
               AND BP_MONTH >= DATEADD('month', -13, CURRENT_DATE())
               AND BP_MONTH < ?
             GROUP BY 1, 2
             ORDER BY 1, 2 DESC
             LIMIT 500`,
            EntityDqShieldedRowSchema,
            [...allPmcNames, cutoffStr],
            { label: "Fetch DQ shielded per combined entity (exec summary switcher)" }
          ).catch(() => [] as z.infer<typeof EntityDqShieldedRowSchema>[])
        : Promise.resolve([] as z.infer<typeof EntityDqShieldedRowSchema>[]),
      needsSinceInception
        ? ctx.integrations.snowflake_sso.query(
            `SELECT
                YEAR(BP_MONTH) AS YEAR,
                SUM(RENT_PAID_AMOUNT) AS TOTAL_RENT,
                SUM(BILLS_PAID_COUNT) AS BILLS_PAID,
                COUNT(DISTINCT BP_MONTH) AS MONTHS_ACTIVE,
                SUM(CASE WHEN MONTH(BP_MONTH) <= ? THEN RENT_PAID_AMOUNT ELSE 0 END) AS YTD_RENT,
                SUM(CASE WHEN MONTH(BP_MONTH) <= ? THEN BILLS_PAID_COUNT ELSE 0 END) AS YTD_BILLS,
                COUNT(DISTINCT CASE WHEN MONTH(BP_MONTH) <= ? THEN BP_MONTH END) AS YTD_MONTHS_ACTIVE
             FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
             WHERE PMC_NAME IN (${allPmcNames.map(() => "?").join(", ")})
               AND BP_MONTH < ?
             GROUP BY 1
             ORDER BY 1
             LIMIT 50`,
            // No IS_IN_NETWORK filter - matches Flask's pull_yearly_rent_bills exactly (deliberately
            // unfiltered, same "true history" convention as lifetime_rent). Confirmed real: this
            // filter dropped 6 properties' historical rent/bills for months they were later
            // deactivated/transferred out of - $10.9K/6 bills in 2024, $5.5K/3 bills in 2025 -
            // silently shrinking a lifetime total that was genuinely guaranteed and paid at the
            // time. A property's CURRENT network status has no bearing on whether past history
            // happened (Kevin's catch: Flask showed $12.43M/7,239 bills, this showed $12.4M/7,230).
            YearlyRentBillsSchema,
            [cutoffMonthNum, cutoffMonthNum, cutoffMonthNum, ...allPmcNames, cutoffStr],
            { label: "Fetch since-inception yearly totals (unbounded)" }
          )
        : Promise.resolve([] as z.infer<typeof YearlyRentBillsSchema>[]),
      needsSinceInception && allPmcNames.length > 1
        ? ctx.integrations.snowflake_sso.query(
            `SELECT
                PMC_NAME,
                YEAR(BP_MONTH) AS YEAR,
                SUM(RENT_PAID_AMOUNT) AS TOTAL_RENT,
                SUM(BILLS_PAID_COUNT) AS TOTAL_BILLS,
                SUM(CASE WHEN MONTH(BP_MONTH) <= ? THEN RENT_PAID_AMOUNT ELSE 0 END) AS YTD_RENT
             FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
             WHERE PMC_NAME IN (${allPmcNames.map(() => "?").join(", ")})
               AND BP_MONTH < ?
             GROUP BY 1, 2
             ORDER BY 1, 2
             LIMIT 500`,
            // Same unfiltered "true history" convention and same WHERE bounds as
            // YearlyRentBillsSchema's combined query just above - see the schema comment for
            // why this has to be a separate query instead of adding PMC_NAME to that one's own
            // GROUP BY. Gated on allPmcNames.length > 1 - a single-PMC report never fires this.
            EntityYearlyRentSchema,
            [cutoffMonthNum, ...allPmcNames, cutoffStr],
            { label: "Fetch since-inception yearly totals per combined entity (stacked bar)" }
          )
        : Promise.resolve([] as z.infer<typeof EntityYearlyRentSchema>[]),
      needsQBRQueries
        ? ctx.integrations.snowflake_sso.query(
            `SELECT PROPERTY_NAME,
                    TO_VARCHAR(BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH,
                    BILLS_PAID_COUNT,
                    PROPERTY_UNIT_COUNT,
                    TO_VARCHAR(ROLLOUT_MONTH, 'YYYY-MM-DD') AS ROLLOUT_MONTH,
                    NEW_BILL_CONNECTIONS_PROPERTY
             FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
             WHERE PMC_NAME = ?
               AND IS_IN_NETWORK = TRUE
               AND BP_MONTH < ?
               AND BP_MONTH >= DATEADD('month', -25, ?)
             ORDER BY PROPERTY_NAME, BP_MONTH`,
            PropertyTrendSchema,
            [pmc_name, cutoffStr, cutoffStr],
            { label: "Fetch 25-month property history for trend badges" }
          )
        : Promise.resolve([] as z.infer<typeof PropertyTrendSchema>[]),
      ctx.integrations.snowflake_sso.query(
        `WITH active_properties AS (
            -- Flask (generator/data.py:405-427, _active_property_pmc_pairs): scopes retention
            -- to properties IS_IN_NETWORK as of the LATEST COMPLETED MONTH specifically, not
            -- per-row across the whole window -- "keeps retention rates honest by not counting
            -- departed-property residents as churn." A property that transferred away or
            -- deactivated PARTWAY through the 12-month window used to still contribute its
            -- earlier in-network months, and once it drops out of the data its residents look
            -- exactly like churn -- they left because their PROPERTY left the network, not
            -- because they personally stopped using Flex. This is the real cause of the true-
            -- repeat-rate gap: the "Perfect" bucket count was IDENTICAL between Flask and this
            -- port (267 both) while every OTHER bucket, and the total population, ran higher
            -- here -- those extra customers were exactly the departed-property residents
            -- Flask's snapshot excludes (a customer with a broken/incomplete history from a
            -- property leaving mid-window can't hit "Perfect," but can inflate every other
            -- bucket and drag the eligible-population denominator up).
            -- Flask's real match key is (PROPERTY_NAME, PMC_NAME) pairs, NOT PROPERTY_PUBLIC_ID
            -- -- matching that exactly (rather than the arguably-more-correct stable-ID version
            -- tried first) in case any of this PMC's properties were renamed within the window,
            -- which would make Flask's own name-based pairs silently exclude that property's
            -- pre-rename history as if it were a "different" property. Testing whether this
            -- explains the small residual gap remaining after the first active-properties fix.
            SELECT PROPERTY_NAME
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE PMC_NAME IN (${allPmcNames.map(() => "?").join(", ")})
              AND BP_MONTH = ?::DATE
              AND IS_IN_NETWORK = TRUE
         ),
         scoped_props AS (
            SELECT PROPERTY_PUBLIC_ID, BP_MONTH
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE PMC_NAME IN (${allPmcNames.map(() => "?").join(", ")})
              AND PROPERTY_NAME IN (SELECT PROPERTY_NAME FROM active_properties)
              AND IS_IN_NETWORK = TRUE
              AND BP_MONTH >= DATEADD('month', -?, ?::DATE)
              AND BP_MONTH < ?
         ),
         customer_months AS (
            SELECT
               n.CUSTOMER_PUBLIC_ID,
               COUNT(DISTINCT n.BP_MONTH) AS months_paid,
               MIN(n.BP_MONTH) AS first_month,
               GREATEST(1, DATEDIFF('month', MIN(n.BP_MONTH), ?::DATE) + 1) AS months_available
            FROM scoped_props p
            JOIN PRODUCTION.ANALYTICS.NAR_CHARGED_USERS n
               ON n.PROPERTY_PUBLIC_ID = p.PROPERTY_PUBLIC_ID AND n.BP_MONTH = p.BP_MONTH
            WHERE n.HAS_BILL_PAID = TRUE
            GROUP BY n.CUSTOMER_PUBLIC_ID
         ),
         -- Flask (generator/slides.py:3891-3894): only customers with 3+ months of history can
         -- be assessed for a real loyalty pattern — 1-2 month customers can't yet. Was >= 2.
         multi_month AS (
            SELECT * FROM customer_months WHERE months_available >= 3
         ),
         total_cust AS (
            SELECT COUNT(*) AS cnt FROM multi_month
         ),
         eligible AS (
            SELECT * FROM customer_months WHERE first_month < ?::DATE
         ),
         repeat_cust AS (
            SELECT COUNT(*) AS cnt FROM eligible WHERE months_paid >= 2
         ),
         eligible_count AS (
            SELECT COUNT(*) AS cnt FROM eligible
         ),
         bucketed AS (
            SELECT
              CASE
                WHEN months_paid >= months_available THEN 'PERFECT'
                WHEN CAST(months_paid AS FLOAT) / NULLIF(months_available, 0) >= 0.75 THEN 'HIGH'
                WHEN CAST(months_paid AS FLOAT) / NULLIF(months_available, 0) >= 0.50 THEN 'REGULAR'
                ELSE 'EPISODIC'
              END AS LOYALTY_BUCKET
            FROM multi_month
         )
         SELECT
            b.LOYALTY_BUCKET,
            COUNT(*) AS BUCKET_COUNT,
            t.cnt AS TOTAL_CUSTOMERS,
            CASE WHEN e.cnt > 0 THEN CAST(r.cnt AS FLOAT) / e.cnt ELSE NULL END AS TRUE_REPEAT_RATE
         FROM bucketed b
         CROSS JOIN total_cust t
         CROSS JOIN repeat_cust r
         CROSS JOIN eligible_count e
         GROUP BY b.LOYALTY_BUCKET, t.cnt, r.cnt, e.cnt`,
        RetentionCohortSchema,
        // Flask: max(3, lookback_months) (app.py:730) — floor so a very short override can't
        // starve the cohort window entirely. First param group (allPmcNames, reportingMonthStr)
        // resolves active_properties' latest-month snapshot; second allPmcNames spread is
        // scoped_props' own PMC_NAME filter, needed now that the join key is PROPERTY_NAME
        // (not unique across the whole network) instead of PROPERTY_PUBLIC_ID.
        [...allPmcNames, reportingMonthStr, ...allPmcNames, Math.max(3, lookback_months), cutoffStr, cutoffStr, reportingMonthStr, reportingMonthStr],
        { label: "Compute loyalty buckets & true repeat rate from customer cohort" }
      ).catch(() => [] as { LOYALTY_BUCKET: string; BUCKET_COUNT: number; TOTAL_CUSTOMERS: number; TRUE_REPEAT_RATE: number | null }[]),
      ctx.integrations.snowflake_sso.query(
        `WITH active_properties AS (
            -- Same "active as of latest month" scoping as the retention-cohort query above
            -- (Flask: _active_property_pmc_pairs, generator/data.py:405-427) -- without it, a
            -- property that departed the network mid-window still contributes customers here,
            -- whose payment history simply stops when the property leaves, looking exactly like
            -- churn in the MoM set-intersection below.
            -- Flask's real match key is (PROPERTY_NAME, PMC_NAME), not PROPERTY_PUBLIC_ID --
            -- see the retention-cohort query's own comment for why this is being tested as the
            -- source of the small residual gap remaining after the first active-properties fix.
            SELECT PROPERTY_NAME
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE PMC_NAME = ?
              AND BP_MONTH = ?::DATE
              AND IS_IN_NETWORK = TRUE
         )
         SELECT
            n.CUSTOMER_PUBLIC_ID,
            TO_VARCHAR(n.BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH
         FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS p
         JOIN PRODUCTION.ANALYTICS.NAR_CHARGED_USERS n
            ON n.PROPERTY_PUBLIC_ID = p.PROPERTY_PUBLIC_ID AND n.BP_MONTH = p.BP_MONTH
         WHERE p.PMC_NAME = ?
           AND p.PROPERTY_NAME IN (SELECT PROPERTY_NAME FROM active_properties)
           AND p.IS_IN_NETWORK = TRUE
           AND p.BP_MONTH >= DATEADD('month', -?, ?::DATE)
           AND p.BP_MONTH < ?
           AND n.HAS_BILL_PAID = TRUE`,
        CustomerMonthSchema,
        // Same window as the retention-cohort query above (Flask: pull_retention_cohort's
        // lookback_months) — this feeds the same cohort_df the MoM chart is built from.
        [pmc_name, reportingMonthStr, pmc_name, Math.max(3, lookback_months), cutoffStr, cutoffStr],
        { label: "Fetch raw (customer, month) pairs for MoM retention set-intersection" }
      ).catch(() => [] as { CUSTOMER_PUBLIC_ID: string; BP_MONTH: string }[]),
      // Real DAY-level rollout-to-first-signup, replacing the old BP_MONTH-granularity calc
      // (Kevin's catch: "0.0 months" from same-BP-month rollout+connection told you nothing;
      // the real number for the one qualifying property here is 3 days, not 0). RENTERS is
      // resident-level with real timestamps (BILL_CONNECTED_AT_UTC, RESIDENT_PROPERTY_ROLLOUT_
      // DATE) - PROPERTY_BP_MONTH_STATS only has BP_MONTH, monthly granularity, no finer.
      // BILL_CONNECTED_AT_UTC >= rollout date is NOT redundant - confirmed real and necessary:
      // without it, residents who moved from an EARLIER Flex-connected property carry their
      // original connection timestamp (one real case: dated 2024, two years before this
      // property even rolled out in 2026), which would make "days to first sign-up" go
      // negative or nonsensically large instead of reflecting this property's own onboarding.
      ctx.integrations.snowflake_sso.query(
        `SELECT
            RESIDENT_PROPERTY_NAME AS PROPERTY_NAME,
            TO_VARCHAR(RESIDENT_PROPERTY_ROLLOUT_DATE, 'YYYY-MM-DD') AS ROLLOUT_DATE,
            TO_VARCHAR(MIN(BILL_CONNECTED_AT_UTC), 'YYYY-MM-DD"T"HH24:MI:SS') AS FIRST_CONNECTED_AT
         FROM PRODUCTION.ANALYTICS.RENTERS
         WHERE RESIDENT_PMC_NAME = ?
           AND RESIDENT_PROPERTY_ROLLOUT_DATE IS NOT NULL
           AND RESIDENT_PROPERTY_ROLLOUT_DATE >= DATEADD('month', -12, ?::DATE)
           AND RESIDENT_PROPERTY_ROLLOUT_DATE < ?::DATE
           AND BILL_CONNECTED_AT_UTC IS NOT NULL
           AND BILL_CONNECTED_AT_UTC >= RESIDENT_PROPERTY_ROLLOUT_DATE::TIMESTAMP_NTZ
         GROUP BY RESIDENT_PROPERTY_NAME, RESIDENT_PROPERTY_ROLLOUT_DATE`,
        SubjectSignupTimingSchema,
        [pmc_name, cutoffStr, cutoffStr],
        { label: "Fetch real day-level rollout-to-first-signup timing (RENTERS)" }
      ).catch((err) => { console.error("[SUBJECT SIGNUP TIMING QUERY FAILED]", String(err)); return [] as z.infer<typeof SubjectSignupTimingSchema>[]; }),
    ]);

    // --- Fire slow secondary queries in parallel ---
    // Customer signups + partner-since launch concurrently with networkPool + regionDetail
    const CustomerSignupsSchema = z.object({
      BP_MONTH: z.string(),
      NEW_SIGNUPS_CUSTOMER: z.coerce.number(),
    });
    const custSignupsPromise = ctx.integrations.snowflake_sso.query(
      `WITH customer_first AS (
          SELECT CUSTOMER_PUBLIC_ID, MIN(n.BP_MONTH) AS first_paid_month
          FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS p
          JOIN PRODUCTION.ANALYTICS.NAR_CHARGED_USERS n
              ON n.PROPERTY_PUBLIC_ID = p.PROPERTY_PUBLIC_ID AND n.BP_MONTH = p.BP_MONTH
          WHERE p.PMC_NAME = ?
            AND p.IS_IN_NETWORK = TRUE
            AND n.HAS_BILL_PAID = TRUE
          GROUP BY CUSTOMER_PUBLIC_ID
       )
       SELECT
          TO_VARCHAR(first_paid_month, 'YYYY-MM-DD') AS BP_MONTH,
          COUNT(*) AS NEW_SIGNUPS_CUSTOMER
       FROM customer_first
       WHERE first_paid_month >= DATEADD('month', -?, CURRENT_DATE())
         AND first_paid_month < ?
       GROUP BY 1
       ORDER BY 1
       LIMIT 50`,
      CustomerSignupsSchema,
      [pmc_name, lookback_months, cutoffStr],
      { label: "True first-time-payer monthly counts (excl. win-backs)" }
    ).catch(() => [] as { BP_MONTH: string; NEW_SIGNUPS_CUSTOMER: number }[]);

    const LaunchSchema = z.object({ LAUNCH_MONTH: z.string().nullable() });
    let partnerSinceError: string | null = null;
    const partnerSincePromise = ctx.integrations.snowflake_sso.query(
      `WITH opp_dates AS (
        -- Any closed-won opportunity, not just 'New Logo' - dropped that type filter (Kevin's
        -- catch, mirrors the same fix in Flask's pull_launch_month, generator/data.py:2496).
        -- 'New Logo' isn't reliable: confirmed real on Bridge PM, whose only 'New Logo'-typed
        -- opps are dated 2024 and are literally named "(Glen 91 Transfer)" / "(Dulles Greene
        -- Transfer)" - property-transfer deals into an already multi-year-established partner,
        -- mistyped as New Logo - while real Expansion opportunities go back to Sept 2020 (an
        -- Expansion deal can't happen before you're already a customer) and property rollout
        -- data goes back to Oct 2019. Because a 'New Logo' match existed, this never fell
        -- through to the rollout fallback that would have gotten closer to the truth, and
        -- returned the false, too-recent 2024 date instead. Any closed-won deal proves the
        -- partnership already existed by that date, which is all this needs - and unlike
        -- rollout_month, a deal record is tied to the ACCOUNT, not a property, so it can't be
        -- inherited from an unrelated prior owner via a transfer the way rollout_month can.
        SELECT MIN(o.CLOSED_AT_UTC) AS closed_at
        FROM PRODUCTION.SALES.FCT_SALES_OPPORTUNITIES o
        JOIN PRODUCTION.SALES.DIM_SALES_ACCOUNTS a ON o.SALES_ACCOUNT_KEY = a.SALES_ACCOUNT_KEY
        JOIN (SELECT DISTINCT PMC_ID FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS WHERE PMC_NAME IN (${allPmcNames.map(() => "?").join(", ")})) p
             ON a.PMC_ID = p.PMC_ID
        WHERE o.IS_CLOSED_WON = TRUE
        UNION ALL
        SELECT MIN(o.CLOSED_AT_UTC) AS closed_at
        FROM FLEX.SALES.FCT_CRM_OPPORTUNITY o
        JOIN FLEX.SALES.DIM_CRM_ACCOUNT_HISTORY a ON o.CRM_ACCOUNT_SK = a.CRM_ACCOUNT_SK
        JOIN (SELECT DISTINCT PMC_ID FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS WHERE PMC_NAME IN (${allPmcNames.map(() => "?").join(", ")})) p
             ON a.PMC_ID = p.PMC_ID
        WHERE a.IS_CURRENT = TRUE
          AND o.IS_CLOSED_WON = TRUE
       )
       SELECT TO_VARCHAR(MIN(closed_at), 'YYYY-MM-DD') AS LAUNCH_MONTH FROM opp_dates`,
      LaunchSchema,
      [...allPmcNames, ...allPmcNames],
      { label: "Pull partner launch month from Salesforce opportunities (old + new schema)" }
    ).catch((err) => {
      partnerSinceError = err instanceof Error ? err.message : String(err);
      return [{ LAUNCH_MONTH: null }] as { LAUNCH_MONTH: string | null }[];
    });

    // Guarded rollout-date comparator - mirrors Flask's pull_launch_month (generator/data.py:
    // 2496) after its second fix. Only trusts a property's ROLLOUT_MONTH when that property's
    // OWN earliest bp_month row under this pmc scope actually starts close to it (<=3 months) -
    // a transferred-in property carries its old rollout_month forward but has a real gap
    // before its billing history under the new PMC's name begins, which this excludes. This is
    // the guard the PREVIOUS version of this file's "earlier wins" logic was missing (see the
    // comment above partnerSince below) - without it, a genuinely long-tenured property and a
    // transfer-inherited one are indistinguishable by date alone, which is why that logic got
    // reverted. With the guard, they're not: verified directly against Bridge PM's own data -
    // "Allure" (rollout 2019-10-01) has 1,505 bills paid continuously from Oct 2019 through
    // today, not a gapped transfer artifact.
    // FIRST_BP / FLOOR_BP ride along on the same scan for the stale-opp guard at the combine
    // below (Flask c2e2057): the scope's earliest BP row of any kind, and the whole table's
    // earliest BP month (its data floor). The scope predicate is bound TWICE (first_bp subquery
    // + main filter).
    const RolloutLaunchSchema = z.object({
      LAUNCH_MONTH: z.string().nullable(),
      FIRST_BP: z.string().nullable(),
      FLOOR_BP: z.string().nullable(),
    });
    type RolloutLaunchRow = z.infer<typeof RolloutLaunchSchema>;
    const rolloutDatePromise = ctx.integrations.snowflake_sso.query(
      `SELECT TO_VARCHAR(MIN(ROLLOUT_MONTH), 'YYYY-MM-DD') AS LAUNCH_MONTH,
              TO_VARCHAR((SELECT MIN(BP_MONTH) FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
                          WHERE PMC_NAME IN (${allPmcNames.map(() => "?").join(", ")})), 'YYYY-MM-DD') AS FIRST_BP,
              TO_VARCHAR((SELECT MIN(BP_MONTH) FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS), 'YYYY-MM-DD') AS FLOOR_BP
       FROM (
           SELECT PROPERTY_PUBLIC_ID, ROLLOUT_MONTH, MIN(BP_MONTH) AS first_billed_month
           FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
           WHERE PMC_NAME IN (${allPmcNames.map(() => "?").join(", ")}) AND ROLLOUT_MONTH IS NOT NULL
           GROUP BY PROPERTY_PUBLIC_ID, ROLLOUT_MONTH
       ) t
       WHERE DATEDIFF('month', ROLLOUT_MONTH, first_billed_month) <= 3`,
      RolloutLaunchSchema,
      [...allPmcNames, ...allPmcNames],
      { label: "Pull guarded earliest rollout month (+ first/floor BP month) for partner-since comparison" }
    ).catch(() => [{ LAUNCH_MONTH: null, FIRST_BP: null, FLOOR_BP: null }] as RolloutLaunchRow[]);

    // Flask (generator/data.py:2367-2413, compute_benchmark): Portfolio Penetration's
    // denominator is deliberately NOT HUBSPOT_DEAL_TOTAL_COMPANY_UNITS for the SUBJECT PMC -
    // that field is a per-deal snapshot that varies wildly row-to-row (explicit comment in
    // Flask source warns against it). Instead it queries the Salesforce accounts table
    // directly via PMC_ID, same join pattern as partnerSincePromise above. NOTE: this is
    // intentionally asymmetric with the PEER side (below, in the PENETRATION percentile CTE),
    // which DOES use HUBSPOT_DEAL_TOTAL_COMPANY_UNITS - Flask does the same (peer_penetration
    // CTE, data.py:2035-2043) because peers only feed a percentile position, not a displayed
    // headline number, so the noisier field is tolerated there but not for the subject's own
    // value.
    // For combined entities, distinct PMC_NAMEs can map to distinct PMC_IDs (and therefore
    // distinct Salesforce accounts) - the old LIMIT 1 (which assumed exactly one subject) stays
    // dropped so every combined entity's account row comes back.
    //
    // BUT: one PMC_ID can itself own MORE THAN ONE account row in DIM_SALES_ACCOUNTS (real case,
    // live-verified 2026-09-11: "AJH Management" has an 11,000-unit Partner account and a
    // 70-unit deleted Deep SMB duplicate; FLEX.SALES.DIM_CRM_ACCOUNT_HISTORY returns the
    // 11,000-unit row TWICE with IS_CURRENT = TRUE). Summing every returned row therefore
    // inflates the portfolio ceiling by whatever duplicates happen to exist - it would report
    // 11,070 (or 22,000 on the new-schema table) for an 11,000-unit PMC. Flask never sums
    // duplicates: compute_benchmark's portfolio_total takes ONE row (cursor.fetchone(),
    // generator/data.py:2717-2731) and the Expansion auto-populate keys
    // list_expansion_candidates by PMC name (one value per name, app.py:1948-1955). So the rule
    // is: one row per PMC_ID, then sum across distinct PMC_IDs. resolveSubjectPortfolioUnits
    // owns that selection (pure + unit-tested); PMC_ID and ACCOUNT_FLEX_UNITS are selected here
    // purely to feed it.
    const SubjectPortfolioTotalSchema = z.object({
      PMC_ID: z.coerce.number().nullable(),
      TOTAL_COMPANY_UNITS: z.coerce.number().nullable(),
      FLEX_UNITS: z.coerce.number().nullable(),
    });
    let subjectPortfolioTotalError: string | null = null;
    const subjectPortfolioTotalPromise = ctx.integrations.snowflake_sso.query(
      `SELECT acc.PMC_ID                        AS PMC_ID,
              acc.ACCOUNT_TOTAL_COMPANY_UNITS   AS TOTAL_COMPANY_UNITS,
              acc.ACCOUNT_FLEX_UNITS            AS FLEX_UNITS
       FROM PRODUCTION.SALES.DIM_SALES_ACCOUNTS acc
       JOIN (SELECT DISTINCT PMC_ID FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS WHERE PMC_NAME IN (${allPmcNames.map(() => "?").join(", ")})) p
            ON acc.PMC_ID = p.PMC_ID`,
      SubjectPortfolioTotalSchema,
      [...allPmcNames],
      { label: "Subject PMC's true total company units from Salesforce accounts (for Portfolio Penetration denominator)" }
    ).catch((err) => {
      subjectPortfolioTotalError = err instanceof Error ? err.message : String(err);
      return [] as SubjectPortfolioRow[];
    });

    // --- Network property pool was moved earlier (fired before the batch) ---
    let regionDetail: RegionDetailRow[] = [];
    // Subject PMC's own properties' median renter income, keyed by property name — feeds the
    // RTI (rent-to-income) peer-matching tier in peer-matching.ts's resolvePropertyPeerMetric.
    const subjectIncomeByProperty = new Map<string, number>();
    // Tenure percentile vs. all active PMCs (1 = oldest) — gates the anniversary-milestone
    // callout below to only the top 50% most-tenured partners, matching Flask.
    let tenurePercentileFromTop: number | null = null;
    // Deactivated properties, feeding the "These properties need our attention" slide's
    // No-Longer-Active section (QBR only, same as the rest of this block). New Rollouts'
    // benchmark used to come from a dedicated network-wide-untiered query here
    // (stageAgeBenchmarkRows) - removed (see stageBenchmarksMap below for why).
    let disabledPropertyRows: { PROPERTY_NAME: string; DEACTIVATION_REASON: string; PROPERTY_UNIT_COUNT: number; LAST_SEEN_MONTH: string | null }[] = [];

    if (needsQBRQueries) {
      // Network pool query was moved earlier (fires in parallel with the main batch above).
      // regionDetailPromise was moved earlier too (now fires for Expansion as well - see its
      // new definition and comment next to networkPoolPromise above).

      // Subject PMC's own property-level median renter income (same ZIP→FIPS→census UDF
      // chain as the network pool query above) — lets the peer-matching resolver compare
      // rent-to-income instead of raw rent for this PMC's properties.
      const SubjectIncomeSchema = z.object({
        PROPERTY_NAME: z.string(),
        // z.coerce — same FIPS_TO_CENSUS_DATA UDF as NetworkPoolSchema above; see that
        // comment for why z.number() alone can silently reject the whole result.
        MEDIAN_RENTER_INCOME: z.coerce.number().nullable(),
      });
      const subjectIncomePromise = ctx.integrations.snowflake_sso.query(
          `WITH prop_zip AS (
              SELECT PROPERTY_PUBLIC_ID, PROPERTY_ZIP,
                     ROW_NUMBER() OVER (PARTITION BY PROPERTY_PUBLIC_ID ORDER BY CREATED_AT_UTC DESC) AS rn
              FROM PRODUCTION.ANALYTICS.DIM_PROPERTIES_PMCS
           )
           SELECT DISTINCT
              t.PROPERTY_NAME,
              PRODUCTION.ANALYTICS.FIPS_TO_CENSUS_DATA(
                  PRODUCTION.ANALYTICS.ZIP_TO_FIPS(LEFT(p.PROPERTY_ZIP, 5)),
                  'median_renter_household_income'
              ) AS MEDIAN_RENTER_INCOME
           FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
           LEFT JOIN prop_zip p
             ON p.PROPERTY_PUBLIC_ID = t.PROPERTY_PUBLIC_ID AND p.rn = 1
           WHERE t.PMC_NAME = ?
             AND t.IS_IN_NETWORK = TRUE`,
          SubjectIncomeSchema,
          [pmc_name],
          { label: "Fetch subject PMC's property median renter income for RTI peer matching" }
        ).catch(() => [] as { PROPERTY_NAME: string; MEDIAN_RENTER_INCOME: number | null }[]);

      // Tenure percentile vs. all active PMCs — gates the anniversary-milestone callout to only
      // the top 50% most-tenured partners, same as Flask's pull_pmc_tenure_percentile.
      //
      // Ranks by the same SFDC-New-Logo-aware "true partner since" date as partnerSincePromise
      // above (COALESCE opp close date, falling back to raw MIN(ROLLOUT_MONTH) only when no
      // matching opportunity exists) — NOT raw MIN(ROLLOUT_MONTH) alone. Confirmed real bug
      // this fixes (Kevin's catch, 2026-08-19): Bridge PM's milestone slide showed "Top 1%" /
      // "2 years" / "since July 2024" on the same slide — internally contradictory, since 2
      // years of tenure is nowhere near the network's real top 1% (P99 tenure is ~75 months).
      // Root cause: Bridge PM's earliest PROPERTY rolled out in Oct 2019 under a prior
      // management company, 57 months before Bridge PM itself became a Flex partner — ranking
      // the whole network by raw rollout month reproduces that inherited-date problem for any
      // PMC in the same situation. Live-verified: Bridge PM's real percentile is 36%, not 1%,
      // and the corrected subject launch_month (2024-07-29) matches its own "since July 2024"
      // headline exactly.
      const subjectPmcNames = allPmcNames;
      const subjectPlaceholders = subjectPmcNames.map(() => "?").join(", ");
      const TenurePercentileSchema = z.object({
        PERCENTILE_FROM_TOP: z.number().nullable(),
      });
      const tenurePercentilePromise = ctx.integrations.snowflake_sso.query(
          `WITH pmc_ids AS (
              SELECT DISTINCT PMC_NAME, PMC_ID FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS WHERE PMC_ID IS NOT NULL
           ),
           pmc_rollout AS (
              -- Same guard as rolloutDatePromise above: only trust a property's ROLLOUT_MONTH
              -- when its own earliest bp_month row starts close to it (<=3 months), so a
              -- transferred-in property's inherited old rollout_month doesn't win here either.
              -- first_bp = the PMC's earliest BP row over ALL its rollout rows (Flask's
              -- MIN(BP_MONTH) in pmc_rollout), not just the <=3-month-guarded properties - the
              -- window over the aggregate carries it past the guard filter below.
              SELECT PMC_NAME, MIN(ROLLOUT_MONTH) AS rollout_launch, MIN(pmc_first_bp) AS first_bp
              FROM (
                  SELECT PMC_NAME, PROPERTY_PUBLIC_ID, ROLLOUT_MONTH, MIN(BP_MONTH) AS first_billed_month,
                         MIN(MIN(BP_MONTH)) OVER (PARTITION BY PMC_NAME) AS pmc_first_bp
                  FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
                  WHERE ROLLOUT_MONTH IS NOT NULL
                  GROUP BY PMC_NAME, PROPERTY_PUBLIC_ID, ROLLOUT_MONTH
              )
              WHERE DATEDIFF('month', ROLLOUT_MONTH, first_billed_month) <= 3
              GROUP BY PMC_NAME
           ),
           pmc_opps AS (
              -- Same join shape as partnerSincePromise's old-schema half above, and the same
              -- dropped 'New Logo' type filter - see the comment there for why (Kevin's catch).
              SELECT pi.PMC_NAME, MIN(o.CLOSED_AT_UTC) AS opp_launch
              FROM PRODUCTION.SALES.FCT_SALES_OPPORTUNITIES o
              JOIN PRODUCTION.SALES.DIM_SALES_ACCOUNTS a ON o.SALES_ACCOUNT_KEY = a.SALES_ACCOUNT_KEY
              JOIN pmc_ids pi ON pi.PMC_ID = a.PMC_ID
              WHERE o.IS_CLOSED_WON = TRUE
              GROUP BY pi.PMC_NAME
           ),
           pmc_guarded_opps AS (
              -- Same stale-opp guard as the partnerSince combine (STALE_OPP_GAP_MONTHS, Flask
              -- c2e2057): an opp closed more than that many months before the PMC's first BP
              -- row never launched, so the population falls back to rollout for it - unless its
              -- first BP row is the table's own floor (history predates the data).
              SELECT o.PMC_NAME,
                     CASE WHEN DATEDIFF('month', o.opp_launch, r.first_bp) > ${STALE_OPP_GAP_MONTHS}
                               AND r.first_bp > (SELECT MIN(BP_MONTH) FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS)
                          THEN NULL ELSE o.opp_launch::DATE END AS opp_launch
              FROM pmc_opps o
              LEFT JOIN pmc_rollout r ON r.PMC_NAME = o.PMC_NAME
           ),
           pmc_tenures AS (
              -- Earlier of the two (guarded rollout vs opp date), same reasoning as
              -- partnerSincePromise above, not "opp wins whenever it exists" - and driven off
              -- every known PMC_NAME (not just those with a qualifying rollout property), so a
              -- PMC with only an opp date isn't dropped from the ranking entirely.
              -- Opp side goes through pmc_guarded_opps (the stale-opp guard).
              SELECT pi.PMC_NAME,
                     CASE
                       WHEN g.opp_launch IS NOT NULL AND r.rollout_launch IS NOT NULL
                         THEN LEAST(g.opp_launch, r.rollout_launch)
                       ELSE COALESCE(g.opp_launch, r.rollout_launch)
                     END AS launch_month
              FROM (SELECT DISTINCT PMC_NAME FROM pmc_ids) pi
              LEFT JOIN pmc_rollout r ON r.PMC_NAME = pi.PMC_NAME
              LEFT JOIN pmc_guarded_opps g ON g.PMC_NAME = pi.PMC_NAME
           ),
           subject AS (
              SELECT MIN(launch_month) AS launch_month
              FROM pmc_tenures
              WHERE PMC_NAME IN (${subjectPlaceholders})
           ),
           counts AS (
              SELECT
                  (SELECT COUNT(*) FROM pmc_tenures) AS total_count,
                  (SELECT COUNT(*) FROM pmc_tenures t, subject s
                   WHERE t.launch_month < s.launch_month) + 1 AS tenure_rank
           )
           SELECT CEIL(100.0 * c.tenure_rank / NULLIF(c.total_count, 0)) AS PERCENTILE_FROM_TOP
           FROM subject s CROSS JOIN counts c
           WHERE s.launch_month IS NOT NULL`,
          TenurePercentileSchema,
          subjectPmcNames,
          { label: "Fetch PMC tenure percentile for anniversary-milestone gate" }
        ).catch(() => [] as { PERCENTILE_FROM_TOP: number | null }[]);

      // Disabled/deactivated properties for the "These properties need our attention" slide's
      // No-Longer-Active section (Flask: pull_disabled_properties, generator/data.py:4247).
      // Partner-relevant reasons only — internal ops codes are excluded via the WHERE clause,
      // and PARTNER_INITIATED_LOSS_OF_API_ACCESS is additionally dropped at render time
      // (ambiguous — may be intentional/migration, not necessarily churn).
      const DisabledPropertySchema = z.object({
        PROPERTY_NAME: z.string(),
        DEACTIVATION_REASON: z.string(),
        PROPERTY_UNIT_COUNT: z.number(),
        LAST_SEEN_MONTH: z.string().nullable(),
      });
      const disabledPropertiesPromise = ctx.integrations.snowflake_sso.query(
        `SELECT
            PROPERTY_NAME,
            DEACTIVATION_REASON,
            PROPERTY_UNIT_COUNT,
            TO_VARCHAR(MAX(BP_MONTH), 'YYYY-MM-DD') AS LAST_SEEN_MONTH
         FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
         WHERE PMC_NAME IN (${subjectPlaceholders})
           AND DEACTIVATION_REASON IN (${Object.keys(DEACTIVATION_LABELS).map(() => "?").join(", ")})
           AND BP_MONTH >= DATEADD('month', -18, CURRENT_DATE())
         GROUP BY PROPERTY_NAME, DEACTIVATION_REASON, PROPERTY_UNIT_COUNT
         ORDER BY LAST_SEEN_MONTH DESC, PROPERTY_NAME`,
        DisabledPropertySchema,
        [...subjectPmcNames, ...Object.keys(DEACTIVATION_LABELS)],
        { label: "Fetch deactivated properties for the No-Longer-Active section" }
      ).catch(() => [] as z.infer<typeof DisabledPropertySchema>[]);

      // New Rollouts section's "expected" NAR used to come from a dedicated network-wide,
      // UNTIERED query here. Confirmed real and broken: it returned P50_NAR = 0.0 at every
      // single age bucket 1-11 (Kevin's catch - "clark is showing a 0 peer median adoption
      // rate") because ~77% of ALL network property-months have zero bills paid and nothing
      // here excluded them by geography/size/rent the way every real peer benchmark elsewhere
      // in this deck does - Flask's real equivalent for this exact column
      // (_pull_stage_benchmarks, generator/data.py:2524) IS geo/size/rent/NIRO-tiered, and
      // showed a real 3.4% for the same property/age this query returned 0.0% for. Since
      // stageBenchmarksMap (built above, same tenure-cohort query the Adoption Trend chart
      // now uses) already covers ages 1-36 on the SAME locked-peers cohort, the New Rollouts
      // section now reads that directly instead of this separate, broken query - see the
      // newRolloutCandidates loop below.

      const [propertyPoolResult, regionDetailResult, subjectIncomeRows, tenurePercentileRows, disabledPropertyResult] = await Promise.all([
        propertyPoolPromise, regionDetailPromise, subjectIncomePromise, tenurePercentilePromise,
        disabledPropertiesPromise,
      ]);
      propertyPool = propertyPoolResult;
      regionDetail = regionDetailResult;
      disabledPropertyRows = disabledPropertyResult;
      for (const row of subjectIncomeRows) {
        if (row.MEDIAN_RENTER_INCOME != null && row.MEDIAN_RENTER_INCOME > 0) {
          subjectIncomeByProperty.set(row.PROPERTY_NAME, row.MEDIAN_RENTER_INCOME);
        }
      }
      tenurePercentileFromTop = tenurePercentileRows[0]?.PERCENTILE_FROM_TOP ?? null;
    }

    // --- Testimonials (user-selected from frontend, or auto-pulled from Zendesk) ---
    // zendeskPromise/residentTrendPromise are defined up near cutoffStr now, not here - see the
    // perf-fix comment there (Kevin's catch: they were only firing after the network/property
    // pool batch resolved instead of overlapping it). Still awaited below, just before the
    // slides that need them - only the definition moved, not the await site.

    // --- Transform ---

    // Groups already-merged rows by their own PMC_NAME - no new query needed, since the main
    // pull (case allPmcNames.length > 1) keeps per-row entity attribution through the merge.
    // Used by the Exec Summary switcher, Since Inception's stacked bar, Adoption Trend's
    // per-entity lines, the Residents/Units/Rent switcher, and the Portfolio Comparison table -
    // one grouping utility, five consumers.
    //
    // Entity ORDER is normalized to allPmcNames (the primary pmc_name first, then the
    // additional_pmc_names as entered), not Map insertion order of whatever rows happened to
    // come first. Those three source row sets are each sorted differently (inNetwork: BP_MONTH,
    // PROPERTY_NAME; latestRows: PROPERTY_NAME within one month; entityYearlyRentRows:
    // PMC_NAME, YEAR), so first-seen order gave entityMonthlyData / entityBreakdown /
    // entityYearlyData three DIFFERENT entity orders - and since every combined slide colors
    // entity i with entityColor(i), the same subsidiary showed up in a different color on each
    // slide (Kevin's "a few purple colors" catch). A PMC with no rows in a given set is simply
    // absent (same as before); a row whose PMC_NAME isn't in allPmcNames can't occur (every
    // query filters PMC_NAME IN allPmcNames) but is appended at the end rather than dropped.
    function groupRowsByPmc<T extends { PMC_NAME: string }>(rows: T[]): Map<string, T[]> {
      const map = new Map<string, T[]>();
      for (const name of allPmcNames) map.set(name, []);
      for (const r of rows) {
        const list = map.get(r.PMC_NAME);
        if (list) list.push(r);
        else map.set(r.PMC_NAME, [r]);
      }
      for (const [name, list] of map) if (list.length === 0) map.delete(name);
      return map;
    }

    // ── ONE canonical entity list + order, for every per-entity consumer ────────────────────
    // groupRowsByPmc normalizes ORDER to allPmcNames, which fixed the "a few purple colors"
    // bug for entities present in every row set. It does not fix MEMBERSHIP: it deletes empty
    // groups (just above), and the three consumers hand it three DIFFERENT row sets -
    //
    //   entityMonthlyData / residentsUnitsEntityMonthlyData  <- inNetwork    (12m, in-network)
    //   entityBreakdown                                      <- latestRows  (one month)
    //   entityYearlyData                                     <- entityYearlyRentRows
    //                                                           (UNBOUNDED, no in-network filter)
    //
    // - so an entity in one set and absent from another shifted every LATER entity's array
    // index, and since each renderer colors entity i with entityColor(i), the same subsidiary
    // came out a different color on different slides. Exactly the failure the shared palette
    // exists to prevent, and it survived the first fix because the Asset Living family (the
    // case it was tested on) happens to have all 8 entities present in all three sets.
    //
    // It is reachable on real data. Live (2026-09-11): 278 PMCs have in-network rows inside the
    // 12-month window but ZERO rows at the latest completed month, and 387 have real rent
    // history with no latest-month rows. Security Properties is one - 287 in-network rows in
    // window, last in-network month 2026-07, $19.7M lifetime rent - so a combined report of
    // "Asset Living" + "Security Properties" + "FPI (An Asset Living Company)" gives FPI index
    // 2 on Adoption Trend and Since Inception but index 1 on the Exec Summary switcher and
    // Portfolio Comparison.
    //
    // Flask cannot diverge because _pmc_split, _monthly_split_data and _dq_split are all
    // derived from ONE `_splits` list (app.py:1685-1717), built from the named frames that
    // survive compute_pmc_kpis - i.e. the entities with real in-network rows in the lookback
    // window. canonicalEntityNames is that same semantic: allPmcNames order, filtered to those
    // with in-network rows in the window. Union-padded rather than intersected, for the same
    // reason Flask keeps such an entity in _splits: it IS part of this report (it has rows in
    // the window, it contributes to the combined totals, it owns a color), it simply has
    // nothing to show in one particular view - which must render as empty, not as a shift.
    const canonicalEntityNames = Array.from(groupRowsByPmc(inNetwork).keys());
    // Per-canonical-entity row lists, padded with [] and in canonical order. Rows whose
    // PMC_NAME isn't canonical are dropped - matching Flask, where an entity that didn't
    // survive compute_pmc_kpis is absent from every split, not just the one it lacks rows for
    // (this is what keeps the unbounded, unfiltered entityYearlyRentRows from introducing an
    // entity the other two views have never heard of).
    function canonicalGroups<T extends { PMC_NAME: string }>(rows: T[]): [string, T[]][] {
      const map = groupRowsByPmc(rows);
      return canonicalEntityNames.map((name) => [name, map.get(name) ?? []]);
    }

    // Monthly totals. Factored into a closure (same logic, unchanged) so the Platinum deck can run
    // the exact same per-month aggregation on each tier's rows (Flask: transform_monthly_totals
    // on silver_df / platinum_df) instead of a second, drift-prone copy.
    const buildMonthlyTotals = (rows: typeof inNetwork) => {
      const monthMap = new Map<string, { billsPaid: number; units: number; rentPaid: number; newSignups: number; chargedUsers: number; propertyNames: Set<string> }>();
      for (const row of rows) {
        const existing = monthMap.get(row.BP_MONTH) || { billsPaid: 0, units: 0, rentPaid: 0, newSignups: 0, chargedUsers: 0, propertyNames: new Set<string>() };
        existing.billsPaid += row.BILLS_PAID;
        existing.units += row.PROPERTY_UNIT_COUNT;
        existing.rentPaid += row.RENT_PAID;
        existing.newSignups += row.NEW_SIGNUPS ?? 0;
        existing.chargedUsers += row.CHARGED_USERS ?? 0;
        existing.propertyNames.add(row.PROPERTY_NAME);
        monthMap.set(row.BP_MONTH, existing);
      }

      // Pre-index rows by BP_MONTH for O(1) lookups in established NAR calc
      const byMonth = new Map<string, typeof inNetwork>();
      for (const r of rows) {
        const arr = byMonth.get(r.BP_MONTH);
        if (arr) arr.push(r);
        else byMonth.set(r.BP_MONTH, [r]);
      }

      return Array.from(monthMap.entries())
        .map(([month, { billsPaid, units, rentPaid, newSignups, chargedUsers, propertyNames }]) => {
          // Established NAR: properties where rollout_month < (month - 2 calendar months).
          // DateOffset(months=2) gives a 3-full-month floor, aligned with Loyalty Rate's
          // months_available >= 3 and the trend legend "(excl. first 3 months)".
          const mDate = new Date(month + "T00:00:00");
          const estCutoff = new Date(mDate.getFullYear(), mDate.getMonth() - 2, 1)
            .toISOString().slice(0, 10);
          const monthRows = byMonth.get(month) ?? [];
          let estUnits = 0;
          let estBills = 0;
          for (const r of monthRows) {
            if (r.ROLLOUT_MONTH != null && r.ROLLOUT_MONTH < estCutoff) {
              estUnits += r.PROPERTY_UNIT_COUNT;
              estBills += r.BILLS_PAID;
            }
          }
          const establishedNar = estUnits > 0 ? estBills / estUnits : undefined;

          return {
            month,
            billsPaid,
            units,
            rentPaid,
            newSignups,
            chargedUsers,
            adoptionRate: units > 0 ? billsPaid / units : 0,
            propertyCount: propertyNames.size,
            establishedNar,
          };
        })
        .sort((a, b) => a.month.localeCompare(b.month));
    };
    const monthlyTotals = buildMonthlyTotals(inNetwork);

    // Per-entity monthly adoption rate for the Adoption Trend chart's per-entity lines
    // (Task 11). Grouped from inNetwork - the exact same row set monthlyTotals above is built
    // from - via groupRowsByPmc (Task 9's helper), one dimension finer. Deliberately sparse:
    // each entity's own residents/units are summed only from ITS OWN rows per month, so a
    // second entity that joined later naturally produces a shorter series here rather than a
    // fabricated 0% for months before it existed - renderAdoptionTrend aligns this against the
    // combined chart's own month axis and treats a missing month as a real gap. A single-PMC
    // report yields a 1-entry array, which the renderer's own "needs 2+" check keeps off the
    // chart, same discipline as Task 9's entityBreakdown and Task 10's entityYearlyData.
    // canonicalGroups, not groupRowsByPmc: canonical membership+order for every per-entity
    // consumer (see canonicalEntityNames above). For THIS consumer the two are identical by
    // construction - canonical IS derived from inNetwork - but it reads off the shared list so
    // nothing here can drift from the other two if the canonical rule ever changes.
    const entityMonthlyData = canonicalGroups(inNetwork).map(([name, rows]) => {
      const emMap = new Map<string, { billsPaid: number; units: number }>();
      for (const row of rows) {
        const existing = emMap.get(row.BP_MONTH) || { billsPaid: 0, units: 0 };
        existing.billsPaid += row.BILLS_PAID;
        existing.units += row.PROPERTY_UNIT_COUNT;
        emMap.set(row.BP_MONTH, existing);
      }
      const entityMonthly = Array.from(emMap.entries())
        .map(([month, { billsPaid, units }]) => ({ month, adoptionRate: units > 0 ? billsPaid / units : 0 }))
        .sort((a, b) => a.month.localeCompare(b.month));
      return { pmcName: name, monthly: entityMonthly };
    });

    // Per-entity monthly residents/units/rent for the Residents/Units/Rent view switcher
    // (Task 12: Combined-or-one-entity). Same source rows (inNetwork) and same groupRowsByPmc
    // helper as entityMonthlyData above - one more per-entity breakdown off the same grouping,
    // no new query. Kept sparse here (only months an entity actually has rows for) - the
    // renderer itself aligns each entity's series onto monthlyTotals' own month axis and fills
    // any gap as 0 (a single-select switcher shows one dataset at a time, so a stable shared
    // axis matters more here than the sparse-honest null gaps Adoption Trend's additive lines
    // use above).
    const residentsUnitsEntityMonthlyData = canonicalGroups(inNetwork).map(([name, rows]) => {
      const ruMap = new Map<string, { billsPaid: number; units: number; rentPaid: number }>();
      for (const row of rows) {
        const existing = ruMap.get(row.BP_MONTH) || { billsPaid: 0, units: 0, rentPaid: 0 };
        existing.billsPaid += row.BILLS_PAID;
        existing.units += row.PROPERTY_UNIT_COUNT;
        existing.rentPaid += row.RENT_PAID;
        ruMap.set(row.BP_MONTH, existing);
      }
      const monthly = Array.from(ruMap.entries())
        .map(([month, { billsPaid, units, rentPaid }]) => ({ month, billsPaid, units, rentPaid }))
        .sort((a, b) => a.month.localeCompare(b.month));
      return { pmcName: name, monthly };
    });

    // ── True first-time-payer counts (excluding win-backs) ──────────────────
    // Flask: pull_customer_monthly_signups() — customers whose first-ever payment
    // falls in that month. Overrides the simpler NEW_SIGNUPS_COUNT which includes
    // win-backs and property-level double-counting.
    // Applied from custSignupsResult (fetched in parallel above).
    try {
      const custSignupRows = await custSignupsPromise;
      const custSignupMap = new Map(custSignupRows.map((r) => [r.BP_MONTH, r.NEW_SIGNUPS_CUSTOMER]));
      for (const m of monthlyTotals) {
        const trueCount = custSignupMap.get(m.month);
        if (trueCount !== undefined) {
          m.newSignups = trueCount;
        }
      }
    } catch {
      // Fall back to property-level NEW_SIGNUPS_COUNT on query failure
    }

    // Latest completed month — the SINGLE definition, computed once from `inNetwork` up beside
    // reportingMonthStr (see latestCompletedMonthOf there for the rule and for what having had
    // two of these cost us live). This used to be a second, independent derivation off
    // monthlyTotals gated on billsPaid > 0, which disagreed with reportingMonthStr for 110
    // PMCs; the two are now the same value by construction, so the headline, latestRows, the
    // Exec Summary tiles and by_state can never date themselves differently from the retention
    // cohort, regionDetail or the geo cache again.
    const latestCompletedMonth = reportingMonthStr;

    // ── Quarter-adds cohorts for the "Q<N> <YYYY> adds" buttons on Adoption Trend + Residents/
    // Units & Rent (Kevin's ask 2026-09-09; spec: flex-pmc-reports docs/superpowers/specs/
    // 2026-09-09-quarter-adds-toggle-design.md; multi-quarter 2026-09-10: "can we show like q2
    // as well? even q1? that way we can see how everything is ramping" - Flask 333f372). The last
    // 3 completed CALENDAR quarters as of latestCompletedMonth, most recent first, one button per
    // quarter; cohort = inNetwork properties with ROLLOUT_MONTH inside it, their own rows from
    // rollout onward. Same per-month sums the two charts already aggregate (residents =
    // BILLS_PAID, PROPERTY_UNIT_COUNT, RENT_PAID; adoption = residents/units recomputed in the
    // renderer), over the same inNetwork rows, one combined series + one per entity via
    // groupRowsByPmc (entities with no adds simply don't appear). A quarter is dropped when (a)
    // its start month is earlier than the chart axis's first month - the cohort's rollout months
    // would be off-axis so its ramp can't be drawn (monthlyTotals IS the frame both renderers
    // plot), or (b) nothing rolled out in it. No new queries. Computed once here, before the
    // QBR/Expansion split, and passed as `quarters` to both renderers at both decks' call sites.
    // [] -> no buttons -> both renderers' output byte-identical to before.
    const quarterAxisMin = monthlyTotals.length > 0 ? monthlyTotals[0].month.slice(0, 7) : null;
    const quarters: QuarterAddsBlock[] = [];
    if (latestCompletedMonth) {
      for (const q of previousCalendarQuarters(latestCompletedMonth, 3)) {
        if (quarterAxisMin !== null && q.start.slice(0, 7) < quarterAxisMin) continue;
        const combined = buildQuarterAddsSeries(inNetwork, q);
        if (!combined) continue;
        const entities = canonicalGroups(inNetwork)
          .map(([name, rows]) => ({ pmcName: name, series: buildQuarterAddsSeries(rows, q) }))
          .filter((e): e is { pmcName: string; series: QuarterAddsSeries } => e.series != null);
        quarters.push({ quarter: q, combined, entities });
      }
    }

    // Resident-level rents for the "Flex For Everyone" rent-bucket slide's Last Month/All Time
    // toggle (Kevin's ask - Expansion's own "high_rent" case never got this; QBR's has had it
    // all along, as its own separate query further down used to fire unconditionally). Hoisted
    // here (first point latestCompletedMonth is available) and shared by both modes instead of
    // querying twice - both queries are scoped to a single subject PMC, no network-wide scan,
    // no UDF chain, same "safe to extend to Expansion" profile as regionDetailPromise above.
    const needsResidentRents = needsQBRQueries || deck_mode === "expansion";
    const ResidentRentSchema = z.object({ RESIDENT_AMOUNT_PAID: z.number() });
    const AlltimeResidentSchema = z.object({ RESIDENT_AMOUNT_PAID: z.number(), RESIDENT_TOTAL_PAID: z.number() });
    const [residentRentRows, alltimeResidentRows] = !needsResidentRents
      ? [[] as { RESIDENT_AMOUNT_PAID: number }[], [] as { RESIDENT_AMOUNT_PAID: number; RESIDENT_TOTAL_PAID: number }[]]
      : await Promise.all([
          ctx.integrations.snowflake_sso.query(
            `WITH scoped_props AS (
                SELECT PROPERTY_PUBLIC_ID, BP_MONTH
                FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
                WHERE PMC_NAME IN (${allPmcNames.map(() => "?").join(", ")})
                  AND IS_IN_NETWORK = TRUE
             ),
             latest AS (
                -- NAR_CHARGED_USERS lags PROPERTY_BP_MONTH_STATS's own BILLS_PAID_COUNT — a
                -- month can already show as "completed" (bills paid > 0) before this table has
                -- been populated for it. Requiring an exact match on latestCompletedMonth here
                -- silently returned zero resident rows, which fell back to inflated property-
                -- level totals. Mirrors Flask's pull_resident_detail (generator/data.py:3317-
                -- 3327) exactly: the real "latest" for THIS table is whichever month it
                -- actually has data joined for.
                SELECT MAX(p.BP_MONTH) AS BP_MONTH
                FROM scoped_props p
                JOIN PRODUCTION.ANALYTICS.NAR_CHARGED_USERS n
                   ON n.PROPERTY_PUBLIC_ID = p.PROPERTY_PUBLIC_ID AND n.BP_MONTH = p.BP_MONTH
                WHERE n.HAS_BILL_PAID = TRUE AND p.BP_MONTH <= ?
             )
             SELECT n.RENT_AMOUNT AS RESIDENT_AMOUNT_PAID
             FROM scoped_props p
             JOIN PRODUCTION.ANALYTICS.NAR_CHARGED_USERS n
               ON n.PROPERTY_PUBLIC_ID = p.PROPERTY_PUBLIC_ID AND n.BP_MONTH = p.BP_MONTH
             WHERE p.BP_MONTH = (SELECT BP_MONTH FROM latest)
               AND n.HAS_BILL_PAID = TRUE
             LIMIT 50000`,
            ResidentRentSchema,
            [...allPmcNames, latestCompletedMonth],
            { label: "Pull resident-level rents for rent bucket slide (last month)" }
          ).catch(() => [] as { RESIDENT_AMOUNT_PAID: number }[]),
          ctx.integrations.snowflake_sso.query(
            `WITH active_props AS (
                -- Only properties still IS_IN_NETWORK as of the latest completed month - mirrors
                -- Flask's _active_property_pmc_pairs scoping for this exact slide
                -- (generator/data.py:429, app.py:1501), which keeps All-Time honest by not
                -- counting a departed property's old residents/rent. Without this, All-Time
                -- silently included every property ever active under this PMC name, even ones
                -- since sold/transferred/taken off Flex - which is why Last Month matched
                -- between Flask and Clark but All-Time didn't (Kevin's catch).
                SELECT DISTINCT PROPERTY_PUBLIC_ID
                FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
                WHERE PMC_NAME IN (${allPmcNames.map(() => "?").join(", ")}) AND IS_IN_NETWORK = TRUE AND BP_MONTH = ?
             ),
             scoped_props AS (
                SELECT PROPERTY_PUBLIC_ID, BP_MONTH
                FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
                WHERE PMC_NAME IN (${allPmcNames.map(() => "?").join(", ")})
                  AND IS_IN_NETWORK = TRUE
                  AND BP_MONTH < ?
                  AND PROPERTY_PUBLIC_ID IN (SELECT PROPERTY_PUBLIC_ID FROM active_props)
             )
             SELECT
                AVG(n.RENT_AMOUNT)   AS RESIDENT_AMOUNT_PAID,
                SUM(n.RENT_AMOUNT)   AS RESIDENT_TOTAL_PAID
             FROM scoped_props p
             JOIN PRODUCTION.ANALYTICS.NAR_CHARGED_USERS n
               ON n.PROPERTY_PUBLIC_ID = p.PROPERTY_PUBLIC_ID AND n.BP_MONTH = p.BP_MONTH
             WHERE n.HAS_BILL_PAID = TRUE
             GROUP BY n.CUSTOMER_PUBLIC_ID
             LIMIT 50000`,
            AlltimeResidentSchema,
            [...allPmcNames, latestCompletedMonth, ...allPmcNames, cutoffStr],
            { label: "Pull all-time resident rent averages for rent bucket toggle" }
          ).catch(() => [] as { RESIDENT_AMOUNT_PAID: number; RESIDENT_TOTAL_PAID: number }[]),
        ]);
    const residentRents = residentRentRows.filter((r) => r.RESIDENT_AMOUNT_PAID > 0).map((r) => r.RESIDENT_AMOUNT_PAID);
    const alltimeResidentRents = alltimeResidentRows.filter((r) => r.RESIDENT_AMOUNT_PAID > 0).map((r) => ({
      amountPaid: r.RESIDENT_AMOUNT_PAID,
      totalPaid: r.RESIDENT_TOTAL_PAID,
    }));

    // Property snapshot for latest completed month
    const latestRows = inNetwork.filter((r) => r.BP_MONTH === latestCompletedMonth);
    // Compute cumulative rent & prev-month signups per property for appendix table
    const cumRentMap = new Map<string, number>();
    const prevSignupsMap = new Map<string, number>();
    const priorMonthStr = monthlyTotals.length >= 2
      ? [...monthlyTotals].sort((a, b) => a.month.localeCompare(b.month)).slice(-2)[0]?.month
      : null;
    // Compute T12 connections per property (sum of NEW_BILL_CONNECTIONS over trailing 12 months)
    const t12ConnMap = new Map<string, number>();
    const t12RefDate = latestCompletedMonth ? new Date(latestCompletedMonth) : today;
    const t12CutoffDate = new Date(t12RefDate);
    t12CutoffDate.setMonth(t12CutoffDate.getMonth() - 12);
    const t12CutoffStr = t12CutoffDate.toISOString().slice(0, 10);
    for (const r of inNetwork) {
      const propKey = `${r.PMC_NAME}||${r.PROPERTY_NAME}`;
      cumRentMap.set(propKey, (cumRentMap.get(propKey) ?? 0) + r.RENT_PAID);
      if (priorMonthStr && r.BP_MONTH === priorMonthStr) {
        prevSignupsMap.set(propKey, r.NEW_SIGNUPS ?? 0);
      }
      // Sum T12 connections
      if (r.BP_MONTH >= t12CutoffStr) {
        t12ConnMap.set(propKey, (t12ConnMap.get(propKey) ?? 0) + r.NEW_BILL_CONNECTIONS);
      }
    }

    const propertySnapshot = latestRows
      .map((r) => {
        const monthsLive = r.ROLLOUT_MONTH && latestCompletedMonth
          ? ((new Date(latestCompletedMonth).getFullYear() - new Date(r.ROLLOUT_MONTH).getFullYear()) * 12
             + (new Date(latestCompletedMonth).getMonth() - new Date(r.ROLLOUT_MONTH).getMonth()))
          : 0;
        const avgRent = r.BILLS_PAID > 0 ? (r.RENT_PAID ?? 0) / r.BILLS_PAID : 0;
        const propKey = `${r.PMC_NAME}||${r.PROPERTY_NAME}`;
        return {
          propertyName: r.PROPERTY_NAME,
          // Additive (Kevin's ask: "in all props table bring in pmc name") - only
          // renderFullPropertyTable reads it, and only when the report combines 2+ PMCs.
          pmcName: r.PMC_NAME,
          units: r.PROPERTY_UNIT_COUNT,
          billsPaid: r.BILLS_PAID,
          newSignups: r.NEW_SIGNUPS ?? 0,
          prevSignups: prevSignupsMap.get(propKey) ?? 0,
          adoptionRate: r.PROPERTY_UNIT_COUNT > 0 ? r.BILLS_PAID / r.PROPERTY_UNIT_COUNT : 0,
          propertyState: r.PROPERTY_STATE ?? "",
          monthsLive,
          avgRent,
          rentPaid: r.RENT_PAID ?? 0,
          cumRent: cumRentMap.get(propKey) ?? (r.RENT_PAID ?? 0),
          rolloutMonth: r.ROLLOUT_MONTH ?? null,
          trendFlag: undefined as TrendFlag | undefined,
          t12EngPer100: r.PROPERTY_UNIT_COUNT > 0
            ? (t12ConnMap.get(propKey) ?? 0) / r.PROPERTY_UNIT_COUNT * 100
            : 0,
          hasMarketingIntegration: r.HAS_MARKETING_INTEGRATION ?? false,
          isMarketingOptIn: r.IS_MARKETING_OPT_IN ?? false,
          peerNar: undefined as number | null | undefined,
          peerNarCriteria: undefined as string | undefined,
          peerNarCount: undefined as number | undefined,
          peerEng: undefined as number | null | undefined,
          peerEngCriteria: undefined as string | undefined,
          peerEngCount: undefined as number | undefined,
        };
      })
      .sort((a, b) => b.billsPaid - a.billsPaid);

    // --- Compute trend flags for property deep dive badges ---
    const trendFlagsMap = computePropertyTrendFlags(trendRawRows, cutoffStr);
    for (const p of propertySnapshot) {
      const flag = trendFlagsMap.get(p.propertyName);
      if (flag) p.trendFlag = flag;
    }

    // --- Per-property peer matching (geography + rent + age aware) ---
    const reportingMonthDate = latestCompletedMonth ? new Date(latestCompletedMonth) : new Date();
    // Reads from propertyPool (Flask's real pull_network_property_pool - dedicated, unsampled),
    // NOT networkPool (the PMC-level, sampled pool used for geo-tier matching) - see the full
    // comment on PROPERTY_POOL_SQL above for why those two can't share a source.
    const networkPoolProps: NetworkPoolProperty[] = propertyPool
      .filter((r) => r.PROPERTY_STATE && r.ROLLOUT_MONTH)
      .map((r) => {
        const rollout = new Date(r.ROLLOUT_MONTH!);
        const mLive = (reportingMonthDate.getFullYear() - rollout.getFullYear()) * 12
                      + (reportingMonthDate.getMonth() - rollout.getMonth());
        const billsPaid = r.BILLS_PAID_COUNT ?? 0;
        const t12Conn = r.T12_CONNECTIONS ?? 0;
        const avgRent = billsPaid > 0 ? (r.RENT_PAID_AMOUNT ?? 0) / billsPaid : 0;
        const nar = r.PROPERTY_UNIT_COUNT > 0 ? billsPaid / r.PROPERTY_UNIT_COUNT : 0;
        const t12EngPer100 = r.PROPERTY_UNIT_COUNT > 0 ? t12Conn / r.PROPERTY_UNIT_COUNT * 100 : 0;
        return {
          pmcName: r.PMC_NAME,
          propertyName: r.PROPERTY_NAME,
          propertyState: r.PROPERTY_STATE!,
          propertyUnitCount: r.PROPERTY_UNIT_COUNT,
          avgRent,
          billsPaid,
          monthsLive: mLive,
          nar,
          t12EngPer100,
          ageBucket: propertyAgeBucket(mLive),
          medianRenterIncome: r.MEDIAN_RENTER_INCOME,
        };
      })
      // Flask (generator/data.py:5062): _rent_ok = (bills_paid_count < 3) | (avg_rent between
      // 700 and 2500) - a property with too few payers to trust its avg_rent estimate isn't
      // excluded on that noise. This was previously checking avgRent === 0 as the bypass,
      // which is NOT equivalent: a property with 1-2 payers (nonzero avgRent, potentially an
      // outlier from so few payers) should also bypass the rent-band check but didn't, quietly
      // shrinking the pool relative to Flask's real population.
      .filter((p) => p.monthsLive >= 7 && (p.billsPaid < 3 || (p.avgRent >= 700 && p.avgRent <= 2500)));

    // Shared exclusion set for every peer-pool read below — on a combined multi-PMC report,
    // every named entity's own properties must be excluded, or one entity's properties
    // silently count as another combined entity's "peers." Flask's resolver uses this same
    // exclusion set for every tier, including its network-wide fallback tier — there's no
    // separately-scoped fallback query on the Flask side to fall out of sync with.
    const excludedPmcNames = allPmcNames;

    // Apply per-property peer matching
    // Gate mirrors buildEstablishedPool's (slide-renderers.ts) — 7+mo live, and either
    // >=10 units OR a genuine 0%-adoption laggard. Previously required units>=10
    // unconditionally, so small 0%-adoption properties could land in the "needs attention"
    // table (via buildEstablishedPool's looser gate) but never get a peer-median value —
    // exactly the laggard a PMC most needs a peer comparison for.
    if (networkPoolProps.length > 0) {
      for (const p of propertySnapshot) {
        if (!p.propertyState || p.monthsLive < 7) continue;
        if (!(p.adoptionRate === 0 || p.units >= 10)) continue;
        const subjectIncome = subjectIncomeByProperty.get(p.propertyName);
        const narResult = resolvePropertyPeerNar(p.propertyState, p.units, p.avgRent, p.monthsLive, excludedPmcNames, networkPoolProps, subjectIncome);
        if (narResult) {
          p.peerNar = narResult.p50;
          p.peerNarCriteria = narResult.criteria;
          p.peerNarCount = narResult.peerCount;
        }
        const engResult = resolvePropertyPeerEngagement(p.propertyState, p.units, p.avgRent, p.monthsLive, excludedPmcNames, networkPoolProps, subjectIncome);
        if (engResult) {
          p.peerEng = engResult.p50;
          p.peerEngCriteria = engResult.criteria;
          p.peerEngCount = engResult.peerCount;
        }
      }
    }

    // Fallback: properties without peer NAR get the network-wide P50 (same exclusion set as
    // the tiered matching above — this is not a distinct code path in Flask, just this tier's
    // own "network-wide" bucket, so it must exclude both named PMCs the same way every other
    // tier does)
    const networkNarValues = networkPoolProps
      .filter((p) => !excludedPmcNames.includes(p.pmcName) && p.nar > 0)
      .map((p) => p.nar)
      .sort((a, b) => a - b);
    const networkNarP50 = networkNarValues.length > 0
      ? networkNarValues[Math.floor(networkNarValues.length / 2)]
      : undefined;
    for (const p of propertySnapshot) {
      if (p.peerNar == null && networkNarP50 != null) {
        p.peerNar = networkNarP50;
        p.peerNarCriteria = "network-wide";
      }
    }

    // KPIs
    const earliestRollout = inNetwork
      .filter((r) => r.ROLLOUT_MONTH)
      .map((r) => r.ROLLOUT_MONTH!)
      .sort()[0] || null;

    // ── Partner Since: the EARLIER of the Salesforce closed-won opportunity date and the
    // guarded rollout date (rolloutDatePromise above), not just an "earlier wins" pick between
    // the opp date and the naive earliestRollout computed above from lookback-bounded data.
    // Salesforce opportunity/account data has a confirmed hard floor around mid-2020 (Flex's
    // HubSpot-to-Salesforce migration; pre-migration deal history didn't carry over — Bridge
    // PM's own SFDC account record wasn't created until 2020-07-14, and network-wide, dozens
    // of unrelated PMCs' "earliest opportunity" cluster in Aug-Dec 2020, a migration-backfill
    // signature, not organic sales activity). So for any partner whose real tenure predates
    // that boundary, the opportunity date alone is structurally incapable of being right, even
    // when a match exists — which is why this compares against rollout rather than only
    // falling back to it when no opportunity exists.
    //
    // This file previously took the opp date unconditionally when it existed, specifically to
    // avoid a different bug: a PMC that acquired/inherited a property with OLDER rollout
    // history (from a prior management company) having that inherited date win over its own
    // real, later partnership start. That concern was real, but the fix reached for was too
    // blunt — it assumed ANY rollout date earlier than the opp date must be an inherited
    // artifact, which isn't true. Confirmed directly against Bridge PM's own data: their
    // earliest guarded rollout date (2019-10-01, from "Allure") isn't an inherited artifact —
    // that property has 1,505 bills paid continuously from Oct 2019 through today. The real
    // signature of an inherited transfer date is a GAP between a property's rollout_month and
    // when its billing history under the current PMC's name actually begins — which
    // rolloutDatePromise's own guard (<=3 months) already filters for, making the blunt
    // "always trust the opp date" override unnecessary and, for any pre-2020 partner, wrong.
    let partnerSince = earliestRollout;
    try {
      const [launchRow] = await partnerSincePromise;
      const [rolloutRow] = await rolloutDatePromise;
      let oppDate = launchRow?.LAUNCH_MONTH ?? null;
      const guardedRollout = rolloutRow?.LAUNCH_MONTH ?? null;
      const firstBp = rolloutRow?.FIRST_BP ?? null;
      const floorBp = rolloutRow?.FLOOR_BP ?? null;
      // Stale-opp guard (Kevin's catch on Coast Property Management, 2026-09-10; Flask c2e2057):
      // the account had two "New Logo" opps closed-won Feb 2021 that never rolled out - zero BP
      // rows anywhere until a fresh New Logo in May 2026 and a Jun 2026 rollout - so
      // MIN(closed-won) printed "Partner since Feb 2021" on a partner five years younger than
      // that. Live count: 41 PMCs network-wide have their earliest closed-won opp > 12 months
      // before their first BP row (Doors, United Apartment Group, Skyline, Pratum, AD-West, 29th
      // Street ...) - a signed-but-never-launched or churned-and-re-signed deal in every case,
      // not a partnership. Rule: an opp date only counts when this scope's first BP row lands
      // within STALE_OPP_GAP_MONTHS after it. The floor check keeps the rule from firing on
      // genuinely old partners whose first BP row IS the table's own data floor (their history
      // predates the table, so the gap is the table's, not theirs).
      if (oppDate && firstBp && monthsAfter(oppDate, firstBp) > STALE_OPP_GAP_MONTHS && (!floorBp || firstBp > floorBp)) {
        oppDate = null;
      }
      if (oppDate && guardedRollout) {
        partnerSince = oppDate < guardedRollout ? oppDate : guardedRollout;
      } else {
        partnerSince = oppDate ?? guardedRollout ?? earliestRollout;
      }
      if (!oppDate && partnerSinceError) {
        console.warn(`[PMC Report] partner-since Salesforce query failed for ${pmc_name}: ${partnerSinceError}`);
      }
    } catch {
      // Fallback to rollout-date aggregate on Salesforce query failure
    }

    // PROPERTY_PUBLIC_ID, not PROPERTY_NAME. This is the portfolio property count behind the
    // Exec Summary tile and seven other slides, and the By State bars now sum to a public-id
    // count - so a name-based tile here would contradict the very slide it has to reconcile
    // with. property_name is NOT unique: two genuinely distinct properties can carry the same
    // name, and the name-based count silently collapsed them into one. Same `|| PROPERTY_NAME`
    // fallback renderStateBreakdown uses, row for row, so the two tie by construction. Flask's
    // compute_pmc_kpis has always counted property_public_id (generator/data.py:634).
    const uniqueProperties = new Set(latestRows.map((r) => r.PROPERTY_PUBLIC_ID || r.PROPERTY_NAME));

    const kpis = {
      pmcName: pmcDisplayName,
      reportingMonth: latestCompletedMonth,
      partnerSince,
      propertyCount: uniqueProperties.size,
      firstMonth: monthlyTotals.length > 0 ? monthlyTotals[0].month : null,
    };

    // --- Compute KPI slide data ---
    const latestIdx = monthlyTotals.findIndex((m) => m.month === latestCompletedMonth);
    const latestMonth = latestIdx >= 0 ? monthlyTotals[latestIdx] : null;
    // comparison_months: look back N months for delta (Flask: _cmp_idx = max(1, min(comparison_months, len-1)))
    const cmpIdx = Math.max(1, Math.min(comparison_months ?? 1, latestIdx));
    const prevMonth = latestIdx >= cmpIdx ? monthlyTotals[latestIdx - cmpIdx] : null;
    // Build "vs ..." label: show actual month name when comparison_months > 1. Suffixed "BP" so
    // the pill reads as a bill-pay-month comparison (Kevin: "just don't want to invite questions
    // of 'we're only 9 days into September'") - see the reporting-month labelling note near the
    // top of this file.
    let vsLabel = "vs last BP month";
    if (prevMonth) {
      const prevDate = new Date(prevMonth.month + "T00:00:00");
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      vsLabel = `vs ${monthNames[prevDate.getMonth()]} ${prevDate.getFullYear()} BP`;
    }
    const lifetimeRent = monthlyTotals.reduce((sum, m) => sum + m.rentPaid, 0);

    // --- Compute True Repeat Rate from PARTNER_REPORTING_CORE_METRICS ---
    // RELIABLE_REPEAT_RATE_MIN (Kevin's catch, live-verified against a real "100.0% of
    // eligible residents came back" hero stat on a small portfolio): this ratio is a real,
    // correctly-computed number that's still meaningless as a headline when the denominator is
    // tiny - 1 resident paying again out of 1 who paid last month is a genuine 100%, not a
    // real retention story. Same bug class as the rent-bucket/delinquency floors added this
    // session; this metric had none at all. Applied to BOTH sources below (this MoM fallback
    // and the cohort-derived value near retentionCohortRows), same threshold either way.
    const RELIABLE_REPEAT_RATE_MIN = 10;
    const latestMetrics = metricsRows.find((r) => r.BP_MONTH === latestCompletedMonth);
    let trueRepeatRate: number | null = null;
    if (latestMetrics && latestMetrics.BILLS_PAID_REPEAT != null && latestMetrics.BILLS_PAID_PREV_MONTH != null && latestMetrics.BILLS_PAID_PREV_MONTH >= RELIABLE_REPEAT_RATE_MIN) {
      trueRepeatRate = Math.min(1, latestMetrics.BILLS_PAID_REPEAT / latestMetrics.BILLS_PAID_PREV_MONTH);
    }

    // --- Compute DQ shielded for the exec-summary tile — windowed to lookback_months (the
    // report's own Full/Quarter/YTD period), not the full 13-month dqShieldedRows pulled above
    // (that stays wide on purpose so the Delinquency slide's own trend chart keeps its full
    // window). Used to always show a fixed 13-month figure regardless of the period the AE
    // picked (Kevin's catch). BP_MONTH is 'YYYY-MM-DD' — string comparison is chronological.
    //
    // Anchor to DQ's OWN latest month, not latestCompletedMonth (the main report's latest
    // month) — DQ_PROPERTY data lags 1 month behind BP_MONTH (see the Delinquency slide's
    // comment), so anchoring to latestCompletedMonth silently excluded the oldest real DQ row
    // (Kevin's catch: Delinquency slide said $530K, this tile said $487K — the $43K gap was
    // exactly one excluded month). Not relying on the query's own ORDER BY for which row is
    // latest — computed defensively via string max, same robustness as Flask's sort_values.
    const dqLatestMonth = dqShieldedRows.reduce<string | null>(
      (latest, r) => (r.BP_MONTH != null && (latest == null || r.BP_MONTH > latest) ? r.BP_MONTH : latest),
      null
    );
    const dqWindowedRows = (() => {
      if (dqLatestMonth == null) return [];
      const dqWindowStartDate = new Date(dqLatestMonth + "T00:00:00Z");
      dqWindowStartDate.setUTCMonth(dqWindowStartDate.getUTCMonth() - (lookback_months - 1));
      const dqWindowStart = dqWindowStartDate.toISOString().slice(0, 10);
      return dqShieldedRows.filter((r) => r.BP_MONTH != null && r.BP_MONTH >= dqWindowStart);
    })();
    const lifetimeDqShielded = dqWindowedRows.reduce((sum, r) => sum + (r.TOTAL_RENT_SHIELDED ?? 0), 0);

    // --- Segment NAR / HubSpot segment label — REMOVED (fabricated data source) ---
    // PARTNER_REPORTING_CORE_METRICS.HUBSPOT_COMPANY_SEGMENT / SEGMENT_NAR_AVG have zero
    // equivalent anywhere in Flask (confirmed via full-repo grep) — this table/columns don't
    // exist in real Snowflake. Every read site is migrated to the real geo/size/rent-matched
    // peer cohort (lockedPeers / canonicalPeerNarP50 / stageBenchmarksMap), which is already
    // sourced from real data (PROPERTY_BP_MONTH_STATS) - the Adoption Trend chart's
    // stage_benchmarks was the last holdout (Kevin's catch) and is now migrated too.
    // segmentNarAvg kept as an explicit null (not deleted) so its remaining `?? fallback`
    // read sites still resolve correctly; hubspotSegment had no remaining reader, removed.
    const segmentNarAvg: number | null = null;

    // Growth trend slides (residents_units/adoption_trend/cohort_overview) - unconditional for
    // Expansion now (Kevin's ask: bring in the inception slide, residents paying, and adoption
    // slide for every Expansion deck, not just SMB). Previously gated on is_smb (mode of
    // STATIC_PARENT_TEAM_NAME_OPPORTUNITY, aliased SEGMENT_TEAM) with a growth_slides
    // "auto"/"include"/"exclude" override; both the segment gate and the override input are
    // gone, so this is now a flat `true`. Kept as a named const (not inlined) since it's still
    // read by renderExecSummary's showSparklines below, to suppress the exec-tile sparklines
    // now that the full residents_units chart always renders on Expansion. QBR never reads this
    // at all (its own showSparklines branch is a hardcoded `false`), so this change is
    // Expansion-only.
    const showGrowthSlides = true;

    // Sparklines / period-comparison manual overrides (Kevin's ask) - null means "auto" (no
    // override; the existing derived default applies unchanged). Derived here, same reasoning
    // as showGrowthSlides above - needed before the execResult call further down.
    const sparklinesOverride = sparklines === "include" ? true : sparklines === "exclude" ? false : null;
    const periodComparisonOverride = period_comparison === "include" ? true : period_comparison === "exclude" ? false : null;

    // --- Auto-derive evidence_type from property-level avg rent ---
    // Python logic: median of per-property (rent_paid / bills_paid); if < $950 → "affordable"
    let evidence_type: "high_rent" | "affordable" = "high_rent";
    const propAvgRents = latestRows
      .filter((r) => r.BILLS_PAID > 0 && r.RENT_PAID > 0)
      .map((r) => r.RENT_PAID / r.BILLS_PAID);
    if (propAvgRents.length > 0) {
      const sorted = [...propAvgRents].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      if (median < 950) {
        evidence_type = "affordable";
      }
    }

    // --- Segment percentiles (multi-benchmark slide) + rolling peer median (adoption trend) ---
    // These two Snowflake round-trips are independent of each other — segment percentiles only
    // needs hubspotSegment/latestCompletedMonth, rolling peer median only needs
    // networkPoolProps/latestRows (via lockedPeers, computed below) — but were previously
    // awaited one at a time. Compute lockedPeers first (pure JS, no query), then fire both
    // queries together.
    // CRITICAL: Exclude the named PMC(s) from the peer pool to avoid self-contamination.
    // On a 2-PMC combined report, the second PMC's NAR would otherwise inflate the P50.
    let segmentPercentiles: { metric: string; p25: number; p50: number; p75: number; p90: number; p99: number; pmcValue: number | null; lowerIsBetter?: boolean }[] = [];
    let canonicalPeerNarP50: number | null = null;
    // P25/P75 companions to canonicalPeerNarP50, resolved from the SAME tier at the SAME time -
    // added alongside the tenure-cohort tier fix below so the Performance Benchmarks slide's
    // IQR band can never show a P25/P75 from a different (snapshot) distribution than its own
    // P50 (Kevin's catch: P50 updated to the real 4.8-4.9% tenure-matched value, but P25/P75
    // stayed at the old snapshot's 11.9%/17.0% - an impossible P25 > P50 ordering on screen).
    let canonicalPeerNarP25: number | null = null;
    let canonicalPeerNarP75: number | null = null;
    let rollingPeerMedianMap: Record<string, { p50: number; p25?: number; p75?: number }> = {};
    // Compute months since launch for benchmark resolution (used by peer median + adoption trend)
    let _msl = 0;
    if (earliestRollout && latestCompletedMonth) {
      const [ey, em] = earliestRollout.split("-").map(Number);
      const [ly, lm] = latestCompletedMonth.split("-").map(Number);
      _msl = (ly - ey) * 12 + (lm - em) + 1;
    }

    // --- Locked peers for rolling median (faithful port of Flask's pull_rolling_peer_median
    // Step A, generator/data.py:4043-4199 — pure JS tiered matching, no query) ---
    // Computed regardless of tenure — the rolling time-series median (below) is only useful
    // for established PMCs (>=36mo), but this cohort itself also backs the Peer Benchmarks
    // slide's snapshot percentiles for PMCs of any tenure, so it can't be gated on _msl.
    //
    // This used to be a "simplified Flask approach" that quietly dropped two real tiers (multi-
    // state overlap, region) and mislabeled two more: its "footprint" tiers never actually
    // checked footprint bucket (single/regional/multi/national) — they behaved exactly like
    // Flask's unconditional "none" tiers under a misleading "geographic footprint" label. That's
    // the direct cause of the peer-median line coming back close to, but not matching, Flask's
    // (14.6% vs 15.0%) — a materially different (if similar-looking) cohort. Now matches Flask's
    // real ladder tier-for-tier, in the same order, with the same thresholds.
    let lockedPeers: string[] = [];
    let lockedPeersCriteria = "comparable PMCs";
    // Platinum deck's peer pool (Flask opt_in_only, 22d7052): the ladder below still locks the
    // cohort on whole portfolios, but the rolling / tenure-cohort rate queries restrict to the
    // peers' IS_MARKETING_OPT_IN = TRUE properties, the criteria label is prefixed
    // "platinum peers · ", and the network-wide fallback is skipped (spec self-gate: no pool
    // rather than a network-wide rate). Only the Platinum deck flips this; every other deck
    // keeps the default pool and renders byte-identically.
    const peerOptInOnly = deck_mode === "platinum";
    // Peer-candidate profile for GEO-TIER matching - query fired at the very top of this
    // function (right after cutoffStr), not here, so it overlaps with the rows query and the
    // two query batches in between instead of adding its own sequential stage. See that
    // definition for the full "why this shape" explanation (geo-matching grain, the deliberate
    // Flask deviation on excluding the subject PMC, etc.) - unchanged, just relocated.
    const peerCandidateRows = await peerCandidateRowsPromise;

    // For Expansion decks, peer-match against the FULL TARGET portfolio size instead of the
    // current enrolled size when the target is larger — every slide in the deck must agree on
    // one peer group (Flask app.py:1608-1668, Kevin's call 2026-08-08/2026-08-19: "make clark
    // re derive full target portfolio to match flask"). Resolved here, before the peer-matching
    // ladder below runs (lockedPeers/segmentPercentiles/canonicalPeerNarP50/stageBenchmarksMap
    // all key off subjectUnits, set from this), rather than at the later expTotalPortfolio call
    // site — subjectPortfolioTotalPromise already fired at the top of this function, so
    // resolving it here costs nothing extra. Reused (not recomputed) at the later
    // expTotalPortfolio site. Declared at this scope (not inside the `if` below) so both sites
    // can see it.
    let expTotalPortfolioEarly: number | null = null;
    if (deck_mode === "expansion") {
      expTotalPortfolioEarly = total_portfolio_units || null;
      if (!expTotalPortfolioEarly) {
        const expPortfolioRows = await subjectPortfolioTotalPromise;
        const acctUnits = resolveSubjectPortfolioUnits(expPortfolioRows);
        expTotalPortfolioEarly = acctUnits > 0 ? acctUnits : (latestMonth?.units ?? 0);
      }
      // Region detail (Kevin's ask - Expansion's own "By State" slide never got QBR's DMA
      // sub-region drill-down). QBR awaits this inside its own needsQBRQueries batch further
      // down (unchanged); Expansion needs its own await since it never reaches that batch at
      // all - same hoisted promise either way, no duplicate query.
      regionDetail = await regionDetailPromise;
    }

    if (peerCandidateRows.length > 0) {
      // Step 1: Aggregate to PMC level for peer matching. avgRent is bills-weighted (summed
      // rent / summed bills) — matching Flask's per_pmc_totals (generator/data.py:4118-4121)
      // exactly.
      const pmcAgg = new Map<string, { totalUnits: number; totalRent: number; totalBills: number; stateCount: number }>();
      const pmcStateUnits = new Map<string, Map<string, number>>();
      for (const r of peerCandidateRows) {
        const units = r.UNITS ?? 0;
        const rent = r.RENT ?? 0;
        const bills = r.BILLS ?? 0;
        const existing = pmcAgg.get(r.PMC_NAME);
        if (!existing) {
          pmcAgg.set(r.PMC_NAME, { totalUnits: units, totalRent: rent, totalBills: bills, stateCount: 1 });
          pmcStateUnits.set(r.PMC_NAME, new Map([[r.PROPERTY_STATE, units]]));
        } else {
          existing.totalUnits += units;
          existing.totalRent += rent;
          existing.totalBills += bills;
          const su = pmcStateUnits.get(r.PMC_NAME)!;
          su.set(r.PROPERTY_STATE, (su.get(r.PROPERTY_STATE) ?? 0) + units);
        }
      }
      for (const [nm, su] of pmcStateUnits.entries()) {
        const agg = pmcAgg.get(nm);
        if (agg) agg.stateCount = su.size;
      }

      // Step 2: Subject's own profile — full per-state breakdown (needed for the overlap tier),
      // plus the same >=35%/>=45% real-plurality gating Flask uses for primaryState/dominantRegion
      // instead of an unconditional max() (a subject genuinely split ~35/35/30 across 3 states
      // has no real single-state identity and should fall through to region/footprint, not get
      // matched to peers who happen to share its barely-largest state).
      const enrolledUnitsForMatching = latestRows.reduce((s, r) => s + r.PROPERTY_UNIT_COUNT, 0);
      // Use the target portfolio size (resolved above) instead of the current enrolled size
      // when it's larger — see the comment at expTotalPortfolioEarly's declaration above.
      const subjectUnits = (expTotalPortfolioEarly != null && expTotalPortfolioEarly > enrolledUnitsForMatching)
        ? expTotalPortfolioEarly
        : enrolledUnitsForMatching;
      const subjectBills = latestRows.reduce((s, r) => s + r.BILLS_PAID, 0);
      const subjectRent = latestRows.reduce((s, r) => s + r.RENT_PAID, 0);
      const subjectAvgRent = subjectBills > 0 ? subjectRent / subjectBills : 0;
      const subjectStateUnits = new Map<string, number>();
      for (const r of latestRows) {
        if (r.PROPERTY_STATE) subjectStateUnits.set(r.PROPERTY_STATE, (subjectStateUnits.get(r.PROPERTY_STATE) ?? 0) + r.PROPERTY_UNIT_COUNT);
      }
      const primaryState = primaryStateIfDominant(subjectStateUnits);
      const dominantRegionName = dominantRegion(subjectStateUnits);
      const fpTarget = fpBucket(subjectStateUnits.size);

      interface PeerCandidate { name: string; totalUnits: number; avgRent: number; stateUnits: Map<string, number>; stateCount: number }
      const candidates: PeerCandidate[] = [];
      for (const [nm, agg] of pmcAgg) {
        candidates.push({
          name: nm,
          totalUnits: agg.totalUnits,
          avgRent: agg.totalBills > 0 ? agg.totalRent / agg.totalBills : 0,
          stateUnits: pmcStateUnits.get(nm) ?? new Map(),
          stateCount: agg.stateCount,
        });
      }

      // Step A1: multi-state overlap tier, tried BEFORE the dominant-state/region/footprint
      // ladder below — Flask's _resolve_geo_tier (generator/data.py:1341), see resolveGeoTier's
      // own comment for why this exists separately from the tiers it doesn't replace.
      if (subjectStateUnits.size > 0) {
        const overlap = resolveGeoTier(candidates, subjectStateUnits, 3);
        if (overlap.isOverlap) {
          let pool = overlap.matched;
          // Size-match on each candidate's units WITHIN the overlapping states (not their whole
          // portfolio) — a national operator can be far larger overall while genuinely comparable
          // in scale just within these states. Uses the SAME overlap-units figure resolveGeoTier
          // already computed internally; recomputed here identically since it isn't returned.
          const subjectStates = new Set([...subjectStateUnits.keys()]);
          const overlapUnitsOf = (su: Map<string, number>) => {
            let s = 0;
            for (const [st, u] of su) if (subjectStates.has(st)) s += u;
            return s;
          };
          pool = pool.filter((c) => {
            const ov = overlapUnitsOf(c.stateUnits);
            return ov >= subjectUnits * 0.60 && ov <= subjectUnits * 1.40;
          });
          if (pool.length >= 3) {
            if (subjectAvgRent > 0) {
              const rentSub = pool.filter((c) => c.avgRent >= subjectAvgRent * 0.70 && c.avgRent <= subjectAvgRent * 1.30);
              if (rentSub.length >= 3) pool = rentSub;
            }
            if (pool.length >= 3) {
              lockedPeers = pool.map((c) => c.name);
              lockedPeersCriteria = overlap.label;
            }
          }
        }
      }

      // Step A2: dominant-state -> region -> footprint -> none ladder, same order and
      // thresholds as Flask's `tiers` list (generator/data.py:4168-4181).
      if (lockedPeers.length === 0) {
        interface Tier { kind: "state" | "region" | "footprint" | "none"; lowMult: number; highMult: number; useRent: boolean; minPeers: number; label: string }
        const tiers: Tier[] = [];
        if (primaryState) {
          tiers.push({ kind: "state", lowMult: 0.60, highMult: 1.40, useRent: true, minPeers: 3, label: `same state (${primaryState}), comparable size & avg rent` });
        }
        if (dominantRegionName) {
          tiers.push({ kind: "region", lowMult: 0.60, highMult: 1.40, useRent: true, minPeers: 5, label: `${dominantRegionName} region, comparable size & avg rent` });
        }
        tiers.push(
          { kind: "footprint", lowMult: 0.65, highMult: 1.35, useRent: true, minPeers: 5, label: "geographic footprint, comparable size & avg rent" },
          { kind: "footprint", lowMult: 0.60, highMult: 1.40, useRent: true, minPeers: 3, label: "geographic footprint, comparable size & avg rent" },
          { kind: "footprint", lowMult: 0.30, highMult: 1.70, useRent: false, minPeers: 5, label: "geographic footprint & comparable size" },
          { kind: "none", lowMult: 0.30, highMult: 1.70, useRent: true, minPeers: 5, label: "comparable size & avg rent" },
          { kind: "none", lowMult: 0.30, highMult: 1.70, useRent: false, minPeers: 5, label: "comparable size" },
          { kind: "none", lowMult: 0.30, highMult: 1.70, useRent: false, minPeers: 3, label: "comparable size" },
        );

        for (const tier of tiers) {
          if (tier.useRent && subjectAvgRent <= 0) continue; // Flask: can't apply a rent band without the subject's own avg_rent
          let pool = candidates.filter((c) => c.totalUnits >= subjectUnits * tier.lowMult && c.totalUnits <= subjectUnits * tier.highMult);
          if (tier.kind === "state") pool = pool.filter((c) => primaryStateIfDominant(c.stateUnits) === primaryState);
          else if (tier.kind === "region") pool = pool.filter((c) => dominantRegion(c.stateUnits) === dominantRegionName);
          else if (tier.kind === "footprint") pool = pool.filter((c) => fpBucket(c.stateCount) === fpTarget);
          if (tier.useRent) pool = pool.filter((c) => c.avgRent >= subjectAvgRent * 0.70 && c.avgRent <= subjectAvgRent * 1.30);
          if (pool.length >= tier.minPeers) {
            lockedPeers = pool.map((c) => c.name);
            lockedPeersCriteria = tier.label;
            break;
          }
        }

        // Step A3: "largest PMCs on Flex" rung (Kevin's call, 2026-09-09) - tried only after
        // every size-matched tier above came up empty, and only when they failed because the
        // subject outsizes the network (see largestPmcsPeerTier). Sets the same lockedPeers /
        // lockedPeersCriteria every downstream peer path reads (rolling calendar-time median,
        // tenure-cohort stageBenchmarksMap, Peer Benchmarks snapshot), so the Adoption Trend
        // legend and the Peer Benchmarks slide both say "largest PMCs on Flex". If even this
        // can't seat its min peers, lockedPeers stays empty and the existing network-wide
        // fallback below is unchanged.
        if (lockedPeers.length === 0) {
          const largest = largestPmcsPeerTier(candidates, subjectUnits, { minPeers: 5 });
          if (largest) {
            lockedPeers = largest.peers.map((c) => c.name);
            lockedPeersCriteria = largest.label;
          }
        }
      }
    }
    // "platinum peers · <criteria>" once the cohort is locked (Flask prefixes locked_criteria /
    // every tier label the same way); no cohort -> nothing to label.
    if (lockedPeers.length > 0) lockedPeersCriteria = peerCriteriaLabel(lockedPeersCriteria, peerOptInOnly);

    // P25/P75 added alongside the existing SMOOTHED_NAR (Kevin's catch: an established
    // (>=36mo) PMC's Peer Benchmarks slide could show a P50 from this rolling tier while
    // P25/P75 stayed stuck on whatever tier 2/3 set them to, producing an impossible
    // P75 < P50 ordering on screen when the two tiers' distributions didn't line up).
    const RollingPeerSchema = z.object({
      BP_MONTH: z.string(),
      SMOOTHED_NAR: z.number().nullable(),
      P25: z.number().nullable(),
      P75: z.number().nullable(),
    });
    const StageBenchmarkQuerySchema = z.object({
      MONTH_NUMBER: z.number(),
      P25: z.number().nullable(),
      P50: z.number().nullable(),
      P75: z.number().nullable(),
      PMC_COUNT: z.number(),
    });

    // Peer-Benchmarks percentiles — real formulas ported from Flask's `_run_supplemental_
    // benchmark` (generator/data.py:1920-2093), scoped to the SAME geo/size/rent-matched
    // `lockedPeers` cohort NAR uses (matching app.py's "canonical supplemental recompute",
    // app.py:1400-1421, which re-runs this exact query against the canonical peer list rather
    // than an independent segment). Replaces the fabricated PARTNER_REPORTING_CORE_METRICS /
    // HUBSPOT_COMPANY_SEGMENT read (that table+columns have zero Flask equivalent — confirmed
    // via full-repo grep). PMC_VALUE (the subject's own dot) is left NULL here and overridden
    // in JS below from values already computed elsewhere in this pipeline, so there's one
    // source of truth per metric instead of a second, divergent calculation.
    const segPercPromise = (lockedPeers.length >= 3 && latestCompletedMonth)
      ? ctx.integrations.snowflake_sso.query(
        `WITH peer_latest AS (
           SELECT PMC_NAME, MAX(BP_MONTH) AS BP_MONTH
           FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
           WHERE PMC_NAME IN (${lockedPeers.map(() => "?").join(", ")})
             AND BP_MONTH <= ?
             AND IS_INTEGRATED_TOTAL = TRUE
           GROUP BY PMC_NAME
         ),
         peer_current AS (
           SELECT t.PMC_NAME,
                  SUM(t.PROPERTY_UNIT_COUNT) AS UNITS,
                  SUM(t.CHARGED_USERS_COUNT) AS CHARGED_USERS
           FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
           JOIN peer_latest pl ON t.PMC_NAME = pl.PMC_NAME AND t.BP_MONTH = pl.BP_MONTH
           WHERE t.IS_INTEGRATED_TOTAL = TRUE
           GROUP BY t.PMC_NAME
         ),
         -- Portfolio Penetration's own peer CTE, kept separate from peer_current above.
         -- Flask's real peer_penetration CTE (generator/data.py:2035-2043) deliberately has
         -- NO IS_INTEGRATED_TOTAL filter - only HUBSPOT_DEAL_TOTAL_COMPANY_UNITS > 0. Reusing
         -- peer_current here (an earlier version of this query did) silently added that filter
         -- back in, which pulled in a different (smaller) peer distribution than Flask's -
         -- confirmed live: Flask P50/P75 = 46%/87%, ours = 80%/116% on an otherwise-identical
         -- peer cohort (other metrics' P50s matched almost exactly). Still uses peer_latest's
         -- per-peer join (not Flask's exact single-calendar-month BP_MONTH = rpt_str match) to
         -- avoid the stub-month bug fixed elsewhere in this file - that part of the deviation
         -- is intentional and unrelated to this fix.
         peer_penetration AS (
           -- Capped at 100% (LEAST(1.0, ...)) for the same reason Flask caps the SUBJECT's own
           -- displayed value (generator/data.py:2414-2416): HUBSPOT_DEAL_TOTAL_COMPANY_UNITS is
           -- a noisy per-deal snapshot that can understate a peer's true company size, which
           -- would otherwise show an impossible >100% "penetration" for that one peer and drag
           -- the whole P25/P50/P75 band with it (confirmed live: P75 showed 116%). Flask itself
           -- doesn't cap this on the peer side (only the subject's), but there's no principled
           -- reason a peer's noisy artifact should be allowed to distort the comparison band
           -- when the subject's own identical artifact isn't - same clamp pattern already used
           -- for peer_repeat's rate just below.
           SELECT t.PMC_NAME,
                  LEAST(1.0, SUM(t.PROPERTY_UNIT_COUNT) / NULLIF(MAX(t.HUBSPOT_DEAL_TOTAL_COMPANY_UNITS), 0)) AS PEN_RATE
           FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
           JOIN peer_latest pl ON t.PMC_NAME = pl.PMC_NAME AND t.BP_MONTH = pl.BP_MONTH
           WHERE t.HUBSPOT_DEAL_TOTAL_COMPANY_UNITS > 0
           GROUP BY t.PMC_NAME
         ),
         peer_engagement AS (
           SELECT t.PMC_NAME,
                  SUM(t.NEW_BILL_CONNECTIONS_PROPERTY) / NULLIF(pc.UNITS, 0) * 100 AS ENG_PER_100
           FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
           JOIN peer_current pc ON t.PMC_NAME = pc.PMC_NAME
           WHERE t.BP_MONTH BETWEEN DATEADD('month', -11, ?::DATE) AND ?
             AND t.IS_INTEGRATED_TOTAL = TRUE
           GROUP BY t.PMC_NAME, pc.UNITS
         ),
         peer_repeat AS (
           SELECT t.PMC_NAME,
                  AVG(LEAST(1.0, GREATEST(0.0,
                      (t.CHARGED_USERS_COUNT - t.NEW_SIGNUPS_COUNT)::FLOAT
                      / NULLIF(t.PREVIOUS_MONTH_CHARGED_USERS_COUNT, 0)
                  ))) AS REPEAT_RATE
           FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
           JOIN peer_current pc ON t.PMC_NAME = pc.PMC_NAME
           WHERE t.BP_MONTH BETWEEN DATEADD('month', -11, ?::DATE) AND ?
             AND t.PREVIOUS_MONTH_CHARGED_USERS_COUNT > 0
           GROUP BY t.PMC_NAME
         ),
         -- Time to First Sign-Up: avg DAYS (not months - Kevin's catch, see subjectSignupTimingValue
         -- above for the full reasoning) from a property's rollout to its first NEW BILL
         -- CONNECTION (not first payment). A bill connection is the "expressed interest /
         -- opted in" event -- a real signal distinct from payment, and NOT gated by the BP
         -- billing cycle the way payment is. RENTERS (resident-level, real timestamps) replaces
         -- PROPERTY_BP_MONTH_STATS (BP_MONTH granularity only) as the data source here, same as
         -- the subject-side query. BILL_CONNECTED_AT_UTC >= rollout date excludes residents who
         -- carry a connection timestamp from an earlier Flex-connected property - confirmed real
         -- necessary guard, not defensive-only (see subjectSignupTimingRows' query comment).
         signup_timing AS (
            -- Scoped to properties rolled out in the trailing 12 months, not a PMC's entire
            -- history -- Wellington joined 5 years ago, so a lifetime average would be
            -- dominated by rollouts from years back and say nothing about how fast marketing/
            -- ops get NEW properties live today. Matches the same trailing-12mo window every
            -- other metric on this slide (Engagement, Repeat Rate) already uses, for the same
            -- "how do things look now" reason.
            SELECT
               RESIDENT_PMC_NAME AS PMC_NAME,
               RESIDENT_PROPERTY_NAME AS PROPERTY_NAME,
               RESIDENT_PROPERTY_ROLLOUT_DATE AS ROLLOUT_DATE,
               MIN(BILL_CONNECTED_AT_UTC) AS FIRST_CONNECTED_AT
            FROM PRODUCTION.ANALYTICS.RENTERS
            WHERE RESIDENT_PMC_NAME IN (${lockedPeers.map(() => "?").join(", ")})
              AND RESIDENT_PROPERTY_ROLLOUT_DATE IS NOT NULL
              AND RESIDENT_PROPERTY_ROLLOUT_DATE >= DATEADD('month', -12, ?::DATE)
              AND RESIDENT_PROPERTY_ROLLOUT_DATE < ?::DATE
              AND BILL_CONNECTED_AT_UTC IS NOT NULL
              AND BILL_CONNECTED_AT_UTC >= RESIDENT_PROPERTY_ROLLOUT_DATE::TIMESTAMP_NTZ
            GROUP BY RESIDENT_PMC_NAME, RESIDENT_PROPERTY_NAME, RESIDENT_PROPERTY_ROLLOUT_DATE
         ),
         signup_timing_pmc AS (
            SELECT PMC_NAME, AVG(DATEDIFF('day', ROLLOUT_DATE, FIRST_CONNECTED_AT)) AS AVG_DAYS_TO_SIGNUP
            FROM signup_timing
            GROUP BY PMC_NAME
         )
         SELECT 'NAR' AS METRIC,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY CHARGED_USERS / NULLIF(UNITS, 0)) AS P25,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY CHARGED_USERS / NULLIF(UNITS, 0)) AS P50,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY CHARGED_USERS / NULLIF(UNITS, 0)) AS P75,
                NULL AS P90, NULL AS P99, NULL AS PMC_VALUE
         FROM peer_current
         WHERE UNITS > 0
         UNION ALL
         SELECT 'REPEAT_RATE' AS METRIC,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY REPEAT_RATE) AS P25,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY REPEAT_RATE) AS P50,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY REPEAT_RATE) AS P75,
                NULL AS P90, NULL AS P99, NULL AS PMC_VALUE
         FROM peer_repeat
         UNION ALL
         SELECT 'NEW_CONNECTIONS' AS METRIC,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ENG_PER_100) AS P25,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ENG_PER_100) AS P50,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ENG_PER_100) AS P75,
                NULL AS P90, NULL AS P99, NULL AS PMC_VALUE
         FROM peer_engagement
         WHERE ENG_PER_100 IS NOT NULL
         UNION ALL
         SELECT 'SIGNUP_TIMING' AS METRIC,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY AVG_DAYS_TO_SIGNUP) AS P25,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY AVG_DAYS_TO_SIGNUP) AS P50,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY AVG_DAYS_TO_SIGNUP) AS P75,
                NULL AS P90, NULL AS P99, NULL AS PMC_VALUE
         FROM signup_timing_pmc
         UNION ALL
         SELECT 'PENETRATION' AS METRIC,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY PEN_RATE) AS P25,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY PEN_RATE) AS P50,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY PEN_RATE) AS P75,
                NULL AS P90, NULL AS P99, NULL AS PMC_VALUE
         FROM peer_penetration`,
        SegmentPercentilesSchema,
        [
          ...lockedPeers, latestCompletedMonth, latestCompletedMonth, latestCompletedMonth, latestCompletedMonth, latestCompletedMonth,
          ...lockedPeers, cutoffStr, cutoffStr,
        ],
        { label: "Compute peer-cohort P25/P50/P75 for multi-benchmark (real cohort, not a segment table)" }
      ).catch((err) => { console.error("[PERC QUERY FAILED]", String(err)); return [] as z.infer<typeof SegmentPercentilesSchema>[]; })
      : Promise.resolve([] as z.infer<typeof SegmentPercentilesSchema>[]);

    // SQL text lives in peer-matching.ts (rollingPeerMedianSql) - extracted verbatim so the
    // Platinum deck's optInOnly variant and this default share one builder; default output is
    // byte-identical to the previously inlined string.
    const rollingPromise = (lockedPeers.length >= 3)
      ? ctx.integrations.snowflake_sso.query(
        rollingPeerMedianSql(lockedPeers, lookback_months, { optInOnly: peerOptInOnly }),
        RollingPeerSchema,
        [...lockedPeers, cutoffStr, cutoffStr, lookback_months, cutoffStr, cutoffStr],
        { label: "Rolling peer median NAR (per-month P25/P50/P75 from locked peers)" }
      ).catch((err) => { console.error("[ROLLING QUERY FAILED]", String(err)); return [] as z.infer<typeof RollingPeerSchema>[]; })
      : Promise.resolve([] as z.infer<typeof RollingPeerSchema>[]);

    // Tenure-cohort benchmark for the Adoption Trend chart (months-since-launch 1-36), for PMCs
    // below the 36mo "established" threshold where rollingPromise above doesn't apply. Replaces
    // a stage_benchmarks construction that read PARTNER_REPORTING_CORE_METRICS.SEGMENT_NAR_AVG -
    // a column explicitly flagged elsewhere in this file as having no real Flask equivalent
    // ("fabricated data source"). Confirmed real: it produced 8.9% (wrong direction: "below
    // peer median") where Flask's real tenure-matched benchmark showed 4.8% ("1.6x above"), for
    // the same PMC, same report - and it dropped the most recent 1-2 months whenever that table
    // happened to have a null there, which is why the dashed line never reached the current
    // month. This scopes to the SAME already-resolved, geo/size/rent-matched `lockedPeers`
    // cohort every other slide in this deck uses (Peer Benchmarks, canonicalPeerNarP50) rather
    // than independently re-deriving Flask's separate stage-tier ladder (_pull_stage_benchmarks,
    // generator/data.py:2524) from scratch - internally consistent with the rest of this deck,
    // even if the resulting peer SET can differ in count from Flask's own separately-resolved
    // tenure tier. Mirrors Flask's real monthly_nar/monthly_nar_smoothed CTEs exactly: each
    // peer's OWN adoption rate at their OWN months-since-launch, smoothed over their trailing 3
    // months of tenure before aggregating cross-sectionally, adoption_rate > 0 filter included
    // (Flask drops zero/null months from the curve itself, not just from display).
    // SQL text lives in peer-matching.ts (stageBenchmarkSql) - same extraction as rollingPromise.
    const stageBenchmarkPromise = (lockedPeers.length >= 3)
      ? ctx.integrations.snowflake_sso.query(
        stageBenchmarkSql(lockedPeers, { optInOnly: peerOptInOnly }),
        StageBenchmarkQuerySchema,
        [...lockedPeers, ...lockedPeers, cutoffStr],
        { label: "Tenure-cohort peer benchmark for Adoption Trend chart (locked peers, months-since-launch)" }
      ).catch((err) => { console.error("[STAGE BENCHMARK QUERY FAILED]", String(err)); return [] as z.infer<typeof StageBenchmarkQuerySchema>[]; })
      : Promise.resolve([] as z.infer<typeof StageBenchmarkQuerySchema>[]);

    // On-Time Payment Rate via CPT_OUTCOMES_SEMANTIC_VIEW was tried and pulled back out.
    // Querying that semantic view crashed the ENTIRE report generation ("Generation failed"),
    // not a graceful per-metric degradation the way every other optional query in this file
    // fails safely -- something about semantic-view queries hits a harder failure mode in
    // Superblocks' integration than a normal table query does, severe enough that the
    // .catch()-guarded promise wrapping it never even got the chance to run. Not safe to
    // re-attempt without confirming, outside this pipeline, that a SEMANTIC_VIEW()/AGG() query
    // against this integration can succeed at all -- reintroducing this blind risks breaking
    // report generation again.

    // Fire both independent round-trips together instead of one at a time
    const [percRows, rollingRows, stageBenchmarkRows] = await Promise.all([segPercPromise, rollingPromise, stageBenchmarkPromise]);

    // Build the tenure-bucketed benchmark map the Adoption Trend chart reads (kpis.stage_benchmarks).
    // peer_label matches lockedPeersCriteria - the SAME criteria string the Peer Benchmarks slide
    // shows, so the two never disagree on what "peer" means (this deck's whole reason for having
    // a canonical/locked peer cohort at all). pmc_count surfaces how many peers actually had data
    // at that specific bucket, shown alongside the label (Kevin's ask) - a bucket down to 2 peers
    // shouldn't read with the same confidence as one with 5.
    const stageBenchmarksMap: Record<number, { p25: number | null; p50: number | null; p75: number | null; peer_label?: string; pmc_count?: number }> = {};
    for (const row of stageBenchmarkRows) {
      if (row.P50 != null) {
        stageBenchmarksMap[row.MONTH_NUMBER] = { p25: row.P25, p50: row.P50, p75: row.P75, peer_label: lockedPeersCriteria, pmc_count: row.PMC_COUNT };
      }
    }

    // PMC_VALUE is always NULL from the query above (the subject is excluded from lockedPeers,
    // so it can't appear in its own peer-percentile query) — filled in from values already
    // computed elsewhere in this pipeline right below, one source of truth per metric.
    segmentPercentiles = percRows
      .filter((r) => r.P25 != null && r.P50 != null && r.P75 != null)
      .map((r) => ({
        metric: r.METRIC,
        p25: r.P25!,
        p50: r.P50!,
        p75: r.P75!,
        p90: r.P90 ?? r.P75! * 1.2,
        p99: r.P99 ?? r.P75! * 1.4,
        pmcValue: r.PMC_VALUE ?? 0,
      }));

    // TEMPORARY diagnostic — the engagement fix moved the number (42 -> 47) but in the wrong
    // direction relative to Flask's 33, meaning something in this new formula still doesn't
    // match. Hoisted so the debug panel below can show the actual intermediate values instead
    // of guessing again from the final result alone.
    let _engDebugTotalConnects: number | null = null;
    let _engDebugAvgUnits: number | null = null;
    let _engDebugMonthsFound: string[] = [];
    let _engDebugWindowStart = "";

    // Fill in the subject's own value per metric from real, already-computed data (not a
    // second/divergent calculation): NAR from the subject's latest-month adoption rate;
    // engagement from the subject's own trailing-12mo per-property T12_CONNECTIONS, matching
    // the peer query's units-weighted formula exactly; signup timing from trendRawRows (already
    // fetched for the property trend badges — reused here rather than a second query).
    {
      const subjectNarValue = latestMonth?.adoptionRate ?? null;
      // Flask (generator/data.py:2328-2338): trailing-12mo SUM of new bill connections across
      // ALL properties, divided by the AVERAGE monthly total unit count over that same window —
      // a network-wide ratio, NOT a unit-weighted average of each property's own individually-
      // computed rate (a different, non-equivalent aggregation: summing a ratio-of-ratios biases
      // toward smaller properties' individual rates in a way Flask's single network-wide ratio
      // doesn't). This was ALSO reading from networkPoolProps — the shared/filtered pool built
      // for peer-matching (months_live >= 7, avg rent $700-2500 band) — which silently excluded
      // some of the subject's OWN properties that don't happen to meet those PEER-comparability
      // filters.
      //
      // Second bug, found from the actual debug numbers (1319 connects / 2809.75 avg units =
      // 46.9, arithmetically correct but still the wrong INPUTS): Flask's df here comes from
      // pull_pmc_data (generator/data.py:170-228), whose SQL has NO IS_IN_NETWORK filter AT ALL
      // -- it pulls every property-month row for the PMC in the window regardless of network
      // status. inNetwork (this file's own filtered view) excludes OON/not-yet-integrated
      // property-months -- which Flask's calc does NOT exclude. Those OON months still add their
      // full unit count to the denominator while contributing near-zero bill connections,
      // diluting Flask's ratio downward relative to a version that properly excludes them (this
      // is why removing the filter moves the number DOWN toward Flask's, not up). allRows (the
      // unfiltered fetch inNetwork itself is filtered FROM) is the right source here, not
      // inNetwork -- no second query needed, already fetched.
      const engWindowStart = (() => {
        const [cy, cm] = cutoffStr.split("-").map(Number);
        return new Date(cy, cm - 1 - 12, 1).toISOString().slice(0, 10);
      })();
      const engUnitsByMonth = new Map<string, number>();
      let engTotalConnects = 0;
      for (const r of allRows) {
        if (r.BP_MONTH < engWindowStart || r.BP_MONTH >= cutoffStr) continue;
        engUnitsByMonth.set(r.BP_MONTH, (engUnitsByMonth.get(r.BP_MONTH) ?? 0) + r.PROPERTY_UNIT_COUNT);
        engTotalConnects += r.NEW_BILL_CONNECTIONS ?? 0;
      }
      const engAvgUnitsRecent = engUnitsByMonth.size > 0
        ? [...engUnitsByMonth.values()].reduce((s, v) => s + v, 0) / engUnitsByMonth.size
        : 0;
      const subjectEngValue = engAvgUnitsRecent > 0 ? engTotalConnects / engAvgUnitsRecent * 100 : null;
      _engDebugTotalConnects = engTotalConnects;
      _engDebugAvgUnits = engAvgUnitsRecent;
      _engDebugMonthsFound = [...engUnitsByMonth.keys()].sort();
      _engDebugWindowStart = engWindowStart;
      // Real days (not months) from rollout to first resident bill connection - subjectSignupTimingRows
      // is already scoped to the trailing 12 months and already excludes carried-over history
      // from a prior property (BILL_CONNECTED_AT_UTC >= rollout date, enforced in the query
      // itself). "Days" not "months" was Kevin's catch - a same-BP-month rollout+connection
      // used to always read as "0.0 months" regardless of whether that meant 1 day or 29.
      const subjectSignupTimingValue = (() => {
        const [cy, cm] = cutoffStr.split("-").map(Number);
        const daysList: number[] = [];
        let mostRecentContributingRollout: string | null = null;
        for (const r of subjectSignupTimingRows) {
          const rolloutMs = new Date(r.ROLLOUT_DATE + "T00:00:00Z").getTime();
          const connectedMs = new Date(r.FIRST_CONNECTED_AT.replace(" ", "T") + "Z").getTime();
          if (Number.isNaN(rolloutMs) || Number.isNaN(connectedMs)) continue;
          const days = Math.round((connectedMs - rolloutMs) / 86_400_000);
          daysList.push(Math.max(0, days));
          if (!mostRecentContributingRollout || r.ROLLOUT_DATE > mostRecentContributingRollout) {
            mostRecentContributingRollout = r.ROLLOUT_DATE;
          }
        }
        if (daysList.length === 0) return null;
        // Gate on recency (Kevin's catch): this metric measures whichever cohort happens to be
        // in the trailing-12mo window, which can be a single rollout from 10+ months ago -
        // stale data about how onboarding USED to go, not a live signal about how it's going
        // now. Only trust it if the most recent contributing rollout is itself within the
        // trailing 3 months - i.e. there's actually been a recent "class" to measure, not just
        // a wide lookback window catching something old.
        const recentEnoughCutoff = new Date(cy, cm - 1 - 3, 1).toISOString().slice(0, 10);
        if (!mostRecentContributingRollout || mostRecentContributingRollout < recentEnoughCutoff) {
          return null;
        }
        return daysList.reduce((s, v) => s + v, 0) / daysList.length;
      })();
      // Flask: pmc_penetration = min(enrolled_units / total_company_units, 1.0) — capped so a
      // stale/undersized total-company-units figure can't produce an impossible >100%.
      // total_company_units comes from the Salesforce-accounts query above, NOT
      // HUBSPOT_DEAL_TOTAL_COMPANY_UNITS (that field is a noisy per-deal snapshot Flask
      // explicitly avoids for this calc — see the query's comment above). If the Salesforce
      // query fails or the PMC has no matching account, Flask leaves pmc_penetration as None
      // rather than falling back to a different, less-trustworthy denominator — matched here
      // by leaving subjectPenetrationValue null instead of using the HubSpot field as a fallback.
      const subjectPortfolioRows = await subjectPortfolioTotalPromise;
      if (subjectPortfolioTotalError) {
        console.warn(`[PMC Report] subject portfolio-total Salesforce query failed for ${pmc_name}: ${subjectPortfolioTotalError}`);
      }
      const subjectTotalCompanyUnits = resolveSubjectPortfolioUnits(subjectPortfolioRows);
      // Numerator: latestMonth.units (IS_IN_NETWORK-filtered), NOT Flask's literal
      // current["property_unit_count"].sum() (unfiltered df, same missing-filter pattern as
      // the engagement bug fixed earlier). Verified live for Wellington: Flask's own SFDC
      // snapshot (ACCOUNT_TOTAL_COMPANY_UNITS / ACCOUNT_FLEX_UNITS = 4,300 / 2,992 = 69.6%)
      // reconciles almost exactly with this IS_IN_NETWORK-filtered number (68%), while Flask's
      // compute_benchmark() itself displays 94% - implying an enrolled-units numerator ~1,090
      // higher than Salesforce's own recorded figure, almost certainly non-in-network rows
      // leaking into Flask's unfiltered sum. Deliberately NOT matching Flask's literal
      // behavior here since it demonstrably drifts from ground truth; Flask's own
      // compute_benchmark should get the equivalent fix (scope current to IS_IN_NETWORK rows)
      // rather than this side chasing Flask's inflated number.
      const subjectPenetrationValue = subjectTotalCompanyUnits > 0
        ? Math.min((latestMonth?.units ?? 0) / subjectTotalCompanyUnits, 1.0)
        : null;
      segmentPercentiles = segmentPercentiles.map((m) => {
        if (m.metric === "NAR" && subjectNarValue != null) return { ...m, pmcValue: subjectNarValue };
        if (m.metric === "NEW_CONNECTIONS" && subjectEngValue != null) return { ...m, pmcValue: subjectEngValue };
        // lowerIsBetter: faster (fewer months) is the better outcome — see BenchmarkMetric's
        // own comment for why this has to be flagged explicitly on the metric object. pmcValue
        // stays null (not defaulted to 0) when there's no real trendRawRows data — the renderer
        // already hides a row whose pmcValue is null, and a 0-month fallback would display as
        // "instant," which is a misleading placeholder, not a real result.
        if (m.metric === "SIGNUP_TIMING") return { ...m, pmcValue: subjectSignupTimingValue, lowerIsBetter: true };
        if (m.metric === "PENETRATION") return { ...m, pmcValue: subjectPenetrationValue };
        return m;
      });
    }

    for (const row of rollingRows) {
      if (row.SMOOTHED_NAR != null) {
        rollingPeerMedianMap[row.BP_MONTH] = { p50: row.SMOOTHED_NAR, p25: row.P25 ?? undefined, p75: row.P75 ?? undefined };
      }
    }

    // --- Canonical Peer Benchmark (one resolved P50 NAR per deck) ---
    // Resolution order now mirrors Flask's resolve_canonical_benchmark EXACTLY
    // (generator/data.py:2126-2205) - the stage-bucket tier below was the missing piece
    // (previously "not yet ported... a known gap"), now that stageBenchmarksMap exists.
    //   1. Rolling calendar-time peer median (established PMCs, tenure >= 36 months) — real,
    //      time-series, from the SAME geo/size/rent-matched lockedPeers cohort.
    //   2. Tenure-cohort benchmark (nearest stage_benchmarks bucket to months_since_launch) -
    //      for PMCs under 36mo, or established PMCs whose rolling query came back empty.
    //   3. Snapshot P50 across lockedPeers (real, single-month) — only when neither above has
    //      data at all.
    // Every slide that shows a peer-median number MUST read from this single value. Confirmed
    // real, Kevin's catch: before this, Peer Benchmarks/QBR Close showed tier 3's snapshot
    // (11.8%) while the Adoption Trend chart showed the real tenure-matched curve (4.9%) for
    // the SAME PMC, same report - Flask's real function resolves both from the same value.
    {
      const narPerc = segmentPercentiles.find((s) => s.metric === "NAR");
      if (narPerc) {
        canonicalPeerNarP50 = narPerc.p50; // tier 3
        canonicalPeerNarP25 = narPerc.p25;
        canonicalPeerNarP75 = narPerc.p75;
      }

      // Tier 2: nearest tenure bucket to months_since_launch, mirroring Flask's
      // `min(stage_bmarks.keys(), key=lambda k: abs(k - months_since))` exactly. P25/P75 move
      // WITH P50 here, from the same bucket's same smoothed cross-sectional distribution -
      // never left behind pointing at tier 3's unrelated snapshot (Kevin's catch).
      if (Object.keys(stageBenchmarksMap).length > 0 && _msl > 0) {
        let nearestMn = -1;
        let nearestDist = Infinity;
        for (const mnStr of Object.keys(stageBenchmarksMap)) {
          const mn = Number(mnStr);
          const dist = Math.abs(mn - _msl);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestMn = mn;
          }
        }
        const nearestRow = nearestMn >= 0 ? stageBenchmarksMap[nearestMn] : undefined;
        if (nearestRow?.p50 != null) {
          canonicalPeerNarP50 = nearestRow.p50;
          canonicalPeerNarP25 = nearestRow.p25;
          canonicalPeerNarP75 = nearestRow.p75;
        }
      }

      // Tier 1 (highest priority): rolling calendar-time peer median - established PMCs
      // (>=36mo) only, matching Flask's msl_is_capped gate. Without this gate, a PMC under
      // 36mo with a stray non-empty rollingPeerMedianMap (e.g. the network-wide fallback a
      // few hundred lines up) would wrongly prefer calendar-time movement over the real
      // tenure-matched comparison for a PMC still in its ramp stage.
      // FIXED (Kevin's catch - Peer Benchmarks slide showing P75 < P50, an impossible
      // ordering): rollingPromise/RollingPeerSchema now computes P25/P75 alongside
      // SMOOTHED_NAR (P50) - all three come from this same tier's same smoothed
      // cross-sectional distribution, never a P50 from here left paired with P25/P75 still
      // pointing at tier 2/3's unrelated distribution.
      if (_msl >= 36 && rollingRows.length > 0) {
        const latestPeer = rollingRows[rollingRows.length - 1];
        if (latestPeer.SMOOTHED_NAR != null) {
          canonicalPeerNarP50 = latestPeer.SMOOTHED_NAR;
          if (latestPeer.P25 != null) canonicalPeerNarP25 = latestPeer.P25;
          if (latestPeer.P75 != null) canonicalPeerNarP75 = latestPeer.P75;
        }
      }
    }

    // Fallback: if tiered matching failed to produce per-month data, run a broader
    // network-wide rolling median (all PMCs except subject) to avoid a flat line. This one
    // stays sequential — it's a genuine fallback that only fires when the query above came
    // back empty, so it can't be fired in parallel with it. Not for the Platinum peer pool
    // (peerOptInOnly): Flask treats "All PMCs on Flex" as no pool there - the largest-PMCs rung
    // is the last acceptable tier, so the map simply stays empty.
    if (!peerOptInOnly && _msl >= 36 && networkPoolProps.length > 0 && Object.keys(rollingPeerMedianMap).length === 0) {
      try {
        const networkWideRolling = await ctx.integrations.snowflake_sso.query(
          `WITH peer_monthly AS (
              SELECT
                BP_MONTH,
                PMC_NAME,
                SUM(CHARGED_USERS_COUNT) / NULLIF(SUM(PROPERTY_UNIT_COUNT)::FLOAT, 0) AS nar
              FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
              -- Every combined entity is excluded, not just the primary (was "PMC_NAME != ?"
              -- bound to pmc_name alone - on a combined report the other entities' own NAR
              -- leaked into their "network-wide" peer median). Same exclusion set as
              -- peerCandidateSubjectPmcs / excludedPmcNames.
              WHERE PMC_NAME NOT IN (${allPmcNames.map(() => "?").join(", ")})
                AND IS_INTEGRATED_TOTAL = TRUE
                -- cutoffStr is exclusive (see peer_latest above) — BETWEEN's inclusive upper
                -- bound let this same query pick up the pre-created, not-yet-real stub month.
                AND BP_MONTH >= DATEADD('month', -${lookback_months + 3}, ?::DATE)
                AND BP_MONTH < ?
              GROUP BY BP_MONTH, PMC_NAME
              HAVING SUM(PROPERTY_UNIT_COUNT) >= 10
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
           HAVING COUNT(*) >= 10
           ORDER BY BP_MONTH`,
          RollingPeerSchema,
          [...allPmcNames, cutoffStr, cutoffStr, lookback_months, cutoffStr, cutoffStr],
          { label: "Network-wide rolling median NAR (fallback, P25/P50/P75)" }
        );
        for (const row of networkWideRolling) {
          if (row.SMOOTHED_NAR != null) {
            rollingPeerMedianMap[row.BP_MONTH] = { p50: row.SMOOTHED_NAR, p25: row.P25 ?? undefined, p75: row.P75 ?? undefined };
          }
        }
      } catch (_e2) {
        console.error("[NETWORK-WIDE ROLLING FAILED]", String(_e2));
        // If even the network-wide query fails, peer median line will be hidden
      }
    }

    // --- Compute cohort data ---
    const cohortMap = new Map<string, { propertyIds: Set<string>; totalUnits: number; currentResidents: number; currentRent: number }>();
    for (const r of latestRows) {
      if (!r.ROLLOUT_MONTH) continue;
      const existing = cohortMap.get(r.ROLLOUT_MONTH) || { propertyIds: new Set<string>(), totalUnits: 0, currentResidents: 0, currentRent: 0 };
      if (r.PROPERTY_PUBLIC_ID) existing.propertyIds.add(r.PROPERTY_PUBLIC_ID);
      existing.totalUnits += r.PROPERTY_UNIT_COUNT;
      existing.currentResidents += r.BILLS_PAID;
      existing.currentRent += r.RENT_PAID;
      cohortMap.set(r.ROLLOUT_MONTH, existing);
    }

    // Cumulative rent per cohort (sum of RENT_PAID across ALL months since rollout, not just current)
    const cohortCumRentMap = new Map<string, number>();
    for (const r of inNetwork) {
      if (!r.ROLLOUT_MONTH) continue;
      cohortCumRentMap.set(r.ROLLOUT_MONTH, (cohortCumRentMap.get(r.ROLLOUT_MONTH) ?? 0) + r.RENT_PAID);
    }

    const cohorts: CohortRow[] = Array.from(cohortMap.entries())
      .map(([rolloutMonth, c]) => ({
        rolloutMonth,
        propertyCount: c.propertyIds.size,
        totalUnits: c.totalUnits,
        currentResidents: c.currentResidents,
        currentRent: c.currentRent,
        cumulativeRent: cohortCumRentMap.get(rolloutMonth) ?? 0,
        cohortNar: c.totalUnits > 0 ? c.currentResidents / c.totalUnits : 0,
      }))
      .sort((a, b) => a.rolloutMonth.localeCompare(b.rolloutMonth));

    // --- Compute cohort monthly NAR for sparklines ---
    // For each cohort (by rollout_month), compute NAR per billing period
    const cohortMonthly = new Map<string, (number | null)[]>();
    // monthlyTotals is already sorted by month and carries exactly the aggregation's month keys.
    const sortedMonthKeys = monthlyTotals.map((m) => m.month);
    for (const [cohortRollout] of cohortMap.entries()) {
      const narValues: (number | null)[] = [];
      for (const bpMonth of sortedMonthKeys) {
        // Get rows for this cohort in this bp_month
        const cohortRows = inNetwork.filter(
          (r) => r.ROLLOUT_MONTH === cohortRollout && r.BP_MONTH === bpMonth
        );
        if (cohortRows.length === 0) {
          narValues.push(null);
        } else {
          const units = cohortRows.reduce((s, r) => s + r.PROPERTY_UNIT_COUNT, 0);
          const residents = cohortRows.reduce((s, r) => s + r.BILLS_PAID, 0);
          narValues.push(units > 0 ? residents / units : null);
        }
      }
      cohortMonthly.set(cohortRollout, narValues);
    }

    // --- Render slide blocks ---
    const totalUnitsAll = latestRows.reduce((s, r) => s + r.PROPERTY_UNIT_COUNT, 0);

    // Compute prevPropertyCount (distinct properties in the prev month)
    const prevMonthStr = prevMonth?.month ?? null;
    const prevPropertyCount = prevMonthStr
      ? new Set(inNetwork.filter((r) => r.BP_MONTH === prevMonthStr).map((r) => r.PROPERTY_NAME)).size
      : null;

    // Compute DQ shielded since comparison month (same cutoff as other tiles) — filtered from
    // the same lookback_months-windowed rows as lifetimeDqShielded above, not the raw pull.
    const comparisonMonth = prevMonth?.month ?? null;
    const dqSinceComparison = comparisonMonth
      ? dqWindowedRows
          .filter((r) => r.BP_MONTH != null && r.BP_MONTH! > comparisonMonth)
          .reduce((sum, r) => sum + (r.TOTAL_RENT_SHIELDED ?? 0), 0)
      : null;

    // Cohort-based true repeat rate (preferred over MoM aggregate — matches Flask). Gated on
    // TOTAL_CUSTOMERS (same RELIABLE_REPEAT_RATE_MIN floor as the MoM fallback above) - this is
    // the single, shared, gated source every downstream reader of the cohort repeat rate uses
    // (also feeds subjectRepeatValue and cohortTrueRepeatRate below), so the floor can't be
    // applied at one read site and forgotten at another.
    const cohortTrueRepeatEarly = (retentionCohortRows.length > 0 && (retentionCohortRows[0]?.TOTAL_CUSTOMERS ?? 0) >= RELIABLE_REPEAT_RATE_MIN)
      ? retentionCohortRows[0]?.TRUE_REPEAT_RATE ?? null
      : null;
    // ── True Repeat Rate: ONE value, read by every consumer ──────────────────────────────
    // The deck had two sources and four renderings of one fact: the Exec Summary tile read
    // `effectiveTrueRepeat` (cohort-preferred), QBR's close read its own local copy of the same
    // expression, Expansion's retention slide read a third copy, and
    // renderExpansionCaseClose was handed the BARE MoM fallback - so a single Expansion deck
    // could state one partner's repeat rate as two different numbers, on two slides, minutes
    // apart. Flask's answer (slides.py:76-106) is that the value is computed exactly once
    // beside the other kpis (_set_true_repeat_rate, app.py:748) and every renderer that STATES
    // the metric reads it through _repeat_rate / _repeat_rate_str - never recomputing, never
    // formatting it itself.
    //
    // This is that single source. Cohort-derived where it's reliable, MoM fallback otherwise
    // (both already gated on RELIABLE_REPEAT_RATE_MIN above), then Flask's _repeat_rate gate:
    // a non-positive value is not a real number to quote, so it becomes null and callers fall
    // back qualitatively. Every read site below uses THIS const; printing always goes through
    // the shared fmtPct (formatters.ts), so one source AND one rendering - the exact pair
    // Kevin's AJH catch needed ("100%" on the tile vs "100.0%" on the proof point).
    const effectiveTrueRepeat = ((cohortTrueRepeatEarly ?? trueRepeatRate) ?? 0) > 0
      ? (cohortTrueRepeatEarly ?? trueRepeatRate)
      : null;

    // Per-entity current-month numbers for the Exec Summary switcher (Task 9). Grouped from
    // latestRows - the exact same row set the combined currentResidents/currentRent/totalUnits
    // above are summed from (latestMonth's monthMap totals and totalUnitsAll are both built by
    // reducing over this same inNetwork-filtered-to-latestCompletedMonth set) - so summing these
    // per-entity numbers reproduces the combined figures exactly, not just approximately. A
    // single-PMC report yields a 1-entry array here, which renderExecSummary treats as "no
    // switcher" (needs 2+).
    //
    // Indexed off canonicalEntityNames (canonicalGroups), NOT off latestRows' own membership:
    // an entity with in-network rows in the window but none at the latest completed month is
    // still part of this report and still owns its color slot, so it gets an entry with zeroed
    // current-month figures rather than being dropped and shifting every later entity's color.
    // Its `monthly` series is still real (it comes from inNetwork, not latestRows), so its hero
    // window rent, "N last 3 months" sub-label and sparklines all still say something true -
    // only the four current-month tile values are zero, which is exactly what's true of it.
    //
    // Prior-period figures per entity come from the same comparison month (prevMonthStr, i.e.
    // monthlyTotals[latestIdx - cmpIdx].month) the combined prevResidents/prevRent/prevNar/
    // prevPropertyCount are read at, aggregated from the same inNetwork rows monthlyTotals is
    // built from - so, like the current-month numbers, these sum exactly to the combined
    // prior figures. An entity with no rows that month gets nulls (its pills render empty, the
    // same state the Combined view is in when prevMonth is null).
    const prevRowsByPmc = prevMonthStr
      ? groupRowsByPmc(inNetwork.filter((r) => r.BP_MONTH === prevMonthStr))
      : new Map<string, typeof inNetwork>();
    // Each entity's own full monthly series over the report window (the same inNetwork rows
    // monthlyTotals is summed from, one dimension finer - same grouping entityMonthlyData /
    // residentsUnitsEntityMonthlyData use above, with newSignups added). Feeds the switcher's
    // per-entity hero window rent, "N last 3 months" sub-label and sparklines; sparse (only
    // months the entity has rows in), chronological like monthlyTotals.
    const inNetworkByPmc = groupRowsByPmc(inNetwork);
    // ── Per-entity Delinquency shielded, for the Exec Summary switcher ──────────────────────
    // The DQ tile was the last node on that slide that never switched: it was emitted with no
    // id at all, so selecting a subsidiary left the entire combined portfolio's DQ dollar
    // figure and its green pill sitting under the subsidiary's own numbers. It looked right
    // and it was wrong, which is the worst failure mode there is in a live partner meeting.
    //
    // Flask swaps it (_exec_switch_ids["dq"] / _exec_pill_ids["dq"], slides.py:9057/9068,
    // emitted at :9546-9549), fed by per-entity dq_shielded / dq_since_comparison backfilled
    // into _pmc_split at app.py:2204-2229. These two values reproduce that computation
    // exactly:
    //
    //   dqShielded        = SUM(total_rent_shielded) over this entity's rows from its OWN
    //                       latest DQ month back (lookback_months - 1) calendar months.
    //   dqSinceComparison = the same windowed rows, further restricted to months strictly
    //                       AFTER the combined comparison month.
    //
    // Two details that are easy to get wrong and that Flask pins:
    //  * the window is anchored at each entity's own latest DQ month, not at the report's
    //    latestCompletedMonth - DQ_PROPERTY lags BP_MONTH by a month, and anchoring at the
    //    report month silently drops the oldest real DQ row (the same bug the combined figure
    //    already had fixed, see dqLatestMonth above);
    //  * the window length is lookback_months (the report's own Full/Quarter/YTD period), NOT
    //    the min(tenure, 12) rule delinquencyWindowMonths implements. That rule gates the
    //    standalone Delinquency SLIDE; the exec tile has always tracked the report period, and
    //    Flask's per-entity backfill uses `lookback` too (app.py:2214). Mixing them would make
    //    the tile disagree with its own "trailing N months" caption.
    //
    // The comparison month is the COMBINED one (comparisonMonth), not a per-entity one - same
    // as Flask, which reads _cmp_month off the combined monthly frame for every entity, so all
    // nine switcher views describe the same period.
    const entityDqByPmc = new Map<string, { month: string; shielded: number }[]>();
    for (const r of entityDqShieldedRows) {
      if (r.BP_MONTH == null) continue;
      const arr = entityDqByPmc.get(r.PMC_NAME) ?? [];
      arr.push({ month: r.BP_MONTH, shielded: r.TOTAL_RENT_SHIELDED ?? 0 });
      entityDqByPmc.set(r.PMC_NAME, arr);
    }
    function entityDqFor(name: string): { shielded: number | null; sinceComparison: number | null } {
      const rows = entityDqByPmc.get(name);
      if (rows == null || rows.length === 0) return { shielded: null, sinceComparison: null };
      // String max, not the query's ORDER BY - same defensive derivation as dqLatestMonth.
      const latest = rows.reduce((acc, r) => (r.month > acc ? r.month : acc), rows[0].month);
      const windowStartDate = new Date(latest + "T00:00:00Z");
      windowStartDate.setUTCMonth(windowStartDate.getUTCMonth() - (lookback_months - 1));
      const windowStart = windowStartDate.toISOString().slice(0, 10);
      const windowed = rows.filter((r) => r.month >= windowStart);
      const shielded = windowed.reduce((sum, r) => sum + r.shielded, 0);
      const since = comparisonMonth
        ? windowed.filter((r) => r.month > comparisonMonth).reduce((sum, r) => sum + r.shielded, 0)
        : null;
      // Same "> 0 ? n : null" normalization the combined lifetimeDqShielded /
      // dqSinceComparison get at the renderExecSummary call below, so an entity with no
      // shielded rent renders the tile's em-dash and an empty pill exactly like Combined does.
      return {
        shielded: shielded > 0 ? shielded : null,
        sinceComparison: since != null && since > 0 ? since : null,
      };
    }
    const entityBreakdown = canonicalGroups(latestRows).map(([name, rows]) => {
      const residents = rows.reduce((s, r) => s + r.BILLS_PAID, 0);
      const rent = rows.reduce((s, r) => s + r.RENT_PAID, 0);
      const units = rows.reduce((s, r) => s + r.PROPERTY_UNIT_COUNT, 0);
      const prevRows = prevRowsByPmc.get(name);
      const prevResidents = prevRows ? prevRows.reduce((s, r) => s + r.BILLS_PAID, 0) : null;
      const prevUnits = prevRows ? prevRows.reduce((s, r) => s + r.PROPERTY_UNIT_COUNT, 0) : null;
      const prevProps = prevRows ? new Set(prevRows.map((r) => r.PROPERTY_NAME)).size : 0;
      const dq = entityDqFor(name);
      const ebMap = new Map<string, { billsPaid: number; units: number; rentPaid: number; newSignups: number }>();
      for (const row of inNetworkByPmc.get(name) ?? []) {
        const existing = ebMap.get(row.BP_MONTH) || { billsPaid: 0, units: 0, rentPaid: 0, newSignups: 0 };
        existing.billsPaid += row.BILLS_PAID;
        existing.units += row.PROPERTY_UNIT_COUNT;
        existing.rentPaid += row.RENT_PAID;
        existing.newSignups += row.NEW_SIGNUPS ?? 0;
        ebMap.set(row.BP_MONTH, existing);
      }
      const monthly = Array.from(ebMap.entries())
        // Same adoptionRate rule as monthlyTotals (units > 0 ? bills / units : 0).
        .map(([month, m]) => ({ month, ...m, adoptionRate: m.units > 0 ? m.billsPaid / m.units : 0 }))
        .sort((a, b) => a.month.localeCompare(b.month));
      return {
        pmcName: name,
        currentResidents: residents,
        currentRent: rent,
        currentNar: units > 0 ? residents / units : 0,
        propertyCount: new Set(rows.map((r) => r.PROPERTY_NAME)).size,
        totalUnits: units,
        prevResidents,
        prevRent: prevRows ? prevRows.reduce((s, r) => s + r.RENT_PAID, 0) : null,
        // Same rule as monthlyTotals' adoptionRate (units > 0 ? bills / units : 0).
        prevNar: prevResidents !== null && prevUnits !== null ? (prevUnits > 0 ? prevResidents / prevUnits : 0) : null,
        // Same "> 0 ? n : null" normalization the combined prevPropertyCount gets at the
        // renderExecSummary call below.
        prevPropertyCount: prevProps > 0 ? prevProps : null,
        // Same NEW_SIGNUPS ?? 0 sum monthlyTotals' newSignups uses, over this entity's latest rows.
        currentNewSignups: rows.reduce((s, r) => s + (r.NEW_SIGNUPS ?? 0), 0),
        monthly,
        // Delinquency shielded + its since-comparison pill value, so the switcher can swap the
        // DQ tile (see entityDqFor above). Sourced from the entity's OWN DQ rows, which is why
        // this needed its own query rather than being derivable from anything already pulled.
        dqShielded: dq.shielded,
        dqSinceComparison: dq.sinceComparison,
      };
    });

    // Yearly rent/bills history for the Since Inception slide (Task 10 combined totals, now
    // also feeding Expansion per Kevin's scope addition after Task 15). Hoisted up here - same
    // "build once, both branches read it" convention as entityBreakdown just above - rather
    // than living only inside the QBR-only block further down, since Expansion's own switch
    // case below needs these same two arrays. yearlyRentBillsRows/entityYearlyRentRows are now
    // gated on needsSinceInception (QBR + Expansion), not needsQBRQueries alone - see that
    // flag's declaration near the top of this function. Built BEFORE portfolioComparison*
    // below, which reads the per-entity lifetime totals off entityYearlyRentRows.
    const yearlyData: YearlyData[] = yearlyRentBillsRows.map(r => ({
      year: r.YEAR,
      totalRent: r.TOTAL_RENT ?? 0,
      billsPaid: r.BILLS_PAID ?? 0,
      monthsActive: r.MONTHS_ACTIVE ?? 0,
      ytdRent: r.YTD_RENT ?? 0,
      ytdBills: r.YTD_BILLS ?? 0,
      ytdMonthsActive: r.YTD_MONTHS_ACTIVE ?? 0,
    }));

    // Per-entity yearly rent breakdown for the Since Inception stacked bar (Task 10). Grouped
    // from entityYearlyRentRows via the same groupRowsByPmc helper Task 9 introduced -
    // entityYearlyRentRows is already [] for a single-PMC report (query gated on
    // allPmcNames.length > 1 above), so this yields [] here too, and renderSinceInception's own
    // "needs 2+" check keeps the bar unstacked. Same array feeds both QBR's fixed-slide-3 call
    // and Expansion's "since_inception" switch case below.
    // canonicalGroups, not groupRowsByPmc: this is the row set that diverged WORST, because
    // entityYearlyRentRows is unbounded in time AND carries no IS_IN_NETWORK filter, so it can
    // both (a) miss an entity the other two views have and (b) contain an entity they don't.
    // Canonical membership settles both: an in-window entity with no yearly rows gets an empty
    // record (zero-height stack segments, color slot kept), and an entity with rent history but
    // no in-network rows in the window is dropped from this view too - which is what Flask
    // does, since it never survived compute_pmc_kpis into _splits at all.
    const entityYearlyData = canonicalGroups(entityYearlyRentRows).map(([name, rows]) => {
      const totalRentByYear: Record<number, number> = {};
      const ytdRentByYear: Record<number, number> = {};
      for (const r of rows) {
        totalRentByYear[r.YEAR] = r.TOTAL_RENT ?? 0;
        ytdRentByYear[r.YEAR] = r.YTD_RENT ?? 0;
      }
      return { pmcName: name, totalRentByYear, ytdRentByYear };
    });

    // Per-entity ALL-TIME rent/bills for the Portfolio Comparison slide's "Total Rent Paid" /
    // "Total Bills Paid" columns (Kevin's ask). Summed over every year of the per-entity yearly
    // query above - the SAME unbounded, unfiltered "true history" rows the Since Inception
    // stacked bar draws - NOT entityBreakdown.currentRent (one month) or anything windowed to
    // lookback_months. Since that query shares its WHERE clause with the combined yearly query,
    // these per-entity totals sum exactly to the combined lifetime figures below, which are the
    // Since Inception subtitle's own "$X guaranteed and N bills paid since <year>" numbers.
    const entityLifetimeByPmc = new Map<string, { rent: number; bills: number }>();
    for (const r of entityYearlyRentRows) {
      const cur = entityLifetimeByPmc.get(r.PMC_NAME) ?? { rent: 0, bills: 0 };
      cur.rent += r.TOTAL_RENT ?? 0;
      cur.bills += r.TOTAL_BILLS ?? 0;
      entityLifetimeByPmc.set(r.PMC_NAME, cur);
    }
    const combinedLifetimeRent = yearlyData.reduce((s, y) => s + y.totalRent, 0);
    const combinedLifetimeBills = yearlyData.reduce((s, y) => s + y.billsPaid, 0);

    // Per-entity rows for the new Portfolio Comparison slide (Task 13). Reuses entityBreakdown
    // above (Task 9's per-entity current-month totals), entityMonthlyData (Task 11's per-
    // entity monthly adoption series, built earlier from the same groupRowsByPmc(inNetwork)
    // grouping) and entityLifetimeByPmc just above - no new aggregation, no new query. Shared
    // by both QBR and Expansion below (same "build once, both branches read it" convention
    // Tasks 8-12 already established for entityBreakdown/entityYearlyData/entityMonthlyData
    // themselves). A single-PMC report yields a 1-entry array here, which
    // renderPortfolioComparison's own "needs 2+" check keeps the slide from rendering at all.
    const portfolioComparisonEntities: PortfolioComparisonEntity[] = entityBreakdown.map((eb) => {
      const em = entityMonthlyData.find((e) => e.pmcName === eb.pmcName);
      const lt = entityLifetimeByPmc.get(eb.pmcName);
      return {
        pmcName: eb.pmcName,
        unitsOnFlex: eb.totalUnits,
        payingResidents: eb.currentResidents,
        adoptionRate: eb.currentNar,
        rentPaid: eb.currentRent,
        lifetimeRent: lt?.rent,
        lifetimeBills: lt?.bills,
        monthlySeries: (em?.monthly ?? []).map((m) => m.adoptionRate),
      };
    });
    // The Combined row's own trend sparkline - the real combined adoption-rate-by-month series
    // (same monthlyTotals the bold Adoption Trend line draws), not summed/averaged from the
    // entities' own series above (see PortfolioComparisonInput's doc comment for why that would
    // be wrong).
    const portfolioComparisonCombinedSeries = monthlyTotals.map((m) => m.adoptionRate);

    const execResult = renderExecSummary({
      pmcName: pmcDisplayName,
      reportingMonth: latestCompletedMonth,
      partnerSince,
      lookbackMonths: lookback_months,
      targetNar: adoption_target,
      currentNar: latestMonth?.adoptionRate ?? 0,
      currentResidents: latestMonth?.billsPaid ?? 0,
      currentRent: latestMonth?.rentPaid ?? 0,
      currentNewSignups: latestMonth?.newSignups ?? 0,
      lifetimeRent,
      propertyCount: uniqueProperties.size,
      totalUnits: totalUnitsAll,
      prevNar: prevMonth?.adoptionRate ?? null,
      prevResidents: prevMonth?.billsPaid ?? null,
      prevRent: prevMonth?.rentPaid ?? null,
      prevNewSignups: prevMonth?.newSignups ?? null,
      prevPropertyCount: prevPropertyCount !== null && prevPropertyCount > 0 ? prevPropertyCount : null,
      prevUnits: prevMonth?.units ?? null,
      monthlyTotals,
      trueRepeatRate: effectiveTrueRepeat,
      lifetimeDqShielded: lifetimeDqShielded > 0 ? lifetimeDqShielded : null,
      dqSinceComparison: dqSinceComparison != null && dqSinceComparison > 0 ? dqSinceComparison : null,
      hiddenTiles: hidden_kpi_tiles,
      entityBreakdown,
      slideId: 2,
      // Flask: QBR always show_sparklines=False (hardcoded, unconditional).
      // Expansion: show_sparklines = not (_show_growth and 54 in active_exp_order).
      // Since slide 54 = "residents_units", suppress sparklines on expansion when the growth
      // trend slides are showing (always, now that showGrowthSlides is unconditionally true
      // for Expansion) and that slide specifically is included (it renders the same data as a
      // full chart).
      // An empty expansion_slides array means "no filter" (all slides included) per the
      // activeOrder build below — match that semantics here rather than treating [] as "off".
      // sparklinesOverride is Expansion-only (Kevin's call: QBR stays exactly as-is - it never
      // shows sparklines regardless, so an override has nothing to attach to there anyway).
      // `?? ` so "auto" (null) falls through to the existing derived default unchanged.
      showSparklines: deck_mode === "qbr" ? false
        : deck_mode === "expansion" ? (sparklinesOverride ?? !(showGrowthSlides && (
            expansion_slides && expansion_slides.length > 0
              ? expansion_slides.includes("residents_units")
              : true
          )))
        : false,
      // Same Expansion-only scoping as sparklinesOverride above - QBR's comparison pills always
      // show today with no override mechanism to hook into, so leaving it false there preserves
      // that exactly.
      hidePeriodComparison: deck_mode === "expansion" && periodComparisonOverride === false,
      vsLabel,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SHARED DATA: Delinquency, Retention, Loyalty — used by Expansion & QBR
    // ─────────────────────────────────────────────────────────────────────────
    const dqMonths = dqShieldedRows
      .filter((r) => r.BP_MONTH != null)
      .sort((a, b) => (a.BP_MONTH! < b.BP_MONTH! ? -1 : 1))
      .map((r) => ({
        month: r.BP_MONTH!,
        totalRentShielded: r.TOTAL_RENT_SHIELDED ?? 0,
        residentsShielded: r.NUMBER_OF_RESIDENTS ?? 0,
      }));

    // Delinquency window length = min(TENURE, 12) months — see delinquencyWindowMonths for why
    // this must not be min(dqMonths.length, 12), which is what all four consumers below used to
    // pass. Computed once here, in the shared section above both deck branches, so the
    // Expansion and QBR render calls AND both speaker-notes payloads can never disagree about
    // the window: the renderer's "Trailing N Months" label, its headline sum, and its
    // >=3-real-months floor all derive from this one value.
    //
    // Same derivation as expMonthsSinceLaunch (Expansion) and monthsSinceLaunch (QBR) further
    // down, which is Clark's mirror of Flask's kpis["months_since_launch"] — the exact value
    // Flask's render_delinquency reads. Kept here rather than reusing one of those because
    // both are declared inside their own deck branch, below this shared section; if the three
    // are ever unified, they must stay one value, not drift apart.
    const dqTenureMonths = (() => {
      if (!earliestRollout || !latestCompletedMonth) return 0;
      const [ey, em] = earliestRollout.split("-").map(Number);
      const [ly, lm] = latestCompletedMonth.split("-").map(Number);
      return (ly - ey) * 12 + (lm - em) + 1;
    })();
    const dqWindowMonths = delinquencyWindowMonths(dqTenureMonths, dqMonths.length);

    // Flask's real MoM retention (render_retention, generator/slides.py) is a true
    // customer-level set intersection between consecutive months — NOT a ratio of two
    // pre-aggregated columns. Build month -> set(customer_public_id) from the raw pairs,
    // then rate = |prior month's customers ∩ this month's customers| / |prior month's customers|.
    const customerMonthMap = new Map<string, Set<string>>();
    for (const row of customerMonthRows) {
      if (!customerMonthMap.has(row.BP_MONTH)) customerMonthMap.set(row.BP_MONTH, new Set());
      customerMonthMap.get(row.BP_MONTH)!.add(row.CUSTOMER_PUBLIC_ID);
    }
    const sortedCustomerMonths = [...customerMonthMap.keys()]
      .filter((m) => m <= latestCompletedMonth)
      .sort();
    const momRetentionRates: { month: string; rate: number }[] = [];
    for (let i = 1; i < sortedCustomerMonths.length; i++) {
      const priorIds = customerMonthMap.get(sortedCustomerMonths[i - 1])!;
      const curIds = customerMonthMap.get(sortedCustomerMonths[i])!;
      if (priorIds.size === 0) continue;
      let intersectionCount = 0;
      for (const id of priorIds) if (curIds.has(id)) intersectionCount++;
      momRetentionRates.push({ month: sortedCustomerMonths[i], rate: intersectionCount / priorIds.size });
    }

    const retentionAvg = momRetentionRates.length > 0
      ? momRetentionRates.reduce((s, r) => s + r.rate, 0) / momRetentionRates.length
      : 0;

    // Subject's own true repeat rate for the Peer Benchmarks REPEAT_RATE row's dot — matching
    // Flask's kpis.get("true_repeat_rate") or kpis.get("avg_retention") fallback (slides.py:328).
    // Computed here (shared by both QBR and expansion mode, which branches before QBR's own
    // later retention-slide computation of the same value) so it exists before either code path
    // that might read it.
    // effectiveTrueRepeat, not a fourth copy of the cohort-vs-MoM expression (see its
    // declaration for why this metric now has exactly one source).
    const subjectRepeatValue = effectiveTrueRepeat ?? retentionAvg;

    let loyaltyBuckets: { name: string; description: string; count: number; color: string }[] | null = null;
    let loyaltyTotal = 0;
    let loyaltyTitle = "Loyalty rate across active residents";

    if (retentionCohortRows.length > 0) {
      const totalCustomers = retentionCohortRows[0]?.TOTAL_CUSTOMERS ?? 0;
      loyaltyTotal = totalCustomers;

      if (totalCustomers >= 5) {
        const getBucket = (name: string) => retentionCohortRows.find((r) => r.LOYALTY_BUCKET === name)?.BUCKET_COUNT ?? 0;
        const perfect = getBucket("PERFECT");
        const high = getBucket("HIGH");
        const regular = getBucket("REGULAR");
        const episodic = getBucket("EPISODIC");

        loyaltyBuckets = [
          { name: "Perfect ⭐", description: "every available month", count: perfect, color: "#1a9e6a" },
          { name: "High", description: "75–99% of months", count: high, color: "#6A3DB8" },
          { name: "Regular", description: "50–74% of months", count: regular, color: "#d97706" },
          { name: "Episodic", description: "< 50% of months", count: episodic, color: "#a09cb0" },
        ];

        const pctPerfect = totalCustomers > 0 ? perfect / totalCustomers : 0;
        const pctHigh = totalCustomers > 0 ? high / totalCustomers : 0;
        const pctEpisodic = totalCustomers > 0 ? episodic / totalCustomers : 0;

        // Third case: if Perfect tier is empty, drop down to High tier for headline
        if (perfect > 0) {
          loyaltyTitle = episodic > 0
            ? `${(pctPerfect * 100).toFixed(0)}% used Flex every available month – ${(pctEpisodic * 100).toFixed(0)}% used it when they needed it.`
            : `${(pctPerfect * 100).toFixed(0)}% used Flex every available month.`;
        } else if (high > 0) {
          loyaltyTitle = episodic > 0
            ? `${(pctHigh * 100).toFixed(0)}% used Flex 75%+ of available months – ${(pctEpisodic * 100).toFixed(0)}% used it when they needed it.`
            : `${(pctHigh * 100).toFixed(0)}% used Flex 75%+ of available months.`;
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK-IN DECK MODE - "Adoption since our check-in" (early return)
    // Clark mirror of Flask app.py _generate_checkin (013c659; spec: flex-pmc-reports
    // docs/superpowers/specs/2026-09-09-adoption-checkin-design.md). Cover + one wedge slide from
    // this one PMC's monthly series - none of the QBR pipeline below applies. Peer p50/p75 are the
    // canonical values resolved above (canonicalPeerNarP50 / P75 - rolling -> tenure bucket ->
    // snapshot, the same value every other deck's benchmark prints), so the peer tile and the
    // projection cap agree with the rest of the tool. Gates -> Flask's exact messages as `error`:
    // check-in month not before the reporting month; check-in month absent from the series.
    // ─────────────────────────────────────────────────────────────────────────
    if (deck_mode === "checkin" && checkinMonth) {
      // Flask's transform_monthly_totals is already trimmed to completed BP months (its last row IS
      // the reporting month); Clark's monthlyTotals can carry a not-yet-completed trailing month,
      // so trim to the reporting month here for the same contract.
      const ckMonthly = monthlyTotals.filter((m) => m.month <= latestCompletedMonth);
      const ckIdx = checkinMonth.slice(0, 7);
      const rptIdxKey = latestCompletedMonth.slice(0, 7);
      if (ckIdx >= rptIdxKey) {
        return { html: "", empty: false, error: `Check-in must be at least one BP month before the reporting month (${shortMonthLabel(latestCompletedMonth)} BP).` };
      }
      if (!ckMonthly.some((m) => m.month.slice(0, 7) === ckIdx)) {
        return { html: "", empty: false, error: `No Flex data for ${pmcDisplayName} in the ${shortMonthLabel(checkinMonth)} BP month - pick a check-in date inside their history.` };
      }

      const ckBenchmark = { p50Nar: canonicalPeerNarP50, p75Nar: canonicalPeerNarP75, criteria: lockedPeers.length > 0 ? lockedPeersCriteria : "" };
      const projectionEnd = checkinProjectionEnd(latestCompletedMonth);
      const summary = checkinSummary(ckMonthly, checkinMonth, projectionEnd, canonicalPeerNarP75);
      const ckKpis = {
        pmcName: pmcDisplayName,
        reportingMonth: latestCompletedMonth,
        propertyCount: uniqueProperties.size,
        totalUnits: totalUnitsAll,
      };

      // Fixed 2-slide order (Flask CHECKIN_SLIDE_ORDER = [64, 63]); same pushSlide mechanism as the
      // other fixed decks. Both renderers always produce html, so ids are 1..2 in order.
      const CHECKIN_SLIDE_ORDER = ["cover", "adoption_checkin"];
      const ckSlideHtmls: string[] = [];
      const ckSlideJsList: string[] = [];
      const ckRenderedKeys: string[] = [];
      const pushCkSlide = (sid: string, result: { html: string; js: string }) => {
        if (!result.html) return;
        ckSlideHtmls.push(result.html);
        ckRenderedKeys.push(sid);
        if (result.js) ckSlideJsList.push(result.js);
      };
      let ckSlideNum = 0;
      for (const sid of CHECKIN_SLIDE_ORDER) {
        ckSlideNum++;
        switch (sid) {
          case "cover":
            pushCkSlide(sid, renderCheckinCover(ckSlideNum, ckKpis, summary.headline, checkinMonth));
            break;
          case "adoption_checkin":
            pushCkSlide(sid, renderAdoptionCheckin(ckSlideNum, ckMonthly, checkinMonth, ckBenchmark, projectionEnd));
            break;
        }
      }

      const reportMonth = monthOnly(latestCompletedMonth);
      const reportYear = yearOnly(latestCompletedMonth);
      // Flask base_name: "{PMC}_Checkin_{MonYYYY}" (spaces / slashes -> "_", 30-char cap).
      const monYyyy = new Date(latestCompletedMonth + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).replace(" ", "");
      const safePmc = pmcDisplayName.replace(/ /g, "_").replace(/\//g, "_").slice(0, 30);
      const html = applyTerminology(buildDeckHtml({
        slides: ckSlideHtmls.join("\n"),
        pmc_name: pmcDisplayName,
        report_month: reportMonth,
        report_year: reportYear,
        slide_count: ckSlideHtmls.length,
        pdf_filename: `${safePmc}_Checkin_${monYyyy}.pdf`,
        extra_js: ckSlideJsList.filter(Boolean).join("\n"),
      }), terminology);

      // Speaker notes always (3-line script per slide).
      let ckNotesHtml: string | undefined;
      try {
        const ckNotesSnapshot = propertySnapshot.map((p) => ({
          propertyName: p.propertyName, units: p.units, billsPaid: p.billsPaid,
          newSignups: p.newSignups, adoptionRate: p.adoptionRate, rentPaid: p.rentPaid,
          cumRent: p.cumRent,
        }));
        ckNotesHtml = applyTerminology(
          buildCheckinSpeakerNotesHtml(ckRenderedKeys, {
            pmcName: pmcDisplayName,
            reportingMonth: latestCompletedMonth,
            monthsSinceLaunch: _msl,
            summary,
          }, ckNotesSnapshot),
          terminology,
        );
      } catch (e) {
        console.warn(`[PMC Report] checkin speaker notes generation failed for ${pmc_name}: ${e instanceof Error ? e.message : String(e)}`);
      }

      return { html, empty: false, notes_html: ckNotesHtml };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PLATINUM DECK MODE - "The Case for Marketing" (early return)
    // Clark mirror of Flask app.py _generate_platinum (0de2310; spec: flex-pmc-reports
    // docs/superpowers/specs/2026-09-09-platinum-deck-design.md). Its own 4-slide deck built
    // from the silver / platinum tier split of this one PMC's rows - none of the QBR pipeline
    // below applies.
    //
    // Charts get the SILVER tier's monthly series + kpis (the units being sold - axes, labels,
    // property / unit counts are the silver properties'), while the peer ladder above was matched
    // on the WHOLE PMC (latestRows - the same peer definition every other deck uses); only the
    // RATE comes from peers' opt-in properties (peerOptInOnly). Peer rate source order, as Flask:
    // rollingPeerMedianMap (calendar-month keyed) first; only if that is empty, stageBenchmarksMap,
    // whose month_number keys are mapped onto the chart's calendar months via the subject's
    // months-since-launch (same formula / 1-36 clamp as renderAdoptionTrend). Both empty -> no
    // peer pool; platinumCounterfactual then decides. Self-gates -> the spec's messages, returned
    // as `error` (see the output schema for why not a 422).
    // ─────────────────────────────────────────────────────────────────────────
    if (deck_mode === "platinum") {
      const tiers = splitTierRows(inNetwork, latestCompletedMonth);
      const silverMonthly = tiers.silver.length > 0 ? buildMonthlyTotals(tiers.silver) : [];
      const platinumMonthly = tiers.platinum.length > 0 ? buildMonthlyTotals(tiers.platinum) : null;
      if (silverMonthly.length === 0) {
        return { html: "", empty: false, error: `No Platinum deck for ${pmc_name}: fewer than ${PLATINUM_MIN_PROPERTIES} silver properties.` };
      }
      const chartMonths = silverMonthly.map((m) => m.month);

      // Peer rate by calendar month: rolling median first, else the tenure-cohort ladder mapped
      // month_number -> calendar month. Clark's months-since-launch is `_msl` (earliest rollout
      // -> reporting month, launch month = 1), the same value every other deck's stage matching
      // uses here - Flask reads pull_integration_launch_month, which this port has no query for.
      const peerRates: PeerRateByMonth = {};
      for (const m of chartMonths) {
        const row = rollingPeerMedianMap[m];
        if (row?.p50) peerRates[m] = { p50: row.p50 };
      }
      let peerCriteria = Object.keys(peerRates).length > 0 ? lockedPeersCriteria : "";
      if (Object.keys(peerRates).length === 0 && Object.keys(stageBenchmarksMap).length > 0 && latestCompletedMonth) {
        const [ly, lm] = latestCompletedMonth.split("-").map(Number);
        const rptIdx = ly * 12 + lm;
        for (const m of chartMonths) {
          const [my, mm] = m.split("-").map(Number);
          const mn = _msl - (rptIdx - (my * 12 + mm));
          const row = stageBenchmarksMap[Math.max(1, Math.min(36, mn))];
          if (row?.p50) {
            peerRates[m] = { p50: row.p50 };
            if (!peerCriteria && row.peer_label) peerCriteria = row.peer_label;
          }
        }
      }
      // "platinum peers · ..." -> "Platinum peers · ..." (Flask's peer_label capitalisation).
      const peerLabel = peerCriteria ? peerCriteria.charAt(0).toUpperCase() + peerCriteria.slice(1) : null;

      const cf = platinumCounterfactual(silverMonthly, platinumMonthly, peerRates, lookback_months, peerLabel);
      if (cf.source === null) {
        return { html: "", empty: false, error: `No Platinum deck for ${pmc_name}: ${cf.reason ?? "no counterfactual"}.` };
      }

      // SILVER tier kpis drive the charts - property / unit counts are the units being sold.
      const silverLatestRows = tiers.silver.filter((r) => r.BP_MONTH === latestCompletedMonth);
      const platKpis = {
        pmcName: pmcDisplayName,
        reportingMonth: latestCompletedMonth,
        firstMonth: silverMonthly[0].month,
        propertyCount: new Set(silverLatestRows.map((r) => r.PROPERTY_NAME)).size,
        totalUnits: silverLatestRows.reduce((s, r) => s + r.PROPERTY_UNIT_COUNT, 0),
      };

      // Fixed 4-slide order, no picker (Flask PLATINUM_SLIDE_ORDER = [61, 6, 54, 62]). Same
      // pushSlide mechanism as the Expansion deck; every renderer here always produces html, so
      // slide ids are 1..4 in order and no renumbering pass is needed.
      const PLATINUM_SLIDE_ORDER = ["cover", "adoption_trend", "residents_units", "platinum_close"];
      const platSlideHtmls: string[] = [];
      const platSlideJsList: string[] = [];
      const platRenderedKeys: string[] = [];
      const pushPlatSlide = (sid: string, result: { html: string; js: string }) => {
        if (!result.html) return;
        platSlideHtmls.push(result.html);
        platRenderedKeys.push(sid);
        if (result.js) platSlideJsList.push(result.js);
      };
      let platSlideNum = 0;
      for (const sid of PLATINUM_SLIDE_ORDER) {
        platSlideNum++;
        switch (sid) {
          case "cover":
            pushPlatSlide(sid, renderPlatinumCover(platSlideNum, platKpis, cf));
            break;
          case "adoption_trend":
            pushPlatSlide(sid, renderAdoptionTrend({ slideId: platSlideNum, monthly: silverMonthly, kpis: { pmc_name: pmcDisplayName }, platinum: cf }));
            break;
          case "residents_units":
            pushPlatSlide(sid, renderResidentsUnitsCombo({ slideId: platSlideNum, monthlyTotals: silverMonthly, platinum: cf }));
            break;
          case "platinum_close":
            pushPlatSlide(sid, renderPlatinumClose(platSlideNum, cf));
            break;
        }
      }

      const reportMonth = monthOnly(latestCompletedMonth);
      const reportYear = yearOnly(latestCompletedMonth);
      // Flask base_name: "{PMC}_Platinum_{MonYYYY}" (spaces / slashes -> "_", 30-char cap).
      const monYyyy = new Date(latestCompletedMonth + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).replace(" ", "");
      const safePmc = pmcDisplayName.replace(/ /g, "_").replace(/\//g, "_").slice(0, 30);
      const html = applyTerminology(buildDeckHtml({
        slides: platSlideHtmls.join("\n"),
        pmc_name: pmcDisplayName,
        report_month: reportMonth,
        report_year: reportYear,
        slide_count: platSlideHtmls.length,
        pdf_filename: `${safePmc}_Platinum_${monYyyy}.pdf`,
        extra_js: platSlideJsList.filter(Boolean).join("\n"),
      }), terminology);

      // Speaker notes always - this deck is a pitch (3-line script per slide).
      let platNotesHtml: string | undefined;
      try {
        const platNotesMonthly: SpeakerNotesMonthlyRow[] = silverMonthly.map((m) => ({
          month: m.month, billsPaid: m.billsPaid, units: m.units, rentPaid: m.rentPaid,
          newSignups: m.newSignups, propertyCount: m.propertyCount,
        }));
        const silverCumRent = new Map<string, number>();
        for (const r of tiers.silver) silverCumRent.set(r.PROPERTY_NAME, (silverCumRent.get(r.PROPERTY_NAME) ?? 0) + r.RENT_PAID);
        const platNotesSnapshot = silverLatestRows
          .map((r) => ({
            propertyName: r.PROPERTY_NAME, units: r.PROPERTY_UNIT_COUNT, billsPaid: r.BILLS_PAID,
            newSignups: r.NEW_SIGNUPS ?? 0,
            adoptionRate: r.PROPERTY_UNIT_COUNT > 0 ? r.BILLS_PAID / r.PROPERTY_UNIT_COUNT : 0,
            rentPaid: r.RENT_PAID, cumRent: silverCumRent.get(r.PROPERTY_NAME) ?? r.RENT_PAID,
          }))
          .sort((a, b) => b.billsPaid - a.billsPaid);
        platNotesHtml = applyTerminology(
          buildPlatinumSpeakerNotesHtml(platRenderedKeys, {
            pmcName: pmcDisplayName,
            reportingMonth: latestCompletedMonth,
            monthsSinceLaunch: _msl,
            headline: platinumHeadline(cf, false),
            sourceLabel: cf.sourceLabel,
          }, platNotesMonthly, platNotesSnapshot),
          terminology,
        );
      } catch (e) {
        console.warn(`[PMC Report] platinum speaker notes generation failed for ${pmc_name}: ${e instanceof Error ? e.message : String(e)}`);
      }

      return { html, empty: false, notes_html: platNotesHtml };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NEW LOGO DECK MODE — 3 slides only
    // ─────────────────────────────────────────────────────────────────────────
    if (deck_mode === "new_logo") {
      const totalRent = monthlyTotals.reduce((s, m) => s + m.rentPaid, 0);
      const totalBills = monthlyTotals.reduce((s, m) => s + m.billsPaid, 0);
      const totalSignups = monthlyTotals.reduce((s, m) => s + m.newSignups, 0);

      const launchResult = renderLaunchSnapshot({
        slideId: 2,
        pmcName: pmcDisplayName,
        partnerSince,
        propertyCount: uniqueProperties.size,
        totalUnits: totalUnitsAll,
        // Flask's kpis["month_count"] is len(monthly) (app.py:1021) - the number of months in
        // the monthly frame, full stop. This read the now-deleted `completedMonths` array (months
        // with billsPaid > 0), the last remnant of the second latest-completed-month derivation;
        // monthlyTotals.length is both the Flask definition and equal to it for any PMC that has
        // billed in every month of its window.
        monthCount: monthlyTotals.length,
        totalRent,
        totalBills,
        totalSignups,
        latestNar: latestMonth?.adoptionRate ?? 0,
      });

      // Property snapshot needs rentPaid for rent bucket slide
      const propSnapshotWithRent = latestRows
        .map((r) => ({
          propertyName: r.PROPERTY_NAME,
          units: r.PROPERTY_UNIT_COUNT,
          billsPaid: r.BILLS_PAID,
          rentPaid: r.RENT_PAID,
          adoptionRate: r.PROPERTY_UNIT_COUNT > 0 ? r.BILLS_PAID / r.PROPERTY_UNIT_COUNT : 0,
        }))
        .sort((a, b) => b.billsPaid - a.billsPaid);

      const rentBucketResult = renderHighRentAdoption({
        slideId: 3,
        pmcName: pmcDisplayName,
        propertySnapshot: propSnapshotWithRent,
      });

      const nlSlides = [
        renderCover(kpis),
        launchResult.html,
        rentBucketResult.html,
      ].filter(Boolean);

      const nlJs = [launchResult.js, rentBucketResult.js].filter(Boolean).join("\n");
      const nlCount = nlSlides.length;

      const reportMonth = monthOnly(latestCompletedMonth);
      const reportYear = yearOnly(latestCompletedMonth);
      const pdfFilename = pmc_name.replace(/[^a-zA-Z0-9]/g, "_") + "_launch.pdf";

      const html = applyTerminology(buildDeckHtml({
        slides: nlSlides.join("\n"),
        pmc_name,
        report_month: reportMonth,
        report_year: reportYear,
        slide_count: nlCount,
        pdf_filename: pdfFilename,
        extra_js: nlJs,
      }), terminology);

      return { html, empty: false };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXPANSION DECK MODE
    // Canonical order matches EXPANSION_SLIDE_ORDER in app.py's own EXPANSION_SLIDE_ORDER constant
    // (Multiple Payments Update is retired and omitted).
    //
    // Cover and Exec Summary are NOT hardcoded — they only render if selected,
    // exactly the same as every other slide in this deck.
    //
    // Expansion Case Close is always force-appended last regardless of
    // selection, matching the Flask override at app.py line 1466.
    // ─────────────────────────────────────────────────────────────────────────
    if (deck_mode === "expansion") {
      const expSlideHtmls: string[] = [];
      const expSlideJsList: string[] = [];
      // Parallel to expSlideHtmls — the string slide key that actually rendered at each
      // position, in order, for speaker-notes generation below (mirrors Flask's
      // rendered_exp_sids: only slides that actually produced html, not everything attempted).
      const expRenderedKeys: string[] = [];
      // Slides the AE selected that a renderer decided NOT to show - insufficient real sample
      // to make a credible chart (Kevin's ask: surface this in the UI so an AE who notices
      // fewer slides than expected isn't left guessing whether something's broken). Every
      // Expansion slide funnels through pushSlide except cohort_overview's own raw push below,
      // which is tracked the same way at its own call site.
      const expSkippedSlides: { key: string; label: string }[] = [];

      const pushSlide = (sid: string, result: { html: string; js: string }) => {
        if (result.html) {
          expSlideHtmls.push(result.html);
          expRenderedKeys.push(sid);
          if (result.js) expSlideJsList.push(result.js);
        } else {
          expSkippedSlides.push({ key: sid, label: EXPANSION_SLIDE_TITLES[sid] ?? sid });
        }
      };

      // Canonical expansion slide order (string IDs matching SlidesPicker).
      // Reordered 2026-08-19 per Kevin: growth trend slides move up front (right after the
      // KPI slide), benchmarking/MetroSight move later, right before the closing slides.
      const EXPANSION_SLIDE_ORDER = [
        "cover",
        "exec_bottom_line",
        // New (scope addition after Task 15) — same renderSinceInception this same plan's
        // Task 10 built for QBR, wired in here for the first time. Placed right after the KPI
        // slide and before the other growth-trend slides, same relative position as QBR's own
        // fixed order (Cover, Exec Summary, THEN Since Inception, THEN Residents/Units/Rent).
        // Renders via the ordinary pushSlide "attempted but came back empty" path like
        // portfolio_comparison/by_state above — not pre-filtered out of this array — since
        // renderSinceInception itself returns empty html when yearlyData is empty.
        "since_inception",
        "residents_units",     // growth trend — residents paying across unit base
        "adoption_trend",      // growth trend — adoption by month
        // New (Task 13) — Kevin's placement: right after Residents Paying + Adoption Trend and
        // before the geographic breakdown (was just before expansion_case_close), so the
        // per-entity table reads as the breakdown of the two combined trend charts it follows.
        // Renders via the same pushSlide-driven "attempted but came back empty" mechanism as
        // by_state/cohort_overview — not pre-filtered out of this array — since
        // renderPortfolioComparison itself returns empty html for <=1 entity.
        "portfolio_comparison",
        "cohort_overview",     // growth trend — performance by rollout-month cohort
        "by_state",            // geographic breakdown
        "retention",           // resident behavior / loyalty bucket
        "high_rent",           // rent bucket
        "delinquency",         // DQ shielded
        // "peer_benchmarks" removed (Kevin's call - "we don't need to show that" on Expansion).
        // Its case in the switch below was removed too - unreachable dead code once it's gone
        // from this order, same slide id/case still exists and stays live for QBR mode.
        "expansion_metrosight",
        "expansion_gap",
        "testimonials",
        "expansion_case_close",
      ];

      // Growth trend slides (residents_units/adoption_trend/cohort_overview) used to be gated
      // here by showGrowthSlides (a segment-based veto) via a GROWTH_TREND_SLIDES set-membership
      // check. showGrowthSlides is now unconditionally `true` for Expansion (see its
      // declaration above), so that gate could never fire and is removed - these 3 slides are
      // ordinary members of EXPANSION_SLIDE_ORDER now, subject only to the same expansion_slides
      // selection filter as everything else below. showGrowthSlides itself stays, since it still
      // feeds the exec-tile sparkline suppression above.

      // Build active order: filter by expansion_slides if provided, then
      // force-append expansion_case_close at the end regardless of selection
      const slideFilter = expansion_slides && expansion_slides.length > 0
        ? new Set(expansion_slides)
        : null;

      const activeOrder = EXPANSION_SLIDE_ORDER.filter((sid) => {
        if (sid === "expansion_case_close") return false; // always appended below
        if (sid === "testimonials" && testimonials.length === 0) return false;
        return slideFilter === null || slideFilter.has(sid);
      });
      activeOrder.push("expansion_case_close"); // always last

      // Shared computations
      const enrolledUnits = latestMonth?.units ?? 0;
      // Auto-populate total_portfolio_units from Salesforce accounts (ACCOUNT_TOTAL_COMPANY_UNITS)
      // if the caller didn't provide one — mirrors Flask's list_expansion_candidates SFDC lookup
      // (generator/data.py:343, PRODUCTION.SALES.DIM_SALES_ACCOUNTS). NOT
      // HUBSPOT_DEAL_TOTAL_COMPANY_UNITS — same noisy-field reasoning as the QBR Portfolio
      // Penetration fix above. Reuses expTotalPortfolioEarly (resolved above, before the peer-
      // matching ladder ran) rather than re-deriving it here — same value, already computed.
      let expTotalPortfolio = expTotalPortfolioEarly ?? total_portfolio_units;
      if (!expTotalPortfolio) {
        const expPortfolioRows = await subjectPortfolioTotalPromise;
        const acctUnits = resolveSubjectPortfolioUnits(expPortfolioRows);
        expTotalPortfolio = acctUnits > 0 ? acctUnits : enrolledUnits;
      }
      const expNarPerc = segmentPercentiles.find((s) => s.metric === "NAR");

      // Hoisted so both the Adoption Rate chart's render call (case "adoption_trend" below) and
      // the speaker-notes payload (expNotesKpis further down) read the same single value,
      // rather than each recomputing it independently (same "one canonical source" rule this
      // file already enforces for peer-median numbers).
      let expMonthsSinceLaunch = 0;
      if (earliestRollout && latestCompletedMonth) {
        const [ey, em] = earliestRollout.split("-").map(Number);
        const [ly, lm] = latestCompletedMonth.split("-").map(Number);
        expMonthsSinceLaunch = (ly - ey) * 12 + (lm - em) + 1;
      }
      // Kevin's ask: the Adoption Rate chart's peer-median line/toggle should only appear on
      // the Expansion deck when this PMC is genuinely beating peers - showing "you're behind"
      // undercuts the whole pitch. Uses the same canonical peer value every other Expansion
      // slide already reads from (see renderExpansionGap's p50Nar a bit further down).
      const expPeerNarP50 = canonicalPeerNarP50 ?? expNarPerc?.p50 ?? null;
      const isAbovePeerMedian = expPeerNarP50 != null && (latestMonth?.adoptionRate ?? 0) > expPeerNarP50;

      const expRentBucketProps = latestRows
        .map((r) => ({
          propertyName: r.PROPERTY_NAME,
          units: r.PROPERTY_UNIT_COUNT,
          billsPaid: r.BILLS_PAID,
          rentPaid: r.RENT_PAID,
          adoptionRate: r.PROPERTY_UNIT_COUNT > 0 ? r.BILLS_PAID / r.PROPERTY_UNIT_COUNT : 0,
        }))
        .sort((a, b) => b.billsPaid - a.billsPaid);

      // Render each slide in order; slideNum is used as the sequential HTML id
      let slideNum = 0;

      // Imported slides (PDF upload / Google Slides picker), Expansion deck - start/end
      // anchors only (Kevin's ask: PDF upload across report types, not just QBR). Pushed via
      // the same pushSlide() every real slide uses, so they flow through the exact same
      // expSlideIdMap/expSlidesRenumbered renumbering pass below with no special-casing.
      // image_b64 rides as an opaque placeholder token until AFTER applyTerminology runs (see
      // the token-swap right before `html` is returned) - see renderImportedSlide's docstring
      // in slide-renderers.ts for why raw base64 here would be a real bug, not just unneeded
      // caution.
      const expImportPlaceholders = new Map<string, string>();
      const expStartImports: { token: string; sourceTitle: string; deckTitle: string }[] = [];
      const expEndImports: { token: string; sourceTitle: string; deckTitle: string }[] = [];
      (imported_slides ?? []).forEach((imp, idx) => {
        const token = `__FLEX_IMPORTED_SLIDE_X${idx}__`;
        expImportPlaceholders.set(token, `data:${imp.image_mime || "image/png"};base64,${imp.image_b64 || ""}`);
        const entry = { token, sourceTitle: imp.source_title ?? "", deckTitle: imp.deck_title ?? "" };
        if (imp.anchor === "start") expStartImports.push(entry); else expEndImports.push(entry);
      });
      for (const imp of expStartImports) {
        slideNum++;
        pushSlide(`imported:${imp.token}`, renderImportedSlide(slideNum, imp.token, imp.sourceTitle, imp.deckTitle));
      }

      for (const sid of activeOrder) {
        slideNum++;
        switch (sid) {
          case "cover": {
            // Kevin's catch: renderCover's isExpansion branch (deckLabel "Portfolio Expansion
            // Opportunity", no third Reporting Period tile, etc.) was built but never actually
            // wired at this call site - `kpis` alone never carried isExpansion:true anywhere,
            // so this always rendered the QBR-labeled cover even inside the Expansion branch.
            // totalUnits / totalPortfolioUnits feed the "Total Portfolio" tile ("1,232 of
            // 11,000 units"). expTotalPortfolio is the SAME value every other Expansion slide
            // reads - caller-supplied when given, otherwise resolved from
            // PRODUCTION.SALES.DIM_SALES_ACCOUNTS through resolveSubjectPortfolioUnits (one row
            // per PMC_ID, never a blind SUM across joined account rows).
            const coverHtml = renderCover({
              ...kpis,
              isExpansion: true,
              totalUnits: enrolledUnits,
              totalPortfolioUnits: expTotalPortfolio,
            });
            if (coverHtml) {
              expSlideHtmls.push(coverHtml);
              expRenderedKeys.push(sid);
            }
            break;
          }

          case "exec_bottom_line":
            pushSlide(sid, execResult);
            break;

          case "since_inception": {
            // Same renderSinceInception call QBR makes below (fixed slideId 3 there) - here
            // slideId is the dynamic slideNum this deck's switch already uses for every other
            // case. yearlyData/entityYearlyData are hoisted above (shared with QBR), fed by the
            // needsSinceInception-gated queries, which now fire for Expansion too. Renders the
            // same non-stacked single-bar treatment QBR gets for a single-PMC report when
            // entityYearlyData has <=1 entry - no separate Expansion-only fallback needed.
            const r = renderSinceInception({
              slideId: slideNum,
              pmcName: pmcDisplayName,
              reportingMonth: latestCompletedMonth,
              yearlyData,
              monthlyTotals,
              partnerSince,
              entityYearlyData,
            });
            pushSlide(sid, r);
            break;
          }

          case "by_state": {
            // Pre-check: skip if ≤2 distinct states (Flask: property_state.nunique() > 2)
            const distinctStates = new Set(latestRows.map(r => r.PROPERTY_STATE).filter(Boolean)).size;
            if (distinctStates > 2) {
              const r = renderStateBreakdown({
                latestRows,
                portfolioNar: latestMonth?.adoptionRate ?? 0,
                reportingMonth: latestCompletedMonth,
                slideId: slideNum,
                // Was missing here (Kevin's ask) - QBR's own call to this same function a few
                // hundred lines down already passes this; Expansion just never did.
                regionDetail,
              });
              pushSlide(sid, r);
            }
            break;
          }

          case "residents_units": {
            const r = renderResidentsUnitsCombo({ slideId: slideNum, monthlyTotals, entityMonthlyData: residentsUnitsEntityMonthlyData, quarters });
            pushSlide(sid, r);
            break;
          }

          case "adoption_trend": {
            // Was missing kpis entirely (Kevin's catch) - QBR's own call to this same function
            // passes stage_benchmarks/rolling_peer_median/locked_peers_criteria; Expansion never
            // did, so the peer-median line + "Hide peer median" toggle never appeared here at
            // all. Now gated on isAbovePeerMedian (computed above, near expNarPerc) - below/at
            // median, kpis stays null and renderAdoptionTrend renders with no peer line at all,
            // same code path QBR hits for a PMC with zero peer data.
            const r = renderAdoptionTrend({
              slideId: slideNum,
              monthly: monthlyTotals,
              kpis: isAbovePeerMedian ? {
                pmc_name,
                months_since_launch: expMonthsSinceLaunch,
                stage_benchmarks: stageBenchmarksMap,
                rolling_peer_median: Object.keys(rollingPeerMedianMap).length > 0 ? rollingPeerMedianMap : {},
                locked_peers_criteria: lockedPeersCriteria,
              } : null,
              entityMonthlyData,
              quarters,
            });
            pushSlide(sid, r);
            break;
          }

          case "cohort_overview": {
            const cohortHtml = renderCohortAnalysis({ cohorts, reportingMonth: latestCompletedMonth, cohortMonthly, slideId: slideNum, presentingMode: presenting_mode });
            if (cohortHtml) expSlideHtmls.push(cohortHtml);
            else {
              slideNum--; // no data — don't count this slot
              expSkippedSlides.push({ key: sid, label: EXPANSION_SLIDE_TITLES[sid] ?? sid });
            }
            break;
          }

          case "retention": {
            const r = renderRetention({
              slideId: slideNum,
              pmcName: pmcDisplayName,
              reportingMonth: latestCompletedMonth,
              // effectiveTrueRepeat - the deck's single source (see its declaration). This
              // used to be the bare MoM trueRepeatRate, then its own inline copy of the
              // cohort-preferring expression; both are gone.
              trueRepeatRate: effectiveTrueRepeat,
              avgRetention: retentionAvg,
              momRates: momRetentionRates,
              loyaltyBuckets,
              loyaltyTotal,
              loyaltyTitle,
              newInMonth: latestMonth?.newSignups ?? 0,
              avgPayment: latestMonth ? (latestMonth.rentPaid / Math.max(latestMonth.billsPaid, 1)) : 0,
              slideTitle: "Your residents use Flex their own way, but once they start, most keep coming back.",
            });
            pushSlide(sid, r);
            break;
          }

          case "high_rent": {
            if (evidence_type === "affordable") {
              // renderAffordableHousingSlide (slides-prospect.ts), NOT expansion-renderers'
              // renderAffordableHousing. This call used to reach the latter, which cites a
              // study Flex cannot substantiate: "a 2024 survey of 3,200+ Flex users",
              // "n=3,247 respondents in LIHTC / Section 8 / workforce housing", and - worse -
              // relabels Flask's 89% "PMs recommend continuing" as 89% of RESIDENTS who
              // "would recommend Flex to a neighbor". None of those numbers or that framing
              // exist anywhere in Flask. Flask's own slide (render_affordable_housing_slide,
              // generator/slides.py:8408) cites the real partner study - "40,000+ residents
              // across 200+ affordable properties" - and slides-prospect.ts:1216 is already
              // its faithful port, used by the prospect deck (get-prospect-deck.ts:688).
              // One renderer, the substantiated one, for both decks.
              //
              // expansion-renderers.renderAffordableHousing is now unreferenced and should be
              // DELETED - left in place only because another agent is currently in that file.
              const r = renderAffordableHousingSlide(slideNum);
              pushSlide(sid, r);
            } else {
              // residentRents/alltimeResidentRents were missing here (Kevin's ask) - QBR's own
              // call to this same function passes both for the Last Month/All Time toggle;
              // Expansion never did. Both are now hoisted/shared, computed once near
              // latestCompletedMonth above.
              const r = renderHighRentAdoption({
                slideId: slideNum,
                pmcName: pmcDisplayName,
                propertySnapshot: expRentBucketProps,
                residentRents: residentRents.length >= 4 ? residentRents : undefined,
                alltimeResidentRents: alltimeResidentRents.length >= 4 ? alltimeResidentRents : undefined,
              });
              pushSlide(sid, r);
            }
            break;
          }

          case "delinquency": {
            // This slide is deliberately independent of the report's own Full/Quarter/YTD
            // period (matches Flask's render_delinquency, generator/slides.py:3309-3325) —
            // always a trailing-12-months-or-full-tenure headline. windowMonths used to be
            // lookback_months, which made this slide silently follow Quarter/YTD even though
            // its own label never did — the same "$ doesn't match its own label" bug class
            // Kevin caught on the exec tile, just introduced from the other direction. Dropped
            // lifetimeShielded entirely — renderDelinquency now computes its own windowed sum
            // from `months` + `windowMonths` internally, so it can't drift from its own label.
            const r = renderDelinquency({
              slideId: slideNum,
              months: dqMonths,
              windowMonths: dqWindowMonths,
            });
            pushSlide(sid, r);
            break;
          }

          case "expansion_metrosight": {
            const r = renderExpansionMetrosight({
              slideId: slideNum,
              pmcName: pmcDisplayName,
              enrolledUnits,
              totalPortfolioUnits: expTotalPortfolio,
              avgRent: latestMonth ? (latestMonth.rentPaid / Math.max(latestMonth.billsPaid, 1)) : 0,
            });
            pushSlide(sid, r);
            break;
          }

          case "expansion_gap": {
            const r = renderExpansionGap({
              slideId: slideNum,
              pmcName: pmcDisplayName,
              totalPortfolioUnits: expTotalPortfolio,
              enrolledUnits,
              currentNar: latestMonth?.adoptionRate ?? 0,
              currentRent: latestMonth?.rentPaid ?? 0,
              currentResidents: latestMonth?.billsPaid ?? 0,
              monthlyHistory: monthlyTotals.map((m) => ({ units: m.units, rentPaid: m.rentPaid })),
              // Canonical value — every slide showing a peer-median NAR must read from this same
              // one (see the rule at its declaration above), or a PMC can see two different
              // "peer median" numbers in the same deck (this slide vs. Peer Benchmarks/Case Close).
              // p75Nar was missing this same fallback (Kevin's catch) — p50/p75 must move
              // together from the same resolved tier, same fix as every other read site in
              // this file. The peer cohort behind these values IS matched at the full target
              // portfolio size, mirroring Flask (app.py:1608-1668) — see subjectUnits in the
              // peer-matching block above, which prefers expTotalPortfolioEarly over the
              // current-enrolled count whenever it's larger.
              p50Nar: canonicalPeerNarP50 ?? expNarPerc?.p50,
              p75Nar: canonicalPeerNarP75 ?? expNarPerc?.p75,
            });
            pushSlide(sid, r);
            break;
          }

          case "testimonials": {
            const r = renderCustomerExperience({
              slideId: slideNum,
              testimonials: testimonials.map((t) => ({ name: t.name, property: t.propertyName, quote: t.quote, role: "Resident" })),
              trend: { csatByMonth: [], responseByMonth: [] },
            });
            pushSlide(sid, r);
            break;
          }

          case "portfolio_comparison": {
            const r = renderPortfolioComparison({
              slideId: slideNum,
              entities: portfolioComparisonEntities,
              combinedMonthlySeries: portfolioComparisonCombinedSeries,
              // Same month entityBreakdown's latestRows are filtered to (and the Exec Summary
              // tiles report) - names the window the numeric columns are a snapshot of.
              asOfMonth: latestCompletedMonth,
              // Combined all-time totals = the Since Inception subtitle's own figures.
              lifetimeRent: combinedLifetimeRent,
              lifetimeBills: combinedLifetimeBills,
              // Combined Avg Rent Paid = the Exec Summary hero's own avg $/resident
              // (currentRent / currentResidents from the same latestMonth row).
              avgRentPerResident: latestMonth && latestMonth.billsPaid > 0 ? latestMonth.rentPaid / latestMonth.billsPaid : null,
            });
            pushSlide(sid, r);
            break;
          }

          case "expansion_case_close": {
            const r = renderExpansionCaseClose({
              slideId: slideNum,
              pmcName: pmcDisplayName,
              enrolledUnits,
              totalPortfolioUnits: expTotalPortfolio,
              currentNar: latestMonth?.adoptionRate ?? 0,
              currentRent: latestMonth?.rentPaid ?? 0,
              currentResidents: latestMonth?.billsPaid ?? 0,
              evidenceType: evidence_type,
              lifetimeDqShielded: lifetimeDqShielded ?? 0,
              hasNiroActivity: false,
              benchmarkNar: canonicalPeerNarP50 ?? segmentNarAvg ?? 0.085,
              // effectiveTrueRepeat, NOT the bare MoM `trueRepeatRate` this used to pass.
              // renderExpansionCaseClose states the metric as a proof point on the closing
              // slide while the retention slide two slides earlier stated the cohort value -
              // the same Expansion deck quoted one partner's repeat rate as two numbers.
              // Exactly Kevin's live AJH catch, which Flask fixed by giving the metric one
              // source (slides.py:76-106).
              trueRepeatRate: effectiveTrueRepeat,
              // Names the real window lifetimeDqShielded is summed over (Kevin's catch) -
              // see the comment at its use inside renderExpansionCaseClose.
              lookbackMonths: lookback_months,
              // Kevin's catch (real client, AJH) - makes this slide "smart" about which of its
              // own proof points actually have a slide behind them. expRenderedKeys is already
              // complete by this point since this case is always last in activeOrder.
              renderedSlideKeys: expRenderedKeys,
            });
            pushSlide(sid, r);
            break;
          }
        }
      }

      for (const imp of expEndImports) {
        slideNum++;
        pushSlide(`imported:${imp.token}`, renderImportedSlide(slideNum, imp.token, imp.sourceTitle, imp.deckTitle));
      }

      // ─── Renumber slideIds sequentially by document position ─────────────────
      // `slideNum` increments on every case in the switch above, even when that case's
      // renderer self-gates and returns empty html (e.g. by_state with <=2 distinct states,
      // an empty peer-benchmark/rent-bucket dataset) — pushSlide only checks the earlier
      // "cohort_overview" case decrements on its own empty path, every other case doesn't, so a
      // skipped slot leaves every later slide's baked-in id="slide-N"/chartN/initSlideN not
      // matching its real position once the empty slide is filtered out. Same fix already
      // applied to the QBR path above (slideIdMap/slidesConcatenated) — reapply it here so
      // navigation (getElementById('slide-'+n)) and the mandatory last "expansion_case_close"
      // slide stay reachable regardless of which slides upstream happened to self-gate empty.
      const expSlideIdMap = new Map<string, string>();
      const expSlidesRenumbered = expSlideHtmls.map((slideHtml, idx) => {
        const newId = idx + 1;
        const m = slideHtml.match(/id="slide-(\d+)"/);
        if (!m) return slideHtml;
        const oldId = m[1];
        expSlideIdMap.set(oldId, String(newId));
        if (oldId === String(newId)) return slideHtml;
        return slideHtml
          .replace(new RegExp(`id="slide-${oldId}"`, "g"), `id="slide-${newId}"`)
          .replace(new RegExp(`#slide-${oldId}\\b`, "g"), `#slide-${newId}`)
          .replace(new RegExp(`id="chart${oldId}"`, "g"), `id="chart${newId}"`)
          .replace(new RegExp(`chart${oldId}(?=['"])`, "g"), `chart${newId}`)
          .replace(new RegExp(`initSlide${oldId}`, "g"), `initSlide${newId}`)
          .replace(new RegExp(`slide-${oldId}(?=['"\\.\\s])`, "g"), `slide-${newId}`);
      });

      let expJs = expSlideJsList.filter(Boolean).join("\n");
      for (const [oldId, newId] of expSlideIdMap) {
        if (oldId === newId) continue;
        expJs = expJs
          .replace(new RegExp(`initSlide${oldId}\\b`, "g"), `initSlide__TMP${newId}__`)
          .replace(new RegExp(`chart${oldId}(?=['"])`, "g"), `chart__TMP${newId}__`)
          .replace(new RegExp(`#slide-${oldId}\\b`, "g"), `#slide-__TMP${newId}__`)
          .replace(new RegExp(`"slide-${oldId}"`, "g"), `"slide-__TMP${newId}__"`);
      }
      expJs = expJs
        .replace(/initSlide__TMP(\d+)__/g, "initSlide$1")
        .replace(/chart__TMP(\d+)__/g, "chart$1")
        .replace(/#slide-__TMP(\d+)__/g, "#slide-$1")
        .replace(/"slide-__TMP(\d+)__"/g, '"slide-$1"');

      const reportMonth = monthOnly(latestCompletedMonth);
      const reportYear = yearOnly(latestCompletedMonth);
      const pdfFilename = displayName.replace(/[^a-zA-Z0-9]/g, "_") + "_expansion.pdf";

      let html = applyTerminology(buildDeckHtml({
        slides: expSlidesRenumbered.join("\n"),
        pmc_name: displayName,
        report_month: reportMonth,
        report_year: reportYear,
        slide_count: expSlidesRenumbered.length,
        pdf_filename: pdfFilename,
        extra_js: expJs,
      }), terminology);
      // Swap imported-slide placeholder tokens for their real data: URIs only now, after
      // terminology substitution has already run (see the imports setup above for why).
      for (const [token, dataUri] of expImportPlaceholders) {
        html = html.replaceAll(token, dataUri);
      }

      // --- Speaker notes ---
      let expNotesHtml: string | undefined;
      try {
        // expMonthsSinceLaunch computed once, above near expNarPerc - reused here rather than
        // recomputed, so the notes and the Adoption Rate chart never disagree.
        const expNotesKpis: SpeakerNotesKpis = {
          pmcName: displayName,
          reportingMonth: latestCompletedMonth,
          monthsSinceLaunch: expMonthsSinceLaunch,
          currentNar: latestMonth?.adoptionRate ?? 0,
          // Kevin's ask: when the Adoption Rate chart is showing a favorable peer comparison,
          // coach the AE to lean into it (see notesAdoptionTrend's use of this field).
          showingAbovePeerMedian: isAbovePeerMedian,
          currentBillsPaid: latestMonth?.billsPaid ?? 0,
          currentNewSignups: latestMonth?.newSignups ?? 0,
          targetNar: 0.15,
          totalUnits: expTotalPortfolio,
          currentResidents: latestMonth?.billsPaid ?? 0,
          hasNiro: false,
          dqWindowMonths,
        };
        const expNotesBenchmark: SpeakerNotesBenchmark = {
          benchmarkNar: canonicalPeerNarP50 ?? segmentNarAvg ?? 0.085,
          p50Nar: canonicalPeerNarP50 ?? expNarPerc?.p50 ?? null,
          // Same missing-fallback fix as the Portfolio Gap slide's p75Nar above.
          p75Nar: canonicalPeerNarP75 ?? expNarPerc?.p75 ?? null,
        };
        const expNotesMonthly: SpeakerNotesMonthlyRow[] = monthlyTotals.map((m) => ({
          month: m.month, billsPaid: m.billsPaid, units: m.units, rentPaid: m.rentPaid,
          newSignups: m.newSignups, propertyCount: m.propertyCount,
        }));
        // Property Reference tab (Kevin's catch) — same propertySnapshot every property-level
        // slide in this deck already reads from.
        const expNotesPropertySnapshot = propertySnapshot.map((p) => ({
          propertyName: p.propertyName, units: p.units, billsPaid: p.billsPaid,
          newSignups: p.newSignups, adoptionRate: p.adoptionRate, rentPaid: p.rentPaid,
          cumRent: p.cumRent,
        }));
        expNotesHtml = applyTerminology(
          buildExpansionSpeakerNotesHtml(expRenderedKeys, expNotesKpis, expNotesMonthly, expNotesBenchmark, expNotesPropertySnapshot),
          terminology
        );
      } catch (e) {
        console.warn(`[PMC Report] expansion speaker notes generation failed for ${pmc_name}: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Data Workbook (Kevin's ask) - raw rows for the client-side .xlsx build. Reuses the
      // exact same source variables/mappings already used a few lines above for the speaker
      // notes (propertySnapshot, monthlyTotals, cohorts) - no new derivation.
      const workbookData = {
        summary: {
          pmcName: pmcDisplayName,
          reportingMonth: latestCompletedMonth,
          partnerSince,
          propertyCount: uniqueProperties.size,
          currentAdoptionRate: latestMonth?.adoptionRate ?? 0,
          currentResidents: latestMonth?.billsPaid ?? 0,
          currentRentPaid: latestMonth?.rentPaid ?? 0,
          lifetimeRent,
        },
        historical: monthlyTotals.map((m) => ({
          month: m.month, billsPaid: m.billsPaid, units: m.units,
          rentPaid: m.rentPaid, newSignups: m.newSignups, adoptionRate: m.adoptionRate,
        })),
        properties: propertySnapshot.map((p) => ({
          propertyName: p.propertyName, units: p.units, billsPaid: p.billsPaid,
          newSignups: p.newSignups, adoptionRate: p.adoptionRate, propertyState: p.propertyState,
          rentPaid: p.rentPaid, cumRent: p.cumRent, rolloutMonth: p.rolloutMonth,
        })),
        cohorts: cohorts.map((c) => ({
          rolloutMonth: c.rolloutMonth, propertyCount: c.propertyCount, totalUnits: c.totalUnits,
          currentResidents: c.currentResidents, currentRent: c.currentRent, cohortNar: c.cohortNar,
        })),
      };

      return { html, empty: false, notes_html: expNotesHtml, skipped_slides: expSkippedSlides, workbook_data: workbookData };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // QBR DECK MODE (default)
    // ─────────────────────────────────────────────────────────────────────────
    // Correct QBR order:
    // 1. Cover (always first)
    // 2. Exec Summary (always second)
    // 3. Since Inception (Bills & Rent Since Inception)
    // 4. Residents, Units & Rent
    // 5. Adoption Trend
    // 6. Portfolio Projection
    // 7. Cohort Overview
    // 8. By State (Geographic Breakdown)
    // 9. Rethinking Rent (MetroSight)
    // 10. QBR Close (always last real slide)
    // 11. Full Property Table (appendix after QBR Close)

    const sinceInceptionResult = renderSinceInception({
      slideId: 3,
      pmcName: pmcDisplayName,
      reportingMonth: latestCompletedMonth,
      yearlyData,
      monthlyTotals,
      partnerSince,
      entityYearlyData,
    });

    const residentsUnitsResult = renderResidentsUnitsCombo({
      slideId: 4,
      monthlyTotals,
      entityMonthlyData: residentsUnitsEntityMonthlyData,
      quarters,
    });

    // Adoption Trend = slide 5
    // Compute months since launch for peer benchmark alignment
    let monthsSinceLaunch = 0;
    if (earliestRollout && latestCompletedMonth) {
      const [ey, em] = earliestRollout.split("-").map(Number);
      const [ly, lm] = latestCompletedMonth.split("-").map(Number);
      monthsSinceLaunch = (ly - ey) * 12 + (lm - em) + 1;
    }
    const adoptionTrendKpis = {
      pmc_name,
      months_since_launch: monthsSinceLaunch,
      // Real tenure-cohort benchmark (locked-peers cohort, months-since-launch) - see
      // stageBenchmarksMap above. Replaced the SEGMENT_NAR_AVG-based construction (fabricated
      // data source, confirmed producing a wrong number in the wrong direction - Kevin's catch).
      stage_benchmarks: stageBenchmarksMap,
      // Use real rolling peer median if available; otherwise hide the peer median line
      // (a flat line from SEGMENT_NAR_AVG is misleading — better to show no peer line
      // than a constant that doesn't actually represent calendar-month peer movement)
      rolling_peer_median: Object.keys(rollingPeerMedianMap).length > 0
        ? rollingPeerMedianMap
        : {},
      // Same criteria the Peer Benchmarks slide shows — both read from the same lockedPeers
      // cohort, so their descriptions must agree instead of one being a generic hardcoded string.
      locked_peers_criteria: lockedPeersCriteria,
    };
    const adoptionTrendResult = renderAdoptionTrend({ slideId: 5, monthly: monthlyTotals, kpis: adoptionTrendKpis, entityMonthlyData, quarters });
    const adoptionTrendHtml = adoptionTrendResult.html;

    const narPerc = segmentPercentiles.find((s) => s.metric === "NAR");
    const projResult = renderPortfolioProjection({
      currentResidents: latestMonth?.billsPaid ?? 0,
      currentRent: latestMonth?.rentPaid ?? 0,
      currentNar: latestMonth?.adoptionRate ?? 0,
      totalUnits: totalUnitsAll,
      monthlyTotals,
      pmcName: pmcDisplayName,
      slideId: 6,
      // P25/P75 move with P50 from the same resolved tier - same fix as the Peer Benchmarks
      // slide above (Kevin's catch: P50 alone used to get the canonical override here too).
      peerPercentiles: narPerc ? {
        p25: canonicalPeerNarP25 ?? narPerc.p25,
        p50: canonicalPeerNarP50 ?? narPerc.p50,
        p75: canonicalPeerNarP75 ?? narPerc.p75,
        p90: narPerc.p90,
        p99: narPerc.p99,
      } : undefined,
    });

    // Cohort Overview = slide 7
    const cohortHtml = renderCohortAnalysis({ cohorts, reportingMonth: latestCompletedMonth, cohortMonthly, slideId: 7, presentingMode: presenting_mode });

    // Pre-check: skip state breakdown if ≤2 distinct states
    const qbrDistinctStates = new Set(latestRows.map(r => r.PROPERTY_STATE).filter(Boolean)).size;
    const stateResult = qbrDistinctStates > 2
      ? renderStateBreakdown({
          latestRows,
          portfolioNar: latestMonth?.adoptionRate ?? 0,
          reportingMonth: latestCompletedMonth,
          slideId: 8,
          regionDetail,
        })
      : { html: "", js: "" };

    // (MetroSight and QBR Close rendered below with dynamic slide IDs)

    // --- Peer Benchmarks slide ---
    // Override metrics' P50 with locked-peer-derived values for consistency with Flask
    // Flask uses the same geo/size/rent-matched peer pool for all three benchmark metrics.
    // The REPEAT_RATE row's own dot is the subject's true repeat rate (subjectRepeatValue,
    // computed above — matching Flask's kpis.get("true_repeat_rate") or
    // kpis.get("avg_retention") fallback, slides.py:328).
    // Display order: Engagement, Time to First Sign-Up, Adoption Rate, Resident Retention,
    // Portfolio Penetration. segmentPercentiles' own order isn't reliable for this — its rows
    // come from a UNION ALL with no ORDER BY, which Snowflake doesn't guarantee a row order for.
    const BENCHMARK_DISPLAY_ORDER = ["NEW_CONNECTIONS", "SIGNUP_TIMING", "NAR", "REPEAT_RATE", "PENETRATION"];
    const benchmarkMetrics = segmentPercentiles
      .map((m) => {
        if (m.metric === "NAR" && canonicalPeerNarP50 != null) {
          // P25/P75 move together with P50 - all three (or none) come from whichever tier
          // resolved above, never a mix of this tier's P50 with a different tier's spread
          // (Kevin's catch: P50 alone used to get overridden here, leaving P25/P75 pointing at
          // the old snapshot distribution - an impossible P25 > P50 ordering on screen).
          return {
            ...m,
            p50: canonicalPeerNarP50,
            p25: canonicalPeerNarP25 ?? m.p25,
            p75: canonicalPeerNarP75 ?? m.p75,
          };
        }
        if (m.metric === "REPEAT_RATE" && subjectRepeatValue != null) {
          return { ...m, pmcValue: subjectRepeatValue };
        }
        return m;
      })
      .sort((a, b) => BENCHMARK_DISPLAY_ORDER.indexOf(a.metric) - BENCHMARK_DISPLAY_ORDER.indexOf(b.metric));
    const peerBenchResult = renderPeerBenchmarks({
      slideId: 9,
      pmcName: pmcDisplayName,
      segment: lockedPeersCriteria,
      metrics: benchmarkMetrics,
      // Flask's subtitle is "Benchmarked against N comparable PMCs (<criteria>)" — the count
      // prefix was missing here, so the renderer's existing peerCount-gated subtitle logic
      // (slide-renderers.ts, subtitlePeers) fell through to the bare criteria string instead.
      peerCount: lockedPeers.length,
    });

    // --- Flex Is For Everyone (high rent adoption) slide ---
    // residentRents/alltimeResidentRents now computed once, hoisted up near latestCompletedMonth
    // (shared with Expansion's own "high_rent" case) - see the comment there.
    const flexForEveryoneResult = renderHighRentAdoption({
      slideId: 12,
      pmcName: pmcDisplayName,
      propertySnapshot: propertySnapshot.map((p) => ({
        propertyName: p.propertyName,
        units: p.units,
        billsPaid: p.billsPaid,
        rentPaid: p.rentPaid ?? 0,
        adoptionRate: p.adoptionRate,
      })),
      residentRents: residentRents.length >= 4 ? residentRents : undefined,
      alltimeResidentRents: alltimeResidentRents.length >= 4 ? alltimeResidentRents : undefined,
    });

    // --- Delinquency Protection slide --- (windowed internally now, see the Expansion call
    // site's comment above for why lifetimeShielded is no longer passed in)
    const delinquencyResult = renderDelinquency({
      slideId: 13,
      months: dqMonths,
      windowMonths: dqWindowMonths,
    });

    // --- Resident Retention slide ---
    // Use cohort-derived true repeat rate (lifetime metric, stable across runs).
    // The MoM fallback (trueRepeatRate) measures a different thing and is non-deterministic
    // across months, so only use it if the cohort query genuinely has no data.
    // Reads effectiveTrueRepeat, the deck's single source (see its declaration) - this was a
    // third local copy of the cohort-vs-MoM expression. Kept as a named alias rather than
    // inlined so the two call sites below read unchanged.
    const finalTrueRepeatRate = effectiveTrueRepeat;

    // Average rent per resident per month (for KPI card) — from monthlyTotals (real,
    // PROPERTY_BP_MONTH_STATS-derived), not the fabricated PARTNER_REPORTING_CORE_METRICS table.
    const avgPaymentPerResident = (() => {
      const totalRent = monthlyTotals.reduce((s, m) => s + m.rentPaid, 0);
      const totalBills = monthlyTotals.reduce((s, m) => s + m.billsPaid, 0);
      return totalBills > 0 ? totalRent / totalBills : 0;
    })();

    // New signups in latest month — from monthlyTotals, same reasoning as above.
    const newInLatestMonth = latestMonth?.newSignups ?? 0;

    const retentionResult = renderRetention({
      slideId: 14,
      pmcName: pmcDisplayName,
      reportingMonth: latestCompletedMonth,
      trueRepeatRate: finalTrueRepeatRate,
      avgRetention: retentionAvg,
      momRates: momRetentionRates,
      loyaltyBuckets,
      loyaltyTotal,
      loyaltyTitle,
      newInMonth: newInLatestMonth,
      avgPayment: avgPaymentPerResident,
    });

    // --- Dynamic slide ID allocator ---
    // Every slide above this point uses a fixed literal slideId (2 through 14 — exec, since
    // inception, residents/units, adoption trend, projection, cohort, state, peer benchmarks,
    // flex-for-everyone, delinquency, retention). The slides below (testimonials, celebrate,
    // opportunities, metrosight, QBR close) previously computed their IDs via ad-hoc arithmetic
    // ("9 + newDataSlideCount + testimonialSlideRendered", etc.) trying to guess a free number —
    // that arithmetic could (and did) land back on 9, 12, 13, or 14, colliding with a slide
    // already using that literal. A collision on the same slideId means BOTH slides' JS ends up
    // sharing one entry in the renumbering map (get-pmc-monthly-report.ts's slidesOrdered
    // renumbering pass below), so one of them gets its canvas-lookup renumbered to the WRONG
    // final position — exactly the "Failed to create chart: can't acquire context from the
    // given item" / getElementById-returns-null bug. A simple monotonic counter, safely clear
    // of every literal above, makes a collision structurally impossible regardless of which
    // combination of these slides ends up empty vs. rendered.
    let _nextDynamicSlideId = 100;
    const allocSlideId = () => _nextDynamicSlideId++;

    // --- Imported slides (PDF upload, QBR only for now) ---
    // Mirrors Flask's app.py imported-slides handling: each import rides as an opaque
    // placeholder token until AFTER applyTerminology runs (see the token-swap right before
    // `html` is returned below), then gets swapped for its real data: URI. Only "start"/"end"
    // anchors are supported this round - see renderImportedSlide's docstring for why a
    // specific-slide anchor is out of scope for now.
    const importedSlidesRaw = imported_slides ?? [];
    const importPlaceholders = new Map<string, string>(); // token -> real data: URI
    const startImportsHtml: string[] = [];
    const endImportsHtml: string[] = [];
    importedSlidesRaw.forEach((imp, idx) => {
      const token = `__FLEX_IMPORTED_SLIDE_${idx}__`;
      importPlaceholders.set(token, `data:${imp.image_mime || "image/png"};base64,${imp.image_b64 || ""}`);
      const { html } = renderImportedSlide(allocSlideId(), token, imp.source_title ?? "", imp.deck_title ?? "");
      // Anything other than a literal "start" (including any stray "after:X" from a client
      // that hasn't been updated) falls through to "end" - same default Flask's own anchor
      // parsing uses for an unrecognized value, rather than silently dropping the slide.
      if (imp.anchor === "start") startImportsHtml.push(html); else endImportsHtml.push(html);
    });

    // Testimonials slide (after retention, before celebrate/opportunities)
    // Resolve the deferred Zendesk promise now
    let topTestimonials: Testimonial[];
    if (testimonials.length > 0) {
      topTestimonials = testimonials.map((t) => ({ name: t.name, property: t.propertyName, quote: t.quote }));
    } else {
      const zendeskRows = await (zendeskPromise ?? Promise.resolve([]));
      const POSITIVE_KEYWORDS = ["love", "amazing", "great", "excellent", "helpful", "fantastic", "wonderful", "easy", "convenient", "lifesaver", "recommend", "thank", "best", "perfect", "awesome"];
      const scored = zendeskRows.map((r) => {
        const lower = r.COMMENT.toLowerCase();
        const score = POSITIVE_KEYWORDS.reduce((s, kw) => s + (lower.includes(kw) ? 1 : 0), 0);
        return { ...r, score };
      });
      scored.sort((a, b) => b.score - a.score);
      topTestimonials = scored.slice(0, 4).map((r) => ({ name: r.RESIDENT_NAME ?? "", property: r.PROPERTY_NAME ?? "", quote: r.COMMENT }));
    }
    const testimonialSlideId = allocSlideId();
    const [csatTrendRows, responseTrendRows] = await residentTrendPromise;
    const residentTrend: ResidentTrend = {
      csatByMonth: csatTrendRows.map((r) => ({ month: r.MONTH, nTotal: r.N_TOTAL, nGood: r.N_GOOD })),
      responseByMonth: responseTrendRows.map((r) => ({ month: r.MONTH, nTickets: r.N_TICKETS, avgReplyMin: r.AVG_REPLY_MIN })),
    };
    const testimonialResult = renderCustomerExperience({
      slideId: testimonialSlideId,
      testimonials: topTestimonials,
      trend: residentTrend,
    });
    // Count new properties onboarded in trailing 3 months for QBR close
    let newPropsThisQ = 0;
    if (latestCompletedMonth) {
      const reportDate = new Date(latestCompletedMonth);
      const qStart = new Date(reportDate.getFullYear(), reportDate.getMonth() - 2, 1);
      const qStartStr = qStart.toISOString().slice(0, 10);
      const newPropNames = new Set<string>();
      for (const row of inNetwork) {
        if (row.ROLLOUT_MONTH && row.ROLLOUT_MONTH >= qStartStr && row.ROLLOUT_MONTH <= latestCompletedMonth) {
          newPropNames.add(row.PROPERTY_NAME);
        }
      }
      newPropsThisQ = newPropNames.size;
    }

    // (QBR Close rendered below with dynamic slide ID)

    // --- Property Deep Dive slides ---
    // Smart adoption target: if user left default (15), use that. Otherwise use their override.
    const targetNar = adoption_target / 100; // convert % to decimal

    // Network-wide P50 engagement as fallback when per-property peer matching didn't resolve
    const networkEngValues = networkPoolProps
      .filter((p) => p.pmcName !== pmc_name && p.t12EngPer100 > 0)
      .map((p) => p.t12EngPer100)
      .sort((a, b) => a - b);
    const peerMedianEngFallback = networkEngValues.length > 0
      ? networkEngValues[Math.floor(networkEngValues.length / 2)]
      : undefined;

    // --- New Rollouts — below age-since-rollout benchmark (Flask: generator/slides.py:5226-5318) ---
    // Only meaningful once the portfolio itself has enough history to distinguish "new" from
    // "everything is new" — Flask's own gate (_msfirst >= 6).
    // benchNar reads stageBenchmarksMap - the SAME real, geo/size/rent-matched tenure-cohort
    // query the Adoption Trend chart uses (built earlier in this function), matching Flask's
    // own render_adoption_opportunities, which reads its "Expected" column from this exact
    // same kpis["stage_benchmarks"] source (generator/slides.py:5277-5279). Previously read a
    // dedicated untiered network-wide query that returned exactly 0.0% at every age bucket -
    // confirmed broken, not a thin-sample artifact (Kevin's catch).
    // expectedEngPer100 falls back to peerMedianEngFallback (already computed above) rather
    // than reviving that same broken query for engagement - a real, if coarser, network-wide
    // P50 beats a degenerate one, and the "below benchmark" filter tolerates a missing/zero
    // engagement expectation without excluding the row (only benchNar being exactly 0 broke
    // that filter).
    const newRolloutCandidates: NewRolloutCandidate[] = [];
    if (_msl >= 6) {
      const newCutoffDate = latestCompletedMonth ? new Date(latestCompletedMonth) : new Date();
      newCutoffDate.setMonth(newCutoffDate.getMonth() - 6);
      const newCutoffStr = newCutoffDate.toISOString().slice(0, 10);
      for (const p of propertySnapshot) {
        if (!p.rolloutMonth || p.rolloutMonth <= newCutoffStr) continue;
        const age = Math.max(1, p.monthsLive);
        const bench = stageBenchmarksMap[age];
        newRolloutCandidates.push({
          propertyName: p.propertyName,
          propertyState: p.propertyState,
          units: p.units,
          ageMonths: age,
          adoptionRate: p.adoptionRate,
          benchNar: bench?.p50 ?? 0,
          observedEngPer100: p.t12EngPer100 ?? 0,
          expectedEngPer100: peerMedianEngFallback ?? 0,
          hasMarketingIntegration: p.hasMarketingIntegration,
          isMarketingOptIn: p.isMarketingOptIn,
        });
      }
    }

    // --- Disabled properties (Flask: pull_disabled_properties, generator/data.py:4247) ---
    const disabledProperties: DisabledPropertyRow[] = disabledPropertyRows
      .filter((r) => r.DEACTIVATION_REASON !== "PARTNER_INITIATED_LOSS_OF_API_ACCESS")
      .map((r) => ({
        propertyName: r.PROPERTY_NAME,
        units: r.PROPERTY_UNIT_COUNT,
        deactivationLabel: DEACTIVATION_LABELS[r.DEACTIVATION_REASON] ?? r.DEACTIVATION_REASON,
        lastSeenMonth: r.LAST_SEEN_MONTH
          ? new Date(r.LAST_SEEN_MONTH + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
          : null,
      }));

    const celebrateResult = renderPropertiesWorthCelebrating({
      slideId: allocSlideId(),
      propertySnapshot,
      targetNar,
      peerMedianNar: canonicalPeerNarP50 ?? undefined,
      peerMedianEngagement: peerMedianEngFallback,
      showAdoptionPortfolioAvg: show_adoption_portfolio_avg,
      showAdoptionPeerMedian: show_adoption_peer_median,
      showEngagementObserved: show_engagement_observed,
      showEngagementPortfolioAvg: show_engagement_portfolio_avg,
      showEngagementPeerMedian: show_engagement_peer_median,
    });

    const opportunitiesResult = renderAdoptionOpportunities({
      slideId: allocSlideId(),
      propertySnapshot,
      targetNar,
      peerMedianNar: canonicalPeerNarP50 ?? undefined,
      peerMedianEngagement: peerMedianEngFallback,
      newRolloutCandidates,
      disabledProperties,
      presentingMode: presenting_mode,
      hideD2c: hide_d2c,
      showAdoptionPortfolioAvg: show_adoption_portfolio_avg,
      showAdoptionPeerMedian: show_adoption_peer_median,
      showEngagementObserved: show_engagement_observed,
      showEngagementPortfolioAvg: show_engagement_portfolio_avg,
      showEngagementPeerMedian: show_engagement_peer_median,
    });

    const metrosightSlideId = allocSlideId();
    const qbrCloseSlideId = allocSlideId();

    // Re-render metrosight and QBR close with corrected slide IDs
    const metrosightFinal = renderMetrosightEvidence({
      slideId: metrosightSlideId,
      pmcName: pmcDisplayName,
      totalUnits: totalUnitsAll,
      avgRent: (latestMonth?.billsPaid ?? 0) > 0
        ? (latestMonth?.rentPaid ?? 0) / latestMonth!.billsPaid
        : 0,
    });

    const qbrFinal = renderQbrClose({
      slideId: qbrCloseSlideId,
      pmcName: pmcDisplayName,
      currentNar: latestMonth?.adoptionRate ?? 0,
      currentRent: latestMonth?.rentPaid ?? 0,
      lifetimeRent,
      currentResidents: latestMonth?.billsPaid ?? 0,
      propertyCount: uniqueProperties.size,
      partnerSince,
      benchmarkNar: canonicalPeerNarP50 ?? segmentNarAvg ?? 0.085,
      benchmarkP75: narPerc?.p75 ?? null,
      trueRepeatRate: finalTrueRepeatRate,
      newPropertiesCount: newPropsThisQ,
      monthlyTotals,
      // Anniversary-milestone check — fires for 1/2/3/5yr milestones within a 3-month window
      // (the milestone month itself, or up to 2 months after), anchored to the true partner-
      // since date (not raw rollout, which can inherit a prior owner's history), then
      // suppressed unless this PMC is in the top 50% most-tenured partners network-wide —
      // matches Flask's app.py:1225-1244 exactly.
      milestoneYears: (() => {
        if (!partnerSince || !latestCompletedMonth) return null;
        const start = new Date(partnerSince + "T00:00:00Z");
        const rpt = new Date(latestCompletedMonth + "T00:00:00Z");
        for (const yrs of [1, 2, 3, 5]) {
          const msDate = new Date(start.getFullYear() + yrs, start.getMonth(), 1);
          const deltaMo = (rpt.getFullYear() * 12 + rpt.getMonth()) - (msDate.getFullYear() * 12 + msDate.getMonth());
          if (deltaMo >= 0 && deltaMo <= 2) {
            if (tenurePercentileFromTop != null && tenurePercentileFromTop > 50) return null;
            return yrs;
          }
        }
        return null;
      })(),
      lifetimeDqShielded,
      // % of units with D2C marketing enabled (Flask: platinum_pct, generator/data.py:2219-2226
      // — plat_units/total_units where HAS_MARKETING_INTEGRATION) — this was never threaded
      // through, so "Drive co-marketing" (gated on optInPct > 70%) never showed on this port
      // regardless of the PMC's real opt-in rate.
      optInPct: (() => {
        const totalUnits = latestRows.reduce((s, r) => s + r.PROPERTY_UNIT_COUNT, 0);
        if (totalUnits === 0) return 0;
        const optInUnits = latestRows.reduce((s, r) => s + (r.HAS_MARKETING_INTEGRATION ? r.PROPERTY_UNIT_COUNT : 0), 0);
        return optInUnits / totalUnits;
      })(),
      showAdoptionPeerMedian: show_adoption_peer_median,
    });

    // Full Property Table = appendix after QBR Close
    const propTableSlideId = allocSlideId();
    const propertyTableHtml = renderFullPropertyTable(propertySnapshot, propTableSlideId);

    // New (Task 13) - right after Since Inception, before Residents/Units. No Flask reference
    // slide id (this is TS-only, net new) - uses the dynamic allocator like every other
    // post-retention slide below. Only produces html for 2+ combined entities (see
    // renderPortfolioComparison's own gate) - a single-PMC report's slidesOrdered/.filter(Boolean)
    // drops it exactly like every other conditionally-empty slide in this array.
    const portfolioComparisonResult = renderPortfolioComparison({
      slideId: allocSlideId(),
      entities: portfolioComparisonEntities,
      combinedMonthlySeries: portfolioComparisonCombinedSeries,
      // Same month entityBreakdown's latestRows are filtered to (and the Exec Summary tiles
      // report) - names the window the numeric columns are a snapshot of.
      asOfMonth: latestCompletedMonth,
      // Combined all-time totals = the Since Inception subtitle's own figures.
      lifetimeRent: combinedLifetimeRent,
      lifetimeBills: combinedLifetimeBills,
      // Combined Avg Rent Paid = the Exec Summary hero's own avg $/resident (currentRent /
      // currentResidents from the same latestMonth row).
      avgRentPerResident: latestMonth && latestMonth.billsPaid > 0 ? latestMonth.rentPaid / latestMonth.billsPaid : null,
    });

    // Flask SLIDE_ORDER: [3, 54, 6, 21, 14, 49, 12, 39, 15, 26, 50, 44, 23, 58, 34, 45, 53, 57, 59]
    // Mapped to TS slides (skipping IDs we don't implement: 3, 49, 23, 45, 53, 59):
    //   Cover(1) → Exec(13) → Since Inception(56) → Residents/Units(54)
    //   → Adoption Trend(6) → Projection(21) → Cohort(14) → Geographic(12)
    //   → Flex For Everyone(39) → Retention(15) → Delinquency(26) → MetroSight(50)
    //   → Peer Benchmarks(44) → Celebrate(58) → Opportunities(34) → Testimonials(57) → QBR Close(25) → Appendix
    // ─── QBR slide picker gate (qbr_slides) ──────────────────────────────────
    // The rep's picker selection, applied to BOTH the html and the per-slide extra JS below.
    // Gating the JS too is load-bearing, not tidiness: extraJs is renumbered against
    // slideIdMap, which only carries the ids of slides that actually rendered, so an excluded
    // slide's leftover `initSlideN` / `chartN` references would keep their original number and
    // could collide with whatever slide ends up renumbered ONTO that number.
    //
    // Keys are SlidesPicker's QBR_SLIDES ids; every id in that list appears exactly once here,
    // and the list carries no id that isn't here (so a rep can never tick a box that does
    // nothing). The two exceptions, both matching Flask:
    //   - imported slides (PDF upload) have no picker id and always render, at their anchor.
    //   - QBR Close is force-appended regardless of selection, exactly like Expansion's
    //     expansion_case_close (Flask app.py's own `if 46 not in active_exp_order` override).
    const pickedSlide = qbrSlidePicked(qbr_slides);
    const keepHtml = (key: string, html: string) => (pickedSlide(key) ? html : "");
    const keepJs = (key: string, js: string | undefined) => (pickedSlide(key) ? js : "");

    const slidesOrdered = [
      ...startImportsHtml,                      // Imported (PDF upload) - anchor "start"
      keepHtml("cover", renderCover(kpis)),                        // Flask slide 1  - Cover
      keepHtml("exec_summary", execResult.html),                   // Flask slide 13 - Executive Summary
      keepHtml("since_inception", sinceInceptionResult.html),      // Flask slide 56 - Bills & Rent Since Inception
      keepHtml("residents_units", residentsUnitsResult.html),      // Flask slide 54 - Residents + Units + Rent
      keepHtml("adoption_trend", adoptionTrendHtml),               // Flask slide 6  - Adoption Trend
      // New (Task 13) - Portfolio Comparison (2+ entities only). Kevin's placement: after
      // Residents Paying + Adoption Trend, before Geographic Breakdown - the table reads as the
      // per-entity breakdown of the two combined trend charts it follows.
      keepHtml("portfolio_comparison", portfolioComparisonResult.html),
      keepHtml("portfolio_projection", projResult.html),           // Flask slide 21 - Portfolio Projection
      keepHtml("cohort_overview", cohortHtml),                     // Flask slide 14 - Cohort Analysis
      keepHtml("by_state", stateResult.html),                      // Flask slide 12 - Geographic Breakdown
      keepHtml("high_rent", flexForEveryoneResult.html),           // Flask slide 39 - Flex Is For Everyone
      keepHtml("retention", retentionResult.html),                 // Flask slide 15 - Resident Retention
      keepHtml("delinquency", delinquencyResult.html),             // Flask slide 26 - Delinquency Protection
      keepHtml("rethinking_rent", metrosightFinal.html),           // Flask slide 50 - MetroSight Evidence
      keepHtml("peer_benchmarks", peerBenchResult.html),           // Flask slide 44 - Multi-metric Peer Benchmarks
      keepHtml("properties_celebrating", celebrateResult.html),    // Flask slide 58 - Properties Worth Celebrating
      keepHtml("adoption_opportunities", opportunitiesResult.html),// Flask slide 34 - Adoption Opportunities
      keepHtml("customer_experience", testimonialResult.html),     // Flask slide 57 - Customer Experience / Testimonials
      qbrFinal.html,                            // Flask slide 25 - QBR Close (always last real slide)
      keepHtml("full_property_table", propertyTableHtml),          // Appendix - Full Property Table
      ...endImportsHtml,                        // Imported (PDF upload) - anchor "end" (default)
    ].filter(Boolean) as string[];

    // ─── Renumber slideIds sequentially by document position ─────────────────
    // Each renderer assigns an arbitrary slideId used for id="slide-N", chart canvases
    // ("chartN"), and JS init functions ("initSlideN"). After .filter(Boolean) removes
    // empty slides, document positions shift. Re-stamp each slide's internal IDs so
    // they match sequential positions (1-based).
    const slideIdMap = new Map<string, string>(); // oldId → newId
    const slidesConcatenated = slidesOrdered.map((html, idx) => {
      const newId = idx + 1;
      const m = html.match(/id="slide-(\d+)"/);
      if (!m) return html;
      const oldId = m[1];
      slideIdMap.set(oldId, String(newId));
      if (oldId === String(newId)) return html;
      return renumberSlideHtml(html, oldId, String(newId));
    }).join("\n");

    // Collect extra JS from slide renderers and apply same renumbering
    // Same qbr_slides gate as slidesOrdered above - see keepJs's declaration for why an
    // excluded slide's JS must not survive into the renumbering pass.
    let extraJs = [
      keepJs("exec_summary", execResult.js),
      keepJs("since_inception", sinceInceptionResult.js),
      keepJs("portfolio_comparison", portfolioComparisonResult.js),
      keepJs("residents_units", residentsUnitsResult.js),
      keepJs("adoption_trend", adoptionTrendResult.js),
      keepJs("portfolio_projection", projResult.js),
      keepJs("by_state", stateResult.js),
      keepJs("peer_benchmarks", peerBenchResult.js),
      keepJs("high_rent", flexForEveryoneResult.js),
      keepJs("delinquency", delinquencyResult.js),
      keepJs("retention", retentionResult.js),
      keepJs("customer_experience", testimonialResult.js),
      qbrFinal.js,
    ].filter(Boolean).join("\n");
    // Apply the same slideId renumbering to JS init functions
    // Use two-pass approach to avoid double-renames (e.g., 14→9 then 9→12)
    // Pass 1: rename to temporary placeholders
    for (const [oldId, newId] of slideIdMap) {
      if (oldId === newId) continue;
      extraJs = extraJs
        .replace(new RegExp(`initSlide${oldId}\\b`, "g"), `initSlide__TMP${newId}__`)
        .replace(new RegExp(`chart${oldId}(?=['"])`, "g"), `chart__TMP${newId}__`)
        .replace(new RegExp(`#slide-${oldId}\\b`, "g"), `#slide-__TMP${newId}__`)
        .replace(new RegExp(`"slide-${oldId}"`, "g"), `"slide-__TMP${newId}__"`);
    }
    // Pass 2: strip temporary markers
    extraJs = extraJs
      .replace(/initSlide__TMP(\d+)__/g, "initSlide$1")
      .replace(/chart__TMP(\d+)__/g, "chart$1")
      .replace(/#slide-__TMP(\d+)__/g, "#slide-$1")
      .replace(/"slide-__TMP(\d+)__"/g, '"slide-$1"');

    // --- Build full deck HTML ---
    const reportMonth = monthOnly(latestCompletedMonth);
    const reportYear = yearOnly(latestCompletedMonth);
    const pdfFilename = displayName.replace(/[^a-zA-Z0-9]/g, "_") + "_deck.pdf";

    let html = applyTerminology(buildDeckHtml({
      slides: slidesConcatenated,
      pmc_name: displayName,
      report_month: reportMonth,
      report_year: reportYear,
      slide_count: slidesOrdered.length, // actual number of rendered slides
      pdf_filename: pdfFilename,
      extra_js: extraJs,
    }), terminology);
    // Swap imported-slide placeholder tokens for their real data: URIs only now, after
    // terminology substitution has already run - see the imported-slides setup above for
    // why this order matters (mirrors Flask's app.py).
    for (const [token, dataUri] of importPlaceholders) {
      html = html.replaceAll(token, dataUri);
    }

    // --- Speaker notes (downloaded client-side as a data URI, same pattern as the deck) ---
    let notesHtml: string | undefined;
    try {
      // Same target-NAR cascade renderPortfolioProjection uses above (next real peer tier up
      // from current NAR: P50 -> P75 -> P90 -> P99+2pp), so the notes explain the same number
      // the projection slide actually shows.
      // p50/p75 from the same resolved tier (same fix as renderPortfolioProjection above) -
      // p90/p99 stay on narPerc's raw snapshot since no tier here resolves those two.
      const p25 = canonicalPeerNarP25 ?? narPerc?.p25, p50 = canonicalPeerNarP50 ?? narPerc?.p50, p75 = canonicalPeerNarP75 ?? narPerc?.p75, p90 = narPerc?.p90, p99 = narPerc?.p99;
      const currentNarForTarget = latestMonth?.adoptionRate ?? 0;
      let targetNarForNotes: number;
      if (p99 != null && currentNarForTarget >= (p90 ?? Infinity)) targetNarForNotes = p99 + 0.02;
      else if (p90 != null && currentNarForTarget >= (p75 ?? Infinity)) targetNarForNotes = p90;
      else if (p75 != null && currentNarForTarget >= (p50 ?? Infinity)) targetNarForNotes = p75;
      else if (p50 != null) targetNarForNotes = p50;
      else targetNarForNotes = 0.20;
      targetNarForNotes = Math.round(targetNarForNotes * 100) / 100;

      const notesKpis: SpeakerNotesKpis = {
        pmcName: displayName,
        reportingMonth: latestCompletedMonth,
        monthsSinceLaunch,
        currentNar: currentNarForTarget,
        currentBillsPaid: latestMonth?.billsPaid ?? 0,
        currentNewSignups: latestMonth?.newSignups ?? 0,
        targetNar: targetNarForNotes,
        totalUnits: totalUnitsAll,
        currentResidents: latestMonth?.billsPaid ?? 0,
        hasNiro: false,
        dqWindowMonths,
      };
      const notesBenchmark: SpeakerNotesBenchmark = {
        benchmarkNar: canonicalPeerNarP50 ?? segmentNarAvg ?? 0.085,
        peerCount: undefined,
        p50Nar: p50 ?? null,
        p75Nar: p75 ?? null,
        p90Nar: p90 ?? null,
        p99Nar: p99 ?? null,
      };
      const notesMonthly: SpeakerNotesMonthlyRow[] = monthlyTotals.map((m) => ({
        month: m.month, billsPaid: m.billsPaid, units: m.units, rentPaid: m.rentPaid,
        newSignups: m.newSignups, propertyCount: m.propertyCount,
      }));
      // Same Flask slide-ID sequence the deck itself was just assembled from (see the
      // `slidesOrdered` array above) — notes are keyed by the real Flask slide ID, not by
      // this deck's own renumbered document position.
      // Filtered by the same qbr_slides picker gate the deck itself was gated on, so the notes
      // can't script a slide that isn't in the deck (Flask passes its own rendered_slide_ids
      // here for exactly this reason). An id with no picker key mapped to it - the close slide -
      // is always rendered, so it's always scripted.
      const QBR_NOTE_SLIDE_KEYS: Record<number, string> = {
        1: "cover", 13: "exec_summary", 56: "since_inception", 54: "residents_units",
        6: "adoption_trend", 21: "portfolio_projection", 14: "cohort_overview", 12: "by_state",
        39: "high_rent", 15: "retention", 26: "delinquency", 50: "rethinking_rent",
        44: "peer_benchmarks", 58: "properties_celebrating", 34: "adoption_opportunities",
        57: "customer_experience",
      };
      const qbrSlideIdSequence = [1, 13, 56, 54, 6, 21, 14, 12, 39, 15, 26, 50, 44, 58, 34, 57, 47]
        .filter((sid) => {
          const key = QBR_NOTE_SLIDE_KEYS[sid];
          return key === undefined || pickedSlide(key);
        });
      // Property Reference tab (Kevin's catch) — same propertySnapshot every property-level
      // slide in this deck already reads from. preMeetingFlags stays unwired (a separate,
      // pre-existing gap, not touched here).
      const qbrNotesPropertySnapshot = propertySnapshot.map((p) => ({
        propertyName: p.propertyName, units: p.units, billsPaid: p.billsPaid,
        newSignups: p.newSignups, adoptionRate: p.adoptionRate, rentPaid: p.rentPaid,
        cumRent: p.cumRent,
      }));
      notesHtml = applyTerminology(
        buildSpeakerNotesHtml(qbrSlideIdSequence, notesKpis, notesMonthly, notesBenchmark, undefined, qbrNotesPropertySnapshot),
        terminology
      );
    } catch (e) {
      console.warn(`[PMC Report] speaker notes generation failed for ${pmc_name}: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Data Workbook (Kevin's ask) - same shape/mapping as Expansion's own workbookData above,
    // just reading from QBR's own variable names (displayName instead of pmcDisplayName) for
    // the same underlying shared source data.
    const workbookData = {
      summary: {
        pmcName: displayName,
        reportingMonth: latestCompletedMonth,
        partnerSince,
        propertyCount: uniqueProperties.size,
        currentAdoptionRate: latestMonth?.adoptionRate ?? 0,
        currentResidents: latestMonth?.billsPaid ?? 0,
        currentRentPaid: latestMonth?.rentPaid ?? 0,
        lifetimeRent,
      },
      historical: monthlyTotals.map((m) => ({
        month: m.month, billsPaid: m.billsPaid, units: m.units,
        rentPaid: m.rentPaid, newSignups: m.newSignups, adoptionRate: m.adoptionRate,
      })),
      properties: propertySnapshot.map((p) => ({
        propertyName: p.propertyName, units: p.units, billsPaid: p.billsPaid,
        newSignups: p.newSignups, adoptionRate: p.adoptionRate, propertyState: p.propertyState,
        rentPaid: p.rentPaid, cumRent: p.cumRent, rolloutMonth: p.rolloutMonth,
      })),
      cohorts: cohorts.map((c) => ({
        rolloutMonth: c.rolloutMonth, propertyCount: c.propertyCount, totalUnits: c.totalUnits,
        currentResidents: c.currentResidents, currentRent: c.currentRent, cohortNar: c.cohortNar,
      })),
    };

    return { html, empty: false, notes_html: notesHtml, workbook_data: workbookData };
  },
});
