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
  type Benchmarks,
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
import { STATE_TO_REGION } from "./peer-matching.js";
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
  deriveStatesFromProperties,
  type GeocodedProperty,
  type Market,
  type MarketSummary,
  type SimilarityInfo,
  type ProspectPin,
  type NetworkPin,
  type UploadParseDiagnostic,
} from "./market-map-data.js";
import { renderMarketMap } from "./market-map-slides.js";
import { buildProspectSpeakerNotesHtml } from "./speaker-notes.js";

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

function latestMonth(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-01`;
}


function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(arr: number[], q: number): number {
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

const PeerBenchmarkRow = z.object({
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
    } = input;
    const prospectSlidesFilter = prospect_slides && prospect_slides.length > 0 ? new Set(prospect_slides) : null;

    // ─── Market Map: Parse + Geocode early (before peer matching) ─────────
    let geocodedProperties: GeocodedProperty[] = [];
    let marketMapWarning: string | null = null;
    let derivedStates: string[] = [];
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
          derivedStates = deriveStatesFromProperties(geocodedProperties);

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
    const latestMo = latestMonth();

    ctx.log.info("GetProspectDeck start", { prospect_name, units, states, segment, footprint });

    // ─── Step 1: Pull peer benchmark pool ────────────────────────────────────
    // Simplified port of pull_peer_benchmark - runs the new SQL only (no shadow mode)
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
      poolRows = await ctx.integrations.snowflake_sso.query(
        peerSql,
        ExtendedPeerRow as any,
        allParams,
        { label: "Pull peer benchmark pool" },
      );
    } catch (e: any) {
      ctx.log.error("Peer benchmark query failed", { error: e.message });
      return {
        slides: [],
        benchmarks: { median_nar: 0, avg_nar: 0, pool_size: 0, match_level: "none", match_mode: "portfolio" },
        email_draft: "",
        error: `Peer benchmark query failed: ${e.message}`,
        default_hidden_slides: [],
        market_map_warning: marketMapWarning,
        geocode_diagnostic: geocodeDiagnostic,
        upload_diagnostic: uploadDiagnostic,
      };
    }

    if (poolRows.length === 0) {
      return {
        slides: [],
        benchmarks: { median_nar: 0, avg_nar: 0, pool_size: 0, match_level: "none", match_mode: "portfolio" },
        email_draft: "",
        error: "No comparable Flex properties found for this profile. Try broader attributes.",
        default_hidden_slides: [],
        market_map_warning: marketMapWarning,
        geocode_diagnostic: geocodeDiagnostic,
        upload_diagnostic: uploadDiagnostic,
      };
    }

    // ─── Step 2: 5-Tier Cascade Peer Matching ─────────────────────────────
    // Mirrors pull_peer_benchmark from generator/prospect.py (lines 640-862)
    // Priority order: strongest geo match first, stops at the tier that clears threshold.
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
    function withRentBand(frame: any[], threshold: number, useOverlapRent = false): [any[], boolean] {
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
    // Uses Flask's bucket system (single/regional/multi/national), not raw state count
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
    // Concentration = overlap_property_count / property_count (NOT units!)
    // Threshold: min_pool_size (3) — a true 1:1 match is valuable even with a small sample
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
    // Threshold: min_pool_size (3). Footprint-preferenced.
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
    // Operates on basePool (already narrowed to established). Threshold: NOT_THIN (6).
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
    // Operates on basePool (established-narrowed). Classifies prospect by total_units into a
    // segment tier, then filters pool to same/adjacent segments. No threshold beyond min_pool_size.
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

    ctx.log.info("Peer matching result", {
      tierUsed, poolSize: pool.length, matchLevel, matchMode, footprint,
      overlapCandidateCount: overlapCandidates.length,
      basePoolSize: basePool.length,
      establishedNarrowed: establishedBase.length >= MIN_POOL_SIZE,
    });

    // Extract peer PMC names
    const peerPmcNames = pool.map((r: any) => r.PMC_NAME);

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

    await Promise.all([
      pullPeerMonthlyMetrics(),
      pullPeerCohort(),
      pullRampCurve(),
      pullPeerAdoptionTrend(),
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

        // Render each market map slide
        for (let rank = 0; rank < marketsWithGuarantee.length; rank++) {
          const { market } = marketsWithGuarantee[rank];
          marketMapRanks.push(rank);

          // Prospect pins in this market
          const rawProspectPins: ProspectPin[] = geocodedProperties
            .filter(p => market.sub_markets.includes(p.dma))
            .map(p => ({ property_name: p.property_name, lat: p.lat, lon: p.lon }));

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
            filteredNetworkPins.slice(0, 300), market.prospect_units, avgRentInput
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
    const moStr = moTotal >= 1e6 ? `$${(moTotal / 1e6).toFixed(1)}M` : `$${(moTotal / 1e3).toFixed(0)}K`;
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

    // Resident/household terminology (Kevin's ask) — applied once here, to every fully-
    // assembled piece of output text, same as get-pmc-monthly-report.ts's deck/notes.
    const termedSlides = slides.map((s) => ({ ...s, html: applyTerminology(s.html, terminology) }));
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
