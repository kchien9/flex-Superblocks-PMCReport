import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

export default api({
  name: "SubmitFeedback",
  description: "Inserts user feedback into the FEEDBACK table",

  integrations: {
    snowflake_sso_v2: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    page: z.string(),
    message: z.string().min(1),
  }),

  output: z.object({
    success: z.boolean(),
  }),

  async run(ctx, { page, message }) {
    const userEmail = ctx.user?.email || "unknown";
    const userName = ctx.user?.name || ctx.user?.email || "Unknown";

    await ctx.integrations.snowflake_sso_v2.execute(
      `INSERT INTO SCRATCH_DATA.SALES.FEEDBACK (user_email, user_name, page, message)
       SELECT ?, ?, ?, ?`,
      [userEmail, userName, page, message],
      { label: `Submit feedback from ${page}` }
    );

    ctx.log.info("Feedback submitted", { userEmail, page });
    return { success: true };
  },
});
