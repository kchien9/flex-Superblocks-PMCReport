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

export type ContentDoc = z.infer<typeof ContentDocSchema>;

export default api({
  name: "GetContentLibrary",
  description: "Fetches all documents from the content_library table.",

  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({}),

  output: z.object({
    documents: z.array(ContentDocSchema),
  }),

  async run(ctx) {
    const documents = await ctx.integrations.db.query(
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
      ORDER BY DISPLAY_NAME
      LIMIT 50`,
      ContentDocSchema,
      [],
      { label: "Fetch all content documents" }
    );

    return { documents };
  },
});
