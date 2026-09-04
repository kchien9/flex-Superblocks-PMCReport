import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

const PMCNameRowSchema = z.object({
  PMC_NAME: z.string(),
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

export default api({
  name: "GetPMCNames",
  description: "Fetches distinct PMC names active in the last 12 months.",

  integrations: {
    snowflake_sso: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({}),

  output: z.object({
    pmcNames: z.array(z.string()),
  }),

  async run(ctx) {
    const cutoff = bpSafeCutoff();
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

    return { pmcNames: rows.map((r) => r.PMC_NAME) };
  },
});
