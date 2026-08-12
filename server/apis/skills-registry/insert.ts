import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

export default api({
  name: "InsertSkill",
  description: "Inserts a new skill into the registry.",

  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    skill_type: z.string(),
    data_source: z.string(),
    code_or_query: z.string().nullable().optional(),
    modules_using: z.string(),
    owner: z.string(),
  }),

  output: z.object({
    success: z.boolean(),
  }),

  async run(ctx, { id, name, description, skill_type, data_source, code_or_query, modules_using, owner }) {
    await ctx.integrations.db.execute(
      `INSERT INTO SCRATCH_DATA.SALES.SKILL_REGISTRY (ID, NAME, DESCRIPTION, SKILL_TYPE, DATA_SOURCE, CODE_OR_QUERY, CONTENT_LIBRARY_DOC, MODULES_USING, OWNER, UPDATED_BY, UPDATED_AT)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, CURRENT_TIMESTAMP())`,
      [id, name, description, skill_type, data_source, code_or_query ?? null, modules_using, owner, owner],
      { label: "Insert new skill" }
    );

    return { success: true };
  },
});
