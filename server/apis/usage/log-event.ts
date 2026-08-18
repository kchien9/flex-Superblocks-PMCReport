import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

export default api({
  name: "LogUsageEvent",
  description: "Inserts a usage event row into Snowflake USAGE_EVENTS table",

  integrations: {
    snowflake_sso_v2: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    event_type: z.string(),
    module: z.string(),
    metadata: z.record(z.unknown()).nullable(),
  }),

  output: z.object({
    success: z.boolean(),
  }),

  async run(ctx, { event_type, module, metadata }) {
    const userEmail = ctx.user?.email || "unknown";
    const userName = ctx.user?.name || ctx.user?.email || "Unknown";
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    await ctx.integrations.snowflake_sso_v2.execute(
      `INSERT INTO SCRATCH_DATA.SALES.USAGE_EVENTS (user_email, user_name, event_type, module, metadata)
       SELECT ?, ?, ?, ?, PARSE_JSON(?)`,
      [userEmail, userName, event_type, module, metadataJson],
      { label: `Log usage: ${module} - ${event_type}` }
    );

    return { success: true };
  },
});
