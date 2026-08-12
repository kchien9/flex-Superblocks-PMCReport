import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

export default api({
  name: "TestSnowflakeConnection",
  description: "Tests the Snowflake SSO connection with a lightweight query.",

  integrations: {
    sf: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({}),

  output: z.object({
    currentUser: z.string(),
    currentRole: z.string(),
    currentWarehouse: z.string(),
  }),

  async run(ctx) {
    const ResultSchema = z.object({
      CURRENT_USER: z.string(),
      CURRENT_ROLE: z.string(),
      CURRENT_WAREHOUSE: z.string(),
    });

    const rows = await ctx.integrations.sf.query(
      "SELECT CURRENT_USER() AS CURRENT_USER, CURRENT_ROLE() AS CURRENT_ROLE, CURRENT_WAREHOUSE() AS CURRENT_WAREHOUSE",
      ResultSchema,
      [],
      { label: "Test Snowflake connection" }
    );

    if (rows.length === 0) {
      throw new Error("No result returned from Snowflake");
    }

    return {
      currentUser: rows[0].CURRENT_USER,
      currentRole: rows[0].CURRENT_ROLE,
      currentWarehouse: rows[0].CURRENT_WAREHOUSE,
    };
  },
});
