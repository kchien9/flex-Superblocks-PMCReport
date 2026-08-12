import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

const SkillSchema = z.object({
  ID: z.string(),
  NAME: z.string(),
  DESCRIPTION: z.string().nullable(),
  SKILL_TYPE: z.string(),
  DATA_SOURCE: z.string().nullable(),
  CODE_OR_QUERY: z.string().nullable(),
  CONTENT_LIBRARY_DOC: z.string().nullable(),
  MODULES_USING: z.string().nullable(),
  OWNER: z.string().nullable(),
  UPDATED_BY: z.string().nullable(),
  UPDATED_AT: z.string().nullable(),
});

export default api({
  name: "GetSkillRegistry",
  description: "Fetches all skills from the registry ordered by type and name.",

  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({}),

  output: z.object({
    skills: z.array(SkillSchema),
  }),

  async run(ctx) {
    const skills = await ctx.integrations.db.query(
      `SELECT ID, NAME, DESCRIPTION, SKILL_TYPE, DATA_SOURCE, CODE_OR_QUERY, CONTENT_LIBRARY_DOC, MODULES_USING, OWNER, UPDATED_BY, UPDATED_AT
       FROM SCRATCH_DATA.SALES.SKILL_REGISTRY
       ORDER BY SKILL_TYPE, NAME`,
      SkillSchema,
      [],
      { label: "Fetch all skills" }
    );

    return { skills };
  },
});
