import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

export default api({
  name: "LogConsoleActivity",
  description: "Writes a CONSOLE_ACTIVITY row to track module usage",

  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    module: z.string(),
    action: z.string(),
  }),

  output: z.object({
    success: z.boolean(),
  }),

  async run(ctx, { module, action }) {
    const operator = ctx.user?.name || ctx.user?.email || "Unknown";

    await ctx.integrations.db.execute(
      `INSERT INTO SCRATCH_DATA.SALES.CONSOLE_ACTIVITY (operator, module, action)
       VALUES (?, ?, ?)`,
      [operator, module, action],
      { label: `Log activity: ${module} - ${action}` }
    );

    return { success: true };
  },
});
