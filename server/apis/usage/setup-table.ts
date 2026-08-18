import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

export default api({
  name: "SetupUsageTable",
  description: "Creates the USAGE_EVENTS table in Snowflake if it doesn't exist",

  integrations: {
    snowflake_sso_v2: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({}),

  output: z.object({
    created: z.boolean(),
  }),

  async run(ctx) {
    await ctx.integrations.snowflake_sso_v2.execute(
      `CREATE TABLE IF NOT EXISTS SCRATCH_DATA.SALES.USAGE_EVENTS (
        event_id        STRING DEFAULT UUID_STRING(),
        ts              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
        user_email      STRING NOT NULL,
        user_name       STRING,
        event_type      STRING NOT NULL,
        module          STRING NOT NULL,
        metadata        VARIANT
      )`,
      [],
      { label: "Create USAGE_EVENTS table" }
    );

    ctx.log.info("USAGE_EVENTS table created or already exists");
    return { created: true };
  },
});
