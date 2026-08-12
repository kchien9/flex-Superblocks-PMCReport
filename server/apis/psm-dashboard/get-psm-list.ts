import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

const PSMRowSchema = z.object({
  PARTNER_SUCCESS_MANAGER_NAME: z.string(),
  PARTNER_SUCCESS_MANAGER_EMAIL: z.string(),
});

export default api({
  name: "GetPSMList",
  description: "Fetches distinct PSM names and emails for the filter dropdown",
  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
  },
  input: z.object({}),
  output: z.object({
    psms: z.array(z.object({ name: z.string(), email: z.string() })),
  }),
  async run(ctx) {
    const rows = await ctx.integrations.db.query(
      `SELECT DISTINCT
        PARTNER_SUCCESS_MANAGER_NAME,
        PARTNER_SUCCESS_MANAGER_EMAIL
      FROM PRODUCTION.SALES.DIM_SALES_ACCOUNTS
      WHERE PARTNER_SUCCESS_MANAGER_EMAIL IS NOT NULL
        AND PARTNER_SUCCESS_MANAGER_NAME IS NOT NULL
      ORDER BY PARTNER_SUCCESS_MANAGER_NAME
      LIMIT 200`,
      PSMRowSchema,
      [],
      { label: "Fetch PSM list for dropdown" }
    );

    return {
      psms: rows.map((r) => ({
        name: r.PARTNER_SUCCESS_MANAGER_NAME,
        email: r.PARTNER_SUCCESS_MANAGER_EMAIL,
      })),
    };
  },
});
