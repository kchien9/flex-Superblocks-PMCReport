import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

const ContentDocSchema = z.object({
  ID: z.string(),
  NAME: z.string(),
  DISPLAY_NAME: z.string(),
  DESCRIPTION: z.string().nullable(),
  CONTENT: z.string().nullable(),
  CATEGORY: z.string(),
  LINKED_SKILL: z.string().nullable(),
  UPDATED_BY: z.string().nullable(),
  UPDATED_AT: z.string().nullable(),
});

export default api({
  name: "GetContextDocument",
  description: "Reusable workflow: fetches a single content document by name.",

  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    document_name: z.string(),
  }),

  output: z.object({
    document: ContentDocSchema.nullable(),
    error: z.string().nullable(),
  }),

  async run(ctx, { document_name }) {
    const rows = await ctx.integrations.db.query(
      `SELECT
        ID,
        NAME,
        DISPLAY_NAME,
        DESCRIPTION,
        CONTENT,
        CATEGORY,
        LINKED_SKILL,
        UPDATED_BY,
        TO_VARCHAR(UPDATED_AT, 'YYYY-MM-DD HH24:MI:SS') AS UPDATED_AT
      FROM SCRATCH_DATA.SALES.CONTENT_LIBRARY
      WHERE NAME = ?
      LIMIT 1`,
      ContentDocSchema,
      [document_name],
      { label: `Fetch document: ${document_name}` }
    );

    if (rows.length === 0) {
      return { document: null, error: `Document not found: ${document_name}` };
    }

    return { document: rows[0], error: null };
  },
});
