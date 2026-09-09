import { api, z, snowflake } from "@superblocksteam/sdk-api";
import { PMC_PRESETS } from "./pmc-presets.js";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

const PMCNameRowSchema = z.object({
  PMC_NAME: z.string(),
});

const PmcPresetSchema = z.object({
  key: z.string(),
  label: z.string(),
  primaryPmcName: z.string(),
  subsidiaryPmcNames: z.array(z.string()),
});

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

// Platinum-deck picker (Flask list_silver_pmcs, 22d7052; spec: flex-pmc-reports
// docs/superpowers/specs/2026-09-09-platinum-deck-design.md): PMCs with >= PLATINUM_MIN_SILVER
// SILVER properties in-network at the latest completed BP month - silver = HAS_MARKETING_INTEGRATION
// (automatic with DI) and NOT opted in to marketing; a NULL IS_MARKETING_OPT_IN counts as not
// opted in (same reading as platinum.ts splitTierRows). Latest completed month = MAX(BP_MONTH)
// under the same bpSafeCutoff bound the default query uses. Exported for the query-shape test.
export const PLATINUM_MIN_SILVER = 3;
export function silverPmcNamesSql(): string {
  return `SELECT PMC_NAME
       FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS s
       WHERE PMC_NAME IS NOT NULL
         AND BP_MONTH = (SELECT MAX(BP_MONTH) FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS WHERE BP_MONTH < ?)
         AND IS_IN_NETWORK = TRUE
         AND HAS_MARKETING_INTEGRATION = TRUE
         AND COALESCE(IS_MARKETING_OPT_IN, FALSE) = FALSE
         -- Same Deep SMB exclusion as the default picker below (Kevin's tool-wide rule: every
         -- account search in this tool). Flask's list_silver_pmcs has no such clause - Clark's
         -- default list_pmcs mirror already deviates from Flask on exactly this point, so the
         -- Platinum picker follows Clark's own default rather than re-admitting Deep SMB here.
         AND NOT EXISTS (
           SELECT 1 FROM EXTERNAL_DATA.POLYTOMIC.SALESFORCE_ACCOUNT sf
           WHERE REGEXP_REPLACE(UPPER(sf.NAME), '[^A-Z0-9]', '') = REGEXP_REPLACE(UPPER(s.PMC_NAME), '[^A-Z0-9]', '')
             AND sf.SALES_SEGMENT__C = 'Deep SMB'
             AND sf.ISDELETED = FALSE
         )
       GROUP BY PMC_NAME
       HAVING COUNT(DISTINCT PROPERTY_PUBLIC_ID) >= ?
       ORDER BY PMC_NAME`;
}

export default api({
  name: "GetPMCNames",
  description: "Fetches distinct PMC names active in the last 12 months.",

  integrations: {
    snowflake_sso: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    // "platinum" -> the Platinum deck's silver-only picker (see silverPmcNamesSql). Omitted ->
    // the default 12-month-active list, unchanged.
    mode: z.enum(["platinum"]).optional(),
  }),

  output: z.object({
    pmcNames: z.array(z.string()),
    // Known multi-PMC "family" presets (e.g. Asset Living's subsidiaries) — surfaced here so
    // the client can offer a one-click "Load {family}" button without a second round trip.
    // Static config, not Snowflake-derived, but this endpoint is already fetched once per form
    // load, so it's the lowest-friction place to hand it to the client.
    presets: z.array(PmcPresetSchema).optional(),
  }),

  async run(ctx, { mode }) {
    const cutoff = bpSafeCutoff();
    if (mode === "platinum") {
      const silverRows = await ctx.integrations.snowflake_sso.query(
        silverPmcNamesSql(),
        PMCNameRowSchema,
        [cutoff, PLATINUM_MIN_SILVER],
        { label: "Fetch PMC names with >= 3 silver properties at the latest completed BP month (Platinum deck picker)" }
      );
      return { pmcNames: silverRows.map((r) => r.PMC_NAME), presets: PMC_PRESETS };
    }
    const rows = await ctx.integrations.snowflake_sso.query(
      `SELECT DISTINCT PMC_NAME
       FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS s
       WHERE PMC_NAME IS NOT NULL
         AND BP_MONTH >= DATEADD('month', -12, CURRENT_DATE())
         AND BP_MONTH < ?
         -- Deep SMB excluded from every account search in this tool (Kevin's call) - this
         -- segment isn't a fit for either report type. NOT EXISTS (not a JOIN) so a PMC_NAME
         -- with no matching Salesforce account at all is left untouched, not dropped.
         -- Name comparison strips everything but letters/digits before matching, not a bare
         -- UPPER(a)=UPPER(b) - live-verified this matters: Flex's own billing data has this
         -- PMC as "1904Group" (no space) while Salesforce has "1904 Group" (with one), so an
         -- exact-string comparison let the very account that surfaced this bug slip straight
         -- through the filter meant to catch it.
         AND NOT EXISTS (
           SELECT 1 FROM EXTERNAL_DATA.POLYTOMIC.SALESFORCE_ACCOUNT sf
           WHERE REGEXP_REPLACE(UPPER(sf.NAME), '[^A-Z0-9]', '') = REGEXP_REPLACE(UPPER(s.PMC_NAME), '[^A-Z0-9]', '')
             AND sf.SALES_SEGMENT__C = 'Deep SMB'
             AND sf.ISDELETED = FALSE
         )
       ORDER BY PMC_NAME`,
      PMCNameRowSchema,
      [cutoff],
      { label: "Fetch distinct PMC names (12mo recency), excluding Deep SMB" }
    );

    return { pmcNames: rows.map((r) => r.PMC_NAME), presets: PMC_PRESETS };
  },
});
