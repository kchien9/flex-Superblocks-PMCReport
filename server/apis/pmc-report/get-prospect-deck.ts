import { api, z, snowflake, restApiIntegration } from "@superblocksteam/sdk-api";
import {
  renderProspectCover,
  renderEmbedActivation,
  renderPeerPerformance,
  renderPeerRepeatUsage,
  renderRampBenchmark,
  renderFlexForEveryone,
  renderAffordableHousingSlide,
  renderProspectClose,
  type ProspectInfo,
  type PeerRow,
  type PeerMetrics,
  type TrendRow,
  type CohortRow,
  type RampRow,
  type EmbedData,
  type RentDistRow,
  type HighRentPropertyRow,
} from "./slides-prospect.js";
import { renderMetrosightEvidence } from "./slide-renderers.js";
import { renderCustomerExperience, type Testimonial } from "./slide-renderers.js";
import { renderImportedSlide } from "./slide-renderers.js";
import { geocodeAddressesConcurrent, type GeocodeDiagnostic } from "./market-map-geocode.js";
import {
  parseUpload,
  assignMarkets,
  groupPropertiesByMarket,
  pullMarketSummary,
  fetchRelevantNetworkPins,
  marketAnnualGuarantee,
  filterProspectPinsForMarket,
  filterPinsNearAny,
  summarizeStatesFromProperties,
  matchProspectOonUsage,
  sumMatchedUsageForMarket,
  type GeocodedProperty,
  type Market,
  type MarketSummary,
  type SimilarityInfo,
  type ProspectPin,
  type NetworkPin,
  type UploadParseDiagnostic,
  type ProspectUsageMatch,
} from "./market-map-data.js";
import { renderMarketMap } from "./market-map-slides.js";
import { buildProspectSpeakerNotesHtml } from "./speaker-notes.js";
import { pullPeerBenchmark, pullPeerPlatinumRate } from "./peer-benchmark.js";

const SNOWFLAKE_ID = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";
// "Census Geocoder" REST API integration, configured in Superblocks' Integrations panel.
// Replaces the raw fetch() calls market-map-geocode.ts used to make directly, which failed
// with "ReferenceError: fetch is not defined" - this server runtime has no global fetch,
// same as every other external call in this codebase (Snowflake, Salesforce, Notion,
// Anthropic all go through ctx.integrations.X too).
const CENSUS_GEOCODER_ID = "3d0e85c7-61d4-402f-bf97-64a3428c15a4";
const TBL = "PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS";

// ─── Helpers ────────────────────────────────────────────────────────────────

function bpSafeCutoff(): string {
  const now = new Date();
  const day = now.getDate();
  let cutoff: Date;
  if (day <= 5) {
    cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    cutoff = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }
  return `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * The latest fully-closed BP month = cutoff - 1 month. MUST be derived from the cutoff, not
 * from today: bpSafeCutoff() rolls to the FOLLOWING month once we're past the 5th, so deriving
 * from `now` lands a whole month behind the cutoff for ~25 days out of every month, and every
 * snapshot number on the New Logo deck (pool membership, medians, Platinum rate) then gets
 * computed against a stale month. Mirrors Flask prospect.pull_peer_benchmark:275-279.
 */
export function latestMonth(cutoff: string): string {
  const [y, m] = cutoff.split("-").map(Number);
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  return `${prevY}-${String(prevM).padStart(2, "0")}-01`;
}


function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// Resident/household terminology toggle (Kevin's ask, 2026-08-19) — see the identical helper
// in get-pmc-monthly-report.ts for the full rationale. Duplicated here (not imported) to
// match this file's existing convention of self-contained helpers with no cross-file imports.
const TERM_MAP: Record<string, string> = {
  Residents: "Households", residents: "households",
  Resident: "Household", resident: "household",
  RESIDENTS: "HOUSEHOLDS", RESIDENT: "HOUSEHOLD",
};
const TERM_MAP_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(TERM_MAP).map(([k, v]) => [v, k])
);

function applyTerminology(html: string, terminology: string | null | undefined): string {
  const mapping = terminology === "household" ? TERM_MAP : TERM_MAP_REVERSE;
  let out = html;
  for (const [src, dst] of Object.entries(mapping)) {
    out = out.replace(new RegExp(`\\b${src}\\b`, "g"), dst);
  }
  return out;
}

// ─── Schemas ────────────────────────────────────────────────────────────────

// PeerBenchmarkRow moved to peer-benchmark.ts with the pool query it schematizes.

const TrendSchema = z.object({
  BP_MONTH: z.string(),
  MEDIAN_BILLS_PAID: z.coerce.number(),
  MEDIAN_NEW_SIGNUPS: z.coerce.number(),
  MEDIAN_RENT_PAID: z.coerce.number(),
  MEDIAN_RETENTION: z.coerce.number().nullable(),
  PROPERTY_COUNT: z.coerce.number(),
});

const CohortSchema = z.object({
  LOYALTY_RATE: z.coerce.number(),
  MONTHS_AVAILABLE: z.coerce.number(),
  MONTHS_PAID: z.coerce.number(),
});

const RampSchema = z.object({
  MONTHS_SINCE_ROLLOUT: z.coerce.number(),
  MEDIAN_NAR: z.coerce.number(),
  AVG_NAR: z.coerce.number(),
  P25_NAR: z.coerce.number(),
  P75_NAR: z.coerce.number(),
  P90_NAR: z.coerce.number(),
  PROPERTY_COUNT: z.coerce.number(),
});

const AdoptionTrendRow = z.object({
  BP_MONTH: z.string(),
  NAR: z.coerce.number(),
});

// ─── API Definition ─────────────────────────────────────────────────────────

export default api({
  name: "GetProspectDeck",
  description: "Generates prospect New Logo deck with peer benchmark matching and prospect-specific slides.",

  integrations: {
    snowflake_sso: snowflake(SNOWFLAKE_ID),
    census: restApiIntegration(CENSUS_GEOCODER_ID),
  },

  input: z.object({
    prospect_name: z.string(),
    units: z.number(),
    state: z.string(),
    pms: z.string().nullable(),
    segment: z.string().nullable(),
    asset_subtypes: z.array(z.string()).nullable(),
    avg_rent: z.number().nullable(),
    footprint: z.string().nullable(),
    opp_stage: z.string().nullable(),
    portfolio_type: z.string().nullable(),
    testimonials: z.array(z.object({
      quote: z.string(),
      source: z.string().optional(),
    })).nullable(),
    property_list_csv: z.string().nullable(),
    property_list_filename: z.string().nullable(),
    // Empty/omitted = all slides (matches Flask's prospect_slides_filter default)
    prospect_slides: z.array(z.string()).nullable().optional(),
    presenting_mode: z.boolean().optional().default(false),
    // Resident/household terminology (Kevin's ask, 2026-08-19) — this is the real New Logo
    // backend (NewLogoTab.tsx calls GetProspectDeck, not get-pmc-monthly-report.ts's
    // deck_mode:"new_logo" branch, which is a different, unrelated launch-snapshot concept).
    terminology: z.enum(["resident", "household"]).optional(),
    // Slides pulled in from an uploaded PDF (Import Slides picker, Kevin's ask: PDF upload
    // across report types, not just QBR). anchor is "start" | "end" only - mirrors Flask's
    // generate_prospect() and get-pmc-monthly-report.ts's identical scope decision this
    // session (see renderImportedSlide's docstring in slide-renderers.ts for why "after a
    // specific slide" is out of scope). Plain optional, not .default([]) - same call-site-
    // required gotcha as every other optional field in this file's sibling schemas.
    imported_slides: z.array(z.object({
      anchor: z.string(),
      image_b64: z.string(),
      image_mime: z.string(),
      source_title: z.string().optional(),
      deck_title: z.string().optional(),
    })).optional(),
  }),

  output: z.object({
    slides: z.array(z.object({
      key: z.string(),
      html: z.string(),
      js: z.string(),
    })),
    notes_html: z.string().optional(),
    benchmarks: z.object({
      median_nar: z.number(),
      avg_nar: z.number(),
      pool_size: z.number(),
      match_level: z.string(),
      match_mode: z.string(),
      // Platinum comparator (DI + marketing opt-in peers) — present only when the pull succeeds.
      platinum_median_nar: z.number().optional(),
      platinum_peer_count: z.number().optional(),
      platinum_scope: z.string().optional(),
    }),
    email_draft: z.string(),
    error: z.string().nullable(),
    default_hidden_slides: z.array(z.number()),
    market_map_warning: z.string().nullable(),
    geocode_diagnostic: z.object({
      total: z.number(),
      success: z.number(),
      failed: z.number(),
      census_hits: z.number(),
      nominatim_hits: z.number(),
      errors: z.array(z.string()),
    }).nullable(),
    // TEMPORARY diagnostic — traces exactly which columns parsePropertyUpload matched and the
    // resulting units total, so a units sum that doesn't match a manual count is traceable
    // instead of guessed at (console-logged client-side, same as geocode_diagnostic).
    upload_diagnostic: z.object({
      headers_seen: z.array(z.string()),
      address_col: z.string().nullable(),
      street_col: z.string().nullable(),
      city_col: z.string().nullable(),
      state_col: z.string().nullable(),
      zip_col: z.string().nullable(),
      units_col: z.string().nullable(),
      name_col: z.string().nullable(),
      rows_in_sheet: z.number(),
      rows_parsed: z.number(),
      rows_dropped_no_address: z.number(),
      rows_trimmed_by_max_properties: z.number(),
      total_units_parsed: z.number(),
    }).nullable(),
  }),

  async run(ctx, input) {
    const {
      prospect_name,
      units,
      state: stateRaw,
      pms: pmsRaw,
      segment: segmentRaw,
      asset_subtypes: assetSubtypes,
      avg_rent: avgRentInput,
      footprint: footprintRaw,
      opp_stage: oppStage,
      portfolio_type: portfolioTypeRaw,
      testimonials,
      property_list_csv,
      property_list_filename,
      prospect_slides,
      presenting_mode,
      terminology,
      imported_slides,
    } = input;
    const prospectSlidesFilter = prospect_slides && prospect_slides.length > 0 ? new Set(prospect_slides) : null;

    // ─── Market Map: Parse + Geocode early (before peer matching) ─────────
    let geocodedProperties: GeocodedProperty[] = [];
    let marketMapWarning: string | null = null;
    let derivedStates: string[] = [];
    // The states the 5%-of-units threshold pruned out of the footprint used for peer
    // matching. Previously computed and discarded, so the prune was invisible on the deck -
    // now handed to renderMarketMap, which states it as a footnote (Flask excluded_states).
    let excludedStates: { state: string; share: number; units: number; property_count: number }[] = [];
    let geocodeDiagnostic: GeocodeDiagnostic | null = null;
    let uploadDiagnostic: UploadParseDiagnostic | null = null;

    if (property_list_csv && property_list_filename) {
      try {
        const { properties: parsed, diagnostic: parseDiag } = await parseUpload(property_list_csv, property_list_filename);
        uploadDiagnostic = parseDiag;
        if (parsed.length === 0) {
          marketMapWarning = "Property list upload was empty or could not be parsed. Market maps skipped.";
        } else {
          // Geocode all addresses
          const addresses = parsed.map(p => p.address);
          const { results: geoResults, diagnostic } = await geocodeAddressesConcurrent(addresses, ctx.integrations.census);
          geocodeDiagnostic = diagnostic;

          // Count geocoding success/failure
          const geocodeSuccessCount = diagnostic.success;
          const geocodeFailCount = diagnostic.failed;

          // Merge geocode results with parsed properties
          const withGeo = parsed.map(p => ({
            ...p,
            ...(geoResults[p.address] || {}),
          }));

          // Assign DMAs (uses csvZip fallback when geocoding returns no zip)
          geocodedProperties = await assignMarkets(withGeo, ctx.integrations.snowflake_sso);

          // Derive states for peer matching (uses csvState fallback via GeocodedProperty.state)
          const stateSummary = summarizeStatesFromProperties(geocodedProperties);
          derivedStates = stateSummary.included;
          excludedStates = stateSummary.excluded;

          // Surface a warning if geocoding failed but zip fallback saved the day
          if (geocodeFailCount > 0 && geocodeFailCount === addresses.length) {
            const dmaHits = geocodedProperties.filter(p => p.dma !== "Unknown").length;
            if (dmaHits > 0) {
              ctx.log.info("Geocoding failed for all properties but ZIP fallback assigned DMAs", { dmaHits });
            } else {
              marketMapWarning = "Could not determine markets from the uploaded property list. Ensure ZIP codes are included in your upload.";
            }
          }
        }
      } catch (e: any) {
        ctx.log.warn("Market map property list processing failed", { error: e.message });
        marketMapWarning = `Property list processing failed: ${e.message}. Market maps skipped.`;
      }
    }

    // Use derived states if available, otherwise fall back to manual input
    const states = derivedStates.length > 0
      ? derivedStates
      : (stateRaw || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    const pms = (pmsRaw || "").trim();
    const segment = (segmentRaw || "SMB").trim();
    // Auto-derive footprint from states when user hasn't manually picked one
    // (Flask app.py:2488-2493 — same _footprint_bucket logic)
    // UI sends "single_market"/"multi_state" (NewLogoTab.tsx); the footprint-bucket vocabulary
    // used everywhere else in this file (footprintBucket/ADJACENT_FOOTPRINTS) is just
    // "single"/"regional"/"multi"/"national" — without this normalization, "single_market"/
    // "multi_state" never equal any real bucket name and silently fall through to "no
    // footprint preference" (Tier 5's exact/adjacent footprint narrowing never fires).
    const FOOTPRINT_ALIASES: Record<string, string> = { single_market: "single", multi_state: "multi" };
    let footprint = (footprintRaw || "").toLowerCase();
    footprint = FOOTPRINT_ALIASES[footprint] ?? footprint;
    if (!footprint && states.length > 0) {
      const nStates = states.length;
      footprint = nStates <= 1 ? "single" : nStates <= 4 ? "regional" : nStates <= 9 ? "multi" : "national";
    }
    const portfolioType = (portfolioTypeRaw || "Multi Family");
    const isSfr = portfolioType.toLowerCase().includes("single");
    // Case-insensitive: NewLogoTab.tsx sends lowercase asset_subtypes ("affordable", "mixed"),
    // not Flask's capitalized vocabulary ("Affordable", "Mixed") — a case-sensitive .includes()
    // here means picking "Affordable/HUD" or "Mixed" in the UI never actually set these flags.
    const mixed = (assetSubtypes || []).some(s => s.toLowerCase().includes("mixed"));
    const affordable = !mixed && (assetSubtypes || []).some(s => { const sl = s.toLowerCase(); return sl.includes("affordable") || sl.includes("hud"); });
    const avgRent = avgRentInput || 0;

    const cutoff = bpSafeCutoff();
    const latestMo = latestMonth(cutoff);

    ctx.log.info("GetProspectDeck start", { prospect_name, units, states, segment, footprint });

    // ─── Step 1: Pull peer benchmark pool + 5-tier cascade ───────────────────
    // Moved verbatim to peer-benchmark.ts (no logic change) so the Embed deck's Platinum floor
    // reads the exact same pool / medians / Platinum rate this deck shows - Flask shares one
    // pull_peer_benchmark between both decks.
    const peerResult = await pullPeerBenchmark(ctx.integrations.snowflake_sso, {
      pms, states, segment, affordable, mixed, isSfr, units, footprint, avgRent, cutoff, latestMo,
    }, ctx.log);
    if (peerResult.error) {
      return {
        slides: [],
        benchmarks: { median_nar: 0, avg_nar: 0, pool_size: 0, match_level: "none", match_mode: "portfolio" },
        email_draft: "",
        error: peerResult.error,
        default_hidden_slides: [],
        market_map_warning: marketMapWarning,
        geocode_diagnostic: geocodeDiagnostic,
        upload_diagnostic: uploadDiagnostic,
      };
    }
    const { pool, peerPmcNames, benchmarks, rentFilter } = peerResult;

    // ─── Step 3: Pull supporting data ────────────────────────────────────────
    // These 4 queries are independent of each other (each only needs peerPmcNames/cutoff/
    // rentFilter/isSfr, none reads another's result) but were previously awaited one at a
    // time — fire them all together instead of paying for 4 serial Snowflake round-trips.

    // 3a. Peer monthly metrics (trend + retention)
    let trendRows: TrendRow[] = [];
    let peerMetrics: PeerMetrics = { median_bills_paid: 0, median_new_signups: 0, median_rent_paid: 0, median_retention: null, property_count: 0 };

    const pullPeerMonthlyMetrics = async () => {
    if (peerPmcNames.length > 0) {
      const pmcPlaceholders = peerPmcNames.map(() => "?").join(",");
      const trendSql = `
        WITH peer_props AS (
          SELECT t.PROPERTY_PUBLIC_ID
          FROM ${TBL} t
          WHERE t.IS_INTEGRATED_TOTAL = TRUE
            AND t.PMC_NAME IN (${pmcPlaceholders})
            AND t.ROLLOUT_MONTH IS NOT NULL
            AND t.BP_MONTH < ?
          GROUP BY t.PROPERTY_PUBLIC_ID, t.PMC_NAME
          HAVING COUNT(DISTINCT t.BP_MONTH) >= 6
            ${rentFilter}
        ),
        monthly AS (
          SELECT
            t.PROPERTY_PUBLIC_ID, t.BP_MONTH, t.BILLS_PAID_COUNT,
            t.NEW_SIGNUPS_COUNT, t.RENT_PAID_AMOUNT,
            LAG(t.BILLS_PAID_COUNT) OVER (PARTITION BY t.PROPERTY_PUBLIC_ID ORDER BY t.BP_MONTH) AS prev_bills_paid
          FROM ${TBL} t
          JOIN peer_props p ON t.PROPERTY_PUBLIC_ID = p.PROPERTY_PUBLIC_ID
          WHERE t.IS_INTEGRATED_TOTAL = TRUE
            AND t.BP_MONTH >= DATEADD('month', -12, ?)
            AND t.BP_MONTH < ?
            AND t.BILLS_PAID_COUNT > 0
        )
        SELECT
          BP_MONTH, MEDIAN(BILLS_PAID_COUNT) AS MEDIAN_BILLS_PAID,
          MEDIAN(NEW_SIGNUPS_COUNT) AS MEDIAN_NEW_SIGNUPS,
          MEDIAN(RENT_PAID_AMOUNT) AS MEDIAN_RENT_PAID,
          MEDIAN(CASE WHEN prev_bills_paid > 0 THEN (BILLS_PAID_COUNT - NEW_SIGNUPS_COUNT)::FLOAT / prev_bills_paid END) AS MEDIAN_RETENTION,
          COUNT(DISTINCT PROPERTY_PUBLIC_ID) AS PROPERTY_COUNT
        FROM monthly GROUP BY BP_MONTH ORDER BY BP_MONTH
      `;
      try {
        const rawTrend = await ctx.integrations.snowflake_sso.query(
          trendSql, TrendSchema, [...peerPmcNames, cutoff, cutoff, cutoff],
          { label: "Pull peer monthly metrics" },
        );
        if (rawTrend.length > 0) {
          trendRows = rawTrend.map(r => ({
            bp_month: r.BP_MONTH,
            median_bills_paid: r.MEDIAN_BILLS_PAID,
            median_new_signups: r.MEDIAN_NEW_SIGNUPS,
            median_rent_paid: r.MEDIAN_RENT_PAID,
            median_retention: r.MEDIAN_RETENTION ?? 0,
            property_count: r.PROPERTY_COUNT,
          }));
          const latest = rawTrend[rawTrend.length - 1];
          peerMetrics = {
            median_bills_paid: latest.MEDIAN_BILLS_PAID,
            median_new_signups: latest.MEDIAN_NEW_SIGNUPS,
            median_rent_paid: latest.MEDIAN_RENT_PAID,
            median_retention: latest.MEDIAN_RETENTION != null ? Math.min(latest.MEDIAN_RETENTION, 1.0) : null,
            property_count: latest.PROPERTY_COUNT,
          };
        }
      } catch (e: any) {
        ctx.log.warn("pull_peer_monthly_metrics failed", { error: e.message });
      }
    }
    };

    // 3b. Peer cohort (retention loyalty tiers)
    let cohortRows: CohortRow[] = [];
    const pullPeerCohort = async () => {
    if (peerPmcNames.length > 0) {
      const pmcPlaceholders = peerPmcNames.map(() => "?").join(",");
      const cohortSql = `
        WITH resident_months AS (
          SELECT CUSTOMER_PUBLIC_ID, BP_MONTH
          FROM FLEX.REPORT.RPT_RENT_CUSTOMER_STATS_MONTHLY
          WHERE PMC_NAME IN (${pmcPlaceholders})
            AND BILL_PAID_AMOUNT > 0
            AND BP_MONTH >= DATEADD('month', -13, ?)
            AND BP_MONTH < ?
        ),
        resident_stats AS (
          SELECT CUSTOMER_PUBLIC_ID,
            COUNT(DISTINCT BP_MONTH) AS months_paid,
            DATEDIFF('month', MIN(BP_MONTH), DATEADD('month', -1, ?)) + 1 AS months_available
          FROM resident_months
          GROUP BY CUSTOMER_PUBLIC_ID
          HAVING months_available >= 2
        )
        SELECT
          LEAST(months_paid::FLOAT / NULLIF(months_available, 0), 1.0) AS LOYALTY_RATE,
          months_available AS MONTHS_AVAILABLE,
          months_paid AS MONTHS_PAID
        FROM resident_stats
      `;
      try {
        const rawCohort = await ctx.integrations.snowflake_sso.query(
          cohortSql, CohortSchema, [...peerPmcNames, cutoff, cutoff, cutoff],
          { label: "Pull peer cohort" },
        );
        cohortRows = rawCohort.map(r => ({
          loyalty_rate: Math.max(0, Math.min(r.LOYALTY_RATE, 1.0)),
          months_available: r.MONTHS_AVAILABLE,
          months_paid: r.MONTHS_PAID,
        }));
      } catch (e: any) {
        ctx.log.warn("pull_peer_cohort failed", { error: e.message });
      }
    }
    };

    // 3c. Ramp curve
    let rampRows: RampRow[] = [];
    const pullRampCurve = async () => {
    if (peerPmcNames.length > 0) {
      const pmcPlaceholders = peerPmcNames.map(() => "?").join(",");
      const sfrExclusion = isSfr ? "" : "AND t.PROPERTY_UNIT_COUNT >= 5";
      const rampSql = `
        WITH peer_props AS (
          SELECT t.PROPERTY_PUBLIC_ID, MIN(t.ROLLOUT_MONTH) AS rollout_month
          FROM ${TBL} t
          WHERE t.IS_INTEGRATED_TOTAL = TRUE
            AND t.PMC_NAME IN (${pmcPlaceholders})
            AND t.ROLLOUT_MONTH IS NOT NULL
            AND t.BP_MONTH < ?
            ${sfrExclusion}
          GROUP BY t.PROPERTY_PUBLIC_ID
          HAVING COUNT(DISTINCT t.BP_MONTH) >= 4
            ${rentFilter}
        ),
        monthly_nar AS (
          SELECT t.PROPERTY_PUBLIC_ID,
            DATEDIFF('month', p.rollout_month, t.BP_MONTH) AS months_since_rollout,
            t.BILLS_PAID_COUNT::FLOAT / NULLIF(t.PROPERTY_UNIT_COUNT, 0) AS nar
          FROM ${TBL} t
          JOIN peer_props p ON t.PROPERTY_PUBLIC_ID = p.PROPERTY_PUBLIC_ID
          WHERE t.IS_INTEGRATED_TOTAL = TRUE
            AND t.BP_MONTH < ?
            AND DATEDIFF('month', p.rollout_month, t.BP_MONTH) BETWEEN 0 AND 24
        )
        SELECT months_since_rollout AS MONTHS_SINCE_ROLLOUT,
          MEDIAN(nar) AS MEDIAN_NAR, AVG(nar) AS AVG_NAR,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY nar) AS P25_NAR,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY nar) AS P75_NAR,
          PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY nar) AS P90_NAR,
          COUNT(DISTINCT PROPERTY_PUBLIC_ID) AS PROPERTY_COUNT
        FROM monthly_nar WHERE nar IS NOT NULL
        GROUP BY months_since_rollout ORDER BY months_since_rollout
      `;
      try {
        const rawRamp = await ctx.integrations.snowflake_sso.query(
          rampSql, RampSchema, [...peerPmcNames, cutoff, cutoff],
          { label: "Pull ramp curve" },
        );
        // 3-month rolling average smoothing
        const rawArr = rawRamp.map(r => ({
          months_since_rollout: r.MONTHS_SINCE_ROLLOUT,
          median_nar: r.MEDIAN_NAR,
          avg_nar: r.AVG_NAR,
          p25_nar: r.P25_NAR,
          p75_nar: r.P75_NAR,
          p90_nar: r.P90_NAR,
          property_count: r.PROPERTY_COUNT,
        }));
        // Apply 3-month centered rolling average
        rampRows = rawArr.map((row, i) => {
          const start = Math.max(0, i - 1);
          const end = Math.min(rawArr.length - 1, i + 1);
          const window = rawArr.slice(start, end + 1);
          return {
            months_since_rollout: row.months_since_rollout,
            median_nar: mean(window.map(w => w.median_nar)),
            avg_nar: mean(window.map(w => w.avg_nar)),
            p25_nar: mean(window.map(w => w.p25_nar)),
            p75_nar: mean(window.map(w => w.p75_nar)),
            p90_nar: mean(window.map(w => w.p90_nar)),
            property_count: row.property_count,
          };
        });
      } catch (e: any) {
        ctx.log.warn("pull_ramp_curve failed", { error: e.message });
      }
    }
    };

    // 3d. Per-peer adoption trend (sparklines)
    const trendMap: Record<string, number[]> = {};
    const pullPeerAdoptionTrend = async () => {
    if (peerPmcNames.length > 0) {
      const pmcPlaceholders = peerPmcNames.map(() => "?").join(",");
      const trendSql2 = `
        SELECT PMC_NAME, BP_MONTH,
          SUM(BILLS_PAID_COUNT)::FLOAT / NULLIF(SUM(PROPERTY_UNIT_COUNT), 0) AS NAR
        FROM ${TBL}
        WHERE IS_INTEGRATED_TOTAL = TRUE
          AND PMC_NAME IN (${pmcPlaceholders})
          AND BP_MONTH >= DATEADD('month', -6, ?)
          AND BP_MONTH < ?
          AND BILLS_PAID_COUNT > 0
        GROUP BY PMC_NAME, BP_MONTH
        ORDER BY PMC_NAME, BP_MONTH
      `;
      try {
        const trendRows2 = await ctx.integrations.snowflake_sso.query(
          trendSql2,
          z.object({ PMC_NAME: z.string(), BP_MONTH: z.string(), NAR: z.coerce.number() }),
          [...peerPmcNames, cutoff, cutoff],
          { label: "Pull peer adoption trends" },
        );
        for (const r of trendRows2) {
          if (!trendMap[r.PMC_NAME]) trendMap[r.PMC_NAME] = [];
          trendMap[r.PMC_NAME].push(r.NAR);
        }
      } catch (e: any) {
        ctx.log.warn("pull_peer_adoption_trend failed", { error: e.message });
      }
    }
    };

    // 3e. Platinum comparator for the embed-activation slide - peer-benchmark.ts's
    // pullPeerPlatinumRate (moved there with the pool cascade so the Embed deck reads the same
    // rate). Any failure / no rows -> keys stay absent -> old comparator.
    const applyPlatinumRate = async () => {
      const plat = await pullPeerPlatinumRate(ctx.integrations.snowflake_sso, latestMo, peerPmcNames, ctx.log);
      if (!plat) return;
      benchmarks.platinum_median_nar = plat.platinum_median_nar;
      benchmarks.platinum_peer_count = plat.platinum_peer_count;
      benchmarks.platinum_scope = plat.platinum_scope;
    };

    await Promise.all([
      pullPeerMonthlyMetrics(),
      pullPeerCohort(),
      pullRampCurve(),
      pullPeerAdoptionTrend(),
      applyPlatinumRate(),
    ]);

    // ─── Step 4: Build pool for renderers ────────────────────────────────────
    const poolForRender: PeerRow[] = pool.map((r: any) => ({
      total_units: r.TOTAL_UNITS,
      avg_rent: r.AVG_RENT || 0,
      current_adoption: r.CURRENT_ADOPTION,
      current_monthly_rent: r.CURRENT_MONTHLY_RENT,
      new_signups: r.NEW_SIGNUPS,
      months_live: r.MONTHS_LIVE,
      pms: r.PMS || "",
      property_count: r.PROPERTY_COUNT,
      dq_shielded_mo: r.DQ_SHIELDED_MO || 0,
      primary_state: r.PRIMARY_STATE || "",
      state_count: r.STATE_COUNT || 1,
      trend: trendMap[r.PMC_NAME] || [],
      overlap_states: r.OVERLAP_STATES || "",
    }));

    // ─── Step 5: Render slides ───────────────────────────────────────────────
    const prospect: ProspectInfo = {
      name: prospect_name,
      units,
      state: stateRaw,
      pms,
      segment,
      opp_stage: oppStage || "",
      affordable,
      asset_subtypes: assetSubtypes || [],
      avg_rent: avgRent > 0 ? avgRent : benchmarks.median_avg_rent,
      footprint,
    };

    const slides: { key: string; html: string; js: string }[] = [];
    let slideId = 0;

    // Imported slides (PDF upload / Google Slides picker) - start/end anchors only (Kevin's
    // ask: PDF upload across report types, not just QBR; same start/end-only scope as the
    // QBR and Expansion routes' identical handling - see renderImportedSlide's docstring in
    // slide-renderers.ts). image_b64 rides as an opaque placeholder token until AFTER the
    // per-slide terminology map runs below (termedSlides), then gets swapped for the real
    // data: URI - skipping that and embedding raw base64 directly would risk termedSlides'
    // \bword\b-boundary regex corrupting it, same reasoning as every other route's imports
    // handling this session.
    const importPlaceholders = new Map<string, string>();
    const startImports: { token: string; sourceTitle: string; deckTitle: string }[] = [];
    const endImports: { token: string; sourceTitle: string; deckTitle: string }[] = [];
    (imported_slides ?? []).forEach((imp, idx) => {
      const token = `__FLEX_IMPORTED_SLIDE_N${idx}__`;
      importPlaceholders.set(token, `data:${imp.image_mime || "image/png"};base64,${imp.image_b64 || ""}`);
      const entry = { token, sourceTitle: imp.source_title ?? "", deckTitle: imp.deck_title ?? "" };
      if (imp.anchor === "start") startImports.push(entry); else endImports.push(entry);
    });
    for (const imp of startImports) {
      slideId++;
      const r = renderImportedSlide(slideId, imp.token, imp.sourceTitle, imp.deckTitle);
      slides.push({ key: `imported:${imp.token}`, html: r.html, js: r.js });
    }

    // Cover
    slideId++;
    const cover = renderProspectCover(slideId, prospect, benchmarks);
    if (cover.html) slides.push({ key: "cover", html: cover.html, js: cover.js });

    // Peer Performance (Peer Proof Table)
    slideId++;
    const peerPerf = renderPeerPerformance(slideId, benchmarks, peerMetrics, poolForRender);
    if (peerPerf.html) slides.push({ key: "peer_perf", html: peerPerf.html, js: peerPerf.js });

    // Peer Retention
    slideId++;
    const peerRet = renderPeerRepeatUsage(slideId, trendRows, peerMetrics, benchmarks, cohortRows);
    if (peerRet.html) slides.push({ key: "peer_retention", html: peerRet.html, js: peerRet.js });

    // ─── Flex For Everyone (high_rent) slide ─────────────────────────────────
    // Port of app.py:2617-2637 — two branches: affordable → static slide, else → chart+cards
    slideId++;
    if (affordable) {
      const affSlide = renderAffordableHousingSlide(slideId);
      if (affSlide.html) slides.push({ key: "high_rent", html: affSlide.html, js: affSlide.js });
    } else {
      // 1. Pull rent distribution (peer first, fallback to network)
      let rentDistRows: RentDistRow[] = [];
      let rentSource: "peer" | "network" = "network";

      if (peerPmcNames.length > 0) {
        try {
          // First get dynamic breakpoints for peer set
          const pmcPlaceholders = peerPmcNames.map(() => "?").join(",");
          const peerRentFilter = "AND (SUM(RENT_PAID_AMOUNT) / NULLIF(SUM(CHARGED_USERS_COUNT), 0)) >= 600";
          const breaksSql = `
            SELECT SUM(RENT_PAID_AMOUNT) / NULLIF(SUM(CHARGED_USERS_COUNT), 0) AS avg_rent
            FROM ${TBL}
            WHERE IS_INTEGRATED_TOTAL = TRUE
              AND ROLLOUT_MONTH IS NOT NULL
              AND PMC_NAME IN (${pmcPlaceholders})
              AND BP_MONTH >= DATEADD('month', -12, ?)
              AND BP_MONTH < ?
              AND CHARGED_USERS_COUNT > 0
              AND PROPERTY_UNIT_COUNT >= 30
            GROUP BY PROPERTY_NAME
            HAVING COUNT(DISTINCT BP_MONTH) >= 4
              AND AVG(CHARGED_USERS_COUNT * 1.0 / NULLIF(PROPERTY_UNIT_COUNT, 0)) >= 0.03
              ${peerRentFilter}
          `;
          const breaksRows = await ctx.integrations.snowflake_sso.query(
            breaksSql,
            z.object({ AVG_RENT: z.coerce.number().nullable() }),
            [...peerPmcNames, cutoff, cutoff],
            { label: "Peer rent breaks" },
          );
          let breaks = [1000, 1500, 2000]; // default
          const rents = breaksRows.map(r => r.AVG_RENT).filter((v): v is number => v !== null && v > 0);
          if (rents.length >= 4) {
            rents.sort((a, b) => a - b);
            const lo = rents[Math.floor(rents.length * 0.05)];
            const hi = rents[Math.floor(rents.length * 0.95)];
            if (hi > lo) {
              const medianRent = rents[Math.floor(rents.length / 2)];
              const snap = medianRent >= 2000 ? 500 : 250;
              const loSnap = Math.max(snap, Math.round(lo / snap) * snap);
              const hiSnap = Math.max(loSnap + snap, Math.round(hi / snap) * snap);
              const targetBuckets = 5;
              const width = Math.max(snap, Math.round((hiSnap - loSnap) / targetBuckets / snap) * snap);
              const dynamicBreaks: number[] = [];
              let b = loSnap;
              while (b < hiSnap && dynamicBreaks.length < targetBuckets) {
                dynamicBreaks.push(b);
                b += width;
              }
              if (dynamicBreaks.length >= 2) breaks = [...new Set(dynamicBreaks)].sort((a, b2) => a - b2);
            }
          }

          // Build bucket SQL using dynamic breaks
          const bucketLabels = [
            `Under $${breaks[0].toLocaleString()}`,
            ...breaks.slice(0, -1).map((v, i) => `$${v.toLocaleString()}-$${breaks[i + 1].toLocaleString()}`),
            `$${breaks[breaks.length - 1].toLocaleString()}+`,
          ];
          const caseWhen = breaks.map((b, i) => `WHEN avg_rent < ${b} THEN ${i + 1}`).join("\n                    ");
          const nBuckets = bucketLabels.length;
          const labelWhen = bucketLabels.map((lbl, i) => `WHEN ${i + 1} THEN '${lbl}'`).join("\n                ");

          const rentDistSql = `
            WITH props AS (
              SELECT
                PROPERTY_NAME,
                SUM(RENT_PAID_AMOUNT) / NULLIF(SUM(CHARGED_USERS_COUNT), 0) AS avg_rent,
                AVG(CHARGED_USERS_COUNT * 1.0 / NULLIF(PROPERTY_UNIT_COUNT, 0)) AS avg_nar,
                SUM(RENT_PAID_AMOUNT) / 12.0 AS monthly_rent,
                SUM(CHARGED_USERS_COUNT) / 12.0 AS avg_monthly_users
              FROM ${TBL}
              WHERE IS_INTEGRATED_TOTAL = TRUE
                AND ROLLOUT_MONTH IS NOT NULL
                AND PMC_NAME IN (${pmcPlaceholders})
                AND BP_MONTH >= DATEADD('month', -12, ?)
                AND BP_MONTH < ?
                AND CHARGED_USERS_COUNT > 0
                AND PROPERTY_UNIT_COUNT >= 30
              GROUP BY PROPERTY_NAME
              HAVING COUNT(DISTINCT BP_MONTH) >= 4
                AND AVG(CHARGED_USERS_COUNT * 1.0 / NULLIF(PROPERTY_UNIT_COUNT, 0)) >= 0.03
                ${peerRentFilter}
            ),
            bucketed AS (
              SELECT
                CASE
                    ${caseWhen}
                    ELSE ${nBuckets}
                END AS bucket_rank,
                avg_nar,
                monthly_rent,
                avg_monthly_users
              FROM props
              WHERE avg_rent IS NOT NULL AND avg_rent > 0
            )
            SELECT
              CASE bucket_rank
                  ${labelWhen}
              END AS RENT_BUCKET,
              MEDIAN(avg_nar) AS MEDIAN_NAR,
              SUM(monthly_rent) AS TOTAL_MONTHLY_RENT,
              SUM(avg_monthly_users) AS TOTAL_MONTHLY_USERS,
              COUNT(*) AS PROPERTY_COUNT
            FROM bucketed
            GROUP BY bucket_rank
            ORDER BY bucket_rank
          `;
          const RentDistSchema = z.object({
            RENT_BUCKET: z.string(),
            MEDIAN_NAR: z.coerce.number(),
            TOTAL_MONTHLY_RENT: z.coerce.number(),
            TOTAL_MONTHLY_USERS: z.coerce.number(),
            PROPERTY_COUNT: z.coerce.number(),
          });
          const peerRentResult = await ctx.integrations.snowflake_sso.query(
            rentDistSql, RentDistSchema, [...peerPmcNames, cutoff, cutoff],
            { label: "Peer rent distribution" },
          );
          const bucketsWithData = peerRentResult.filter(r => r.PROPERTY_COUNT > 0).length;
          if (bucketsWithData >= 3) {
            rentDistRows = peerRentResult.map(r => ({
              rent_bucket: r.RENT_BUCKET,
              median_nar: r.MEDIAN_NAR,
              total_monthly_rent: r.TOTAL_MONTHLY_RENT,
              total_monthly_users: r.TOTAL_MONTHLY_USERS,
              property_count: r.PROPERTY_COUNT,
            }));
            rentSource = "peer";
          }
        } catch (e: any) {
          ctx.log.warn("peer rent distribution failed, trying network", { error: e.message });
        }
      }

      // Network fallback if peer didn't produce enough data
      if (rentDistRows.length === 0) {
        try {
          const networkRentFilter = "AND (SUM(RENT_PAID_AMOUNT) / NULLIF(SUM(CHARGED_USERS_COUNT), 0)) >= 600";
          const networkRentSql = `
            WITH props AS (
              SELECT
                PROPERTY_NAME,
                SUM(RENT_PAID_AMOUNT) / NULLIF(SUM(CHARGED_USERS_COUNT), 0) AS avg_rent,
                AVG(CHARGED_USERS_COUNT * 1.0 / NULLIF(PROPERTY_UNIT_COUNT, 0)) AS avg_nar,
                SUM(RENT_PAID_AMOUNT) / 12.0 AS monthly_rent,
                SUM(CHARGED_USERS_COUNT) / 12.0 AS avg_monthly_users
              FROM ${TBL}
              WHERE IS_INTEGRATED_TOTAL = TRUE
                AND ROLLOUT_MONTH IS NOT NULL
                AND BP_MONTH >= DATEADD('month', -12, ?)
                AND BP_MONTH < ?
                AND CHARGED_USERS_COUNT > 0
                AND PROPERTY_UNIT_COUNT >= 30
              GROUP BY PROPERTY_NAME
              HAVING COUNT(DISTINCT BP_MONTH) >= 4
                AND AVG(CHARGED_USERS_COUNT * 1.0 / NULLIF(PROPERTY_UNIT_COUNT, 0)) >= 0.03
                ${networkRentFilter}
            ),
            bucketed AS (
              SELECT
                CASE
                    WHEN avg_rent < 1000 THEN 1
                    WHEN avg_rent < 1500 THEN 2
                    WHEN avg_rent < 2000 THEN 3
                    ELSE 4
                END AS bucket_rank,
                avg_nar,
                monthly_rent,
                avg_monthly_users
              FROM props
              WHERE avg_rent IS NOT NULL AND avg_rent > 0
            )
            SELECT
              CASE bucket_rank
                  WHEN 1 THEN 'Under $1,000'
                  WHEN 2 THEN '$1,000-$1,500'
                  WHEN 3 THEN '$1,500-$2,000'
                  WHEN 4 THEN '$2,000+'
              END AS RENT_BUCKET,
              MEDIAN(avg_nar) AS MEDIAN_NAR,
              SUM(monthly_rent) AS TOTAL_MONTHLY_RENT,
              SUM(avg_monthly_users) AS TOTAL_MONTHLY_USERS,
              COUNT(*) AS PROPERTY_COUNT
            FROM bucketed
            GROUP BY bucket_rank
            ORDER BY bucket_rank
          `;
          const RentDistSchema2 = z.object({
            RENT_BUCKET: z.string(),
            MEDIAN_NAR: z.coerce.number(),
            TOTAL_MONTHLY_RENT: z.coerce.number(),
            TOTAL_MONTHLY_USERS: z.coerce.number(),
            PROPERTY_COUNT: z.coerce.number(),
          });
          const networkResult = await ctx.integrations.snowflake_sso.query(
            networkRentSql, RentDistSchema2, [cutoff, cutoff],
            { label: "Network rent distribution" },
          );
          rentDistRows = networkResult.map(r => ({
            rent_bucket: r.RENT_BUCKET,
            median_nar: r.MEDIAN_NAR,
            total_monthly_rent: r.TOTAL_MONTHLY_RENT,
            total_monthly_users: r.TOTAL_MONTHLY_USERS,
            property_count: r.PROPERTY_COUNT,
          }));
          rentSource = "network";
        } catch (e: any) {
          ctx.log.warn("network rent distribution failed", { error: e.message });
        }
      }

      // 2. Pull high-rent property cards (network-wide fallback for cards view)
      let highRentProperties: HighRentPropertyRow[] = [];
      try {
        const highRentSql = `
          SELECT
            PROPERTY_STATE,
            MAX(PROPERTY_UNIT_COUNT) AS PROPERTY_UNIT_COUNT,
            SUM(RENT_PAID_AMOUNT) / NULLIF(SUM(CHARGED_USERS_COUNT), 0) AS AVG_RENT,
            AVG(CHARGED_USERS_COUNT) AS AVG_MONTHLY_USERS,
            AVG(CHARGED_USERS_COUNT * 1.0 / NULLIF(PROPERTY_UNIT_COUNT, 0)) AS AVG_NAR
          FROM ${TBL}
          WHERE IS_INTEGRATED_TOTAL = TRUE
            AND BP_MONTH >= DATEADD('month', -12, CURRENT_DATE())
            AND BP_MONTH < DATEADD('month', -1, DATE_TRUNC('month', CURRENT_DATE()))
            AND CHARGED_USERS_COUNT > 0
            AND ROLLOUT_MONTH IS NOT NULL
            AND ROLLOUT_MONTH < DATEADD('month', -3, DATE_TRUNC('month', CURRENT_DATE()))
          GROUP BY PROPERTY_NAME, PROPERTY_STATE, PMC_NAME
          HAVING COUNT(DISTINCT BP_MONTH) >= 3
            AND MAX(PROPERTY_UNIT_COUNT) >= 50
            AND AVG(CHARGED_USERS_COUNT) >= 5
            AND SUM(RENT_PAID_AMOUNT) / NULLIF(SUM(CHARGED_USERS_COUNT), 0) >= 1800
            AND AVG(CHARGED_USERS_COUNT * 1.0 / NULLIF(PROPERTY_UNIT_COUNT, 0)) >= 0.08
          ORDER BY AVG_RENT DESC
          LIMIT 30
        `;
        const HighRentSchema = z.object({
          PROPERTY_STATE: z.string().nullable(),
          PROPERTY_UNIT_COUNT: z.coerce.number(),
          AVG_RENT: z.coerce.number(),
          AVG_MONTHLY_USERS: z.coerce.number(),
          AVG_NAR: z.coerce.number(),
        });
        const hrRows = await ctx.integrations.snowflake_sso.query(
          highRentSql, HighRentSchema, [],
          { label: "High-rent properties for Flex For Everyone" },
        );
        highRentProperties = hrRows.map(r => ({
          property_state: r.PROPERTY_STATE || "",
          property_unit_count: r.PROPERTY_UNIT_COUNT,
          avg_rent: r.AVG_RENT,
          avg_monthly_users: r.AVG_MONTHLY_USERS,
          avg_nar: r.AVG_NAR,
        }));
      } catch (e: any) {
        ctx.log.warn("pull_peer_high_rent_properties failed", { error: e.message });
      }

      // 3. Render the slide
      const highRentSlide = renderFlexForEveryone(slideId, highRentProperties, rentDistRows, rentSource);
      if (highRentSlide.html) slides.push({ key: "high_rent", html: highRentSlide.html, js: highRentSlide.js });
    }

    // MetroSight Evidence (already exists in slide-renderers.ts)
    slideId++;
    const metroInput = {
      slideId,
      pmcName: prospect_name,
      totalUnits: units,
      avgRent: prospect.avg_rent || benchmarks.median_avg_rent || 1500,
    };
    const metro = renderMetrosightEvidence(metroInput);
    if (metro.html) slides.push({ key: "metrosight", html: metro.html, js: metro.js });

    // Ramp Benchmark
    slideId++;
    const ramp = renderRampBenchmark(slideId, rampRows, benchmarks, prospect, "peer");
    if (ramp.html) slides.push({ key: "ramp", html: ramp.html, js: ramp.js });

    // ─── Market Map slides (after ramp, before testimonials/close) ─────────
    const marketMapRanks: number[] = [];
    if (geocodedProperties.length > 0 && !marketMapWarning) {
      try {
        const markets = groupPropertiesByMarket(geocodedProperties);
        const bpMonth = latestMo;
        const yearStart = `${new Date().getFullYear()}-01-01`;

        // Compute prospect's average units per property for similarity filtering
        const totalProspectUnits = geocodedProperties.reduce((acc, p) => acc + (p.units || 0), 0);
        const avgUnitsPerProperty = geocodedProperties.length > 0
          ? totalProspectUnits / geocodedProperties.length
          : 0;

        // Pull summaries for all qualifying DMAs (with similarity filtering)
        const allDmas = [...new Set(markets.flatMap(m => m.sub_markets))];
        const summaryByDma: Record<string, MarketSummary> = {};
        // Use peer median rent as fallback when user hasn't typed a value, so
        // Market Map's similarity filter stays consistent with the main benchmark calc.
        const effectiveRentForMap = avgRentInput || benchmarks.median_avg_rent || 0;
        for (const dma of allDmas) {
          summaryByDma[dma] = await pullMarketSummary(dma, bpMonth, yearStart, ctx.integrations.snowflake_sso, {
            avgRent: effectiveRentForMap,
            avgUnitsPerProperty,
          });
        }

        // Build similarity-by-DMA map for pin filtering
        const similarityByDma: Record<string, SimilarityInfo | null> = {};
        for (const dma of allDmas) {
          similarityByDma[dma] = summaryByDma[dma]?.similarity ?? null;
        }

        // Compute annual guarantee for ranking
        const marketsWithGuarantee = markets.map(m => {
          const totals = {
            total_properties: m.sub_markets.reduce((acc, d) => acc + (summaryByDma[d]?.total_properties ?? 0), 0),
            total_pmcs: m.sub_markets.reduce((acc, d) => acc + (summaryByDma[d]?.total_pmcs ?? 0), 0),
            total_units: m.sub_markets.reduce((acc, d) => acc + (summaryByDma[d]?.total_units ?? 0), 0),
            total_active_users: m.sub_markets.reduce((acc, d) => acc + (summaryByDma[d]?.total_active_users ?? 0), 0),
            avg_adoption: 0,
            rent_paid_month: m.sub_markets.reduce((acc, d) => acc + (summaryByDma[d]?.rent_paid_month ?? 0), 0),
            total_rent_paid_all_time: m.sub_markets.reduce((acc, d) => acc + (summaryByDma[d]?.total_rent_paid_all_time ?? 0), 0),
            new_properties_this_year: m.sub_markets.reduce((acc, d) => acc + (summaryByDma[d]?.new_properties_this_year ?? 0), 0),
            new_pmcs_this_year: m.sub_markets.reduce((acc, d) => acc + (summaryByDma[d]?.new_pmcs_this_year ?? 0), 0),
            new_properties_rent_paid: m.sub_markets.reduce((acc, d) => acc + (summaryByDma[d]?.new_properties_rent_paid ?? 0), 0),
          };
          const totalBillsPaid = m.sub_markets.reduce(
            (acc, d) => acc + (summaryByDma[d]?.total_units ?? 0) * (summaryByDma[d]?.avg_adoption ?? 0), 0
          );
          totals.avg_adoption = totals.total_units > 0 ? totalBillsPaid / totals.total_units : 0;
          const guarantee = marketAnnualGuarantee(totals, m.prospect_units, avgRentInput);
          return { market: m, guarantee: guarantee.annual_guarantee };
        });

        // Sort by annual guarantee descending
        marketsWithGuarantee.sort((a, b) => b.guarantee - a.guarantee);

        // Match prospect properties against Flex's own network once, up front, for the
        // "already seeing usage" callout (Kevin's ask) - index-aligned with geocodedProperties,
        // not a join key, so every per-market slide below just re-slices this same array
        // instead of re-querying per market.
        // OON self-serve usage check only (Kevin's catch: an earlier version also checked
        // in-network usage, but for a New Logo deck that's logically almost contradictory - a
        // real match is more likely a stale/former PMC instance than the prospect's own
        // situation - see the note above matchProspectOonUsage in market-map-data.ts).
        const oonUsageMatches: ProspectUsageMatch[] = await matchProspectOonUsage(
          geocodedProperties, bpMonth, yearStart, ctx.integrations.snowflake_sso
        );

        // Render each market map slide
        for (let rank = 0; rank < marketsWithGuarantee.length; rank++) {
          const { market } = marketsWithGuarantee[rank];
          marketMapRanks.push(rank);

          // Prospect pins in this market
          const rawProspectPins: ProspectPin[] = geocodedProperties
            .map((p, i) => ({ p, i }))
            .filter(({ p }) => market.sub_markets.includes(p.dma))
            .map(({ p, i }) => ({
              property_name: p.property_name, lat: p.lat, lon: p.lon,
              has_oon_usage: oonUsageMatches[i]?.matched ?? false,
            }));

          const marketOonUsage = sumMatchedUsageForMarket(geocodedProperties, oonUsageMatches, market.sub_markets);

          // Network pins (with escalation + similarity filtering)
          const networkPins = await fetchRelevantNetworkPins(
            market.sub_markets, bpMonth, yearStart, rawProspectPins, ctx.integrations.snowflake_sso, similarityByDma
          );

          // Outlier filter on prospect pins (anchor on combined centroid)
          const prospectPins = filterProspectPinsForMarket(rawProspectPins, networkPins);

        // Filter network pins to only those near prospect's cleaned pins
        const filteredNetworkPins = prospectPins.length > 0
          ? filterPinsNearAny(networkPins, prospectPins) as NetworkPin[]
          : networkPins;

          slideId++;
          const mapSlide = renderMarketMap(
            slideId, market, summaryByDma, prospectPins,
            filteredNetworkPins.slice(0, 300), market.prospect_units, avgRentInput, marketOonUsage,
            null, excludedStates
          );
          if (mapSlide.html) slides.push({ key: "market_map", html: mapSlide.html, js: mapSlide.js });
        }
      } catch (e: any) {
        ctx.log.warn("Market map slide generation failed", { error: e.message });
        marketMapWarning = `Market map generation failed: ${e.message}. Rest of deck generated normally.`;
      }
    }

    // Testimonials (if provided)
    if (testimonials && testimonials.length > 0) {
      slideId++;
      const mappedTestimonials: Testimonial[] = testimonials.map((t) => ({
        name: t.source || "Customer",
        property: "",
        quote: t.quote,
      }));
      const test = renderCustomerExperience({
        slideId,
        testimonials: mappedTestimonials,
        trend: { csatByMonth: [], responseByMonth: [] },
      });
      if (test.html) slides.push({ key: "testimonials", html: test.html, js: test.js });
    }

    // Close
    slideId++;
    const close = renderProspectClose(slideId, prospect, benchmarks);
    if (close.html) slides.push({ key: "close", html: close.html, js: close.js });

    // ─── Step 6: Email draft ─────────────────────────────────────────────────
    const pnar = benchmarks.median_nar;
    const ppool = benchmarks.pool_size;
    // median_avg_rent is the peer group's per-unit average rent — median_monthly_rent is each
    // peer's portfolio-wide TOTAL rent, not a per-unit figure. The old formula's
    // `/ Math.max(units * pnar, 1)` division was meant to fix that scale mismatch but instead
    // cancels the whole `units` term back out algebraically (units*pnar*(prent/(units*pnar)) =
    // prent), so every prospect was quoted the identical dollar figure regardless of portfolio
    // size. Flask's fixed version (app.py) drops the division and uses the real per-unit rent.
    const prent = benchmarks.median_avg_rent;
    const moTotal = units * pnar * prent;
    const moStr = moTotal >= 1e9 ? `$${(moTotal / 1e9).toFixed(2)}B` : moTotal >= 1e6 ? `$${(moTotal / 1e6).toFixed(1)}M` : `$${(moTotal / 1e3).toFixed(0)}K`;
    const peerLine = `Comparable PMCs average ${(pnar * 100).toFixed(1)}% adoption — at that rate on ${units.toLocaleString()} units, that's ${moStr}/mo in guaranteed rent.`;
    const emailDraft = `Hi [First Name],\n\nAttaching a data-driven overview of what Flex looks like at ${prospect_name}'s scale — built from ${ppool} comparable PMCs on the platform today.\n\n• ${peerLine}\n• Median PMC has been on Flex 65 months — this isn't new or unproven.\n• Retention: 94% of residents who used Flex one month paid through it again the next.\n\nHappy to walk through it — takes 20 minutes. Let me know.\n\n[Your name]`;

    // ─── Slide picker filter ────────────────────────────────────────────────
    // Empty/omitted prospectSlidesFilter = all slides (matches Flask's prospect_slides_filter
    // default). Applied before renumbering below so positions are computed from the final,
    // filtered set — not from the full unfiltered one.
    if (prospectSlidesFilter) {
      const filtered = slides.filter((s) => prospectSlidesFilter.has(s.key));
      slides.splice(0, slides.length, ...filtered);
    }

    // ─── Renumber slideIds sequentially by document position ─────────────────
    // `slideId` advances via `slideId++` on every slide attempt, even when that slide returns
    // empty html and never gets pushed (e.g. the affordable/high_rent branch, or a metro/ramp
    // slide with no qualifying data) — so a later slide's baked-in id="slide-N"/chartN/
    // initSlideN can end up not matching its real position once earlier empty slides are
    // skipped. The client's slide navigation (wrap-slides-html.ts) looks up slides by
    // `id="slide-" + position`, so this must match exactly — same fix already applied on the
    // QBR path in get-pmc-monthly-report.ts.
    for (let i = 0; i < slides.length; i++) {
      const newId = i + 1;
      const m = slides[i].html.match(/id="slide-(\d+)"/);
      if (!m) continue;
      const oldId = m[1];
      if (oldId === String(newId)) continue;
      const renumber = (s: string) => s
        .replace(new RegExp(`id="slide-${oldId}"`, "g"), `id="slide-${newId}"`)
        .replace(new RegExp(`#slide-${oldId}\\b`, "g"), `#slide-${newId}`)
        .replace(new RegExp(`id="chart${oldId}"`, "g"), `id="chart${newId}"`)
        .replace(new RegExp(`chart${oldId}(?=['"])`, "g"), `chart${newId}`)
        .replace(new RegExp(`initSlide${oldId}`, "g"), `initSlide${newId}`)
        .replace(new RegExp(`slide-${oldId}(?=['"\\.\\s])`, "g"), `slide-${newId}`);
      slides[i] = { ...slides[i], html: renumber(slides[i].html), js: renumber(slides[i].js) };
    }

    // ─── Compute default-hidden slides (market maps ranked 5+) ──────────────
    const defaultHiddenSlides: number[] = [];
    let mapRankIdx = 0;
    for (let i = 0; i < slides.length; i++) {
      if (slides[i].key === "market_map") {
        if (marketMapRanks[mapRankIdx] >= 5) {
          defaultHiddenSlides.push(i + 1); // 1-indexed
        }
        mapRankIdx++;
      }
    }

    // ─── Speaker notes (presenting mode only, matching Flask) ────────────────
    let prospectNotesHtml: string | undefined;
    if (presenting_mode) {
      try {
        prospectNotesHtml = buildProspectSpeakerNotesHtml(slides.map((s) => s.key), {
          name: prospect_name,
          poolSize: benchmarks.pool_size,
          medianNar: benchmarks.median_nar,
          matchLevel: benchmarks.match_level,
          ownAvgRent: avgRentInput || null,
          medianAvgRent: benchmarks.median_avg_rent,
        });
      } catch (e) {
        ctx.log.warn("prospect speaker notes generation failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // "end"-anchored imports are appended AFTER speaker notes are generated - notes are keyed
    // off slides.map(s => s.key), and an imported external slide has no real content to build
    // notes from, same reasoning Flask's rendered_named_slides deliberately excludes them.
    for (const imp of endImports) {
      slideId++;
      const r = renderImportedSlide(slideId, imp.token, imp.sourceTitle, imp.deckTitle);
      slides.push({ key: `imported:${imp.token}`, html: r.html, js: r.js });
    }

    // Resident/household terminology (Kevin's ask) — applied once here, to every fully-
    // assembled piece of output text, same as get-pmc-monthly-report.ts's deck/notes.
    let termedSlides = slides.map((s) => ({ ...s, html: applyTerminology(s.html, terminology) }));
    // Swap imported-slide placeholder tokens for their real data: URIs only now, after
    // terminology substitution has already run (see the imports setup above for why).
    termedSlides = termedSlides.map((s) => {
      let html = s.html;
      for (const [token, dataUri] of importPlaceholders) html = html.replaceAll(token, dataUri);
      return { ...s, html };
    });
    const termedNotesHtml = prospectNotesHtml != null ? applyTerminology(prospectNotesHtml, terminology) : prospectNotesHtml;
    const termedEmailDraft = applyTerminology(emailDraft, terminology);

    return {
      slides: termedSlides,
      notes_html: termedNotesHtml,
      benchmarks: {
        median_nar: benchmarks.median_nar,
        avg_nar: benchmarks.avg_nar,
        pool_size: benchmarks.pool_size,
        match_level: benchmarks.match_level,
        match_mode: benchmarks.match_mode,
        platinum_median_nar: benchmarks.platinum_median_nar,
        platinum_peer_count: benchmarks.platinum_peer_count,
        platinum_scope: benchmarks.platinum_scope,
      },
      email_draft: termedEmailDraft,
      error: null,
      default_hidden_slides: defaultHiddenSlides,
      market_map_warning: marketMapWarning,
      geocode_diagnostic: geocodeDiagnostic,
      upload_diagnostic: uploadDiagnostic,
    };
  },
});
