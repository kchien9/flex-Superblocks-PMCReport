import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

export default api({
  name: "SetupAuditTables",
  description: "Creates audit tables in SCRATCH_DATA.SALES if they don't exist.",
  integrations: {
    sf: snowflake(SNOWFLAKE_SSO),
  },
  input: z.object({}),
  output: z.object({
    created: z.array(z.string()),
  }),
  async run(ctx) {
    const tables = [
      {
        name: "AUDIT_RUNS",
        ddl: `CREATE TABLE IF NOT EXISTS SCRATCH_DATA.SALES.AUDIT_RUNS (
  run_id        STRING DEFAULT UUID_STRING(),
  audit_type    STRING,
  operator      STRING,
  status        STRING,
  health_score  NUMBER,
  summary       STRING,
  started_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  finished_at   TIMESTAMP_NTZ
)`,
      },
      {
        name: "AUDIT_STEP_STATUS",
        ddl: `CREATE TABLE IF NOT EXISTS SCRATCH_DATA.SALES.AUDIT_STEP_STATUS (
  run_id        STRING,
  step_no       NUMBER,
  step_name     STRING,
  status        STRING,
  error_msg     STRING,
  started_at    TIMESTAMP_NTZ,
  finished_at   TIMESTAMP_NTZ
)`,
      },
      {
        name: "AUDIT_FINDINGS",
        ddl: `CREATE TABLE IF NOT EXISTS SCRATCH_DATA.SALES.AUDIT_FINDINGS (
  run_id        STRING,
  module        STRING,
  severity      STRING,
  finding       STRING,
  object        STRING,
  record_count  NUMBER,
  owner         STRING,
  status        STRING DEFAULT 'OPEN'
)`,
      },
      {
        name: "CONSOLE_ACTIVITY",
        ddl: `CREATE TABLE IF NOT EXISTS SCRATCH_DATA.SALES.CONSOLE_ACTIVITY (
  ts        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  operator  STRING,
  module    STRING,
  action    STRING
)`,
      },
    ];

    const created: string[] = [];
    for (const t of tables) {
      await ctx.integrations.sf.execute(t.ddl, [], { label: `Create ${t.name}` });
      created.push(t.name);
      ctx.log.info(`Created table ${t.name}`);
    }

    return { created };
  },
});
