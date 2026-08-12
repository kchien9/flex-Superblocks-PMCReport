import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

export default api({
  name: "UpdateContentDocument",
  description: "Updates a content document's display_name, description, and content.",

  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    id: z.string(),
    display_name: z.string(),
    description: z.string(),
    content: z.string(),
  }),

  output: z.object({
    success: z.boolean(),
  }),

  async run(ctx, { id, display_name, description, content }) {
    const email = ctx.user.email ?? "unknown";

    await ctx.integrations.db.execute(
      `UPDATE SCRATCH_DATA.SALES.CONTENT_LIBRARY
       SET DISPLAY_NAME = ?,
           DESCRIPTION = ?,
           CONTENT = ?,
           UPDATED_BY = ?,
           UPDATED_AT = CURRENT_TIMESTAMP()
       WHERE ID = ?`,
      [display_name, description, content, email, id],
      { label: "Update content document" }
    );

    return { success: true };
  },
});
