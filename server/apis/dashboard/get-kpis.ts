import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

const KPIRowSchema = z.object({
  IU: z.coerce.number().nullable(),
  NIRO: z.coerce.number().nullable(),
  TOTAL_UNITS: z.coerce.number().nullable(),
  BILLS_PAID: z.coerce.number().nullable(),
  ANNUALIZED_REVENUE_M: z.coerce.number().nullable(),
  PORTFOLIO_ADOPTION_RATE: z.coerce.number().nullable(),
});

export default api({
  name: "GetDashboardKPIs",
  description: "Fetches portfolio KPIs from Snowflake for the Dashboard page",

  integrations: {
    sf: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({}),

  output: z.object({
    iu: z.number().nullable(),
    niro: z.number().nullable(),
    totalUnits: z.number().nullable(),
    billsPaid: z.number().nullable(),
    annualizedRevenueM: z.number().nullable(),
    portfolioAdoptionRate: z.number().nullable(),
  }),

  async run(ctx) {
    const rows = await ctx.integrations.sf.query(
      `SELECT
        SUM(CASE WHEN IS_INTEGRATED_TOTAL = TRUE THEN PROPERTY_UNIT_COUNT ELSE 0 END) AS IU,
        SUM(CASE WHEN IS_NON_INTEGRATED_ROLLED_OUT = TRUE THEN PROPERTY_UNIT_COUNT ELSE 0 END) AS NIRO,
        SUM(PROPERTY_UNIT_COUNT) AS TOTAL_UNITS,
        SUM(BILLS_PAID_COUNT) AS BILLS_PAID,
        ROUND(SUM(RENT_PAID_AMOUNT) * 12 / 1000000, 1) AS ANNUALIZED_REVENUE_M,
        SUM(BILLS_PAID_COUNT)::FLOAT / NULLIF(SUM(PROPERTY_UNIT_COUNT), 0) AS PORTFOLIO_ADOPTION_RATE
      FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
      WHERE IS_ROLLED_OUT = TRUE
        AND BP_MONTH = DATE_TRUNC('MONTH', DATEADD(MONTH, -1, CURRENT_DATE()))`,
      KPIRowSchema,
      [],
      { label: "Fetch dashboard KPIs" }
    );

    const row = rows[0] ?? null;

    return {
      iu: row?.IU ?? null,
      niro: row?.NIRO ?? null,
      totalUnits: row?.TOTAL_UNITS ?? null,
      billsPaid: row?.BILLS_PAID ?? null,
      annualizedRevenueM: row?.ANNUALIZED_REVENUE_M ?? null,
      portfolioAdoptionRate: row?.PORTFOLIO_ADOPTION_RATE ?? null,
    };
  },
});
