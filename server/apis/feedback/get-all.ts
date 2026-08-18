import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

const RawFeedbackSchema = z.object({
  FEEDBACK_ID: z.string(),
  TS: z.string(),
  USER_EMAIL: z.string(),
  USER_NAME: z.string().nullable(),
  PAGE: z.string(),
  MESSAGE: z.string(),
});

export default api({
  name: "GetFeedback",
  description: "Retrieves all feedback entries, newest first",

  integrations: {
    snowflake_sso_v2: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({}),

  output: z.object({
    feedback: z.array(z.object({
      id: z.string(),
      timestamp: z.string(),
      user_email: z.string(),
      user_name: z.string().nullable(),
      page: z.string(),
      message: z.string(),
    })),
  }),

  async run(ctx) {
    const rows = await ctx.integrations.snowflake_sso_v2.query(
      `SELECT FEEDBACK_ID, TS, USER_EMAIL, USER_NAME, PAGE, MESSAGE
       FROM SCRATCH_DATA.SALES.FEEDBACK
       ORDER BY TS DESC
       LIMIT 500`,
      RawFeedbackSchema,
      [],
      { label: "Fetch all feedback" }
    );

    return {
      feedback: rows.map((r) => ({
        id: r.FEEDBACK_ID,
        timestamp: r.TS,
        user_email: r.USER_EMAIL,
        user_name: r.USER_NAME,
        page: r.PAGE,
        message: r.MESSAGE,
      })),
    };
  },
});
