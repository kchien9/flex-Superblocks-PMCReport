import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

const RawRowSchema = z.record(z.unknown());

const UserUsageSchema = z.object({
  user_email: z.string(),
  user_name: z.string().nullable(),
  total_events: z.number(),
  page_views: z.number(),
  pitchprep_generations: z.number(),
  pmc_generations: z.number(),
  modules_used: z.string(),
  last_active: z.string(),
});

type UserUsage = z.infer<typeof UserUsageSchema>;

function normalizeRow(row: Record<string, unknown>): UserUsage {
  return {
    user_email: String(row.user_email ?? row.USER_EMAIL ?? "unknown"),
    user_name: row.user_name != null ? String(row.user_name) : row.USER_NAME != null ? String(row.USER_NAME) : null,
    total_events: Number(row.total_events ?? row.TOTAL_EVENTS ?? 0),
    page_views: Number(row.page_views ?? row.PAGE_VIEWS ?? 0),
    pitchprep_generations: Number(row.pitchprep_generations ?? row.PITCHPREP_GENERATIONS ?? 0),
    pmc_generations: Number(row.pmc_generations ?? row.PMC_GENERATIONS ?? 0),
    modules_used: String(row.modules_used ?? row.MODULES_USED ?? ""),
    last_active: String(row.last_active ?? row.LAST_ACTIVE ?? ""),
  };
}

export default api({
  name: "GetUsageStats",
  description: "Queries per-user aggregated usage stats from Snowflake",

  integrations: {
    snowflake_sso_v2: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    days: z.number().nullable(),
  }),

  output: z.object({
    stats: z.array(UserUsageSchema),
  }),

  async run(ctx, { days }) {
    const dateFilter = days
      ? `WHERE ts >= DATEADD('day', -${days}, CURRENT_TIMESTAMP())`
      : "";

    const rawRows = await ctx.integrations.snowflake_sso_v2.query(
      `SELECT
        user_email AS "user_email",
        MAX(user_name) AS "user_name",
        COUNT(*) AS "total_events",
        SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS "page_views",
        SUM(CASE WHEN event_type != 'page_view' AND module = 'PitchPrep' THEN 1 ELSE 0 END) AS "pitchprep_generations",
        SUM(CASE WHEN event_type != 'page_view' AND module = 'PMC Report' THEN 1 ELSE 0 END) AS "pmc_generations",
        LISTAGG(DISTINCT module, ', ') WITHIN GROUP (ORDER BY module) AS "modules_used",
        MAX(ts)::STRING AS "last_active"
      FROM SCRATCH_DATA.SALES.USAGE_EVENTS
      ${dateFilter}
      GROUP BY user_email
      ORDER BY "total_events" DESC
      LIMIT 100`,
      RawRowSchema,
      [],
      { label: "Fetch per-user usage stats" }
    );

    const stats = rawRows.map(normalizeRow);
    return { stats };
  },
});
