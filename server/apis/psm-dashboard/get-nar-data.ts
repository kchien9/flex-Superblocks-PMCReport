import { api, z, snowflake } from "@superblocksteam/sdk-api";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

// Raw row schema from Snowflake (UPPERCASE columns)
const NARRowSchema = z.object({
  PMC_ID: z.coerce.string(),
  PMC_NAME: z.string(),
  ACCOUNT_SALESFORCE_ID: z.string().nullable(),
  PSM: z.string().nullable(),
  PSM_EMAIL: z.string().nullable(),
  PMS: z.string().nullable(),
  BP_MONTH: z.string(),
  PROPERTY_COUNT: z.coerce.number(),
  PROPERTY_UNIT_COUNT: z.coerce.number(),
  BILLS_PAID: z.coerce.number(),
  RENT_PAID: z.coerce.number().nullable(),
  RENT_PAID_AVG: z.coerce.number().nullable(),
  ADOPTION_RATE: z.coerce.number().nullable(),
  NEW_ROLLED_OUT_PROPERTIES: z.coerce.number(),
  NEW_ROLLED_OUT_UNITS: z.coerce.number(),
  MONTHS_FROM_ROLLOUT_AVG: z.coerce.number().nullable(),
  NEW_USER_ACTIVATIONS: z.coerce.number(),
  REPEAT_USERS: z.coerce.number(),
  NEW_ACTIVATIONS_PCT: z.coerce.number().nullable(),
  REPEAT_USERS_PCT: z.coerce.number().nullable(),
});

// Output account shape after JS transformation
const HistoryPointSchema = z.object({
  month: z.string(),
  adoptionRate: z.number().nullable(),
  billsPaid: z.number(),
  units: z.number(),
});

const CurrentMetricsSchema = z.object({
  adoptionRate: z.number().nullable(),
  billsPaid: z.number(),
  units: z.number(),
  properties: z.number(),
  rentPaid: z.number().nullable(),
  newActivations: z.number(),
  repeatUsers: z.number(),
  newActivationsPct: z.number().nullable(),
  repeatUsersPct: z.number().nullable(),
  monthsFromRollout: z.number().nullable(),
  month: z.string(),
});

const AccountSchema = z.object({
  pmcId: z.string(),
  pmcName: z.string(),
  salesforceId: z.string().nullable(),
  psm: z.string().nullable(),
  psmEmail: z.string().nullable(),
  pms: z.string().nullable(),
  current: CurrentMetricsSchema.nullable(),
  trendDelta: z.number(),
  health: z.enum(["Critical", "At Risk", "Healthy"]),
  vsTarget: z.number().nullable(),
  history: z.array(HistoryPointSchema),
});

export default api({
  name: "GetPSMNARData",
  description: "Queries Snowflake V2 for PSM NAR data and transforms into account-level metrics.",

  integrations: {
    db: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    psm_emails_json: z.string().default("[]"),
    months_back: z.number().int().default(12),
  }),

  output: z.object({
    accounts: z.array(AccountSchema),
  }),

  async run(ctx, { psm_emails_json, months_back }) {
    // Validate the JSON input
    let psmEmails: string[];
    try {
      psmEmails = JSON.parse(psm_emails_json);
      if (!Array.isArray(psmEmails)) psmEmails = [];
    } catch {
      psmEmails = [];
    }

    const safeJson = JSON.stringify(psmEmails);

    const rows = await ctx.integrations.db.query(
      `SELECT
          p.PMC_ID,
          p.PMC_NAME,
          MAX(s.ACCOUNT_SALESFORCE_ID)                    AS ACCOUNT_SALESFORCE_ID,
          MAX(s.PARTNER_SUCCESS_MANAGER_NAME)             AS PSM,
          MAX(s.PARTNER_SUCCESS_MANAGER_EMAIL)            AS PSM_EMAIL,
          MAX(s.ACCOUNT_PROPERTY_MANAGEMENT_SOFTWARES)    AS PMS,
          TO_VARCHAR(p.BP_MONTH, 'YYYY-MM-DD')            AS BP_MONTH,
          COUNT(DISTINCT p.PROPERTY_ID)                   AS PROPERTY_COUNT,
          SUM(p.PROPERTY_UNIT_COUNT)                      AS PROPERTY_UNIT_COUNT,
          SUM(p.BILLS_PAID_COUNT)                         AS BILLS_PAID,
          SUM(p.RENT_PAID_AMOUNT)                         AS RENT_PAID,
          SUM(p.RENT_PAID_AMOUNT)
              / NULLIF(SUM(p.BILLS_PAID_COUNT), 0)        AS RENT_PAID_AVG,
          SUM(p.BILLS_PAID_COUNT)::FLOAT
              / NULLIF(SUM(p.PROPERTY_UNIT_COUNT), 0)     AS ADOPTION_RATE,
          SUM(CASE WHEN p.IS_NEW_ROLLOUT THEN 1 ELSE 0 END)
                                                          AS NEW_ROLLED_OUT_PROPERTIES,
          SUM(CASE WHEN p.IS_NEW_ROLLOUT THEN p.PROPERTY_UNIT_COUNT ELSE 0 END)
                                                          AS NEW_ROLLED_OUT_UNITS,
          AVG(p.MONTHS_FROM_ROLLOUT)                      AS MONTHS_FROM_ROLLOUT_AVG,
          SUM(p.NEW_USER_ACTIVATION_AT_PROPERTY_COUNT)    AS NEW_USER_ACTIVATIONS,
          SUM(p.BILLS_PAID_COUNT)
              - SUM(p.NEW_USER_ACTIVATION_AT_PROPERTY_COUNT)
                                                          AS REPEAT_USERS,
          SUM(p.NEW_USER_ACTIVATION_AT_PROPERTY_COUNT)::FLOAT
              / NULLIF(SUM(p.BILLS_PAID_COUNT), 0)        AS NEW_ACTIVATIONS_PCT,
          (SUM(p.BILLS_PAID_COUNT) - SUM(p.NEW_USER_ACTIVATION_AT_PROPERTY_COUNT))::FLOAT
              / NULLIF(SUM(p.BILLS_PAID_COUNT), 0)        AS REPEAT_USERS_PCT
      FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS p
      JOIN PRODUCTION.SALES.DIM_SALES_ACCOUNTS s
          ON p.PMC_ID = s.PMC_ID
      WHERE p.IS_ROLLED_OUT = TRUE
        AND p.BP_MONTH BETWEEN
            DATEADD(MONTH, -?, DATE_TRUNC('MONTH', CURRENT_DATE()))
            AND DATEADD(MONTH, 1, DATE_TRUNC('MONTH', CURRENT_DATE()))
        AND s.PARTNER_SUCCESS_MANAGER_NAME IS NOT NULL
        AND (
            ARRAY_SIZE(PARSE_JSON(?)) = 0
            OR s.PARTNER_SUCCESS_MANAGER_EMAIL IN (
                SELECT value::TEXT FROM TABLE(FLATTEN(PARSE_JSON(?)))
            )
        )
      GROUP BY p.PMC_ID, p.PMC_NAME, p.BP_MONTH
      ORDER BY p.PMC_NAME, p.BP_MONTH
      LIMIT 2000`,
      NARRowSchema,
      [months_back, safeJson, safeJson],
      { label: "Fetch PSM NAR data from Snowflake" }
    );

    // JavaScript transformation
    const today = new Date();
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const HEALTHY_THRESHOLD = 0.10;
    const AT_RISK_THRESHOLD = 0.02;
    const TREND_CRITICAL = -0.03;
    const TREND_AT_RISK = -0.01;
    const TARGET_RATE = 0.10;

    function classifyHealth(rate: number | null, trend: number): "Critical" | "At Risk" | "Healthy" {
      if (rate === null || rate < AT_RISK_THRESHOLD) return "Critical";
      if (trend < TREND_CRITICAL && rate < HEALTHY_THRESHOLD) return "Critical";
      if (rate < HEALTHY_THRESHOLD) return "At Risk";
      if (trend < TREND_AT_RISK) return "At Risk";
      return "Healthy";
    }

    // Group rows by PMC_ID
    const grouped: Record<string, typeof rows> = {};
    for (const row of rows) {
      if (!grouped[row.PMC_ID]) grouped[row.PMC_ID] = [];
      grouped[row.PMC_ID].push(row);
    }

    const accounts = Object.values(grouped).map((pmcRows) => {
      const sorted = pmcRows.sort(
        (a, b) => new Date(a.BP_MONTH).getTime() - new Date(b.BP_MONTH).getTime()
      );
      const finalized = sorted.filter((r) => new Date(r.BP_MONTH) < currentMonthStart);
      const active = finalized.filter((r) => r.BILLS_PAID > 0);
      const current = active[active.length - 1] || null;
      const previous = active[active.length - 2] || null;
      const trendDelta =
        current && previous
          ? (current.ADOPTION_RATE ?? 0) - (previous.ADOPTION_RATE ?? 0)
          : 0;
      const history = finalized.slice(-12).map((r) => ({
        month: r.BP_MONTH,
        adoptionRate: r.ADOPTION_RATE,
        billsPaid: r.BILLS_PAID,
        units: r.PROPERTY_UNIT_COUNT,
      }));
      const first = pmcRows[0];
      const health = current ? classifyHealth(current.ADOPTION_RATE, trendDelta) : "Critical";

      return {
        pmcId: first.PMC_ID,
        pmcName: first.PMC_NAME,
        salesforceId: first.ACCOUNT_SALESFORCE_ID,
        psm: first.PSM,
        psmEmail: first.PSM_EMAIL,
        pms: first.PMS,
        current: current
          ? {
              adoptionRate: current.ADOPTION_RATE,
              billsPaid: current.BILLS_PAID,
              units: current.PROPERTY_UNIT_COUNT,
              properties: current.PROPERTY_COUNT,
              rentPaid: current.RENT_PAID,
              newActivations: current.NEW_USER_ACTIVATIONS,
              repeatUsers: current.REPEAT_USERS,
              newActivationsPct: current.NEW_ACTIVATIONS_PCT,
              repeatUsersPct: current.REPEAT_USERS_PCT,
              monthsFromRollout: current.MONTHS_FROM_ROLLOUT_AVG,
              month: current.BP_MONTH,
            }
          : null,
        trendDelta,
        health,
        vsTarget: current ? (current.ADOPTION_RATE ?? 0) - TARGET_RATE : null,
        history,
      };
    });

    // Sort by adoption rate descending
    accounts.sort(
      (a, b) => (b.current?.adoptionRate ?? 0) - (a.current?.adoptionRate ?? 0)
    );

    return { accounts };
  },
});
