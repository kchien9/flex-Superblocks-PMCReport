import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

export default api({
  name: "UpdateSkill",
  description: "Updates a skill's description and modules_using fields.",

  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    id: z.string(),
    description: z.string(),
    modules_using: z.string(),
    updated_by: z.string(),
  }),

  output: z.object({
    success: z.boolean(),
  }),

  async run(ctx, { id, description, modules_using, updated_by }) {
    await ctx.integrations.db.execute(
      `UPDATE SCRATCH_DATA.SALES.SKILL_REGISTRY
       SET DESCRIPTION = ?, MODULES_USING = ?, UPDATED_BY = ?, UPDATED_AT = CURRENT_TIMESTAMP()
       WHERE ID = ?`,
      [description, modules_using, updated_by, id],
      { label: "Update skill" }
    );

    return { success: true };
  },
});
