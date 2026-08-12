import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

const PropertyRowSchema = z.object({
  PROPERTY_ID: z.coerce.string(),
  PROPERTY_NAME: z.string().nullable(),
  BP_MONTH: z.string(),
  ROLLED_OUT: z.coerce.number(),
  ENGAGED_UNITS: z.coerce.number(),
  NEW_SIGNUPS_COUNT: z.coerce.number(),
  INITIATIONS_COUNT: z.coerce.number(),
  BILLS_PAID_COUNT: z.coerce.number(),
  BP_RATE: z.coerce.number().nullable(),
  ENGAGEMENT_RATE: z.coerce.number().nullable(),
  SIGNUP_RATE: z.coerce.number().nullable(),
  CURRENT_TIER: z.string().nullable(),
  INTEGRATION_TYPE: z.string().nullable(),
  HAS_PAYMENT_INTEGRATION: z.coerce.boolean().nullable(),
  IS_INTEGRATED_TOTAL: z.coerce.boolean().nullable(),
  MONTHS_FROM_ROLLOUT: z.coerce.number().nullable(),
  ENGAGED_UNITS_MOM_CHANGE: z.coerce.number().nullable(),
  PREVIOUS_MONTH_BILLS_PAID_COUNT: z.coerce.number().nullable(),
  PROPERTY_CITY: z.string().nullable(),
  PROPERTY_STATE: z.string().nullable(),
});

export type PropertyRow = z.infer<typeof PropertyRowSchema>;

export default api({
  name: "GetPMCPropertyDetail",
  description: "Fetches property-level stats for a PMC over the last 12 months",

  integrations: {
    sf: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    pmc_id: z.string(),
  }),

  output: z.object({
    properties: z.array(PropertyRowSchema),
  }),

  async run(ctx, { pmc_id }) {
    const rows = await ctx.integrations.sf.query(
      `SELECT
        p.PROPERTY_ID,
        p.PROPERTY_NAME,
        p.BP_MONTH,
        p.PROPERTY_UNIT_COUNT AS ROLLED_OUT,
        p.ENGAGED_UNITS,
        p.NEW_SIGNUPS_COUNT,
        p.INITIATIONS_COUNT,
        p.BILLS_PAID_COUNT,
        p.BILLS_PAID_COUNT::FLOAT / NULLIF(p.PROPERTY_UNIT_COUNT, 0) AS BP_RATE,
        p.ENGAGED_UNITS::FLOAT / NULLIF(p.PROPERTY_UNIT_COUNT, 0) AS ENGAGEMENT_RATE,
        p.NEW_SIGNUPS_COUNT::FLOAT / NULLIF(p.PROPERTY_UNIT_COUNT, 0) AS SIGNUP_RATE,
        p.CURRENT_TIER,
        p.INTEGRATION_TYPE,
        p.HAS_PAYMENT_INTEGRATION,
        p.IS_INTEGRATED_TOTAL,
        p.MONTHS_FROM_ROLLOUT,
        p.ENGAGED_UNITS_MOM_CHANGE,
        p.PREVIOUS_MONTH_BILLS_PAID_COUNT,
        p.PROPERTY_CITY,
        p.PROPERTY_STATE
      FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS p
      WHERE p.PMC_ID = ?
        AND p.IS_ROLLED_OUT = TRUE
        AND p.BP_MONTH BETWEEN
            DATEADD(MONTH, -12, DATE_TRUNC('MONTH', CURRENT_DATE()))
            AND DATEADD(MONTH, 1, DATE_TRUNC('MONTH', CURRENT_DATE()))
      ORDER BY p.PROPERTY_NAME, p.BP_MONTH`,
      PropertyRowSchema,
      [pmc_id],
      { label: "Fetch PMC property detail" }
    );

    return { properties: rows };
  },
});
