import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

export default api({
  name: "InsertContentDocument",
  description: "Inserts a new document into the content library.",

  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    id: z.string(),
    name: z.string(),
    display_name: z.string(),
    description: z.string(),
    category: z.string(),
    linked_skill: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    updated_by: z.string(),
  }),

  output: z.object({
    success: z.boolean(),
  }),

  async run(ctx, { id, name, display_name, description, category, linked_skill, content, updated_by }) {
    await ctx.integrations.db.execute(
      `INSERT INTO SCRATCH_DATA.SALES.CONTENT_LIBRARY (ID, NAME, DISPLAY_NAME, DESCRIPTION, CONTENT, CATEGORY, LINKED_SKILL, UPDATED_BY, UPDATED_AT)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP())`,
      [id, name, display_name, description, content ?? null, category, linked_skill ?? null, updated_by],
      { label: "Insert content library document" }
    );

    return { success: true };
  },
});
