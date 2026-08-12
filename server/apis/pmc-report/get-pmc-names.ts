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
       FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
       WHERE PMC_NAME IS NOT NULL
         AND BP_MONTH >= DATEADD('month', -12, CURRENT_DATE())
         AND BP_MONTH < ?
       ORDER BY PMC_NAME`,
      PMCNameRowSchema,
      [cutoff],
      { label: "Fetch distinct PMC names (12mo recency)" }
    );

    return { pmcNames: rows.map((r) => r.PMC_NAME) };
  },
});
